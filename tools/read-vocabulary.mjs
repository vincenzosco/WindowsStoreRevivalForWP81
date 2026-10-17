#!/usr/bin/env node
// Re-derive the Store vocabulary from the phone and compare it with
// src/store/vocabulary.mjs.
//
//   node tools/read-vocabulary.mjs
//   node tools/read-vocabulary.mjs --device H: --verbose
//
// The module holds a reading of the device. A reading is only worth something if
// it can be taken again, so this tool takes it again from the mounted phone and
// reports where the two disagree. A drift is a failure (exit 1): either the phone
// changed, or the module was edited without evidence, and both are worth stopping
// for.
//
// The extraction is deliberately mechanical - string runs and regular expressions.
// It cannot reproduce the judgement in the module (that `GamesHub` is a settings
// key is a reading of context, not of a pattern), so it checks the part that is
// pattern-shaped: which page types the parser names, which template types the UI
// assets style, which structural paths the parser walks, and which content link
// types exist. Those are the claims a page's correctness rests on.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  PAGE_TYPES,
  TEMPLATE_TYPES,
  CONTENT_LINK_TYPES,
  FEED_PATHS,
  PAGE_PARSE_PATHS,
  PATHS_NEAR_THE_PAGE_GRAMMAR,
  TEMPLATE_GRAMMAR,
  PROVENANCE,
} from '../src/store/vocabulary.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i !== -1 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : fallback;
};
const verbose = args.includes('--verbose');
const device = flag('device', PROVENANCE.mount);

const PARSER = path.join(device, 'Windows', 'System32', 'ZMarketplace.dll');
const UI = path.join(device, 'Windows', 'System32', 'ZuneAssets480x800.dll');

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  ${detail}` : ''}`);
}

/**
 * Every printable run of a binary, both encodings, with its byte offset.
 *
 * A WinRT-era DLL keeps most literals in UTF-16, so an ASCII-only walk would miss
 * the names this is looking for - the same reason the first read of these files
 * had to handle both.
 */
function stringRuns(file) {
  const buffer = fs.readFileSync(file);
  const runs = [];
  const push = (text, offset, kind) => {
    if (text.length >= 3 && /[A-Za-z]/.test(text)) runs.push({ text, offset, kind });
  };
  let start = 0;
  let text = '';
  for (let i = 0; i <= buffer.length; i += 1) {
    const byte = i < buffer.length ? buffer[i] : 0;
    if (byte >= 0x20 && byte < 0x7f) {
      if (!text) start = i;
      text += String.fromCharCode(byte);
    } else {
      push(text, start, 'ascii');
      text = '';
    }
  }
  for (let i = 0; i + 1 < buffer.length; i += 1) {
    let j = i;
    let run = '';
    while (j + 1 < buffer.length && buffer[j] >= 0x20 && buffer[j] < 0x7f && buffer[j + 1] === 0) {
      run += String.fromCharCode(buffer[j]);
      j += 2;
    }
    if (run.length >= 3 && /[A-Za-z]/.test(run)) { push(run, i, 'utf16'); i = j - 1; }
  }
  return { buffer, runs: runs.sort((a, b) => a.offset - b.offset) };
}

function requireBinary(file) {
  if (!fs.existsSync(file)) {
    console.error(`not found: ${file}`);
    console.error('The phone has to be mounted for this check. Pass --device <letter:> if it is elsewhere.');
    process.exit(2);
  }
  return stringRuns(file);
}

console.log(`reading the vocabulary from ${device}`);
console.log(`  parser: ${PARSER}`);
console.log(`  ui    : ${UI}\n`);

const parser = requireBinary(PARSER);
const ui = requireBinary(UI);

console.log(`parser: ${parser.buffer.length} bytes, ${parser.runs.length} string runs`);
console.log(`ui    : ${ui.buffer.length} bytes, ${ui.runs.length} string runs\n`);

// --- the page types the parser names ----------------------------------------
//
// Named as string constants in one run beside the page's structural paths, which
// is what makes a name found here a page type rather than an unrelated word. The
// `s` prefix on the first one is the binary's convention for a string constant,
// so it is stripped before comparing.
const pageRunStart = Math.min(...FEED_PATHS.map((entry) => entry.parserOffset)) - 400;
const pageRunEnd = Math.max(...FEED_PATHS.map((entry) => entry.parserOffset)) + 400;
const besidePaths = parser.runs.filter((run) => run.offset >= pageRunStart && run.offset <= pageRunEnd);
if (verbose) {
  console.log('  --- the run the page types live in');
  for (const run of besidePaths) console.log(`  @${run.offset} [${run.kind}] ${run.text}`);
  console.log('');
}

for (const page of PAGE_TYPES) {
  const found = parser.runs.find((run) => {
    const token = run.text.startsWith('s') ? run.text.slice(1) : run.text;
    return token.toLowerCase() === page.id.toLowerCase();
  });
  check(`parser names page type ${page.id}`,
    Boolean(found) && found.offset === page.parserOffset,
    found ? `@${found.offset} "${found.text}"` : 'not found');
}

// --- the template types the UI styles ---------------------------------------
//
// `Store_TemplateType000`, `Store_Hub_TemplateType003`, `Store_Chart_TemplateType010`:
// a page family, the literal TemplateType, and a three-digit number. The trailing
// character on each asset name is the low byte of an ordinal the resource table
// appends to the name, so it is not part of the extraction.
const foundTypes = new Map();
for (const run of ui.runs) {
  const match = /(?:^|_)(?:(Hub|Chart)_)?TemplateType(\d{3})/.exec(run.text);
  if (!match) continue;
  const family = match[1] === 'Chart' ? 'DynamicChart' : 'DynamicHub';
  const id = match[2];
  if (!foundTypes.has(family)) foundTypes.set(family, new Map());
  if (!foundTypes.get(family).has(id)) foundTypes.get(family).set(id, { offset: run.offset, namedAs: run.text });
}

for (const family of Object.keys(TEMPLATE_TYPES)) {
  const declared = TEMPLATE_TYPES[family].map((entry) => entry.id).sort();
  const found = [...(foundTypes.get(family)?.keys() || [])].sort();
  const missing = declared.filter((id) => !found.includes(id));
  const extra = found.filter((id) => !declared.includes(id));
  check(`ui styles the ${family} template types the module declares`,
    missing.length === 0 && extra.length === 0,
    `declared=[${declared.join(',')}] found=[${found.join(',')}]`
      + (missing.length ? ` missing=[${missing.join(',')}]` : '')
      + (extra.length ? ` extra=[${extra.join(',')}]` : ''));
}

// The offsets are the part that makes the reading checkable, so they are compared
// too: a name that moved means the binary is not the one the module was read from.
let offsetDrift = 0;
for (const family of Object.keys(TEMPLATE_TYPES)) {
  for (const entry of TEMPLATE_TYPES[family]) {
    const found = foundTypes.get(family)?.get(entry.id);
    if (!found) { offsetDrift += 1; continue; }
    if (found.offset !== entry.uiOffset) {
      offsetDrift += 1;
      console.log(`      ${family}/${entry.id}: module says @${entry.uiOffset}, device says @${found.offset}`);
    }
  }
}
check('every declared template type is still at the offset the module cites',
  offsetDrift === 0, `${offsetDrift} drifted`);

// --- the structural paths and the type key ----------------------------------
//
// Two lists, checked the same mechanical way. FEED_PATHS is the handful the builder
// was written against; PAGE_PARSE_PATHS is the parser's own run, down to the offer
// inside an application, and it is the one the suite holds the served page to. The
// paths recorded beside it as *not* page paths are checked here too, because a
// drifting one of those would mean the two lists had been sorted wrongly.
// Deduplicated, because six paths are declared twice on purpose: FEED_PATHS is the
// short list the builder was written against, PAGE_PARSE_PATHS is the parser's own
// run, and the second contains the first. Both citations are kept in the module -
// they answer different questions - but checking the same entry twice only makes
// the output look like it has twice as much evidence as it does.
const pathLists = [];
for (const entry of [...FEED_PATHS, ...PAGE_PARSE_PATHS, ...PATHS_NEAR_THE_PAGE_GRAMMAR.flatMap((g) => g.paths)]) {
  if (pathLists.some((seen) => seen.path === entry.path && seen.parserOffset === entry.parserOffset)) continue;
  pathLists.push(entry);
}
for (const entry of pathLists) {
  // Looked up **by the offset the module cites**, not by the first run that carries
  // that text. `/title` and `/content` are each spelled in more than one place in
  // this binary - the page-grammar run, and an earlier config - so a first-match
  // lookup reports drift for a citation that is exactly right, which is what it did
  // the first time these paths were checked against the phone. A second occurrence
  // is not a failure; it is worth printing, because it is the reason the offset is
  // in the module rather than just the path.
  const here = parser.runs.find((run) => run.offset === entry.parserOffset);
  const elsewhere = parser.runs.filter((run) => run.text === entry.path && run.offset !== entry.parserOffset);
  const correct = Boolean(here) && here.text === entry.path;
  check(`parser walks ${entry.path}`, correct,
    correct
      ? `@${entry.parserOffset}${elsewhere.length ? ` (same text also at ${elsewhere.map((r) => `@${r.offset}`).join(', ')})` : ''}`
      : `the module cites @${entry.parserOffset}, which holds ${JSON.stringify(here ? here.text : null)}`
        + (elsewhere.length ? ` - the path itself is at ${elsewhere.map((r) => `@${r.offset}`).join(', ')}` : ''));
}

const typeKey = parser.runs.find((run) => run.text === TEMPLATE_GRAMMAR.typeKey);
check(`parser holds ${TEMPLATE_GRAMMAR.typeKey} as the template type key`,
  Boolean(typeKey) && typeKey.offset === TEMPLATE_GRAMMAR.typeKeyOffset,
  typeKey ? `@${typeKey.offset}` : 'not found');

// --- the content link types -------------------------------------------------
for (const type of CONTENT_LINK_TYPES) {
  const found = parser.runs.find((run) => run.text === type);
  check(`parser names content link type ${type}`,
    Boolean(found), found ? `@${found.offset}` : 'not found');
}

// --- the decoys are still what they were described as -----------------------
//
// Checked because the module's most useful claim about them is negative - they are
// settings, not templates - and a name that stopped being a settings key would be
// worth knowing about before it is relied on.
for (const entry of [...(await import('../src/store/vocabulary.mjs')).NOT_A_TEMPLATE]) {
  const found = parser.runs.find((run) => run.text === entry.name);
  check(`${entry.name} is still present in the parser at the cited offset`,
    Boolean(found) && found.offset === entry.parserOffset,
    found ? `@${found.offset}` : 'not found');
}

const failed = results.filter((r) => !r.ok);
console.log('');
console.log(`${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) {
  console.log('failed:');
  for (const f of failed) console.log(`  - ${f.name}`);
  console.log('');
  console.log('A drift means the module and the phone no longer agree. Re-read the device');
  console.log('and update src/store/vocabulary.mjs, or explain why the module should win.');
}
process.exit(failed.length ? 1 : 0);
