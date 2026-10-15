// Patch rules.
//
// A rule looks like:
//   {
//     "name": "catalog from zinc",
//     "match": { "host": "wscont1.apps.microsoft.com", "path": "^/winstore/", "methods": ["GET"] },
//     "action": "mock" | "passthrough" | "rewrite" | "redirect" | "block",
//     "status": 200,
//     "headers": { "content-type": "application/json" },
//     "body": "{\"ok\":true}",
//     "file": "fixtures/catalog.json",
//     "redirect": "https://zinc.onelive.me/v1/apps/categories",
//     "rewrites": [ { "op": "json.set", "path": "data.ok", "value": true } ]
//   }
//
// The first rule whose match block passes wins. No match means passthrough.

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { matchesAny } from './config.mjs';

export const ACTIONS = ['passthrough', 'mock', 'rewrite', 'redirect', 'block'];

function methodMatches(methods, method) {
  if (!methods || methods.length === 0) return true;
  return methods.some((m) => String(m).toUpperCase() === String(method).toUpperCase());
}

/** @returns {boolean} whether the rule's match block accepts this request context */
export function matchesRule(rule, ctx) {
  const match = rule.match || {};
  if (match.host && !matchesAny(ctx.host, [match.host])) return false;
  if (!methodMatches(match.methods, ctx.method)) return false;
  if (match.path) {
    let re;
    try {
      re = new RegExp(match.path, match.pathFlags || '');
    } catch (err) {
      throw new Error(`rule "${rule.name}": invalid path regex ${match.path}: ${err.message}`);
    }
    if (!re.test(ctx.path)) return false;
  }
  if (match.queryContains && !ctx.path.includes(match.queryContains)) return false;
  return true;
}

/** First matching rule, or null. */
export function decide(rules, ctx) {
  for (const rule of rules || []) {
    if (matchesRule(rule, ctx)) return rule;
  }
  return null;
}

export function validateRules(rules) {
  const errors = [];
  (rules || []).forEach((rule, index) => {
    const label = rule.name || `rules[${index}]`;
    if (!ACTIONS.includes(rule.action)) {
      errors.push(`${label}: action must be one of ${ACTIONS.join(', ')}`);
    }
    if (rule.match?.path) {
      try {
        new RegExp(rule.match.path, rule.match.pathFlags || '');
      } catch (err) {
        errors.push(`${label}: invalid match.path regex: ${err.message}`);
      }
    }
    if (rule.action === 'redirect' && !rule.redirect) {
      errors.push(`${label}: action "redirect" needs a "redirect" URL`);
    }
    if (rule.action === 'mock' && rule.file) {
      const file = path.resolve(rule.file);
      if (!fs.existsSync(file)) errors.push(`${label}: mock file not found: ${file}`);
    }
    for (const op of rule.rewrites || []) {
      if (!['json.set', 'json.delete', 'regex.sub'].includes(op.op)) {
        errors.push(`${label}: unsupported rewrite op "${op.op}"`);
      }
    }
  });
  return errors;
}

/** Parse a dotted/bracketed path like `data.apps[0].name` into segments. */
export function parsePath(expr) {
  const segments = [];
  const re = /([^.[\]]+)|\[(\d+)\]/g;
  let match;
  while ((match = re.exec(expr)) !== null) {
    segments.push(match[1] !== undefined ? match[1] : Number(match[2]));
  }
  return segments;
}

export function setJsonPath(root, expr, value) {
  const segments = parsePath(expr);
  if (segments.length === 0) return root;
  let node = root;
  for (let i = 0; i < segments.length - 1; i += 1) {
    const key = segments[i];
    if (node[key] === undefined || node[key] === null) {
      node[key] = typeof segments[i + 1] === 'number' ? [] : {};
    }
    node = node[key];
  }
  node[segments[segments.length - 1]] = value;
  return root;
}

export function deleteJsonPath(root, expr) {
  const segments = parsePath(expr);
  if (segments.length === 0) return root;
  let node = root;
  for (let i = 0; i < segments.length - 1; i += 1) {
    node = node?.[segments[i]];
    if (node === undefined || node === null) return root;
  }
  const last = segments[segments.length - 1];
  if (Array.isArray(node) && typeof last === 'number') node.splice(last, 1);
  else delete node[last];
  return root;
}

export function decodeBody(buffer, contentEncoding) {
  const encoding = String(contentEncoding || '').toLowerCase().trim();
  if (!encoding || encoding === 'identity') return buffer;
  try {
    if (encoding.includes('br')) return zlib.brotliDecompressSync(buffer);
    if (encoding.includes('gzip')) return zlib.gunzipSync(buffer);
    if (encoding.includes('deflate')) return zlib.inflateSync(buffer);
  } catch {
    return buffer;
  }
  return buffer;
}

export function encodeBody(buffer, contentEncoding) {
  const encoding = String(contentEncoding || '').toLowerCase().trim();
  if (!encoding || encoding === 'identity') return { body: buffer, encoding: '' };
  if (encoding.includes('gzip')) return { body: zlib.gzipSync(buffer), encoding: 'gzip' };
  if (encoding.includes('br')) return { body: zlib.brotliCompressSync(buffer), encoding: 'br' };
  if (encoding.includes('deflate')) return { body: zlib.deflateSync(buffer), encoding: 'deflate' };
  return { body: buffer, encoding: '' };
}

/**
 * Apply rewrite operations to a response body.
 * JSON ops parse the body as JSON; regex ops work on the decoded text.
 * @returns {{body: Buffer, contentTypeHint: string|null, applied: string[]}}
 */
export function applyRewrites(body, rewrites, { contentType = '', contentEncoding = '' } = {}) {
  const ops = rewrites || [];
  const applied = [];
  if (ops.length === 0) return { body, contentTypeHint: null, applied };

  const decoded = decodeBody(body, contentEncoding);
  const looksJson = /json/i.test(contentType) || /^\s*[[{]/.test(decoded.subarray(0, 32).toString('utf8'));

  const jsonOps = ops.filter((op) => op.op.startsWith('json'));
  if (jsonOps.length) {
    if (!looksJson) {
      throw new Error('json.* rewrite requested but the response body is not JSON');
    }
    const parsed = JSON.parse(decoded.toString('utf8'));
    for (const op of jsonOps) {
      if (op.op === 'json.set') setJsonPath(parsed, op.path, op.value);
      else if (op.op === 'json.delete') deleteJsonPath(parsed, op.path);
      applied.push(`json ${op.path}`);
    }
    return { body: Buffer.from(JSON.stringify(parsed)), contentTypeHint: 'application/json', applied };
  }

  let text = decoded.toString('utf8');
  for (const op of ops) {
    if (op.op === 'regex.sub') {
      text = text.replace(new RegExp(op.pattern, op.flags || 'g'), op.replacement ?? '');
      applied.push(`regex ${op.pattern}`);
    }
  }
  return { body: Buffer.from(text, 'utf8'), contentTypeHint: null, applied };
}

/** Resolve a rule's mock body from inline `body` or from `file`. */
export function resolveMockBody(rule) {
  if (rule.file) {
    const file = path.resolve(rule.file);
    const raw = fs.readFileSync(file);
    return /json$/i.test(file) ? Buffer.from(JSON.stringify(JSON.parse(raw.toString('utf8')))) : raw;
  }
  if (rule.body === undefined) return Buffer.alloc(0);
  return Buffer.from(typeof rule.body === 'string' ? rule.body : JSON.stringify(rule.body), 'utf8');
}
