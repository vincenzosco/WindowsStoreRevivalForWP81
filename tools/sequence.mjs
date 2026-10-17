#!/usr/bin/env node
// What one Store open looks like, in order, per device.
//
//   npm run sequence                              # the newest session
//   npm run sequence -- --session 2026-10-16_05-53-27
//   npm run sequence -- --device 40752FED         # only the handset with that id prefix
//   npm run sequence -- --compare <a> <b>         # two sessions, counts side by side
//   npm run sequence -- --json
//
// Why this exists next to `npm run analyze`: that tool answers "who asked, and which
// device", which is the census question. The question that decides the two open
// experiments is a *sequence* one - did the configuration request stop retrying, did
// the page arrive, and did anything at all follow it - and answering it by reading
// `index.jsonl` by eye is how a result gets missed. E-001's verdict sat in the
// capture for hours because nobody had a report that put the exchanges in order.
//
// Read the columns as: time UTC (the index is UTC, the device's own clock is local),
// method, host+path, status, and the decision the lab recorded. A row whose
// decision is `passthrough` and whose status is 502 did not reach a handler.
//
// Grouping follows `npm run analyze`: the device id wins, and a request without an
// id but with the same `hw`/`dm` is joined to the handset that has one - which is
// exactly the shape of the configuration calls, and without that join they would
// look like a device of their own.

import fs from 'node:fs';
import path from 'node:path';

import { readJsonl } from '../src/capture.mjs';
import { deviceKeyOf, localAddresses } from './analyze-captures.mjs';

const ROOT = path.resolve(new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const CAPTURES = path.join(ROOT, 'captures');

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i !== -1 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : fallback;
};
const has = (name) => args.includes(`--${name}`);

/** Resolve a session by name or path; default is the newest one in `captures/`. */
export function resolveSession(spec) {
  if (spec) {
    // Accept the directory name with or without the `session-` prefix, because both
    // spellings are what a reader has in front of them: the folder in `captures/`
    // and the timestamp the report prints.
    const candidates = fs.existsSync(spec)
      ? [path.resolve(spec)]
      : [path.join(CAPTURES, spec), path.join(CAPTURES, `session-${spec}`)];
    const found = candidates.find((candidate) => fs.existsSync(path.join(candidate, 'index.jsonl')));
    if (!found) throw new Error(`no such session: ${spec}`);
    return found;
  }
  const sessions = fs.readdirSync(CAPTURES)
    .filter((name) => name.startsWith('session-'))
    .map((name) => ({ name, dir: path.join(CAPTURES, name) }))
    .filter(({ dir }) => fs.existsSync(path.join(dir, 'index.jsonl')))
    .sort((a, b) => fs.statSync(path.join(b.dir, 'index.jsonl')).mtimeMs
      - fs.statSync(path.join(a.dir, 'index.jsonl')).mtimeMs);
  if (!sessions.length) throw new Error(`no session with an index under ${CAPTURES}`);
  return sessions[0].dir;
}

export async function readExchanges(sessionDir) {
  const exchanges = [];
  for await (const line of readJsonl(path.join(sessionDir, 'index.jsonl'))) {
    try {
      exchanges.push(JSON.parse(line));
    } catch { /* a torn last line is not an exchange */ }
  }
  return exchanges;
}

/**
 * Which exchange this is, in the vocabulary of the two experiments.
 *
 * The store is carried for the configuration calls because the retry count per
 * store is the reading: four tries against a 502 is the client giving up, and one
 * is the client accepting an answer.
 */
export function classify(entry) {
  const host = String(entry.request?.host || '');
  const urlPath = String(entry.request?.path || '');
  if (/^\/v8\/Configuration\//.test(urlPath)) {
    const store = /OEMStores\/([^/?]*)/.exec(urlPath);
    const family = /MOStores/.test(urlPath) ? 'MO' : 'OEM';
    return { kind: 'configuration', store: family, storeId: (store && store[1]) || '' };
  }
  if (/^\/v9\/catalog\/storePages/.test(urlPath)) return { kind: 'page', store: '', storeId: '' };
  if (/^\/v8\/catalog\/updates/.test(urlPath)) return { kind: 'updates', store: '', storeId: '' };
  if (/^\/v[89]\/catalog\/apps/.test(urlPath)) return { kind: 'appList', store: '', storeId: '' };
  return { kind: 'other', store: '', storeId: '', host };
}

/**
 * The exchanges of one session grouped by device, in time order.
 *
 * The join is the one `deviceKeyOf` describes: an exchange that names a device id
 * keys on it, one that only carries `hw`/`dm` keys on hardware, and a hardware key
 * that matches a handset's own tuple is folded into that handset afterwards - so a
 * configuration call without an id appears under the phone it came from instead of
 * as a second device.
 */
export function groupByDevice(exchanges) {
  const sorted = [...exchanges].sort((a, b) => String(a.ts).localeCompare(String(b.ts)));

  // An exchange with no device id keys on hardware **and address**, not on hardware
  // alone. The census needs the opposite - it has to follow one handset across a
  // changed lease (F-023) - but a *sequence* must not fuse two sources, and this is
  // the one place where fusing them is easy to do by accident: `npm run rehearse`
  // replays the phone's own query, so a replay from this PC carries the phone's
  // `hw`/`dm` and would be folded into the handset it is imitating (F-012, footgun 4).
  const groups = new Map();
  for (const entry of sorted) {
    const found = deviceKeyOf(entry);
    const address = entry.client?.address || 'unknown';
    const key = found
      ? (found.kind === 'id' ? found.key : `hardware:${found.hardwareKey}@${address}`)
      : 'no-identity';
    if (!groups.has(key)) {
      groups.set(key, { key, label: labelFor(found, entry), entries: [], addresses: new Set(), hardwareKeys: new Set() });
    }
    const group = groups.get(key);
    group.entries.push(entry);
    if (entry.client?.address) group.addresses.add(entry.client.address);
    if (found?.hardwareKey) group.hardwareKeys.add(found.hardwareKey);
  }

  // Say it where it is true: a hardware key seen at more than one address is two
  // groups on purpose, and the reader has to know why before comparing their counts.
  const addressesByHardware = new Map();
  for (const group of groups.values()) {
    for (const hardwareKey of group.hardwareKeys) {
      if (!addressesByHardware.has(hardwareKey)) addressesByHardware.set(hardwareKey, new Set());
      for (const address of group.addresses) addressesByHardware.get(hardwareKey).add(address);
    }
  }
  for (const group of groups.values()) {
    group.splitAcrossAddresses = [...group.hardwareKeys]
      .some((hardwareKey) => (addressesByHardware.get(hardwareKey) || new Set()).size > 1);
  }
  return [...groups.values()];
}

function labelFor(found, entry) {
  const address = entry.client?.address || 'unknown';
  if (!found) return 'no device identity (no id, no hw/dm)';
  if (found.kind === 'id') {
    return `${found.id.slice(0, 16)}…${found.id.slice(-6)}${found.hardware ? ` (${found.hardware})` : ''}`;
  }
  return `${found.hardware || found.hardwareKey} (no device id) at ${address}`;
}

/**
 * The numbers the two experiments are read by.
 *
 * `afterFirstPage` deliberately excludes the configuration calls and the page itself:
 * those come before or are the page, so counting them as a follow-up would make every
 * session look like it moved. What is left is the only thing that would show a model
 * was built - an image, a pane source, a detail page, an update check.
 */
export function summarize(entries) {
  const ordered = [...entries].sort((a, b) => String(a.ts).localeCompare(String(b.ts)));
  const configuration = { total: 0, byStore: { OEM: 0, MO: 0 }, byStatus: {}, retries: 0 };
  let page = { count: 0, byStatus: {}, firstAt: null };
  const updates = { count: 0, byStatus: {} };
  const appLists = { count: 0, byStatus: {} };
  const others = [];

  for (const entry of ordered) {
    const kind = classify(entry);
    const status = entry.response?.status ?? 0;
    if (kind.kind === 'configuration') {
      configuration.total += 1;
      configuration.byStore[kind.store] += 1;
      configuration.byStatus[status] = (configuration.byStatus[status] || 0) + 1;
    } else if (kind.kind === 'page') {
      page.count += 1;
      page.byStatus[status] = (page.byStatus[status] || 0) + 1;
      if (!page.firstAt) page.firstAt = entry.ts;
    } else if (kind.kind === 'updates') {
      updates.count += 1;
      updates.byStatus[status] = (updates.byStatus[status] || 0) + 1;
    } else if (kind.kind === 'appList') {
      appLists.count += 1;
      appLists.byStatus[status] = (appLists.byStatus[status] || 0) + 1;
    } else {
      others.push(entry);
    }
  }
  // One success per store is what an accepted answer looks like; anything above it
  // is a retry against something the client did not accept.
  configuration.retries = Math.max(0, configuration.byStore.OEM - 1)
    + Math.max(0, configuration.byStore.MO - 1);

  const afterFirstPage = page.firstAt
    ? ordered.filter((entry) => String(entry.ts) > String(page.firstAt)
      && !['configuration', 'page'].includes(classify(entry).kind))
    : [];

  return { configuration, page, updates, appLists, others, afterFirstPage, ordered };
}

function shorten(entry, width = 92) {
  const target = `${entry.request?.host || ''}${entry.request?.path || ''}`;
  return target.length > width ? `${target.slice(0, width - 1)}…` : target;
}

function clock(entry) {
  return String(entry.ts || '').slice(11, 19);
}

function printDevice(group, localIps) {
  const summary = summarize(group.entries);
  const addresses = [...group.addresses];
  const ours = addresses.every((address) => localIps.has(address));
  console.log(`\n## ${group.label}${ours ? '  [this PC: not a device]' : ''}`);
  console.log(`   seen at ${addresses.join(', ')} - ${group.entries.length} exchange(s)`);
  if (group.splitAcrossAddresses && !ours) {
    console.log('   note: the same hw/dm appears at another address in this session, and a replay of'
      + " the phone's own query carries that tuple too - the replay is not a device (F-012, F-023)");
  }
  for (const entry of summary.ordered) {
    const kind = classify(entry);
    const tag = kind.kind === 'configuration' ? `config/${kind.store}` : kind.kind;
    console.log(`   ${clock(entry)}  ${String(entry.request?.method || '?').padEnd(4)} ${shorten(entry).padEnd(94)} ${String(entry.response?.status ?? '?').padEnd(3)} ${String(entry.decision || '').padEnd(22)} ${tag}`);
  }

  const c = summary.configuration;
  if (c.total) {
    const stores = Object.entries(c.byStore).filter(([, n]) => n).map(([store, n]) => `${store}=${n}`).join(' ');
    console.log(`   configuration: ${c.total} request(s) (${stores}), statuses ${JSON.stringify(c.byStatus)}, retries above one per store: ${c.retries}`);
  }
  if (summary.page.count) {
    console.log(`   page: ${summary.page.count} delivery(ies), statuses ${JSON.stringify(summary.page.byStatus)}, first at ${clock({ ts: summary.page.firstAt })} UTC`);
    if (!summary.afterFirstPage.length) {
      console.log('   after the first page: nothing - the signature of a page that built no model (F-005, F-019)');
    } else {
      console.log(`   after the first page: ${summary.afterFirstPage.length} request(s) - ${summary.afterFirstPage.map((entry) => `${clock(entry)} ${shorten(entry, 70)} -> ${entry.response?.status}`).join('; ')}`);
    }
  }
  if (summary.updates.count) {
    console.log(`   update check: ${summary.updates.count}, statuses ${JSON.stringify(summary.updates.byStatus)}`);
  }
  if (summary.appLists.count) {
    console.log(`   application lists: ${summary.appLists.count}, statuses ${JSON.stringify(summary.appLists.byStatus)}`);
  }
  const leftover = summary.others.map((entry) => `${clock(entry)} ${shorten(entry, 70)} -> ${entry.response?.status}`);
  if (leftover.length) console.log(`   other: ${leftover.length} - ${leftover.slice(0, 6).join('; ')}${leftover.length > 6 ? '; …' : ''}`);
  return summary;
}

function printCompare(a, b) {
  const rows = [
    ['configuration (OEM/MO)', (s) => `${s.configuration.byStore.OEM}/${s.configuration.byStore.MO}`],
    ['configuration retries', (s) => String(s.configuration.retries)],
    ['configuration statuses', (s) => JSON.stringify(s.configuration.byStatus)],
    ['page deliveries', (s) => String(s.page.count)],
    ['page statuses', (s) => JSON.stringify(s.page.byStatus)],
    ['after the first page', (s) => String(s.afterFirstPage.length)],
    ['after the first page, what', (s) => s.afterFirstPage.map((entry) => classify(entry).kind).join(',') || '-'],
    ['update checks', (s) => String(s.updates.count)],
  ];
  const width = Math.max(...rows.map(([label]) => label.length));
  console.log(`\n${''.padEnd(width)}  ${a.name.padEnd(28)}  ${b.name}`);
  for (const [label, read] of rows) {
    console.log(`${label.padEnd(width)}  ${read(a.summary).padEnd(28)}  ${read(b.summary)}`);
  }
}

async function main() {
  const config = (() => {
    try {
      return JSON.parse(fs.readFileSync(path.join(ROOT, 'config.json'), 'utf8'));
    } catch {
      return {};
    }
  })();
  const localIps = localAddresses(config);
  localIps.add('127.0.0.1');
  localIps.add('::1');

  if (has('compare')) {
    const i = args.indexOf('--compare');
    const specs = args.slice(i + 1).filter((arg) => !arg.startsWith('--')).slice(0, 2);
    if (specs.length !== 2) throw new Error('--compare needs two sessions');
    const sessions = [];
    for (const spec of specs) {
      const dir = resolveSession(spec);
      const groups = groupByDevice(await readExchanges(dir));
      // The comparison is about one handset, so the group with the most exchanges
      // that is not this machine is the one compared - and it is named in the output.
      const device = groups.find((group) => [...group.addresses].some((address) => !localIps.has(address)))
        || groups[0];
      if (!device) throw new Error(`no exchanges in ${spec}`);
      sessions.push({ name: path.basename(dir).replace(/^session-/, ''), summary: summarize(device.entries), label: device.label });
    }
    console.log(`\nA: ${sessions[0].label}   B: ${sessions[1].label}`);
    printCompare(sessions[0], sessions[1]);
    return;
  }

  const sessionDir = resolveSession(flag('session'));
  const exchanges = await readExchanges(sessionDir);
  const wanted = flag('device');
  let groups = groupByDevice(exchanges);
  if (wanted) {
    groups = groups.filter((group) => group.key.includes(wanted) || group.label.includes(wanted));
    if (!groups.length) throw new Error(`no device matching "${wanted}" in ${path.basename(sessionDir)}`);
  }
  if (has('json')) {
    console.log(JSON.stringify({
      session: path.basename(sessionDir),
      devices: groups.map((group) => ({
        key: group.key,
        label: group.label,
        addresses: [...group.addresses],
        exchanges: group.entries.length,
        ...summarize(group.entries),
      })),
    }, null, 2));
    return;
  }
  console.log(`session ${path.basename(sessionDir)} - ${exchanges.length} exchange(s), times are UTC`);
  if (!exchanges.length) console.log('  (empty)');
  for (const group of groups) printDevice(group, localIps);
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'))) {
  main().catch((err) => {
    console.error(`sequence: ${err.message}`);
    process.exitCode = 1;
  });
}
