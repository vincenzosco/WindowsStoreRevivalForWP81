#!/usr/bin/env node
// Readiness report for the lab.
//
//   node tools/doctor.mjs
//
// Answers "what is still missing?" without the operator having to reason about
// it. Every line is either DONE, WAITING (with the exact action and who performs
// it), or OPTIONAL. Nothing here changes state.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadConfig } from '../src/config.mjs';
import { probeTcp, probeUdp, describePortOwner } from '../src/preflight.mjs';
import { canonical, prettyPath } from '../src/paths.mjs';
import { countJsonl } from '../src/capture.mjs';

const configPath = path.resolve(process.argv.includes('--config')
  ? process.argv[process.argv.indexOf('--config') + 1]
  : 'config.json');

const lines = [];
const section = (title) => { lines.push('', title); };
const item = (mark, text, detail = '') => {
  lines.push(`  ${mark}  ${text}${detail ? `\n        ${detail}` : ''}`);
};

let config;
try {
  config = loadConfig(configPath);
} catch (err) {
  console.error(`config is not usable: ${err.message}`);
  process.exit(1);
}

const captureRoot = path.resolve(config.capture.dir);
const caDir = path.resolve(config.pki.dir);

/** Addresses that mean "this PC" rather than another device. */
const localClients = new Set(['127.0.0.1', '::1', '0.0.0.0', config.__advertiseIp]);
for (const addresses of Object.values(os.networkInterfaces())) {
  for (const address of addresses || []) localClients.add(address.address);
}

// ---------------------------------------------------------------- configuration

section('Configuration');
item('DONE', `loaded ${prettyPath(configPath)}`);
item('DONE', `LAN address advertised to the device: ${config.__advertiseIp}`);
item('DONE', `hijacked names (${config.dns.hijack.names.length}): ${config.dns.hijack.names.join(', ') || 'none'}`);

// ---------------------------------------------------------------- lab status
//
// Fetched before the port checks so a port held by *this* lab is reported as a
// working listener instead of a conflict. Without this the tool tells the
// operator to stop a process that is the very thing they just started.
let labStatus = null;
try {
  const response = await fetch(`http://${config.__advertiseIp}:${config.proxy.port}/__lab/status`,
    { signal: AbortSignal.timeout(3000) });
  labStatus = await response.json();
} catch {
  labStatus = null;
}
const labPid = labStatus?.pid ?? null;

/** Classify a taken port: ours, or someone else's. */
async function takenBy(port, type, address) {
  const owner = await describePortOwner(port, type, address);
  if (labPid !== null && owner?.pid === labPid) return { ours: true, owner };
  return { ours: false, owner };
}

// ---------------------------------------------------------------------- ports

section('Listeners');
const dnsCandidates = [config.__advertiseIp, '0.0.0.0'];
let dnsOk = false;
let dnsNote = '';
for (const address of dnsCandidates) {
  const result = await probeUdp(config.dns.port, [address]);
  if (result.ok) { dnsOk = true; dnsNote = `${address}:${config.dns.port}`; break; }
  dnsNote = `${address}:${config.dns.port} unavailable`;
}
if (dnsOk) {
  item('DONE', `DNS can bind on ${dnsNote}`);
} else {
  const { ours, owner } = await takenBy(config.dns.port, 'udp');
  if (ours) item('DONE', `DNS is served by this lab on port ${config.dns.port}`);
  else {
    item('WAITING', `DNS cannot bind on port ${config.dns.port}`,
      owner ? `held by ${owner.name} (PID ${owner.pid}) - stop it (Windows ICS?) or set dns.bind` : 'check config.dns.bind');
  }
}

async function checkTcpListener(label, port, advice) {
  const probe = await probeTcp(port);
  if (probe.ok) { item('DONE', `${label} port ${port} is free`); return; }
  const { ours, owner } = await takenBy(port, 'tcp', probe.address);
  if (ours) { item('DONE', `${label} is served by this lab on port ${port}`); return; }
  item('WAITING', `${label} port ${port} is taken`,
    owner ? `held by ${owner.name} (PID ${owner.pid}) - ${advice}` : advice);
}

await checkTcpListener('proxy', config.proxy.port, 'change proxy.port in config.json');
if (config.proxy.tlsEnabled) {
  await checkTcpListener('direct TLS', config.proxy.tlsPort,
    'stop it, or set proxy.tlsEnabled=false and configure an HTTP proxy on the device instead');
}

// ------------------------------------------------------------------------- CA

section('Root certificate');
let caInfo = null;
if (fs.existsSync(path.join(caDir, 'ca-info.json'))) {
  caInfo = JSON.parse(fs.readFileSync(path.join(caDir, 'ca-info.json'), 'utf8'));
}
if (caInfo) {
  item('DONE', `CA generated: "${caInfo.commonName}"`);
  item('DONE', `SHA-1 ${caInfo.sha1Thumbprint}`);
  const regPath = path.join(caDir, 'install-root-ca.reg');
  if (fs.existsSync(regPath)) {
    const regAge = fs.statSync(regPath).mtimeMs;
    const caAge = fs.statSync(path.join(caDir, 'ca.der')).mtimeMs;
    if (regAge >= caAge) item('DONE', `install file ready: ${prettyPath(regPath)}`);
    else item('WAITING', 'the .reg file is older than the CA', 'run: npm run make-rootreg');
  } else {
    item('WAITING', 'install file not generated', 'run: npm run make-rootreg');
  }
  item('WAITING', 'install the CA on the device and reboot it',
    'WPinternals -> mount the phone registry -> import install-root-ca.reg');
} else {
  item('WAITING', 'no CA yet', 'start the lab once, or any tool that uses PKI');
}

// -------------------------------------------------------------------- livestore

section('Live Store (Zinc)');
if (config.livestore.apiKey) {
  item('DONE', 'API key configured');
} else {
  item('OPTIONAL', 'API key not set - only needed for the real catalog',
    'create an app for the Live Store realm in the One Live Developer Centre,');
  lines.push('        then set ZINC_API_KEY in the environment (preferred: config.json is');
  lines.push('        tracked by git) or put it in config.json -> livestore.apiKey');
}
// Which catalog the system Store is answered with: the Live Store's own, or a
// fixture. A page built from the fixture while the operator believed otherwise is
// only readable from `x-lab-source` on the response, so it is said here too.
if (config.livestore?.protocol?.source === 'zinc') {
  item(config.livestore.apiKey ? 'DONE' : 'BLOCKED',
    'the Store page is built from the Live Store catalog',
    config.livestore.apiKey ? '' : 'no API key: the page falls back to livestore.protocol.catalogFile');
} else {
  item('OPTIONAL', 'the Store page is built from the catalog file, not the Live Store',
    "set livestore.protocol.source=\"zinc\" to serve the real catalog");
}
const bridge = config.livestore.bridge || {};
if (bridge.enabled) item('DONE', `catalog bridge enabled (source: ${bridge.source || 'fixture'}, path: ${bridge.pathPrefix || '/livestore/'})`);
else {
  item('OPTIONAL', 'catalog bridge is off',
    'set livestore.bridge.enabled=true to serve a test catalog on intercepted hosts');
}

// ---------------------------------------------------------------- live evidence

section('Live evidence');
if (labStatus) {
  item('DONE', `lab is running (PID ${labStatus.pid}, uptime ${Math.round(labStatus.uptimeMs / 1000)}s)`);
  item('DONE', `store handlers registered: ${labStatus.storeHandlers.map((h) => h.name).join(', ') || 'none'}`);
  const consulted = labStatus.storeRouterStats?.consulted ?? 0;
  if (consulted) item('DONE', `handlers consulted ${consulted} time(s)`);

  // The direct (DNS-only) path is where a device shows up before anything can be
  // captured, and it is the only place a missing root CA is visible: the device
  // connects, is refused during the handshake and produces no capture at all.
  const direct = labStatus.stats || {};
  const reachedPort = direct.directTcp ?? 0;
  const intercepted = direct.directTls ?? 0;
  const refused = direct.directHandshakeErrors ?? 0;
  const notWanted = (direct.directRejected ?? 0) + (direct.directNoSni ?? 0);
  const plainDevice = direct.plainDevice ?? 0;

  // The 8.1 store lookups are served over HTTP, so a device that shows up in the
  // DNS log may legitimately arrive on port 80 instead of 443. Reporting this
  // first keeps "nothing on the TLS port" from reading as "the device never
  // connected" - the two were indistinguishable before the HTTP listener existed.
  if (plainDevice) {
    item('DONE', `device used the plain HTTP port ${plainDevice} time(s) - the 8.1 lookups are HTTP`);
  }

  if (reachedPort > 0) {
    item('DONE', `device opened the TLS port ${reachedPort} time(s)`
      + ` (intercepted ${intercepted}, refused ${refused}${notWanted ? `, ignored ${notWanted}` : ''})`);
    if (refused) {
      item('WAITING', `${refused} handshake(s) were refused`,
        'the device has no trusted lab root CA: npm run make-rootreg, import the .reg'
        + ' with WPinternals, then reboot the phone');
    }
  } else if (!plainDevice) {
    item('WAITING', 'no device has reached either the TLS or the plain HTTP port yet',
      'a device that only shows up in the DNS log resolves the hijacked name but never'
      + ' connects: check `npm run canary` for an unexpected port, then suspect a'
      + ' cached/hardcoded CDN IP, which DNS redirection cannot intercept');
  }
} else {
  item('WAITING', 'lab is not running', 'start it with: npm start   (or double-click start.cmd)');
}

const deviceClients = new Set();
if (fs.existsSync(captureRoot)) {
  for (const name of fs.readdirSync(captureRoot)) {
    if (!name.startsWith('dns-queries-')) continue;
    const content = fs.readFileSync(path.join(captureRoot, name), 'utf8');
    for (const line of content.split('\n').filter(Boolean)) {
      try {
        const entry = JSON.parse(line);
        if (entry.client && !localClients.has(entry.client)) deviceClients.add(entry.client);
      } catch { /* skip malformed */ }
    }
  }
}

if (deviceClients.size === 0) {
  item('WAITING', 'no DNS queries from any other device yet',
    'point the router DNS at this PC, then reconnect the phone to Wi-Fi');
} else {
  item('DONE', `DNS queries received from: ${[...deviceClients].join(', ')}`);
}

const sessions = fs.existsSync(captureRoot)
  ? fs.readdirSync(captureRoot).filter((n) => n.startsWith('session-')).sort()
  : [];
let captured = 0;
if (sessions.length) {
  const indexPath = path.join(captureRoot, sessions[sessions.length - 1], 'index.jsonl');
  // Counted without holding the file: a long session's index passes Node's
  // maximum string length, and reading it whole used to throw - which this catch
  // turned into "nothing intercepted yet", the most misleading answer possible.
  try { captured = await countJsonl(indexPath); } catch { captured = 0; }
}
if (captured) item('DONE', `${captured} intercepted exchange(s) in ${prettyPath(path.join(captureRoot, sessions[sessions.length - 1]))}`);
else item('WAITING', 'nothing intercepted yet', 'open the Store on the phone once DNS and the CA are in place');

// ------------------------------------------------------------------ next steps

section('Do this next');
const steps = [];

if (!caInfo) steps.push('Start the lab so the CA is generated.');
else if (!fs.existsSync(path.join(caDir, 'install-root-ca.reg'))) steps.push('Run `npm run make-rootreg`.');
if (caInfo) steps.push('Import install-root-ca.reg into the phone registry with WPinternals, then reboot the phone.');
if (!deviceClients.size) steps.push('Set the router DNS to this PC, then reconnect the phone to Wi-Fi so it picks up the new DNS.');
if (!config.livestore.apiKey) steps.push('Optional: set ZINC_API_KEY to serve the real Live Store catalog.');
else if (config.livestore?.protocol?.source !== 'zinc') steps.push('Set livestore.protocol.source to "zinc" to serve the real Live Store catalog.');
if (steps.length === 0) steps.push('Everything is in place: open the Store on the phone and run `npm run watch`.');

steps.forEach((step, index) => lines.push(`  ${index + 1}. ${step}`));

// The friendly path: both the CA dir and the project root may resolve through a
// junction on Windows, so report the path the user actually sees.
void canonical;

console.log(lines.join('\n'));
console.log('');
