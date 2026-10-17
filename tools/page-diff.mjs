#!/usr/bin/env node
// Read the page's *frame* against the frame the client's own parser describes.
//
//   node tools/page-diff.mjs
//   node tools/page-diff.mjs --archive src/store/fixtures/archive/real-hub-page-20130813.xml
//   node tools/page-diff.mjs --path "/v9/catalog/storePages?typeId=DynamicHub.Main&cc=IT"
//
// WHY THIS EXISTS. The application list from /v9/catalog/apps is drawn: the client
// resolved its seventeen entries, asked for four of them by id and asked for one
// icon each (F-031). The same entries, in the same order, inside a <StorePage>
// produce nothing on screen - no request follows the page fetch and no error is
// shown. So the entry grammar is not what is missing; the *frame* is. This reads the
// frame the served document actually has and compares it, path by path, with the
// paths the client's own parser names (PAGE_PARSE_PATHS, read out of
// ZMarketplace.dll) and with the archived response of the real service.
//
// WHAT IT CANNOT SAY. It says which paths the document carries, and whether it
// carries them spelled exactly as the parser spells them or only with the local name
// under a prefix. Which of those the client's XML engine accepts is the device's
// answer, and a path that differs is reported as differing - not as broken.
//
// The document is fetched through the real router rather than assembled here, so
// what is read is what the device would be sent under the current config, pageFormat,
// pane type and pane data sources included.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadConfig } from '../src/config.mjs';
import { buildHandlers } from '../src/store/handlers.mjs';
import { StoreRouter } from '../src/store/router.mjs';
import { collect, coverage, describe, findFirst, pathsUnder, verdictOf } from '../src/store/page-frame.mjs';
import { PAGE_PARSE_PATHS, PANE_FIELDS } from '../src/store/vocabulary.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i !== -1 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : fallback;
};

const config = loadConfig(path.resolve(flag('config', 'config.json')));
const pagePath = flag('path', '/v9/catalog/storePages?typeId=DynamicHub.Main&os=8.10.14219.0&cc=IT&lang=it-IT');
const archiveFile = flag('archive', config.livestore?.protocol?.archiveFile
  || 'src/store/fixtures/archive/real-hub-page-20130813.xml');

const logger = { warn() {}, error() {}, info() {}, debug() {} };
const router = new StoreRouter({ handlers: buildHandlers(config), logger });
const served = await router.handle({
  id: 'page-diff',
  host: 'cdn.marketplaceedgeservice.windowsphone.com',
  port: 80,
  scheme: 'http',
  method: 'GET',
  path: pagePath,
  headers: { host: 'cdn.marketplaceedgeservice.windowsphone.com', 'user-agent': 'page-diff' },
  body: Buffer.alloc(0),
  mitm: true,
  client: { address: '127.0.0.1', port: 0 },
}, { config, logger, zinc: null });

if (!served) {
  console.error(`no handler answered ${pagePath}: open the tool's --path or turn the protocol handler on`);
  process.exit(2);
}

const servedXml = served.body.toString('utf8');
const archivePath = path.resolve(ROOT, archiveFile);
const archiveXml = fs.existsSync(archivePath) ? fs.readFileSync(archivePath, 'utf8') : '';

const servedDoc = collect(servedXml);
const archiveDoc = archiveXml ? collect(archiveXml) : null;
const servedRoot = describe(servedDoc);

console.log(`served  : <${servedRoot.rootQname}> ${servedXml.length} B,`
  + ` format ${served.headers['x-lab-page-format'] || '?'},`
  + ` ${served.headers['x-lab-sections'] || '?'} section(s),`
  + ` pane sources ${served.headers['x-lab-pane-sources'] || '?'}`);
console.log(`          root children: ${servedRoot.childNames.join(', ') || '(none)'}`);
if (archiveDoc) {
  const archiveRoot = describe(archiveDoc);
  console.log(`archive : <${archiveRoot.rootQname}> ${archiveXml.length} B (${path.basename(archivePath)})`);
  console.log(`          root children: ${archiveRoot.childNames.join(', ') || '(none)'}`);
} else {
  console.log(`archive : not read (${archivePath} is missing)`);
}

const rows = PAGE_PARSE_PATHS.map((entry) => ({
  entry,
  served: coverage(servedDoc, entry),
  archive: archiveDoc ? coverage(archiveDoc, entry) : null,
}));

const width = Math.max(...PAGE_PARSE_PATHS.map((entry) => entry.path.length));
const cell = (result) => {
  const verdict = verdictOf(result);
  if (verdict === 'exact') return String(result.exactHits);
  if (verdict === 'prefix-only') return 'prefix';
  return 'MISSING';
};

console.log('');
console.log(`  ${'parser path'.padEnd(width)}${'served'.padEnd(10)}archive`);
for (const { entry, served: s, archive: a } of rows) {
  console.log(`  ${entry.path.padEnd(width)}${cell(s).padEnd(10)}${a ? verdictOf(a) : '-'}`);
}

const required = rows.filter((row) => row.entry.required !== false);
const byVerdict = (verdict) => required.filter((row) => verdictOf(row.served) === verdict);
const missing = byVerdict('missing');
const prefixOnly = byVerdict('prefix-only');

console.log('');
console.log(`${required.length} required path(s): ${byVerdict('exact').length} spelled exactly,`
  + ` ${prefixOnly.length} prefix-only, ${missing.length} missing`);
if (prefixOnly.length) {
  console.log('');
  console.log('prefix-only - the element is there, spelled under a namespace prefix the parser\'s own');
  console.log('selector string does not carry. Whether the client\'s XML engine ignores prefixes is the');
  console.log('device\'s answer, not this tool\'s. The archived response of the real service is spelled');
  console.log('the same way, which is evidence about the service, not about this client.');
  for (const row of prefixOnly) console.log(`  ${row.entry.path}  (@${row.entry.parserOffset})`);
}
if (missing.length) {
  console.log('');
  console.log('missing - no element of that name at that position, by either spelling:');
  for (const row of missing) console.log(`  ${row.entry.path}  (@${row.entry.parserOffset})`);
}

// The pane's own property map, one level below the page: a frame can carry every
// path the page parser names and still hand it a pane with no fields the pane parser
// reads, and those two failures look identical from the outside - a page with
// nothing on it.
const firstPane = findFirst(servedDoc, 'Pane');
if (firstPane) {
  const under = pathsUnder(firstPane);
  const absent = PANE_FIELDS.filter((field) => !under.has(field.path.split('/').filter(Boolean).join('/')));
  console.log('');
  console.log(`first <Pane>: ${PANE_FIELDS.length - absent.length}/${PANE_FIELDS.length} of the pane property map's path(s) carried`);
  if (absent.length) {
    console.log(`  not carried: ${absent.map((field) => `${field.path} (@${field.parserOffset})`).join(', ')}`);
    console.log('  (absent is a fact about the document, not yet a defect: nothing read says the');
    console.log('   pane parser requires them, and the archived page carries no Panes at all.)');
  }
}

if (archiveDoc) {
  const servedChildren = new Set(servedRoot.childNames);
  const archiveChildren = new Set(describe(archiveDoc).childNames);
  console.log('');
  console.log('root children only in the served page :',
    [...servedChildren].filter((name) => !archiveChildren.has(name)).join(', ') || '(none)');
  console.log('root children only in the archive    :',
    [...archiveChildren].filter((name) => !servedChildren.has(name)).join(', ') || '(none)');
}

console.log('');
console.log('A path marked MISSING is the strongest frame defect this tool can report: the client asks');
console.log('its parser for a construct the document does not contain at all. A path marked `prefix` is');
console.log('carried and spelled differently, which only the device can settle.');
