#!/usr/bin/env node
// Byte-search a firmware image (an FFU, a dump, any single file) for the tokens the
// Store configuration question turns on.
//
//   npm run image:find -- --file "<path>.ffu"
//   npm run image:find -- --file image.ffu --pattern mpcVersion --pattern OEMStores
//   npm run image:find -- --file image.ffu --context 200 --limit 3
//
// Why an image and not the phone: the FFU is the complete filesystem of the build,
// so it answers the same questions a mass-storage pass does - which binaries hold
// `mpcVersion`, whether a default store configuration is stored anywhere - without
// halting the device, without elevation, and without `reg load` rewriting its hive.
// The phone remains the authority on what *this* unit holds; the image is the
// authority on what the build contains.
//
// What it reports: every hit with its absolute offset and the readable text around it,
// in both encodings, because a Windows Phone image is full of UTF-16LE and a search
// that only tried ASCII would return a confident zero (the mistake F-020's content
// search made in the other direction).
//
// Controls matter here and the default list carries two on purpose: `StorePage` and
// `Store_Hub_TemplateType003` are strings this project has already read off the phone,
// so a run that finds neither is a run whose *method* failed, not one that proved
// something is absent.

import fs from 'node:fs';
import path from 'node:path';

const DEFAULT_PATTERNS = [
  // the configuration question
  'mpcVersion', 'OEMStores', 'MOStores', 'v8/Configuration', 'LKGOEMStoreConfigOverride',
  'marketplaceedgeservice',
  // controls: already read off the phone, so a zero here means the method failed
  'StorePage', 'Store_Hub_TemplateType003',
];

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i !== -1 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : fallback;
};
const flags = (name) => args.reduce((out, arg, i) => (
  arg === `--${name}` && args[i + 1] ? [...out, args[i + 1]] : out
), []);

const file = flag('file');
if (!file) {
  console.error('usage: node tools/find-in-image.mjs --file <image> [--pattern <p> ...] [--context 96] [--limit 5]');
  process.exit(2);
}
const absolute = path.resolve(file);
if (!fs.existsSync(absolute)) {
  console.error(`find-in-image: no such file: ${absolute}`);
  process.exit(2);
}

const patterns = flags('pattern').length ? flags('pattern') : DEFAULT_PATTERNS;
const contextBytes = Number(flag('context', 96));
const limitPerPattern = Number(flag('limit', 5));
const CHUNK = 4 * 1024 * 1024;

/** The two byte patterns to look for: the ASCII bytes and the UTF-16LE bytes. */
function encodingsOf(text) {
  const ascii = Buffer.from(text, 'utf8');
  const utf16 = Buffer.alloc(text.length * 2);
  for (let i = 0; i < text.length; i += 1) utf16.writeUInt16LE(text.charCodeAt(i), i * 2);
  return [['ascii', ascii], ['utf16', utf16]];
}

/** Readable text around a hit, so the report says what the string belongs to. */
function contextAt(buffer, offset, width) {
  const from = Math.max(0, offset - width);
  const to = Math.min(buffer.length, offset + width);
  return buffer.subarray(from, to).toString('latin1')
    .replace(/[^\x20-\x7e]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, width * 2);
}

const targets = patterns.map((text) => ({ text, encodings: encodingsOf(text), hits: [] }));
const size = fs.statSync(absolute).size;
const fd = fs.openSync(absolute, 'r');
const chunk = Buffer.alloc(CHUNK);
// Long enough that no pattern can straddle a boundary unseen.
const overlap = Math.max(...targets.map((target) => Math.max(...target.encodings.map(([, bytes]) => bytes.length)))) - 1;
let carry = Buffer.alloc(0);
let position = 0;

while (position < size) {
  const read = fs.readSync(fd, chunk, 0, CHUNK, position);
  if (read <= 0) break;
  const window = Buffer.concat([carry, chunk.subarray(0, read)]);
  const windowBase = position - carry.length;
  for (const target of targets) {
    for (const [encoding, bytes] of target.encodings) {
      let at = window.indexOf(bytes);
      while (at !== -1) {
        target.hits.push({ offset: windowBase + at, encoding, context: contextAt(window, at, contextBytes) });
        at = window.indexOf(bytes, at + 1);
      }
    }
  }
  carry = window.subarray(Math.max(0, window.length - overlap));
  position += read;
}
fs.closeSync(fd);

console.log(`file    ${absolute}`);
console.log(`size    ${size} bytes (${(size / 1024 / 1024).toFixed(0)} MB)`);
console.log(`looking for ${targets.length} token(s), ascii and utf16le\n`);
let total = 0;
for (const target of targets) {
  total += target.hits.length;
  const byEncoding = target.hits.reduce((acc, hit) => {
    acc[hit.encoding] = (acc[hit.encoding] || 0) + 1;
    return acc;
  }, {});
  const summary = Object.entries(byEncoding).map(([encoding, count]) => `${encoding}=${count}`).join(' ') || 'none';
  console.log(`## ${target.text}  ->  ${summary}`);
  for (const hit of target.hits.slice(0, limitPerPattern)) {
    console.log(`   @${hit.offset} ${hit.encoding}: ${hit.context}`);
  }
  if (target.hits.length > limitPerPattern) {
    console.log(`   ... ${target.hits.length - limitPerPattern} more`);
  }
  console.log('');
}
console.log(`${total} hit(s) in total`);
