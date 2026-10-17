#!/usr/bin/env node
// What one attempt to install an app actually asks for.
//
//   node tools/install-trace.mjs                    # the newest session, every device in it
//   node tools/install-trace.mjs --device 192.168.0.137
//   node tools/install-trace.mjs --session session-2026-10-17_14-57-05 --since 15:02
//
// WHY THIS EXISTS. Nothing in this repository has ever captured an install: the phone
// cannot reach the button while the page does not render, and the whole install path -
// entitlement, package, install - is unmeasured. Before deciding whether a service of
// ours can answer it, the question is the cheap one: *which names does the client ask
// for when the button is pressed, and which of those can the lab even see?*
//
// The answer is split in three by construction, and the split is the point:
//
//   resolved, answered by the lab   a host this lab was told to intercept: the capture
//                                   holds the request and the response.
//   resolved, NOT answered by lab   the name resolved through this lab's DNS (every query
//                                   is logged) but no request for it appears in the
//                                   capture - so the client went to the real network, or
//                                   never connected. THIS is where licensing and account
//                                   hosts will appear, because they are deliberately not
//                                   hijacked.
//   answered, never resolved        a request to a host the DNS log has no query for in
//                                   the window: a cached resolution, or a hard-coded IP.
//
// WHAT IT CANNOT SAY. Why a request failed, what the body meant, or whether the device
// drew anything. It is a map of the conversation, not a verdict on it.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const CAPTURES = path.join(ROOT, 'captures');

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i !== -1 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : fallback;
};
const has = (name) => args.includes(`--${name}`);

/** The session directory to read: named, or the newest one with an index. */
function sessionDir() {
  const named = flag('session', '');
  if (named) return path.isAbsolute(named) ? named : path.join(CAPTURES, named);
  const candidates = fs.readdirSync(CAPTURES, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name.startsWith('session-'))
    .map((entry) => path.join(CAPTURES, entry.name))
    .filter((dir) => fs.existsSync(path.join(dir, 'index.jsonl')))
    .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
  return candidates[0];
}

function readJsonl(file) {
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).flatMap((line) => {
    try { return [JSON.parse(line)]; } catch { return []; }
  });
}

const dir = sessionDir();
if (!dir) {
  console.error('no capture session to read: start the lab and open the Store');
  process.exit(2);
}
const exchanges = readJsonl(path.join(dir, 'index.jsonl'));

// `--since` takes `HH:MM` (interpreted in the session's own UTC clock, which is what the
// index stores) or an ISO stamp. The person pressing the button knows the local time on
// the phone; the index is UTC, and this project has confused the two before (F-023), so
// the offset is printed rather than assumed.
const sinceRaw = flag('since', '');
let since = null;
if (sinceRaw) {
  since = /^\d{2}:\d{2}$/.test(sinceRaw)
    ? new Date(`${new Date().toISOString().slice(0, 10)}T${sinceRaw}:00.000Z`)
    : new Date(sinceRaw);
  if (Number.isNaN(since.getTime())) {
    console.error(`--since ${sinceRaw} is not a time this tool can read`);
    process.exit(2);
  }
}

const deviceFilter = flag('device', '');
const exchangesInWindow = exchanges.filter((row) => !since || new Date(row.ts) >= since);

// Which clients are devices? A row is a device's if it carries the phone's own header or
// arrives from a LAN address; this PC's replays are 127.0.0.1 and get excluded by both.
const deviceRows = exchangesInWindow.filter((row) => row.request?.headers?.['x-wp-device-id']
  || /^192\.168\./.test(row.client?.address || ''));
const clients = [...new Set(deviceRows.map((row) => row.client?.address).filter(Boolean))];
const devices = new Map();
for (const row of deviceRows) {
  const id = row.request?.headers?.['x-wp-device-id'];
  if (!id) continue;
  if (!devices.has(id)) devices.set(id, new Set());
  devices.get(id).add(row.client?.address);
}
const selectedClients = deviceFilter
  ? clients.filter((address) => address.startsWith(deviceFilter))
    .concat([...devices].filter(([id]) => id.startsWith(deviceFilter)).flatMap(([, addresses]) => [...addresses]))
  : clients;
const clientSet = new Set(selectedClients);

const rows = deviceRows.filter((row) => clientSet.size === 0 || clientSet.has(row.client?.address));

// The DNS log lives one file per day, at the top of captures/. Every query is recorded,
// hijacked or not, which is the only reason the "resolved but not answered" column can exist.
const dayFiles = [...new Set(rows.map((row) => row.ts.slice(0, 10)))]
  .map((day) => path.join(CAPTURES, `dns-queries-${day}.jsonl`))
  .filter((file) => fs.existsSync(file));
const queries = dayFiles.flatMap(readJsonl).filter((entry) => {
  if (since && new Date(entry.ts) < since) return false;
  return clientSet.size === 0 || clientSet.has(entry.client);
});

const answeredHosts = new Set(rows.map((row) => String(row.request?.host || '').toLowerCase()));
const resolvedNames = new Map();
for (const entry of queries) {
  const name = String(entry.qname || '').toLowerCase();
  if (!resolvedNames.has(name)) resolvedNames.set(name, { action: entry.action, count: 0, first: entry.ts });
  const record = resolvedNames.get(name);
  record.count += 1;
  record.action = entry.action || record.action;
}

const globMatch = (name, pattern) => {
  const re = new RegExp(`^${pattern.toLowerCase().replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.')}$`);
  return re.test(name);
};
const config = JSON.parse(fs.readFileSync(path.join(ROOT, 'config.json'), 'utf8'));
const hijack = config.dns?.hijack?.names || [];
const hijacked = (name) => hijack.some((pattern) => globMatch(name, pattern));

const answeredFromDns = [...resolvedNames.entries()]
  .filter(([name]) => answeredHosts.has(name));
const resolvedNotAnswered = [...resolvedNames.entries()]
  .filter(([name]) => !answeredHosts.has(name))
  .sort((a, b) => (hijacked(a[0]) === hijacked(b[0]) ? b[1].count - a[1].count : hijacked(a[0]) ? -1 : 1));

const time = (ts) => String(ts).slice(11, 23);

if (has('json')) {
  console.log(JSON.stringify({
    session: path.basename(dir),
    clients: [...clientSet],
    devices: [...devices].map(([id, addresses]) => ({ id, addresses: [...addresses] })),
    since: since ? since.toISOString() : null,
    exchanges: rows.map((row) => ({
      ts: row.ts,
      method: row.request?.method,
      host: row.request?.host,
      path: row.request?.path,
      status: row.response?.status,
    })),
    resolved: [...resolvedNames.entries()].map(([name, record]) => ({
      name, ...record, hijacked: hijacked(name), answered: answeredHosts.has(name),
    })),
  }, null, 2));
  process.exit(0);
}

console.log(`session : ${path.basename(dir)}`);
if (clientSet.size) console.log(`client(s): ${[...clientSet].join(', ')}${deviceFilter ? ` (filtered by "${deviceFilter}")` : ''}`);
for (const [id, addresses] of devices) {
  const shown = [...addresses].filter((address) => clientSet.size === 0 || clientSet.has(address));
  if (!shown.length) continue;
  console.log(`device  : ${id.slice(0, 16)}…  at ${shown.join(', ')}`);
}
if (since) console.log(`since   : ${since.toISOString()} (UTC - the index's clock; the phone's own is local)`);
console.log(`window  : ${rows.length} exchange(s) from the device, ${queries.length} DNS quer(y/ies) from it`);
console.log('');

console.log('what the device did, in order');
if (!rows.length) console.log('  (nothing: no exchange from the device in this window)');
for (const row of rows) {
  const status = row.response?.status ?? '?';
  const host = String(row.request?.host || '').padEnd(44);
  const pathname = String(row.request?.path || '').split('?')[0].slice(0, 42).padEnd(44);
  console.log(`  ${time(row.ts)}  ${String(row.request?.method || '').padEnd(4)} ${host} ${pathname} ${status}`);
}

console.log('');
console.log('names resolved, and whether the lab answered them');
if (!resolvedNames.size) console.log('  (none: the DNS log for this window is empty - was dns.logQueries on?)');
for (const [name, record] of [...resolvedNames.entries()].sort((a, b) => b[1].count - a[1].count)) {
  const state = answeredHosts.has(name) ? 'answered by the lab' : 'NOT answered - went elsewhere';
  console.log(`  ${String(record.count).padStart(3)}x  ${name.padEnd(52)} ${record.action || '?'}  ${state}`);
}

console.log('');
if (resolvedNotAnswered.length) {
  console.log('resolved but never seen by the lab (the real network answered, or nothing did)');
  for (const [name, record] of resolvedNotAnswered) {
    console.log(`  ${String(record.count).padStart(3)}x  ${name}${hijacked(name) ? '  [hijacked, yet no request arrived]' : ''}`);
  }
} else {
  console.log('nothing was resolved without also reaching the lab: every name this window used came here.');
}
console.log('');
console.log('A name in that last list is a host this lab cannot answer, by design or not:');
console.log('licensing and account hosts are deliberately not hijacked, so an install attempt that');
console.log('needs them fails where the lab is not standing. Read this list before deciding what to');
console.log('intercept next.');
