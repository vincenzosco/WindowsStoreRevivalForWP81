#!/usr/bin/env node
// Turn a capture session into a protocol report.
//
//   node tools/analyze-captures.mjs                    # newest session
//   node tools/analyze-captures.mjs --session captures/session-2026-10-14_18-37-47
//   node tools/analyze-captures.mjs --json             # machine-readable
//
// Reads index.jsonl plus the DNS query log, then reports:
//   * every distinct endpoint (host + method + normalised path) with statuses,
//     content types, sizes and how the proxy handled it
//   * which hosts the device looked up but that are not hijacked yet
//   * a copy-pasteable config snippet for the next iteration
//
// Writes captures/<session>/report.md.

import fs from 'node:fs';
import path from 'node:path';
import { isMainModule } from '../src/paths.mjs';

const HEADER_PREVIEW = 40;
const BODY_PREVIEW = 600;

/** Collapse ids/numbers so `/app/12345/detail` and `/app/99/detail` group together. */
export function normalisePath(urlPath = '') {
  const [base, query] = urlPath.split('?');
  const normalisedBase = base
    .replace(/\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(?=\/|$)/gi, '/{uuid}')
    .replace(/\/[0-9a-f]{16,}(?=\/|$)/gi, '/{hex}')
    .replace(/\/\d+(?=\/|$)/g, '/{n}');
  if (!query) return normalisedBase;
  const keys = query.split('&').map((pair) => pair.split('=')[0]).sort();
  return `${normalisedBase}?${keys.join('&')}`;
}

function newestSession(root) {
  if (!fs.existsSync(root)) return null;
  const entries = fs.readdirSync(root, { withFileTypes: true })
    .filter((e) => e.isDirectory() && e.name.startsWith('session-'))
    .map((e) => ({ name: e.name, mtime: fs.statSync(path.join(root, e.name)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime);
  return entries.length ? path.join(root, entries[0].name) : null;
}

function readIndex(sessionDir) {
  const indexPath = path.join(sessionDir, 'index.jsonl');
  if (!fs.existsSync(indexPath)) return [];
  return fs.readFileSync(indexPath, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      try { return JSON.parse(line); } catch { return null; }
    })
    .filter(Boolean);
}

function readBodies(sessionDir, entry) {
  const load = (body) => {
    if (!body) return null;
    if (body.inline !== undefined) return body.inline;
    if (body.inlineBase64 !== undefined) return `[base64 ${body.bytes} bytes]`;
    if (body.file) {
      const file = path.join(sessionDir, body.file);
      try {
        const text = fs.readFileSync(file, 'utf8');
        return /[\x00-\x08\x0e-\x1f]/.test(text.slice(0, 200))
          ? `[binary ${body.bytes} bytes]`
          : text;
      } catch {
        return `[unreadable ${body.file}]`;
      }
    }
    return null;
  };
  return { request: load(entry.request?.body), response: load(entry.response?.body) };
}

function readDnsQueries(captureRoot) {
  const queries = new Map();
  if (!fs.existsSync(captureRoot)) return queries;
  for (const name of fs.readdirSync(captureRoot)) {
    if (!name.startsWith('dns-queries-')) continue;
    const lines = fs.readFileSync(path.join(captureRoot, name), 'utf8').split('\n').filter(Boolean);
    for (const line of lines) {
      let entry;
      try { entry = JSON.parse(line); } catch { continue; }
      if (!entry.qname) continue;
      const current = queries.get(entry.qname) || { count: 0, actions: new Set() };
      current.count += 1;
      current.actions.add(entry.action);
      queries.set(entry.qname, current);
    }
  }
  return queries;
}

/** Hosts that look like Store infrastructure and are worth hijacking. */
export function looksLikeStoreHost(hostname) {
  return /(microsoft|zune|windowsphone|msn|live\.net|mp\.microsoft|apps\.microsoft|storeedge|delivery\.mp)/i
    .test(hostname);
}

function buildReport(exchanges, dnsQueries, hijackPatterns, mitmPatterns) {
  const groups = new Map();

  for (const entry of exchanges) {
    const host = entry.request.host;
    const method = entry.request.method;
    const normalised = normalisePath(entry.request.path);
    const key = `${method} https://${host}${normalised}`;
    if (!groups.has(key)) {
      groups.set(key, {
        key,
        host,
        method,
        path: normalised,
        count: 0,
        statuses: new Map(),
        contentTypes: new Set(),
        decisions: new Set(),
        sizes: [],
        errors: new Set(),
        first: entry.ts,
        last: entry.ts,
        sample: entry,
      });
    }
    const group = groups.get(key);
    group.count += 1;
    const status = entry.response?.status;
    if (status !== undefined) group.statuses.set(status, (group.statuses.get(status) || 0) + 1);
    const contentType = entry.response?.headers?.['content-type'];
    if (contentType) group.contentTypes.add(contentType.split(';')[0]);
    group.decisions.add(entry.decision);
    if (entry.response?.body?.bytes) group.sizes.push(entry.response.body.bytes);
    if (entry.error) group.errors.add(entry.error);
    group.last = entry.ts;
  }

  const hijacked = (host) => hijackPatterns.some((pattern) => {
    const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
    return new RegExp(`^${escaped}$`, 'i').test(host);
  });

  const candidates = [...dnsQueries.keys()]
    .filter((name) => looksLikeStoreHost(name) && !hijacked(name))
    .sort();

  // Endpoints that failed are candidates for emulation - but a mock or block
  // rule answers on purpose, so a 4xx there is the intended behaviour.
  const intentional = (group) => [...group.decisions]
    .some((decision) => decision.startsWith('mock:') || decision.startsWith('block:'));

  const unresolved = [...groups.values()]
    .filter((group) => !intentional(group))
    .filter((group) => [...group.statuses.keys()].some((status) => status >= 400) || group.errors.size)
    .map((group) => group.key);

  return { groups: [...groups.values()], candidates, unresolved };
}

function renderMarkdown(report, sessionDir) {
  const lines = [
    '# Intercepted Store protocol',
    '',
    `Session: \`${path.basename(sessionDir)}\``,
    `Generated: ${new Date().toISOString()}`,
    '',
    '## Endpoints seen',
    '',
    '| count | method | endpoint | status | type | decision |',
    '|------:|--------|----------|--------|------|----------|',
  ];

  const sorted = [...report.groups].sort((a, b) => b.count - a.count);
  for (const group of sorted) {
    const statuses = [...group.statuses.entries()].map(([s, c]) => `${s}x${c}`).join(' ') || '-';
    const decisions = [...group.decisions].join(' ');
    lines.push(
      `| ${group.count} | ${group.method} | \`${group.host}${group.path}\` | ${statuses} | `
      + `${[...group.contentTypes].join(' ') || '-'} | ${decisions} |`,
    );
  }

  lines.push('', '## Samples', '');
  for (const group of sorted) {
    const bodies = readBodies(sessionDir, group.sample);
    lines.push(`### ${group.method} ${group.host}${group.path}`, '');
    lines.push(`Seen ${group.count}x, first ${group.first}, last ${group.last}.`);
    if (group.errors.size) lines.push(`Errors: ${[...group.errors].join(', ')}`);
    lines.push('', 'Request headers:', '```json');
    lines.push(JSON.stringify(Object.fromEntries(
      Object.entries(group.sample.request.headers).slice(0, HEADER_PREVIEW),
    ), null, 2));
    lines.push('```');
    if (bodies.request) {
      lines.push('Request body:', '```');
      lines.push(String(bodies.request).slice(0, BODY_PREVIEW));
      lines.push('```');
    }
    if (bodies.response) {
      lines.push('Response body:', '```');
      lines.push(String(bodies.response).slice(0, BODY_PREVIEW));
      lines.push('```');
    }
    lines.push('');
  }

  lines.push('## Hosts the device resolved that are not hijacked yet', '');
  if (report.candidates.length === 0) {
    lines.push('None. Either the capture is empty or the hijack list already covers them.');
  } else {
    lines.push('Add the Store-looking ones to `dns.hijack.names` and `proxy.mitm.hosts`:');
    lines.push('```json');
    lines.push(JSON.stringify(report.candidates, null, 2));
    lines.push('```');
  }

  lines.push('', '## Endpoints still failing', '');
  if (report.unresolved.length === 0) {
    lines.push('None.');
  } else {
    lines.push('These answered 4xx/5xx or could not reach a backend - they are the ones to emulate:');
    for (const endpoint of report.unresolved) lines.push(`- \`${endpoint}\``);
  }

  return `${lines.join('\n')}\n`;
}

function main() {
  const args = process.argv.slice(2);
  const flag = (name, fallback) => {
    const i = args.indexOf(`--${name}`);
    return i !== -1 && args[i + 1] ? args[i + 1] : fallback;
  };

  const configPath = path.resolve(flag('config', 'config.json'));
  const captureRoot = path.resolve(flag('root', 'captures'));
  const sessionDir = path.resolve(flag('session', newestSession(captureRoot) || ''));

  if (!sessionDir || !fs.existsSync(sessionDir)) {
    console.error(`No capture session found under ${captureRoot}. Run the proxy and point the device at it first.`);
    process.exit(1);
  }

  const config = fs.existsSync(configPath) ? JSON.parse(fs.readFileSync(configPath, 'utf8')) : {};
  const hijackPatterns = config.dns?.hijack?.names || [];
  const mitmPatterns = config.proxy?.mitm?.hosts || [];

  const exchanges = readIndex(sessionDir);
  const dnsQueries = readDnsQueries(captureRoot);
  const report = buildReport(exchanges, dnsQueries, hijackPatterns, mitmPatterns);

  if (args.includes('--json')) {
    console.log(JSON.stringify({
      session: sessionDir,
      endpoints: report.groups.map((g) => ({
        endpoint: `${g.method} https://${g.host}${g.path}`,
        count: g.count,
        statuses: [...g.statuses.keys()],
        decisions: [...g.decisions],
        errors: [...g.errors],
      })),
      unhijackedCandidates: report.candidates,
      failing: report.unresolved,
    }, null, 2));
    return;
  }

  const reportPath = path.join(sessionDir, 'report.md');
  fs.writeFileSync(reportPath, renderMarkdown(report, sessionDir));

  console.log(`session     : ${sessionDir}`);
  console.log(`exchanges   : ${exchanges.length}`);
  console.log(`endpoints   : ${report.groups.length}`);
  console.log(`dns names   : ${dnsQueries.size}`);
  console.log('');
  for (const group of [...report.groups].sort((a, b) => b.count - a.count).slice(0, 40)) {
    const statuses = [...group.statuses.keys()].join('/');
    console.log(`  ${String(group.count).padStart(4)}x  ${group.method.padEnd(5)} ${group.host}${group.path}  [${statuses}]  ${[...group.decisions].join(',')}`);
  }
  console.log('');
  if (report.candidates.length) {
    console.log(`not hijacked yet (${report.candidates.length}):`);
    for (const name of report.candidates.slice(0, 25)) console.log(`  - ${name}`);
  }
  if (report.unresolved.length) {
    console.log('');
    console.log(`endpoints to emulate (${report.unresolved.length}):`);
    for (const endpoint of report.unresolved.slice(0, 25)) console.log(`  - ${endpoint}`);
  }
  console.log('');
  console.log(`full report: ${reportPath}`);
}

if (isMainModule(import.meta.url)) {
  main();
}
