// UDP DNS server.
//
// Contract: resolution must behave exactly as before for every name that is not
// explicitly hijacked. Non-hijacked queries are relayed as raw bytes to the real
// upstream resolver, so EDNS options, DNSSEC records and unusual types all keep
// working untouched. Only names matching `dns.hijack.names` are answered locally
// with the lab IP.

import dgram from 'node:dgram';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { matchesAny, dnsBindCandidates } from './config.mjs';

const TYPE_A = 1;
const TYPE_AAAA = 28;

const TYPES = {
  1: 'A', 2: 'NS', 5: 'CNAME', 6: 'SOA', 12: 'PTR', 15: 'MX', 16: 'TXT',
  28: 'AAAA', 33: 'SRV', 43: 'DS', 46: 'RRSIG', 47: 'NSEC', 48: 'DNSKEY',
  64: 'SVCB', 65: 'HTTPS', 255: 'ANY',
};

const typeName = (t) => TYPES[t] || `TYPE${t}`;

/**
 * Parse the first question of a DNS message.
 * @returns {{id:number, flags:number, qname:string, qtype:number, qclass:number, questionEnd:number}|null}
 */
export function parseQuestion(buf) {
  if (buf.length < 12) return null;
  const id = buf.readUInt16BE(0);
  const flags = buf.readUInt16BE(2);
  if (buf.readUInt16BE(4) !== 1) return null; // only single-question queries are hijacked
  let offset = 12;
  const labels = [];
  for (;;) {
    if (offset >= buf.length) return null;
    const len = buf[offset];
    if (len === 0) {
      offset += 1;
      break;
    }
    if ((len & 0xc0) === 0xc0) return null; // compression is illegal in a question
    if (offset + 1 + len > buf.length) return null;
    labels.push(buf.toString('ascii', offset + 1, offset + 1 + len));
    offset += 1 + len;
    if (labels.length > 127) return null;
  }
  if (offset + 4 > buf.length) return null;
  return {
    id,
    flags,
    qname: labels.join('.'),
    qtype: buf.readUInt16BE(offset),
    qclass: buf.readUInt16BE(offset + 2),
    questionEnd: offset + 4,
  };
}

/**
 * Build the reply for a hijacked name: header + echoed question + optional A answer.
 * A queries get one A record; everything else (AAAA and exotic types) gets a
 * clean NOERROR with zero answers so the client falls back to IPv4 instead of
 * waiting for a timeout or an NXDOMAIN failure.
 */
export function serialiseHijack(queryBuf, query, ip, { ttl = 60 } = {}) {
  const answerCount = query.qtype === TYPE_A ? 1 : 0;

  const header = Buffer.alloc(12);
  header.writeUInt16BE(query.id, 0);
  header.writeUInt16BE(0x8080 | (query.flags & 0x0100), 2); // QR=1, RA=1, echo RD
  header.writeUInt16BE(1, 4);
  header.writeUInt16BE(answerCount, 6);
  header.writeUInt16BE(0, 8);
  header.writeUInt16BE(0, 10);

  const question = queryBuf.subarray(12, query.questionEnd);
  const answer = Buffer.alloc(answerCount ? 16 : 0);
  if (answerCount === 1) {
    answer.writeUInt16BE(0xc00c, 0); // name: compression pointer to offset 12
    answer.writeUInt16BE(TYPE_A, 2);
    answer.writeUInt16BE(1, 4);      // class IN
    answer.writeUInt32BE(ttl, 6);
    answer.writeUInt16BE(4, 10);     // RDLENGTH
    const octets = String(ip).split('.').map((n) => Number(n) & 0xff);
    answer.writeUInt8(octets[0], 12);
    answer.writeUInt8(octets[1], 13);
    answer.writeUInt8(octets[2], 14);
    answer.writeUInt8(octets[3], 15);
  }

  return Buffer.concat([header, question, answer]);
}

/** SERVFAIL that echoes the question, used when every upstream resolver fails. */
export function buildServfail(queryBuf) {
  const question = parseQuestion(queryBuf);
  const end = question ? question.questionEnd : Math.max(12, queryBuf.length);
  const buf = Buffer.from(queryBuf.subarray(0, end));
  if (buf.length < 12) return null;
  buf.writeUInt16BE(0x8182, 2); // QR=1, RD=1, RA=1, RCODE=SERVFAIL
  buf.writeUInt16BE(0, 6);
  buf.writeUInt16BE(0, 8);
  buf.writeUInt16BE(0, 10);
  return buf;
}

/** Read the TTL of the first answer record so relayed replies can be cached sanely. */
function firstAnswerTtl(msg) {
  try {
    const question = parseQuestion(msg);
    if (!question) return 30;
    const ancount = msg.readUInt16BE(6);
    if (ancount < 1) return 30;
    // Skip the question then walk to the first answer name.
    let offset = question.questionEnd;
    const len = msg[offset];
    if ((len & 0xc0) === 0xc0) offset += 2;
    else {
      while (offset < msg.length && msg[offset] !== 0) offset += 1 + msg[offset];
      offset += 1;
    }
    const ttl = msg.readUInt32BE(offset + 4);
    return Math.max(5, Math.min(ttl, 86400));
  } catch {
    return 30;
  }
}

export class DnsServer {
  constructor({ config, logger }) {
    this.config = config;
    this.log = logger;
    this.socket = dgram.createSocket('udp4');
    this.cache = new Map();
    this.stats = { total: 0, forwarded: 0, hijacked: 0, cacheHits: 0, errors: 0 };
    this.queryLogPath = path.resolve(
      config.capture.dir,
      `dns-queries-${new Date().toISOString().slice(0, 10)}.jsonl`,
    );
    this.queryLogReady = false;
  }

  async start() {
    const { port } = this.config.dns;
    const hijackIp = this.config.__hijackIp;

    if (this.config.dns.logQueries) {
      await fsp.mkdir(path.dirname(this.queryLogPath), { recursive: true });
      this.queryLogReady = true;
    }

    const candidates = dnsBindCandidates(this.config);
    const failures = [];

    for (const address of candidates) {
      // A datagram socket that failed to bind cannot be retried, so each
      // attempt gets a fresh socket and only the winner keeps its listeners.
      const socket = dgram.createSocket('udp4');
      try {
        await new Promise((resolve, reject) => {
          const onError = (err) => reject(err);
          socket.once('error', onError);
          socket.bind(port, address, () => {
            socket.removeListener('error', onError);
            resolve();
          });
        });
        this.socket = socket;
        this.boundAddress = address;
        break;
      } catch (err) {
        failures.push(`${address}:${port} ${err.code || err.message}`);
        try { socket.close(); } catch { /* never bound */ }
      }
    }

    if (!this.boundAddress) {
      throw new Error(`cannot bind DNS on ${failures.join(', ')}`);
    }

    this.socket.on('message', (msg, rinfo) => {
      this.#handle(msg, rinfo).catch((err) => {
        this.stats.errors += 1;
        this.log.warn(`query handling failed: ${err.message}`);
      });
    });
    this.socket.on('error', (err) => this.log.error(`socket error: ${err.message}`));

    const hijacked = this.config.dns.hijack.names;
    this.log.info(`DNS listening on ${this.boundAddress}:${port} (udp)`);
    if (failures.length) {
      this.log.info(`  (skipped ${failures.join(', ')} - already in use)`);
    }
    this.log.info(`upstream: ${this.config.dns.upstream.join(', ')}`);
    if (hijacked.length) {
      this.log.info(`hijacking ${hijacked.length} name pattern(s) -> ${hijackIp}`);
    } else {
      this.log.info('hijack list empty: pure forwarding, nothing is redirected');
    }
  }

  async #logQuery(entry) {
    if (!this.queryLogReady) return;
    try {
      await fsp.appendFile(this.queryLogPath, `${JSON.stringify(entry)}\n`);
    } catch (err) {
      this.log.warn(`cannot write DNS query log: ${err.message}`);
      this.queryLogReady = false;
    }
  }

  async #handle(msg, rinfo) {
    this.stats.total += 1;
    const query = parseQuestion(msg);
    const label = query ? `${query.qname} ${typeName(query.qtype)}` : '<unparsed>';

    if (query && matchesAny(query.qname, this.config.dns.hijack.names)) {
      this.stats.hijacked += 1;
      const reply = serialiseHijack(msg, query, this.config.__hijackIp, { ttl: 60 });
      this.socket.send(reply, rinfo.port, rinfo.address);
      this.log.info(`HIJACK ${label} from ${rinfo.address} -> ${this.config.__hijackIp}`);
      await this.#logQuery({
        ts: new Date().toISOString(), client: rinfo.address, qname: query.qname,
        qtype: typeName(query.qtype), action: 'hijack', answer: this.config.__hijackIp,
      });
      return;
    }

    const cacheKey = query ? `${query.qname}|${query.qtype}` : null;
    if (cacheKey && this.cache.has(cacheKey)) {
      const hit = this.cache.get(cacheKey);
      if (hit.expires > Date.now()) {
        this.stats.cacheHits += 1;
        this.socket.send(hit.reply, rinfo.port, rinfo.address);
        await this.#logQuery({
          ts: new Date().toISOString(), client: rinfo.address,
          qname: query.qname, qtype: typeName(query.qtype), action: 'cache',
        });
        return;
      }
      this.cache.delete(cacheKey);
    }

    let reply;
    try {
      reply = await this.#forward(msg);
    } catch (err) {
      this.stats.errors += 1;
      this.log.warn(`upstream failure for ${label}: ${err.message}`);
      const servfail = buildServfail(msg);
      if (servfail) this.socket.send(servfail, rinfo.port, rinfo.address);
      return;
    }
    this.stats.forwarded += 1;
    this.socket.send(reply, rinfo.port, rinfo.address);

    if (cacheKey) {
      this.cache.set(cacheKey, {
        reply,
        expires: Date.now() + firstAnswerTtl(reply) * 1000,
      });
      if (this.cache.size > 5000) this.cache.clear();
    }
    this.log.debug(`FWD ${label} -> ${reply.length}B from upstream`);
    await this.#logQuery({
      ts: new Date().toISOString(), client: rinfo.address,
      qname: query ? query.qname : null,
      qtype: query ? typeName(query.qtype) : null, action: 'forward',
    });
  }

  async #forward(msg) {
    const upstreams = this.config.dns.upstream;
    let lastError = new Error('no upstream configured');
    for (const upstream of upstreams) {
      try {
        return await this.#forwardTo(msg, upstream);
      } catch (err) {
        lastError = err;
      }
    }
    throw lastError;
  }

  #forwardTo(msg, upstream) {
    return new Promise((resolve, reject) => {
      const socket = dgram.createSocket('udp4');
      const timer = setTimeout(() => {
        socket.close();
        reject(new Error(`upstream ${upstream} timed out`));
      }, 5000);

      const done = (fn, arg) => {
        clearTimeout(timer);
        try { socket.close(); } catch { /* already closing */ }
        fn(arg);
      };

      socket.on('message', (reply) => done(resolve, reply));
      socket.on('error', (err) => done(reject, err));
      socket.send(msg, 53, upstream, (err) => {
        if (err) done(reject, err);
      });
    });
  }

  async stop() {
    await new Promise((resolve) => this.socket.close(resolve));
  }
}
