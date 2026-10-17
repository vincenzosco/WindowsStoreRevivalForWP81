#!/usr/bin/env node
// Turn a capture session into a protocol report.
//
//   node tools/analyze-captures.mjs                    # newest session
//   node tools/analyze-captures.mjs --all-sessions      # every session, one census
//   node tools/analyze-captures.mjs --session captures/session-2026-10-14_18-37-47
//   node tools/analyze-captures.mjs --json             # machine-readable
//
// Reads index.jsonl plus the DNS query log, then reports:
//   * **who asked** - one row per client address, with this PC's own traffic
//     marked, because in this lab the two are mixed and the aggregate cannot
//     tell them apart (F-012, F-023)
//   * **which device** was behind those addresses, joined on the identity the
//     request itself carries (`x-wp-device-id`, else the `os`/`hw`/`dm` tuple),
//     because one phone here has had two addresses and one address has held
//     traffic from two handsets (F-023)
//   * every distinct endpoint (host + method + normalised path) with statuses,
//     content types, sizes, which clients reached it and how the proxy handled it
//   * which hosts the device looked up but that are not hijacked yet
//   * a copy-pasteable config snippet for the next iteration
//
// Writes captures/<session>/report.md, or captures/census-report.md for
// --all-sessions.
//
// ---------------------------------------------------------------------------
// Two traps are baked into the readers below, both learned by getting them
// wrong (MAINTENANCE.md footguns 4 and 10):
//
// 1. A long session passes Node's maximum string length, so neither the index
//    nor the DNS log may be read with `readFileSync(..., 'utf8')`. Both are
//    streamed.
// 2. `user-agent` does NOT separate the device from this PC. The rehearsal loop
//    sends the phone's *own* agent (`ZDM/4.0; Windows Mobile 8.1`) - 308 390 of
//    the exchanges in this repository's own capture carry it from this PC's
//    address - so sorting by agent alone hands this machine's traffic to the
//    phone. `client.address` is the discriminator; the user agent is reported,
//    never trusted.
//
// And one thing this tool refuses to do: decide which address is *the* phone from
// the DNS log. That log carries no device identity at all - no MAC, no serial, no
// agent - and several clients on this LAN resolve through the lab, so an address
// is marked `phone-ish` only when the names it resolved match the fingerprint a
// Windows Phone -era Nokia device asks: evidence of a kind of device, never of
// which one. The identity that *does* exist is on the HTTP side, in
// `x-wp-device-id`, and that is what the device table joins on (F-023).

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readJsonl } from '../src/capture.mjs';
import { isMainModule } from '../src/paths.mjs';

const HEADER_PREVIEW = 40;
const BODY_PREVIEW = 600;
const SAMPLE_LIMIT = 40;

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

function sessionDirs(root) {
  if (!fs.existsSync(root)) return [];
  return fs.readdirSync(root, { withFileTypes: true })
    .filter((e) => e.isDirectory() && e.name.startsWith('session-'))
    .map((e) => ({ name: e.name, mtime: fs.statSync(path.join(root, e.name)).mtimeMs }))
    // Oldest first, so a multi-session census reads in the order it happened.
    .sort((a, b) => a.mtime - b.mtime)
    .map((e) => path.join(root, e.name));
}

/**
 * Every address this machine answers on.
 *
 * `os.networkInterfaces()` alone is not enough: the lab can be told to advertise
 * an address that is not on an interface this process can enumerate (the suite
 * does exactly that with a documentation address), and this machine's own
 * traffic is then reported as a device. The configured addresses are added
 * because a packet that arrives at the address we advertise ourselves as is
 * either ours or a replay of ours.
 *
 * @returns {Set<string>}
 */
export function localAddresses(config = {}) {
  const addresses = new Set();
  for (const list of Object.values(os.networkInterfaces())) {
    for (const info of list || []) {
      if (info.family === 'IPv4') addresses.add(info.address);
    }
  }
  for (const configured of [config.network?.advertiseIp, config.dns?.hijack?.ip]) {
    if (configured && configured !== 'auto') addresses.add(configured);
  }
  return addresses;
}

/**
 * The whole index, parsed, across one or more sessions.
 *
 * Streamed rather than read as one string: a session that has been running long
 * enough to be interesting is also long enough to pass Node's maximum string
 * length, where `readFileSync(..., 'utf8')` throws and the report comes out
 * empty. A torn last line is skipped, exactly as before. Each entry remembers
 * which session it came from, so a sample's body can still be found.
 */
async function readIndex(sessionDirsList) {
  const entries = [];
  for (const sessionDir of sessionDirsList) {
    const indexPath = path.join(sessionDir, 'index.jsonl');
    if (!fs.existsSync(indexPath)) continue;
    for await (const line of readJsonl(indexPath)) {
      try {
        entries.push({ ...JSON.parse(line), session: path.basename(sessionDir) });
      } catch { /* torn line: skip it */ }
    }
  }
  return entries;
}

/**
 * Stream every `dns-queries-*.jsonl` under the capture root.
 *
 * The DNS log is read whole-capture and not per session because it is not
 * written per session: one file per day, shared by every session, and the
 * device's lookups are in it even when no session was running to receive the
 * connection (F-023 - `.54` queried for 47 names and never completed a request).
 */
async function* readDnsRecords(captureRoot) {
  if (!fs.existsSync(captureRoot)) return;
  for (const name of fs.readdirSync(captureRoot).sort()) {
    if (!name.startsWith('dns-queries-')) continue;
    for await (const line of readJsonl(path.join(captureRoot, name))) {
      try {
        yield JSON.parse(line);
      } catch { /* torn line: skip it */ }
    }
  }
}

/**
 * The DNS log, indexed both ways: by name (for the hijack candidates) and by
 * the client that asked (for the census).
 *
 * Neither reader may use `readFileSync(..., 'utf8')`: this file is the one that
 * produced `ERR_STRING_TOO_LONG` in practice.
 *
 * @returns {Promise<{byName: Map, byClient: Map}>}
 */
export async function readDnsQueries(captureRoot) {
  const byName = new Map();
  const byClient = new Map();
  for await (const entry of readDnsRecords(captureRoot)) {
    if (!entry.qname) continue;

    const current = byName.get(entry.qname) || { count: 0, actions: new Set() };
    current.count += 1;
    current.actions.add(entry.action);
    byName.set(entry.qname, current);

    const address = entry.client || 'unknown';
    let client = byClient.get(address);
    if (!client) {
      client = { address, count: 0, first: entry.ts, last: entry.ts, names: new Map(), actions: new Map(), hijacked: 0 };
      byClient.set(address, client);
    }
    client.count += 1;
    if (entry.ts < client.first) client.first = entry.ts;
    if (entry.ts > client.last) client.last = entry.ts;
    client.names.set(entry.qname, (client.names.get(entry.qname) || 0) + 1);
    client.actions.set(entry.action, (client.actions.get(entry.action) || 0) + 1);
    if (entry.action === 'hijack') client.hijacked += 1;
  }
  return { byName, byClient };
}

/** Hosts that look like Store infrastructure and are worth hijacking. */
export function looksLikeStoreHost(hostname) {
  return /(microsoft|zune|windowsphone|msn|live\.net|mp\.microsoft|apps\.microsoft|storeedge|delivery\.mp)/i
    .test(hostname);
}

/**
 * The names a Windows Phone -era Nokia device asks and little else on this LAN does.
 *
 * Deliberately narrower than `looksLikeStoreHost`: `update.microsoft.com` and
 * `sqm.telemetry.microsoft.com` are asked by every Windows machine here, and
 * `dns.msftncsi.com` by the router, so a name list that included them would mark
 * half the house as the phone. `account.nokia.com`, `discoveryservice.windowsphone.com`
 * and `slp.pos.nlp.nokia.com` are the dead Nokia-services fingerprint: nothing
 * else on this network has a reason to ask for them.
 */
export function looksLikeWindowsPhoneClient(qname) {
  return /(account\.nokia\.com|slp\.pos\.nlp\.nokia\.com|slp\.nokia\.com|discoveryservice\.windowsphone\.com|devicecertificateservice\.windowsphone\.com|marketplaceconfigservice\.windowsphone\.com|\.windowsphone\.com$|\.zune\.net$|p\.pfx\.ms|api\.live\.net)/i
    .test(qname);
}

/**
 * Which device an exchange belongs to, as far as the request says so.
 *
 * Two kinds of evidence, strongest first:
 *
 *  - `x-wp-device-id`: a 32-byte hex identity the Store client sends on its own
 *    requests. It survives a DHCP lease change, which is what makes it the only
 *    way to say that two addresses are one phone.
 *  - the `os`/`hw`/`dm`/`oemId` tuple in the query string: carried by system
 *    components that do not send a device id at all (the Store configuration
 *    calls, `ssl-api.bing.com`), so it is weaker - it identifies a model and a
 *    build, not a handset.
 *
 * Returns null for a request that identifies nothing (the PC's own traffic does
 * not need to be excluded here: it is excluded before this is called, because an
 * identity field is exactly what a rehearsal copies from the capture it replays).
 */
export function deviceKeyOf(entry) {
  const hardware = hardwareFactsOf(entry);
  const hardwareKey = hardwareKeyOf(entry);
  const id = entry.request?.headers?.['x-wp-device-id'];
  // The id wins the key - it is the same handset across addresses - but the
  // hardware tuple is carried too, because that is what a later request without
  // an id has to be matched on.
  if (id) return { key: `id:${id}`, kind: 'id', id, hardware, hardwareKey };
  if (hardwareKey) return { key: `hardware:${hardwareKey}`, kind: 'hardware', hardware: hardware || hardwareKey, hardwareKey };
  return null;
}

/**
 * The `hw`/`dm` pair of a request, as the key a handset can be matched on.
 *
 * `hw` is the model and `dm` the regional variant, so the two together name a
 * handset to the extent anything in this file does. `os` is deliberately left
 * out of the *key*: it is a build, which changes under the same phone, and the
 * configuration calls that are the reason this exists omit fields freely - the
 * `MOStores`/`OEMStores` calls carry `hw`/`dm` and no `oemId`, so matching on
 * the whole tuple would miss the handset it obviously belongs to.
 */
function hardwareKeyOf(entry) {
  const facts = queryFactsOf(entry);
  if (!facts.has('hw') || !facts.has('dm')) return null;
  return `hw=${facts.get('hw')} dm=${facts.get('dm')}`;
}

/** The `os`/`hw`/`dm`/`oemId` tuple of a request, as one line for display. */
function hardwareFactsOf(entry) {
  const facts = queryFactsOf(entry);
  if (!facts.has('os') || !facts.has('hw')) return null;
  return ['os', 'hw', 'dm', 'oemId']
    .filter((key) => facts.has(key))
    .map((key) => `${key}=${facts.get(key)}`)
    .join(' ');
}

function queryFactsOf(entry) {
  const found = new Map();
  const query = String(entry.request?.path || '').split('?')[1];
  if (!query) return found;
  for (const pair of query.split('&')) {
    const [key, value] = pair.split('=');
    if (['os', 'hw', 'dm', 'oemId'].includes(key) && value) found.set(key, decodeURIComponent(value));
  }
  return found;
}

/**
 * The exchanges grouped by the device they identify, and the addresses each was
 * seen at.
 *
 * This is the reading the per-address table cannot give: the same device id at
 * two addresses is one phone that changed lease (`.136` -> `.137`), and two
 * device ids behind one address history are two phones (F-023).
 */
export function buildDeviceRows(exchanges) {
  const devices = new Map();
  for (const entry of exchanges) {
    const evidence = deviceKeyOf(entry);
    if (!evidence) continue;
    let device = devices.get(evidence.key);
    if (!device) {
      device = {
        key: evidence.key,
        ids: new Set(),
        hardware: new Set(),
        hardwareKeys: new Set(),
        addresses: new Map(),
        count: 0,
        first: entry.ts,
        last: entry.ts,
        requests: new Map(),
      };
      devices.set(evidence.key, device);
    }
    if (evidence.id) device.ids.add(evidence.id);
    if (evidence.hardware) device.hardware.add(evidence.hardware);
    if (evidence.hardwareKey) device.hardwareKeys.add(evidence.hardwareKey);
    const address = entry.client?.address || 'unknown';
    device.addresses.set(address, (device.addresses.get(address) || 0) + 1);
    device.count += 1;
    if (entry.ts < device.first) device.first = entry.ts;
    if (entry.ts > device.last) device.last = entry.ts;
    const endpoint = `${entry.request.method} https://${entry.request.host}${normalisePath(entry.request.path)}`;
    device.requests.set(endpoint, (device.requests.get(endpoint) || 0) + 1);
  }

  // A request with no device id but with the same `hw`/`dm` as one that has an id
  // is the same handset: the Store configuration calls and `ssl-api.bing.com` are
  // system components that do not send the header. Said out loud rather than
  // merged, because merging would be a guess about which of two handsets of the
  // same model it is.
  const identified = [...devices.values()].filter((device) => device.ids.size);
  for (const device of devices.values()) {
    if (device.ids.size) continue;
    device.sameAs = identified
      .filter((other) => [...device.hardwareKeys].some((key) => other.hardwareKeys.has(key)))
      .map((other) => other.key);
  }

  return [...devices.values()].sort((a, b) => b.count - a.count);
}

/**
 * The index grouped by client address.
 *
 * `client.address` is the only field that separates the device from this PC
 * (see the header note), so it is the key here. Ports are not: the phone opens a
 * new one per request, and this PC does too.
 */
export function groupHttpClients(exchanges) {
  const byClient = new Map();
  for (const entry of exchanges) {
    const address = entry.client?.address || 'unknown';
    let client = byClient.get(address);
    if (!client) {
      client = {
        address,
        count: 0,
        first: entry.ts,
        last: entry.ts,
        userAgents: new Map(),
        requests: new Map(),
        hosts: new Map(),
        deviceKeys: new Set(),
        // Cleared by the first exchange that carries no identity at all, which
        // is what a rehearsal copy of a device request looks like.
        identified: true,
      };
      byClient.set(address, client);
    }
    client.count += 1;
    if (entry.ts < client.first) client.first = entry.ts;
    if (entry.ts > client.last) client.last = entry.ts;
    const agent = entry.request?.headers?.['user-agent'] || '(none)';
    client.userAgents.set(agent, (client.userAgents.get(agent) || 0) + 1);
    const endpoint = `${entry.request.method} https://${entry.request.host}${normalisePath(entry.request.path)}`;
    client.requests.set(endpoint, (client.requests.get(endpoint) || 0) + 1);
    client.hosts.set(entry.request.host, (client.hosts.get(entry.request.host) || 0) + 1);
    const evidence = deviceKeyOf(entry);
    if (evidence) client.deviceKeys.add(evidence.key);
    else client.identified = false;
  }
  return byClient;
}

const earlier = (a, b) => (!a ? b : !b ? a : (a < b ? a : b));
const later = (a, b) => (!a ? b : !b ? a : (a > b ? a : b));

/**
 * One row per client address, joining what it asked over DNS with what it asked
 * over HTTP.
 *
 * The join is the point: the DNS log carries no device identity at all - no
 * MAC, no user agent, no device id - so a name list per address is only
 * interpretable once the HTTP side has said which of those addresses is the
 * device. An address with DNS queries and no exchanges was either filtered by
 * the hijack list or never spoke to the lab (F-023); an address with exchanges
 * and no DNS queries came through a resolver the lab does not see.
 *
 * Sorted device rows first: this PC is normally the bulk of both files, and
 * reading it first is how the device gets missed.
 */
export function buildClientRows({ http, dns, localIps }) {
  const addresses = new Set([...http.keys(), ...dns.keys()]);
  const rows = [];
  for (const address of addresses) {
    const client = http.get(address);
    const resolver = dns.get(address);
    const names = resolver ? [...resolver.names.keys()] : [];
    rows.push({
      address,
      thisPc: localIps.has(address),
      // A kind of device, not an identity: see the header note.
      fingerprint: names.filter(looksLikeWindowsPhoneClient).sort(),
      exchanges: client ? client.count : 0,
      distinctRequests: client ? client.requests.size : 0,
      userAgents: client ? [...client.userAgents.keys()] : [],
      hosts: client ? [...client.hosts.keys()].sort() : [],
      requests: client ? client.requests : new Map(),
      deviceKeys: client ? [...client.deviceKeys].sort() : [],
      queries: resolver ? resolver.count : 0,
      distinctNames: resolver ? resolver.names.size : 0,
      hijacked: resolver ? resolver.hijacked : 0,
      actions: resolver ? resolver.actions : new Map(),
      // The names that make an address look like a phone. Reported per address
      // and not aggregated, because the aggregate of this list is exactly the
      // mistake this tool exists to stop: this PC asks for the same names.
      storeNames: names.filter(looksLikeStoreHost).sort(),
      first: earlier(client?.first, resolver?.first),
      last: later(client?.last, resolver?.last),
    });
  }
  for (const row of rows) {
    row.phoneIsh = !row.thisPc && row.fingerprint.length > 0;
    row.kind = row.thisPc ? 'this PC' : row.phoneIsh ? 'phone-ish' : 'LAN client';
  }
  // This PC last and the phone-shaped rows first: this machine is the bulk of
  // both files, and reading it first is how the device gets missed.
  rows.sort((a, b) => (Number(a.thisPc) - Number(b.thisPc))
    || (Number(b.phoneIsh) - Number(a.phoneIsh))
    || (b.exchanges + b.queries) - (a.exchanges + a.queries)
    || a.address.localeCompare(b.address));
  return rows;
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

function buildReport(exchanges, dnsByClient, hijackPatterns, localIps) {
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
        clients: new Map(),
        first: entry.ts,
        last: entry.ts,
        sample: entry,
        sampleSession: entry.session,
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
    const address = entry.client?.address || 'unknown';
    group.clients.set(address, (group.clients.get(address) || 0) + 1);
    group.last = entry.ts;
  }

  const hijacked = (host) => hijackPatterns.some((pattern) => {
    const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
    return new RegExp(`^${escaped}$`, 'i').test(host);
  });

  // Candidates come from the names *any* client asked for, because the device
  // is not the only thing that looks up Store hosts - this PC's probes do too -
  // and a name worth hijacking is a name some client resolved.
  const candidates = [...dnsByClient.values()]
    .flatMap((client) => [...client.names.keys()].filter(looksLikeStoreHost))
    .filter((name, index, all) => all.indexOf(name) === index)
    .filter((name) => !hijacked(name))
    .sort();

  // Endpoints that failed are candidates for emulation - but a mock or block
  // rule answers on purpose, so a 4xx there is the intended behaviour.
  const intentional = (group) => [...group.decisions]
    .some((decision) => decision.startsWith('mock:') || decision.startsWith('block:'));

  const unresolved = [...groups.values()]
    .filter((group) => !intentional(group))
    .filter((group) => [...group.statuses.keys()].some((status) => status >= 400) || group.errors.size)
    .map((group) => group.key);

  const rows = buildClientRows({ http: groupHttpClients(exchanges), dns: dnsByClient, localIps });
  const totals = rows.reduce((sum, row) => ({
    ours: sum.ours + (row.thisPc ? row.exchanges + row.queries : 0),
    theirs: sum.theirs + (row.thisPc ? 0 : row.exchanges + row.queries),
  }), { ours: 0, theirs: 0 });

  // Devices are read from the device traffic only: this PC's rehearsal copies the
  // identity out of the request it replays, so including it would invent a device.
  const deviceTraffic = exchanges.filter((entry) => !localIps.has(entry.client?.address || ''));
  const devices = buildDeviceRows(deviceTraffic);

  // What is left belongs to an address and to no device: named, because "21"
  // alone would be read as the device's traffic rather than as this.
  const assigned = devices.reduce((sum, device) => sum + device.count, 0);
  const unassigned = new Map();
  for (const entry of deviceTraffic) {
    if (deviceKeyOf(entry)) continue;
    const endpoint = `${entry.request.method} https://${entry.request.host}${normalisePath(entry.request.path)}`;
    const row = unassigned.get(endpoint) || { endpoint, count: 0, addresses: new Map() };
    row.count += 1;
    const address = entry.client?.address || 'unknown';
    row.addresses.set(address, (row.addresses.get(address) || 0) + 1);
    unassigned.set(endpoint, row);
  }

  return {
    groups: [...groups.values()],
    candidates,
    unresolved,
    rows,
    totals,
    devices,
    unidentified: deviceTraffic.length - assigned,
    unassigned: [...unassigned.values()].sort((a, b) => b.count - a.count),
  };
}

function clientLabel(address, localIps) {
  return localIps.has(address) ? `${address} (this PC)` : address;
}

function renderMarkdown(report, sessionLabel, sessionDirArg) {
  const lines = [
    '# Intercepted Store protocol',
    '',
    `Session: \`${sessionLabel}\``,
    `Generated: ${new Date().toISOString()}`,
    '',
    '## Who asked',
    '',
    'The capture mixes this PC\'s own traffic with every other client\'s, and **the user agent does',
    'not separate them**: the rehearsal loop sends the phone\'s own agent, so sorting by agent hands',
    'this machine\'s exchanges to the phone (F-012, F-023). `client.address` is the discriminator.',
    '',
    '`phone-ish` is **not** an identity. The DNS log carries no MAC, serial or agent, so a row is',
    'marked that way only because the names it resolved match the fingerprint a Windows Phone -era',
    'device asks (Nokia account/positioning, `discoveryservice`, `*.windowsphone.com`). More than one',
    'address here matches, and which of them is the phone in your hand is not decidable from this file.',
    '',
    `Totals: **${report.totals.theirs}** records from anything that is not this PC, `
      + `**${report.totals.ours}** from this machine.`,
    '',
    '| client | | exchanges | distinct requests | user agents | DNS queries | distinct names | hijacked | fingerprint | first | last |',
    '| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- | --- |',
  ];

  for (const row of report.rows) {
    lines.push(
      `| \`${row.address}\` | ${row.thisPc ? '**this PC**' : row.phoneIsh ? '**phone-ish**' : 'LAN client'} | ${row.exchanges} | `
      + `${row.distinctRequests} | ${row.userAgents.length} | ${row.queries} | ${row.distinctNames} | `
      + `${row.hijacked} | ${row.fingerprint.length} | ${row.first || '-'} | ${row.last || '-'} |`,
    );
  }

  if (report.devices.length) {
    lines.push('### Devices the requests themselves identify', '');
    lines.push('Joined on `x-wp-device-id` when the request carries one, on the `os`/`hw`/`dm` tuple',
      'when it does not. One device id at two addresses is **one** handset that changed address; two',
      'device ids with the same `hw` are **two** handsets of the same model.', '');
    lines.push('| device | addresses | exchanges | evidence | first | last |');
    lines.push('| --- | --- | ---: | --- | --- | --- |');
    for (const device of report.devices) {
      const shortIds = [...device.ids].map((id) => `${id.slice(0, 8)}…${id.slice(-6)}`).join(', ');
      const name = device.ids.size ? `\`x-wp-device-id ${shortIds}\`` : '(no device id)';
      const evidence = [...device.hardware].join(' · ') || '(none) - the request carried no hardware tuple';
      const addresses = [...device.addresses.keys()].map((address) => `\`${address}\``).join(', ');
      const same = device.sameAs?.length ? ' - same handset as the id above' : '';
      lines.push(`| ${name} | ${addresses} | ${device.count} | ${evidence}${same} | ${device.first} | ${device.last} |`);
    }
    lines.push('');
    for (const device of report.devices) {
      const label = device.ids.size ? [...device.ids][0] : device.hardware.size ? [...device.hardware][0] : device.key;
      lines.push(`#### \`${label}\``, '');
      lines.push('| count | request |', '| ---: | --- |');
      for (const [endpoint, count] of [...device.requests].sort((a, b) => b[1] - a[1])) {
        lines.push(`| ${count} | \`${endpoint}\` |`);
      }
      lines.push('');
      lines.push(`Seen at ${[...device.addresses.keys()].join(', ')}.`);
      lines.push('');
    }
    if (report.unassigned.length) {
      lines.push(`${report.unidentified} device exchange(s) identify no device at all: no `
        + '`x-wp-device-id` and no `os`/`hw` in the query string. They are the device\'s *other*',
        'components, and they are listed here rather than dropped so that a reader does not read the',
        'device\'s traffic as smaller than it is:', '');
      lines.push('| count | request | addresses |', '| ---: | --- | --- |');
      for (const row of report.unassigned) {
        lines.push(`| ${row.count} | \`${row.endpoint}\` | ${[...row.addresses.keys()].join(', ')} |`);
      }
      lines.push('');
    }
  }

  const phoneIsh = report.rows.filter((row) => !row.thisPc && row.phoneIsh);
  const others = report.rows.filter((row) => !row.thisPc && !row.phoneIsh);
  if (phoneIsh.length) {
    lines.push('', '### Addresses carrying the Windows Phone fingerprint', '');
    for (const row of phoneIsh) {
      lines.push(`#### \`${row.address}\` - ${row.queries} DNS queries, ${row.exchanges} exchange(s)`, '');
      lines.push(`Fingerprint (${row.fingerprint.length}): ${row.fingerprint.map((n) => `\`${n}\``).join(', ')}`);
      lines.push('');
      if (row.requests.size === 0) {
        lines.push('**No completed request.** It resolved names through the lab and never spoke to it -',
          'either every name it asked for was left alone by the hijack list, or the device never opened',
          'the Store in this window. Its name list is still evidence about the device (F-023).', '');
      } else {
        lines.push('| count | request |', '| ---: | --- |');
        for (const [endpoint, count] of [...row.requests].sort((a, b) => b[1] - a[1])) {
          lines.push(`| ${count} | \`${endpoint}\` |`);
        }
        lines.push('');
      }
    }
  } else {
    lines.push('', 'No address in this capture carries the Windows Phone fingerprint.', '');
  }
  if (others.length) {
    lines.push('### Other clients that resolved through the lab', '');
    lines.push('Not Store traffic, and listed so its absence from the readings above is visible:', '');
    for (const row of others) {
      lines.push(`- \`${row.address}\`: ${row.queries} queries, ${row.distinctNames} names, `
        + `${row.exchanges} exchange(s)${row.storeNames.length ? `, ${row.storeNames.length} Store-looking` : ''}`);
    }
    lines.push('');
  }

  lines.push('## Endpoints seen', '');
  lines.push('| count | method | endpoint | status | type | decision | clients |');
  lines.push('|------:|--------|----------|--------|------|----------|---------|');

  const sorted = [...report.groups].sort((a, b) => b.count - a.count);
  for (const group of sorted) {
    const statuses = [...group.statuses.entries()].map(([s, c]) => `${s}x${c}`).join(' ') || '-';
    const decisions = [...group.decisions].join(' ');
    const clients = [...group.clients.keys()].map((address) => clientLabel(address, report.localIps)).join(' ');
    lines.push(
      `| ${group.count} | ${group.method} | \`${group.host}${group.path}\` | ${statuses} | `
      + `${[...group.contentTypes].join(' ') || '-'} | ${decisions} | ${clients} |`,
    );
  }

  lines.push('', '## Samples', '');
  for (const group of sorted.slice(0, SAMPLE_LIMIT)) {
    const bodies = readBodies(path.join(path.dirname(sessionDirArg), group.sampleSession), group.sample);
    lines.push(`### ${group.method} ${group.host}${group.path}`, '');
    lines.push(`Seen ${group.count}x, first ${group.first}, last ${group.last}.`);
    lines.push(`Session: \`${group.sampleSession}\``);
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
  if (sorted.length > SAMPLE_LIMIT) {
    lines.push(`(samples limited to the ${SAMPLE_LIMIT} most-seen endpoints of ${sorted.length}.)`, '');
  }

  lines.push('## Hosts a client resolved that are not hijacked yet', '');
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

async function main() {
  const args = process.argv.slice(2);
  const flag = (name, fallback) => {
    const i = args.indexOf(`--${name}`);
    return i !== -1 && args[i + 1] ? args[i + 1] : fallback;
  };
  const allSessions = args.includes('--all-sessions');

  const configPath = path.resolve(flag('config', 'config.json'));
  const captureRoot = path.resolve(flag('root', 'captures'));

  const selected = flag('session', null)
    ? [path.resolve(flag('session'))]
    : (allSessions ? sessionDirs(captureRoot) : sessionDirs(captureRoot).slice(-1));

  if (!selected.length || !fs.existsSync(selected[0])) {
    console.error(`No capture session found under ${captureRoot}. Run the proxy and point the device at it first.`);
    process.exit(1);
  }

  const config = fs.existsSync(configPath) ? JSON.parse(fs.readFileSync(configPath, 'utf8')) : {};
  const hijackPatterns = config.dns?.hijack?.names || [];
  const localIps = localAddresses(config);

  const exchanges = await readIndex(selected);
  const { byName, byClient } = await readDnsQueries(captureRoot);
  const report = buildReport(exchanges, byClient, hijackPatterns, localIps);
  report.localIps = localIps;

  const sessionLabel = allSessions && !flag('session', null)
    ? `${selected.length} sessions, ${path.basename(selected[0])} .. ${path.basename(selected.at(-1))}`
    : path.basename(selected.at(-1));

  if (args.includes('--json')) {
    console.log(JSON.stringify({
      session: sessionLabel,
      sessions: selected.map((dir) => path.basename(dir)),
      totals: report.totals,
      devices: report.devices.map((device) => ({
        deviceIds: [...device.ids],
        hardware: [...device.hardware],
        hardwareKeys: [...device.hardwareKeys],
        sameAs: device.sameAs || [],
        addresses: [...device.addresses.keys()],
        exchanges: device.count,
        first: device.first,
        last: device.last,
        requests: [...device.requests.keys()],
      })),
      deviceExchangesWithoutIdentity: report.unidentified,
      deviceRequestsWithoutIdentity: report.unassigned.map((row) => ({
        endpoint: row.endpoint,
        count: row.count,
        addresses: [...row.addresses.keys()],
      })),
      clients: report.rows.map((row) => ({
        address: row.address,
        kind: row.kind,
        thisPc: row.thisPc,
        phoneIsh: row.phoneIsh,
        exchanges: row.exchanges,
        distinctRequests: row.distinctRequests,
        userAgents: row.userAgents,
        dnsQueries: row.queries,
        distinctNames: row.distinctNames,
        hijacked: row.hijacked,
        deviceKeys: row.deviceKeys,
        fingerprint: row.fingerprint,
        storeNames: row.storeNames,
        requests: [...row.requests.keys()],
        first: row.first,
        last: row.last,
      })),
      endpoints: report.groups.map((g) => ({
        endpoint: `${g.method} https://${g.host}${g.path}`,
        count: g.count,
        statuses: [...g.statuses.keys()],
        decisions: [...g.decisions],
        errors: [...g.errors],
        clients: [...g.clients.keys()],
      })),
      unhijackedCandidates: report.candidates,
      failing: report.unresolved,
    }, null, 2));
    return;
  }

  const reportPath = allSessions && !flag('session', null)
    ? path.join(captureRoot, 'census-report.md')
    : path.join(selected.at(-1), 'report.md');
  fs.writeFileSync(reportPath, renderMarkdown(report, sessionLabel, selected.at(-1)));

  console.log(`session(s)  : ${sessionLabel}`);
  console.log(`exchanges   : ${exchanges.length}`);
  console.log(`endpoints   : ${report.groups.length}`);
  console.log(`dns names   : ${byName.size}`);
  console.log('');
  console.log('who asked:');
  for (const row of report.rows) {
    const mark = (row.kind === 'this PC' ? 'this PC  ' : row.kind === 'phone-ish' ? 'PHONE-ISH' : 'lan client').padEnd(10);
    console.log(`  ${mark} ${row.address.padEnd(15)} ${String(row.exchanges).padStart(7)} exchanges  `
      + `${String(row.distinctRequests).padStart(3)} distinct requests  `
      + `${String(row.queries).padStart(6)} DNS queries  ${String(row.distinctNames).padStart(4)} names  `
      + `fingerprint ${String(row.fingerprint.length).padStart(3)}  (${row.first || '-'} .. ${row.last || '-'})`);
  }
  console.log('');
  console.log(`records from this PC: ${report.totals.ours}   from other clients: ${report.totals.theirs}`);

  if (report.devices.length) {
    console.log('');
    console.log('devices the requests identify:');
    for (const device of report.devices) {
      const name = device.ids.size
        ? `id ${[...device.ids].join(', ')}`
        : `hardware ${[...device.hardware].join(' · ')}`;
      console.log(`  ${String(device.count).padStart(5)}x  ${name}`);
      console.log(`         addresses: ${[...device.addresses.keys()].join(', ')}`);
      for (const facts of device.hardware) console.log(`         ${facts}`);
    }
    for (const row of report.unassigned) {
      console.log(`  ${String(row.count).padStart(5)}x  (no identity)  ${row.endpoint}`);
    }
  }

  for (const row of report.rows.filter((r) => !r.thisPc && r.phoneIsh)) {
    console.log('');
    console.log(`phone-ish ${row.address}:`);
    if (row.requests.size === 0) {
      console.log('  (no completed request - it resolved names and never spoke to the lab)');
    }
    for (const [endpoint, count] of [...row.requests].sort((a, b) => b[1] - a[1])) {
      console.log(`  ${String(count).padStart(4)}x  ${endpoint}`);
    }
  }

  console.log('');
  for (const group of [...report.groups].sort((a, b) => b.count - a.count).slice(0, 40)) {
    const statuses = [...group.statuses.keys()].join('/');
    const clients = [...group.clients.keys()].map((address) => (localIps.has(address) ? 'us' : address)).join(',');
    console.log(`  ${String(group.count).padStart(4)}x  ${group.method.padEnd(5)} ${group.host}${group.path}  [${statuses}]  ${[...group.decisions].join(',')}  ${clients}`);
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
  // Streamed now, so the report is async: a rejected promise must still be loud,
  // not an empty report with a clean exit status.
  main().catch((err) => {
    console.error(`analysis failed: ${err.message}`);
    process.exit(1);
  });
}
