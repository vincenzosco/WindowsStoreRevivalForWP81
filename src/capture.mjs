// Durable capture of intercepted exchanges.
//
// Every intercepted request/response pair lands in captures/<session>/:
//   index.jsonl      one JSON object per exchange, ordered
//   bodies/*.bin     bodies too large to inline
//
// Writes are serialised through a promise chain so the request path never waits
// on the disk, and a write failure degrades to a log warning instead of breaking
// proxying.

import fsp from 'node:fs/promises';
import path from 'node:path';
import { prettyPath } from './paths.mjs';

const TEXTUAL = /^(text\/|application\/(json|xml|javascript|ecmascript|x-www-form-urlencoded|soap\+xml|problem\+json|xaml))/i;

/**
 * Read a JSONL file line by line, never as one string.
 *
 * A long session's index passes Node's maximum string length, and then
 * `readFileSync(path, 'utf8')` throws `ERR_STRING_TOO_LONG`. Every reader that
 * caught that and fell back to a count reported **zero exchanges** - a session's
 * own record of what the device did, reported as "nothing intercepted yet", at
 * exactly the sizes where the capture matters most. Chunks and whole lines keep
 * the memory flat and the answer true.
 */
export async function* readJsonl(file) {
  const handle = await fsp.open(file, 'r');
  try {
    const buffer = Buffer.alloc(1 << 20);
    let carry = '';
    for (;;) {
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, null);
      if (!bytesRead) break;
      const lines = (carry + buffer.subarray(0, bytesRead).toString('utf8')).split('\n');
      carry = lines.pop() ?? '';
      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed) yield trimmed;
      }
    }
    const last = carry.trim();
    if (last) yield last;
  } finally {
    await handle.close();
  }
}

/** Number of entries in a JSONL file, counted without holding it. */
export async function countJsonl(file) {
  let total = 0;
  for await (const _line of readJsonl(file)) total += 1;
  return total;
}

function sessionStamp() {
  return new Date().toISOString().replace(/[:.]/g, '-').replace('T', '_').slice(0, 19);
}

function isTextual(contentType = '') {
  return TEXTUAL.test(String(contentType));
}

export class Capture {
  constructor({ config, logger }) {
    this.config = config;
    this.log = logger;
    this.enabled = config.capture.enabled;
    this.root = path.resolve(config.capture.dir);
    this.sessionDir = path.join(this.root, `session-${sessionStamp()}`);
    this.bodyDir = path.join(this.sessionDir, 'bodies');
    this.indexPath = path.join(this.sessionDir, 'index.jsonl');
    this.counter = 0;
    this.queue = Promise.resolve();
    this.failures = 0;
    this.ready = false;
  }

  async init() {
    if (!this.enabled) {
      this.log.info('capture disabled');
      return this;
    }
    await fsp.mkdir(this.bodyDir, { recursive: true });
    this.ready = true;
    this.log.info(`capture session: ${prettyPath(this.sessionDir)}`);
    return this;
  }

  /** Queue an exchange for writing. Never rejects. */
  record(exchange) {
    if (!this.enabled || !this.ready) return Promise.resolve();
    this.queue = this.queue
      .then(() => this.#write(exchange))
      .catch((err) => {
        this.failures += 1;
        this.log.warn(`capture write failed: ${err.message}`);
      });
    return this.queue;
  }

  async flush() {
    await this.queue;
  }

  async #storeBody(body, contentType, kind, id) {
    if (!body || body.length === 0) return null;
    const { inlineBodyMaxBytes, maxBodyBytes } = this.config.capture;
    const truncated = body.length > maxBodyBytes;
    const data = truncated ? body.subarray(0, maxBodyBytes) : body;

    if (data.length <= inlineBodyMaxBytes) {
      return isTextual(contentType)
        ? { inline: data.toString('utf8'), truncated, bytes: body.length }
        : { inlineBase64: data.toString('base64'), truncated, bytes: body.length };
    }

    const extension = isTextual(contentType) ? 'txt' : 'bin';
    const file = path.join(this.bodyDir, `${String(id).padStart(4, '0')}-${kind}.${extension}`);
    await fsp.writeFile(file, data);
    return {
      file: path.relative(this.sessionDir, file).split(path.sep).join('/'),
      truncated,
      bytes: body.length,
    };
  }

  async #write(exchange) {
    this.counter += 1;
    const id = this.counter;
    const reqContentType = exchange.request.headers['content-type'] || '';
    const resContentType = exchange.response ? exchange.response.headers['content-type'] || '' : '';

    const requestBody = await this.#storeBody(exchange.request.body, reqContentType, 'req', id);
    const responseBody = exchange.response
      ? await this.#storeBody(exchange.response.body, resContentType, 'res', id)
      : null;

    const line = {
      id,
      ts: new Date().toISOString(),
      durationMs: exchange.durationMs,
      client: exchange.client,
      mitm: exchange.mitm,
      decision: exchange.decision,
      request: {
        method: exchange.request.method,
        scheme: exchange.request.scheme,
        host: exchange.request.host,
        port: exchange.request.port,
        path: exchange.request.path,
        httpVersion: exchange.request.httpVersion,
        headers: exchange.request.headers,
        body: requestBody,
      },
      response: exchange.response
        ? {
            status: exchange.response.status,
            headers: exchange.response.headers,
            body: responseBody,
          }
        : null,
      error: exchange.error || null,
    };

    await fsp.appendFile(this.indexPath, `${JSON.stringify(line)}\n`);
  }
}
