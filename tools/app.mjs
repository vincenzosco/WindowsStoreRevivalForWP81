#!/usr/bin/env node
// Store Patcher driver (PC side).
//
// The phone app does not contain a certificate: it contains a *patch set*, and
// this tool generates that patch set from the lab's own CA. One source of truth,
// so the phone can never be patched with a certificate the lab no longer serves.
//
//    node tools/app.mjs patch             regenerate patches.json from ca/
//    node tools/app.mjs build             compile the XAP and verify its contents
//    node tools/app.mjs deploy [--dry-run] install it on the phone over USB
//    node tools/app.mjs all               patch, build, deploy
//    node tools/app.mjs status            what is present, without changing anything
//
// Every external process is started with execFile and an argument array rather
// than through a shell: on Windows the shell is MSYS bash, which rewrites
// `/p:Configuration=Debug` as a filesystem path and makes MSBuild answer
// "only one project can be specified". No shell, no rewriting.

import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { inflateRawSync } from 'node:zlib';

import { loadConfig } from '../src/config.mjs';
import { createLogger } from '../src/log.mjs';
import { isMainModule, prettyPath } from '../src/paths.mjs';
import { buildCertBlob, sha1Thumbprint } from './make-rootreg.mjs';

const execFileAsync = promisify(execFile);
const log = createLogger('app');

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const APP_DIR = path.join(ROOT, 'StorePatcher', 'Store Patcher');
const PROJECT_DIR = path.join(APP_DIR, 'Store Patcher');
const PROJECT_FILE = path.join(PROJECT_DIR, 'Store Patcher.csproj');
const PATCH_FILE = path.join(PROJECT_DIR, 'patches.json');
const CONFIGURATION = 'Debug';
const PLATFORM = 'AnyCPU';
const XAP_NAME = `Store_Patcher_${CONFIGURATION}_${PLATFORM}.xap`;
const XAP_PATH = path.join(PROJECT_DIR, 'Bin', CONFIGURATION, XAP_NAME);

export const CAPABILITY = 'ID_CAP_INTEROPSERVICES';

/** Reboot is required for the certificate store to be read at boot. */
const PATCH_SCHEMA_VERSION = 1;

// ---------------------------------------------------------------- patch set

/**
 * Build the patch set that the app applies on the device.
 *
 * Pure on purpose: the self-test calls it with its own throwaway CA, so the
 * generator is verified without touching the real `patches.json`.
 *
 * @param {{ caDer: Buffer, caPem?: string, advertiseIp?: string, generatedAt?: string }} options
 * @returns {object} the patch set, ready to be serialised
 */
export function buildPatchSet({ caDer, caPem = null, advertiseIp = null, generatedAt = new Date().toISOString() }) {
  const thumbprint = sha1Thumbprint(caDer);
  const blob = buildCertBlob(caDer);

  return {
    schemaVersion: PATCH_SCHEMA_VERSION,
    generatedAt,
    lab: { advertiseIp },
    patches: [
      {
        id: 'lab-root-ca',
        kind: 'cert-root',
        hive: 'HKLM',
        store: 'Root',
        thumbprint,
        // The exact bytes Windows itself writes for this certificate, as proven
        // by `npm run verify-rootreg`. The app writes these bytes; it does not
        // re-implement the layout.
        blobBase64: blob.toString('base64'),
        derBase64: caDer.toString('base64'),
        requiresReboot: true,
        description: 'Install the lab root CA as a trusted root, so intercepted TLS names are accepted',
      },
    ],
    caPemPresent: Boolean(caPem),
  };
}

/** Read the lab's CA and generate patches.json next to the app project. */
export async function generatePatches({ configPath = null, out = PATCH_FILE } = {}) {
  const config = loadConfig(configPath || path.join(ROOT, 'config.json'));
  const caDir = path.resolve(ROOT, config.pki.dir);
  const derPath = path.join(caDir, 'ca.der');
  const pemPath = path.join(caDir, 'ca.crt');

  if (!fs.existsSync(derPath)) {
    throw new Error(
      `No CA at ${prettyPath(derPath)}. Start the lab once (npm start) so the CA is generated, `
      + 'then run this again.',
    );
  }

  const caDer = fs.readFileSync(derPath);
  const caPem = fs.existsSync(pemPath) ? fs.readFileSync(pemPath, 'utf8') : null;
  const advertiseIp = config.__advertiseIp || config.network?.advertiseIp || null;
  const patchSet = buildPatchSet({ caDer, caPem, advertiseIp });

  fs.writeFileSync(out, `${JSON.stringify(patchSet, null, 2)}\n`);
  return { patchSet, file: out };
}

export function readPatchSet(file = PATCH_FILE) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

// ------------------------------------------------------------------- zip

/**
 * Minimal ZIP reader, enough to look inside the built XAP.
 *
 * The only reason this exists is verification: the artifact the phone receives
 * must actually contain the patch set and the interop capability, and a build
 * that merely exits 0 does not prove either.
 *
 * @returns {{ name: string, method: number, size: number, data: Buffer }[]}
 */
export function readZipEntries(buffer) {
  const EOCD = 0x06054b50;
  let eocd = -1;
  for (let i = buffer.length - 22; i >= 0 && i > buffer.length - 65558; i -= 1) {
    if (buffer.readUInt32LE(i) === EOCD) { eocd = i; break; }
  }
  if (eocd === -1) throw new Error('not a zip archive: end-of-central-directory record not found');

  const count = buffer.readUInt16LE(eocd + 10);
  let offset = buffer.readUInt32LE(eocd + 16);
  const entries = [];

  for (let i = 0; i < count; i += 1) {
    if (buffer.readUInt32LE(offset) !== 0x02014b50) throw new Error(`corrupt central directory at entry ${i}`);
    const method = buffer.readUInt16LE(offset + 10);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const uncompressedSize = buffer.readUInt32LE(offset + 24);
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const localOffset = buffer.readUInt32LE(offset + 42);
    const name = buffer.toString('utf8', offset + 46, offset + 46 + nameLength);

    // The local header repeats the name and extra fields, and its lengths are
    // the authoritative ones for locating the data.
    const localNameLength = buffer.readUInt16LE(localOffset + 26);
    const localExtraLength = buffer.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    const raw = buffer.subarray(dataStart, dataStart + compressedSize);
    const data = method === 0 ? Buffer.from(raw) : inflateRawSync(raw);

    entries.push({ name, method, size: uncompressedSize, data });
    offset += 46 + nameLength + extraLength + commentLength;
  }

  return entries;
}

export function zipEntry(buffer, name) {
  return readZipEntries(buffer).find((entry) => entry.name.replace(/\\/g, '/') === name) || null;
}

// ------------------------------------------------------------------ build

/** Locate MSBuild, newest first. Returns null when nothing usable is installed. */
export function findMsBuild(candidates = [
  process.env.MSBUILD_EXE,
  'C:/Program Files (x86)/MSBuild/14.0/Bin/MSBuild.exe',
  'C:/Program Files (x86)/MSBuild/12.0/Bin/MSBuild.exe',
  'C:/Program Files/MSBuild/14.0/Bin/MSBuild.exe',
].filter(Boolean)) {
  return candidates.find((candidate) => fs.existsSync(candidate)) || null;
}

/**
 * Compile the XAP and verify what landed in it.
 *
 * @returns {Promise<{ xap: string, bytes: number, entries: string[], checks: object[] }>}
 */
export async function buildApp({ msbuild = null, patchFile = PATCH_FILE } = {}) {
  if (!fs.existsSync(PROJECT_FILE)) throw new Error(`app project not found: ${prettyPath(PROJECT_FILE)}`);

  // Never build an app with a missing or stale patch set: the whole point of the
  // app is the patch it carries.
  const { patchSet } = await generatePatches({ out: patchFile });

  const binary = msbuild || findMsBuild();
  if (!binary) {
    throw new Error(
      'MSBuild not found. Install the Windows Phone 8.1 SDK (it ships MSBuild 14.0), '
      + 'or point MSBUILD_EXE at it.',
    );
  }

  try {
    await execFileAsync(binary, [
      PROJECT_FILE,
      `-p:Configuration=${CONFIGURATION}`,
      `-p:Platform=${PLATFORM}`,
      '-t:Build',
      '-v:m',
      '-nologo',
    ], { cwd: APP_DIR, maxBuffer: 32 * 1024 * 1024 });
  } catch (err) {
    // MSBuild reports the useful part on stdout, execFile keeps it on the error
    // object: without this the caller sees only "Command failed" and the actual
    // compiler error is lost.
    const output = `${err.stdout || ''}${err.stderr || ''}`.trim();
    const lines = output.split('\n').filter((line) => /error|warning/i.test(line));
    throw new Error(
      `MSBuild failed (exit ${err.code ?? '?'}).\n`
      + (lines.length ? lines.slice(0, 40).join('\n') : output.split('\n').slice(-25).join('\n')),
    );
  }

  if (!fs.existsSync(XAP_PATH)) throw new Error(`build reported success but no XAP at ${prettyPath(XAP_PATH)}`);

  const buffer = fs.readFileSync(XAP_PATH);
  const entries = readZipEntries(buffer);

  const manifest = zipEntry(buffer, 'WMAppManifest.xml');
  const embedded = zipEntry(buffer, 'patches.json');

  const checks = [];

  const hasCapability = Boolean(manifest && manifest.data.toString('utf8').includes(CAPABILITY));
  checks.push({
    name: `manifest declares ${CAPABILITY}`,
    ok: hasCapability,
    detail: manifest ? `WMAppManifest.xml ${manifest.size} bytes` : 'WMAppManifest.xml missing from the XAP',
  });

  let embeddedSet = null;
  if (embedded) {
    try { embeddedSet = JSON.parse(embedded.data.toString('utf8')); } catch { embeddedSet = null; }
  }
  const expected = patchSet.patches[0];
  const embeddedPatch = embeddedSet?.patches?.find((patch) => patch.id === 'lab-root-ca');
  checks.push({
    name: 'the patch set is embedded and matches the generated one',
    ok: Boolean(embeddedPatch)
      && embeddedPatch.thumbprint === expected.thumbprint
      && embeddedPatch.blobBase64 === expected.blobBase64,
    detail: embeddedPatch
      ? `thumbprint ${embeddedPatch.thumbprint}`
      : 'patches.json missing from the XAP (is it listed as Content in the .csproj?)',
  });

  return {
    xap: XAP_PATH,
    bytes: buffer.length,
    entries: entries.map((entry) => entry.name),
    checks,
    patchSet,
  };
}

// ----------------------------------------------------------------- deploy

/** Locate the Windows Phone 8.1 deployment tool. */
export function findAppDeploy(candidates = [
  process.env.APPDEPLOY_EXE,
  'C:/Program Files (x86)/Microsoft SDKs/Windows Phone/v8.1/Tools/AppDeploy/AppDeployCmd.exe',
  'C:/Program Files (x86)/Microsoft SDKs/Windows Phone/v8.0/Tools/XAP Deployment/XapDeployCmd.exe',
].filter(Boolean)) {
  return candidates.find((candidate) => fs.existsSync(candidate)) || null;
}

/**
 * Install the XAP on the phone over USB.
 *
 * The command is printed before it runs, and `--dry-run` stops after printing:
 * this is the one step that cannot be verified here, so it must be legible.
 */
export async function deployApp({ dryRun = false, launch = true } = {}) {
  if (!fs.existsSync(XAP_PATH)) {
    throw new Error(`No XAP at ${prettyPath(XAP_PATH)}. Run \`node tools/app.mjs build\` first.`);
  }

  const binary = findAppDeploy();
  const action = launch ? '/installlaunch' : '/install';
  const args = [action, XAP_PATH, '-targetdevice', 'usb'];

  const printable = `"${binary || 'AppDeployCmd.exe'}" ${args.map((a) => (a.includes(' ') ? `"${a}"` : a)).join(' ')}`;
  log.info(`deploy command: ${printable}`);

  if (dryRun) return { ran: false, command: printable };
  if (!binary) {
    throw new Error(
      'AppDeployCmd.exe not found. Install the Windows Phone 8.1 SDK, or deploy by hand: '
      + 'WPinternals, or CMD Injector by copying the XAP to the phone.',
    );
  }

  const { stdout } = await execFileAsync(binary, args, { maxBuffer: 16 * 1024 * 1024 });
  return { ran: true, command: printable, output: stdout.trim() };
}

// ------------------------------------------------------------------- cli

function report(checks) {
  let ok = true;
  for (const check of checks) {
    if (!check.ok) ok = false;
    log[check.ok ? 'info' : 'error'](`${check.ok ? 'OK  ' : 'FAIL'} ${check.name}${check.detail ? ` - ${check.detail}` : ''}`);
  }
  return ok;
}

async function status() {
  const rows = [
    ['app project', fs.existsSync(PROJECT_FILE)],
    ['generated patch set', fs.existsSync(PATCH_FILE)],
    ['built XAP', fs.existsSync(XAP_PATH)],
    ['MSBuild', Boolean(findMsBuild())],
    ['AppDeployCmd', Boolean(findAppDeploy())],
  ];
  for (const [label, present] of rows) {
    log.info(`${present ? 'present' : 'missing '}  ${label}`);
  }
  if (fs.existsSync(PATCH_FILE)) {
    const set = readPatchSet();
    const patch = set.patches?.[0];
    log.info(`patch set: ${set.patches?.length ?? 0} patch(es), thumbprint ${patch?.thumbprint || 'none'}`);
  }
  if (fs.existsSync(XAP_PATH)) {
    log.info(`XAP: ${prettyPath(XAP_PATH)} (${fs.statSync(XAP_PATH).size} bytes)`);
  }
  return 0;
}

if (isMainModule(import.meta.url)) {
  const args = process.argv.slice(2);
  const command = args.find((arg) => !arg.startsWith('-')) || 'status';
  const dryRun = args.includes('--dry-run');
  const noLaunch = args.includes('--no-launch');

  try {
    switch (command) {
      case 'patch': {
        const { patchSet, file } = await generatePatches();
        log.info(`wrote ${prettyPath(file)}`);
        log.info(`  1 patch: ${patchSet.patches.map((p) => `${p.id} (${p.kind})`).join(', ')}`);
        break;
      }
      case 'build': {
        const result = await buildApp();
        log.info(`built ${prettyPath(result.xap)} (${result.bytes} bytes, ${result.entries.length} entries)`);
        if (!report(result.checks)) process.exit(1);
        break;
      }
      case 'deploy': {
        const result = await deployApp({ dryRun, launch: !noLaunch });
        if (result.ran) log.info(result.output || 'deploy finished');
        break;
      }
      case 'all': {
        const result = await buildApp();
        log.info(`built ${prettyPath(result.xap)} (${result.bytes} bytes)`);
        if (!report(result.checks)) process.exit(1);
        const deployed = await deployApp({ dryRun, launch: !noLaunch });
        if (deployed.ran) log.info(deployed.output || 'deploy finished');
        break;
      }
      case 'status':
        process.exit(await status());
        break;
      default:
        process.stderr.write(
          'usage: node tools/app.mjs [patch|build|deploy|all|status] [--dry-run] [--no-launch]\n',
        );
        process.exit(2);
    }
  } catch (err) {
    log.error(err.message);
    process.exit(1);
  }
}
