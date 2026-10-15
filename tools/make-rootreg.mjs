#!/usr/bin/env node
// Build the registry entry that installs the lab root CA as a trusted root.
//
// Windows certificate stores live in the registry as:
//   <hive>\SOFTWARE\Microsoft\SystemCertificates\<Store>\Certificates\<SHA1 thumbprint>
//     "Blob" = REG_BINARY
//
// Blob layout (observed, and proven with --verify against what Windows itself
// writes through certutil):
//   DWORD  3            blob header
//   DWORD  1            first property set id
//   DWORD  20           byte length of the thumbprint that follows
//   BYTE   thumbprint[20]
//   DWORD  0x20         constant 32 seen in every Windows-exported store entry
//   DWORD  1            property id of the certificate payload
//   DWORD  n            DER length
//   BYTE   certificate[n]
//
// Usage:
//   node tools/make-rootreg.mjs                       # writes ca/install-root-ca.reg
//   node tools/make-rootreg.mjs --verify              # proves the layout round-trips
//   node tools/make-rootreg.mjs --hive HKLM --out x.reg
//   node tools/make-rootreg.mjs --mount 'HKLM\PhoneSoftware'   # mass storage route
//   node tools/make-rootreg.mjs --phone               # the Blob bytes + command for mass storage
//
// The `--mount` form exists for the PC route: the phone's own SOFTWARE hive is
// loaded into the local registry under a made-up name (`reg load HKLM\PhoneSoftware
// G:\Windows\System32\config\SOFTWARE`), and that hive's root *is* `SOFTWARE`, so
// the key path must not repeat the `SOFTWARE` component. Generating this second
// file from the same builder, instead of hand-editing the first one, keeps the blob
// and the key path in one implementation.

// --verify imports the certificate into a throw-away per-user store with
// certutil, reads the blob Windows produced, compares it with ours, then removes
// the store. A pass means the blob we generate is byte-identical to Windows'.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { isMainModule } from '../src/paths.mjs';

const execFileAsync = promisify(execFile);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const BLOB_HEADER = 3;
const BLOB_PROPERTY_SET = 1;
const BLOB_CONSTANT = 0x20;
const BLOB_CERT_PROPERTY_ID = 1;

/** Version word of every store entry this phone writes, read off the device itself. */
export const PHONE_ELEMENT_VERSION = 0x19;

/** Property ids the phone's own entries use. */
const PROP_SHA1_HASH = 3;
const PROP_CERTIFICATE = 32;

/**
 * Build the REG_BINARY "Blob" value for a DER certificate.
 * @param {Buffer} der
 * @returns {Buffer}
 */
export function buildCertBlob(der) {
  const thumbprint = crypto.createHash('sha1').update(der).digest();

  const prefix = Buffer.alloc(12);
  prefix.writeUInt32LE(BLOB_HEADER, 0);
  prefix.writeUInt32LE(BLOB_PROPERTY_SET, 4);
  prefix.writeUInt32LE(thumbprint.length, 8);

  const property = Buffer.alloc(12);
  property.writeUInt32LE(BLOB_CONSTANT, 0);
  property.writeUInt32LE(BLOB_CERT_PROPERTY_ID, 4);
  property.writeUInt32LE(der.length, 8);

  return Buffer.concat([prefix, thumbprint, property, der]);
}

export function sha1Thumbprint(der) {
  return crypto.createHash('sha1').update(der).digest('hex').toUpperCase();
}

/**
 * Stable 16-byte element id.
 *
 * The ids inside the phone's own entries are not derivable from the certificate -
 * checked against MD5, SHA-1 and the thumbprint of the entries that are on the device
 * - so any unique value does. Deriving it from the certificate instead of randomising
 * it keeps the generator deterministic: the same CA has to produce the same bytes
 * today and tomorrow, or nothing here can be compared with anything.
 */
export function phoneElementId(der) {
  return crypto.createHash('md5').update(der).digest();
}

/**
 * A store entry in the shape *this phone* writes, measured on its own entries.
 *
 * Every entry in every store of the device is a serialized store element:
 *
 *   DWORD 0x19 (25)   version - the same on all 26 entries read off the device
 *   DWORD 1
 *   DWORD 16          length of the element id that follows
 *   BYTE  id[16]
 *   then a list of properties, each: DWORD id, DWORD 1, DWORD length, BYTE data[]
 *
 * The desktop's entries (what `npm run verify-rootreg` proves) use the same grammar
 * with version 3 and one property, and crypt32 on this PC deserializes both back to
 * the byte-identical certificate. That is not the question the phone asks, though:
 * the phone is written the shape the phone itself writes, because that is the only
 * shape it is known to read.
 *
 * Two properties, both measured rather than invented:
 *   3   the SHA-1 of the certificate - in every entry on the device it equals the key name
 *   32  the certificate itself
 *
 * The phone's entries carry more (a subject-name hash, key identifier, friendly name,
 * EKU). They are deliberately not written: the same property id was found to hold 16
 * bytes in one store and 20 in another, and a value that is wrong is worse than a
 * property that is absent, because crypt32 computes the missing ones on demand.
 *
 * @param {Buffer} der
 * @param {{ elementId?: Buffer }} [options]
 * @returns {Buffer}
 */
export function buildPhoneCertBlob(der, { elementId = phoneElementId(der) } = {}) {
  const id = Buffer.from(elementId);
  if (id.length !== 16) throw new Error(`the element id must be 16 bytes, got ${id.length}`);

  const head = Buffer.alloc(12);
  head.writeUInt32LE(PHONE_ELEMENT_VERSION, 0);
  head.writeUInt32LE(BLOB_PROPERTY_SET, 4);
  head.writeUInt32LE(id.length, 8);

  const property = (propId, data) => {
    const header = Buffer.alloc(12);
    header.writeUInt32LE(propId, 0);
    header.writeUInt32LE(1, 4);
    header.writeUInt32LE(data.length, 8);
    return Buffer.concat([header, data]);
  };

  return Buffer.concat([
    head,
    id,
    property(PROP_SHA1_HASH, crypto.createHash('sha1').update(der).digest()),
    property(PROP_CERTIFICATE, Buffer.from(der)),
  ]);
}

/** Render a REG_BINARY value body the way reg.exe does, with line continuations. */
function hexValueBody(buffer, indent = '') {
  const pairs = [];
  for (let i = 0; i < buffer.length; i += 1) pairs.push(buffer[i].toString(16).padStart(2, '0'));
  const perLine = 25; // reg.exe wraps around 25 bytes per line
  const lines = [];
  for (let i = 0; i < pairs.length; i += perLine) {
    lines.push(pairs.slice(i, i + perLine).join(','));
  }
  return lines
    .map((line, index) => `${indent}${line}${index === lines.length - 1 ? '' : ',\\'}`)
    .join('\r\n');
}

/**
 * Build a .reg file body (UTF-16LE at write time) that creates the trusted-root entry.
 *
 * @param {{ der: Buffer, hive?: string, store?: string, mount?: string|null }} options
 *   `mount` is the name a loaded phone hive is attached to on this PC; when it is set
 *   the key is rooted there instead of under `<hive>\SOFTWARE`.
 * @returns {{text: string, keyPath: string, thumbprint: string, blob: Buffer}}
 */
export function buildRegEntry({ der, hive = 'HKLM', store = 'Root', mount = null }) {
  const thumbprint = sha1Thumbprint(der);
  const blob = buildCertBlob(der);
  const keyPath = mount
    ? `${mount}\\Microsoft\\SystemCertificates\\${store}\\Certificates\\${thumbprint}`
    : `${hive}\\SOFTWARE\\Microsoft\\SystemCertificates\\${store}\\Certificates\\${thumbprint}`;

  const text = [
    'Windows Registry Editor Version 5.00',
    '',
    `[${keyPath}]`,
    `"Blob"=hex:${hexValueBody(blob)}`,
    '',
  ].join('\r\n');

  return { text, keyPath, thumbprint, blob };
}

/**
 * The exact bytes of the .reg file reg.exe and regedit accept: UTF-16LE with a BOM.
 *
 * Exported so a caller can hand the phone the bytes generated and verified here
 * instead of formatting a .reg of its own, which is the same reason the REG_BINARY
 * blob is built rather than pasted: a second implementation of the format is a
 * second chance to drift from what was measured.
 *
 * @returns {Buffer}
 */
export function buildRegFileBuffer({ der, hive = 'HKLM', store = 'Root', mount = null }) {
  const entry = buildRegEntry({ der, hive, store, mount });
  return Buffer.concat([
    Buffer.from([0xff, 0xfe]),
    Buffer.from(entry.text, 'utf16le'),
  ]);
}

async function verify() {
  const der = fs.readFileSync(path.resolve(ROOT, 'ca/ca.der'));
  const ours = buildCertBlob(der);
  const thumbprint = sha1Thumbprint(der);
  const storeName = 'WPStoreLabBlobCheck';
  const pemPath = path.resolve(ROOT, 'ca/ca.crt');

  console.log(`verifying blob layout against Windows for ${thumbprint}`);

  await execFileAsync('certutil', ['-f', '-user', '-addstore', storeName, pemPath]);

  try {
    const keyPath = `HKCU:\\Software\\Microsoft\\SystemCertificates\\${storeName}\\Certificates\\${thumbprint}`;
    const { stdout } = await execFileAsync('powershell', [
      '-NoProfile',
      '-Command',
      `$v = (Get-Item '${keyPath}').GetValue('Blob'); ($v | ForEach-Object { $_.ToString('x2') }) -join ''`,
    ]);
    const windowsHex = stdout.trim().toLowerCase();
    const oursHex = ours.toString('hex');

    console.log(`  ours    : ${ours.length} bytes`);
    console.log(`  windows : ${windowsHex.length / 2} bytes`);
    if (windowsHex === oursHex) {
      console.log('  RESULT  : identical - blob layout confirmed');
      return 0;
    }
    console.log('  RESULT  : MISMATCH');
    console.log(`  ours    head: ${oursHex.slice(0, 120)}`);
    console.log(`  windows head: ${windowsHex.slice(0, 120)}`);
    return 1;
  } finally {
    await execFileAsync('certutil', ['-user', '-delstore', storeName, thumbprint]).catch(() => {});
    await execFileAsync('powershell', [
      '-NoProfile',
      '-Command',
      `Remove-Item -Path 'HKCU:\\Software\\Microsoft\\SystemCertificates\\${storeName}' -Recurse -Force -ErrorAction SilentlyContinue`,
    ]).catch(() => {});
    console.log(`  cleanup : removed store ${storeName}`);
  }
}

if (isMainModule(import.meta.url)) {
  const args = process.argv.slice(2);
  const flag = (name, fallback) => {
    const i = args.indexOf(`--${name}`);
    return i !== -1 && args[i + 1] ? args[i + 1] : fallback;
  };

  if (args.includes('--verify')) {
    process.exit(await verify());
  }

  const hive = flag('hive', 'HKLM');
  const store = flag('store', 'Root');
  const mount = flag('mount', null);
  const out = path.resolve(flag('out', path.join(
    ROOT,
    mount ? 'ca/install-root-ca.mounted.reg' : 'ca/install-root-ca.reg',
  )));
  const derPath = path.resolve(flag('der', path.join(ROOT, 'ca/ca.der')));

  if (!fs.existsSync(derPath)) {
    console.error(`CA not found at ${derPath}. Start the server once to generate it.`);
    process.exit(1);
  }

  const der = fs.readFileSync(derPath);

  // The mass storage route does not import a .reg at all: it writes the Blob value
  // into the hive of the phone the PC has mounted. What travels is the value's bytes,
  // in the shape the phone itself writes, plus the one command that puts them there.
  if (args.includes('--phone')) {
    const phoneMount = flag('mount', 'HKLM\\PhoneSoftware');
    const hexPath = path.resolve(flag('out', path.join(ROOT, 'ca/install-root-ca.phone.hex')));
    const blob = buildPhoneCertBlob(der);
    const hex = blob.toString('hex');
    const thumbprint = sha1Thumbprint(der);
    const key = `${phoneMount}\\Microsoft\\SystemCertificates\\${store}\\Certificates\\${thumbprint}`;

    fs.writeFileSync(hexPath, `${hex}\n`);

    console.log(`wrote ${hexPath}`);
    console.log(`  element version : ${PHONE_ELEMENT_VERSION} (0x${PHONE_ELEMENT_VERSION.toString(16)}), as in every entry on this phone`);
    console.log(`  element bytes   : ${blob.length}`);
    console.log(`  sha1 thumbprint : ${thumbprint}`);
    console.log(`  registry key    : ${key}`);
    console.log('');
    console.log('With the phone in mass storage mode, from an elevated prompt:');
    console.log('');
    console.log(`  1. reg load    "${phoneMount}" "G:\\Windows\\System32\\config\\SOFTWARE"`);
    console.log(`  2. reg add     "${key}" /v Blob /t REG_BINARY /d ${hex} /f`);
    console.log(`  3. reg query   "${key}" /v Blob`);
    console.log(`  4. reg unload  "${phoneMount}"`);
    console.log('');
    console.log('Details, the copy-back step and the rollback are in README.md, section');
    console.log('"Mass storage mode".');
    process.exit(0);
  }

  const entry = buildRegEntry({ der, hive, store, mount });
  const file = buildRegFileBuffer({ der, hive, store, mount });

  fs.writeFileSync(out, file);

  console.log(`wrote ${out}`);
  console.log(`  registry key : ${entry.keyPath}`);
  console.log(`  thumbprint   : ${entry.thumbprint}`);
  console.log(`  blob bytes   : ${entry.blob.length}`);
  console.log('');

  if (mount) {
    // The mass storage route: the phone's filesystem is mounted as a drive and its
    // SOFTWARE hive is attached to the local registry. Everything here runs on the
    // PC, which is why the phone does not need to be unlocked or even booted.
    const drive = flag('drive', 'G:');
    console.log('Install with the phone in mass storage mode (filesystem visible as a drive):');
    console.log('');
    console.log(`  1. reg load    "${mount}" "${drive}\\Windows\\System32\\config\\SOFTWARE"`);
    console.log(`  2. reg import  "${out}"`);
    console.log(`  3. reg query   "${entry.keyPath}" /v Blob     <- must print the blob`);
    console.log(`  4. reg unload  "${mount}"`);
    console.log('');
    console.log('Steps 1-4 need an elevated prompt, and the phone has to be rebooted');
    console.log('afterwards for the certificate store to be read again.');
  } else {
    console.log('Install on the device with WPinternals: mount the phone registry (or use');
    console.log('its registry editor) and import this file into the phone, then reboot it.');
    console.log('For the mass storage route (hive loaded on this PC) use --mount instead:');
    console.log('  node tools/make-rootreg.mjs --mount "HKLM\\\\PhoneSoftware"');
  }
}
