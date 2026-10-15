#!/usr/bin/env node
// Watch the lab for traffic coming from the device.
//
//   node tools/watch.mjs                       # polls every 2s until Ctrl+C
//   node tools/watch.mjs --interval 1 --once   # single pass, useful in scripts
//
// Answers the question "is the phone actually pointed at the lab yet?" by showing
// only what originates somewhere other than this PC: DNS lookups the device made
// and exchanges the proxy intercepted. Retries while the server is down, so it is
// safe to start before the lab.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { prettyPath } from '../src/paths.mjs';

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i !== -1 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : fallback;
};

const intervalMs = Number(flag('interval', 2)) * 1000;
const once = args.includes('--once');
const adminBase = flag('admin', 'http://127.0.0.1:8899');
const captureRoot = path.resolve(flag('root', 'captures'));

/**
 * Addresses that mean "this PC".
 *
 * The lab runs on the same machine as the operator's browser and tools, and the
 * DNS log records the loopback/LAN source address of every query - so without
 * this the tool happily reports its own probes as device traffic, which is the
 * one false positive that would send someone chasing a phone that never
 * connected.
 */
const localClients = new Set(['127.0.0.1', '::1', '0.0.0.0']);
for (const addresses of Object.values(os.networkInterfaces())) {
  for (const address of addresses || []) localClients.add(address.address);
}

function newestDnsLog() {
  if (!fs.existsSync(captureRoot)) return null;
  const files = fs.readdirSync(captureRoot)
    .filter((name) => name.startsWith('dns-queries-'))
    .sort();
  return files.length ? path.join(captureRoot, files[files.length - 1]) : null;
}

async function fetchJson(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(4000) });
  return response.json();
}

let dnsOffset = 0;
let seenExchanges = 0;
let deviceClients = new Set();
let seenDirectTcp = null;
let seenDirectErrors = null;
let seenPlainDevice = 0;
let deviceReachable = false;

/** Shown whenever the lab saw the device but could not read its traffic. */
const CA_MISSING_HINT = 'the lab root CA is not trusted on the phone yet -'
  + ' run `npm run make-rootreg` and import the .reg with WPinternals, then reboot the phone';

function reportDns() {
  const logPath = newestDnsLog();
  if (!logPath) return;
  let size = 0;
  try { size = fs.statSync(logPath).size; } catch { return; }
  if (size <= dnsOffset) return;

  const buffer = Buffer.alloc(size - dnsOffset);
  const handle = fs.openSync(logPath, 'r');
  fs.readSync(handle, buffer, 0, buffer.length, dnsOffset);
  fs.closeSync(handle);
  dnsOffset = size;

  for (const line of buffer.toString('utf8').split('\n').filter(Boolean)) {
    let entry;
    try { entry = JSON.parse(line); } catch { continue; }
    if (localClients.has(entry.client)) continue;
    deviceClients.add(entry.client);
    const arrow = entry.action === 'hijack' ? `-> ${entry.answer}  [HIJACK]` : '[forwarded]';
    console.log(`  dns   ${entry.ts.slice(11, 19)}  ${String(entry.client).padEnd(15)} ${entry.qname} ${entry.qtype || ''} ${arrow}`);
  }
}

async function reportCaptures() {
  const data = await fetchJson(`${adminBase}/__lab/captures?limit=200`);
  const exchanges = data.exchanges || [];
  for (const entry of exchanges.slice(seenExchanges)) {
    const host = entry.request?.host || '?';
    const p = entry.request?.path || '';
    console.log(`  http  ${entry.ts.slice(11, 19)}  ${String(entry.request?.method).padEnd(5)} https://${host}${p.slice(0, 70)}`
      + `  [${entry.response?.status ?? '-'}]  ${entry.decision || ''}`);
  }
  seenExchanges = exchanges.length;
}

/**
 * Report the direct (DNS-only) listener counters.
 *
 * Without this the one failure that matters most stays invisible here: a phone
 * with no trusted root CA reaches the lab perfectly well, is refused during the
 * handshake, and never produces a single capture - so `watch` used to look idle
 * while the device was in fact connecting.
 */
function reportDirect(stats = {}) {
  const tcp = stats.directTcp ?? 0;
  const failed = stats.directHandshakeErrors ?? 0;
  const plainDevice = stats.plainDevice ?? 0;

  // The 8.1 store lookups are served over HTTP on port 80, so a device redirected
  // by DNS may arrive here instead of on 443. Reporting it keeps "the phone is
  // pointing at the lab" true regardless of which port it chose.
  if (plainDevice > seenPlainDevice) {
    deviceReachable = true;
    const count = plainDevice - seenPlainDevice;
    console.log(`  http  ${seenPlainDevice ? `+${count}` : count} connection(s) on the plain HTTP port`
      + ' - the device is reaching the lab');
  }
  seenPlainDevice = plainDevice;

  if (seenDirectTcp === null) {
    // First pass: report what already happened, so a failure from before watch
    // was started is not silently lost.
    if (tcp > 0) {
      deviceReachable = true;
      console.log(`  tcp   ${tcp} connection(s) to the direct TLS port recorded so far`);
    }
    if (failed > 0) {
      deviceReachable = true;
      console.log(`  tls   ${failed} refused handshake(s): ${CA_MISSING_HINT}`);
    }
  } else {
    if (tcp > seenDirectTcp) {
      deviceReachable = true;
      console.log(`  tcp   +${tcp - seenDirectTcp} connection(s) to the direct TLS port - the device is reaching the lab`);
    }
    if (failed > seenDirectErrors) {
      deviceReachable = true;
      console.log(`  tls   +${failed - seenDirectErrors} refused handshake(s): ${CA_MISSING_HINT}`);
    }
  }

  seenDirectTcp = tcp;
  seenDirectErrors = failed;
}

async function tick() {
  reportDns();
  try {
    const status = await fetchJson(`${adminBase}/__lab/status`);
    if (status?.advertiseIp) localClients.add(status.advertiseIp);
    reportDirect(status?.stats);
    await reportCaptures();
  } catch {
    console.log(`  ...   server not reachable on ${adminBase} (waiting)`);
  }
}

console.log(`watching for device traffic. captured session: ${prettyPath(captureRoot)}`);
console.log('if nothing appears, the phone still points at the router: set its Wi-Fi DNS and proxy.\n');

await tick();
if (once) {
  // A refused handshake still proves the phone is pointed at the lab, so it
  // counts as activity instead of the silent "nothing happened" exit.
  if (deviceClients.size === 0 && !deviceReachable) {
    console.log('no device activity observed.');
    process.exit(2);
  }
  process.exit(0);
}

setInterval(() => { tick().catch((err) => console.log(`  ...   ${err.message}`)); }, intervalMs);
