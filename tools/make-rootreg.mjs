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
//
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
 * @returns {{text: string, keyPath: string, thumbprint: string, blob: Buffer}}
 */
export function buildRegEntry({ der, hive = 'HKLM', store = 'Root' }) {
  const thumbprint = sha1Thumbprint(der);
  const blob = buildCertBlob(der);
  const keyPath = `${hive}\\SOFTWARE\\Microsoft\\SystemCertificates\\${store}\\Certificates\\${thumbprint}`;

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
 * Exported because the app carries this file verbatim in its patch set. The phone
 * then writes the bytes generated and verified here instead of formatting a .reg of
 * its own, which is the same reason the REG_BINARY blob travels pre-built: a second
 * implementation of the format is a second chance to drift.
 *
 * @returns {Buffer}
 */
export function buildRegFileBuffer({ der, hive = 'HKLM', store = 'Root' }) {
  const entry = buildRegEntry({ der, hive, store });
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
  const out = path.resolve(flag('out', path.join(ROOT, 'ca/install-root-ca.reg')));
  const derPath = path.resolve(flag('der', path.join(ROOT, 'ca/ca.der')));

  if (!fs.existsSync(derPath)) {
    console.error(`CA not found at ${derPath}. Start the server once to generate it.`);
    process.exit(1);
  }

  const der = fs.readFileSync(derPath);
  const entry = buildRegEntry({ der, hive, store });
  const file = buildRegFileBuffer({ der, hive, store });

  fs.writeFileSync(out, file);

  console.log(`wrote ${out}`);
  console.log(`  registry key : ${entry.keyPath}`);
  console.log(`  thumbprint   : ${entry.thumbprint}`);
  console.log(`  blob bytes   : ${entry.blob.length}`);
  console.log('');
  console.log('Install on the device with WPinternals: mount the phone registry (or use');
  console.log('its registry editor) and import this file into the phone, then reboot it.');
}
