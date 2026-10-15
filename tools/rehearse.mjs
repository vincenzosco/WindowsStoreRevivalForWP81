#!/usr/bin/env node
// Rehearse the whole interception chain using the real Store hostnames.
//
//   node tools/rehearse.mjs
//   node tools/rehearse.mjs --host wscont1.apps.microsoft.com --host catalog.zune.net
//
// The self-test proves the mechanisms on 127.0.0.1. This proves the *deployment*:
// for each hijacked name it repeats exactly what the phone will do -
//
//   1. resolve the name against the lab DNS (not the router)
//   2. TCP connect to the address it got back
//   3. CONNECT <host>:443 through the proxy
//   4. TLS handshake with that hostname as SNI, trusting only the lab CA
//   5. send a real request and read the reply
//
// A 502 on the request itself is a *pass* here: the Microsoft backend for these
// names has been dead since 2019, and the 502 with its `detail` is precisely the
// signal that says this endpoint is one to emulate. What must succeed is the
// interception: DNS hijack, TCP reach, TLS validity and capture.

import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import tls from 'node:tls';
import path from 'node:path';
import { loadConfig } from '../src/config.mjs';
import { query } from './dnsprobe.mjs';

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i !== -1 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : fallback;
};
const flags = (name) => args.reduce((out, arg, i) => (
  arg === `--${name}` && args[i + 1] ? [...out, args[i + 1]] : out
), []);

const configPath = path.resolve(flag('config', 'config.json'));
const config = loadConfig(configPath);
const proxyHost = flag('proxy', config.__advertiseIp);
const proxyPort = Number(flag('port', config.proxy.port));
const dnsHost = flag('dns', config.__advertiseIp);
const dnsPort = Number(flag('dnsport', config.dns.port));
const captureRoot = path.resolve(config.capture.dir);
const caPem = fs.readFileSync(path.resolve(config.pki.dir, 'ca.crt'), 'utf8');

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  ${detail}` : ''}`);
};

/** Concrete, resolvable names for the configured patterns. */
function targetHosts() {
  const explicit = flags('host');
  if (explicit.length) return explicit;
  return [...new Set(config.dns.hijack.names.map((pattern) => (
    pattern.includes('*') ? pattern.replace('*', 'wscont1') : pattern
  )))];
}

function rawRequest(secureSocket, { method, requestPath, host, extraHeaders = {} }) {
  return new Promise((resolve, reject) => {
    let buffer = Buffer.alloc(0);
    let settled = false;
    const finish = () => {
      if (settled) return;
      const headerEnd = buffer.indexOf('\r\n\r\n');
      if (headerEnd === -1) return;
      const lines = buffer.subarray(0, headerEnd).toString('utf8').split('\r\n');
      const headers = {};
      for (const line of lines.slice(1)) {
        const idx = line.indexOf(':');
        if (idx > 0) headers[line.slice(0, idx).toLowerCase().trim()] = line.slice(idx + 1).trim();
      }
      const declared = headers['content-length'] !== undefined ? Number(headers['content-length']) : null;
      if (declared !== null && buffer.length - headerEnd - 4 < declared) return;
      settled = true;
      resolve({
        status: Number(lines[0].split(' ')[1]),
        headers,
        body: buffer.subarray(headerEnd + 4, declared === null ? undefined : headerEnd + 4 + declared).toString('utf8'),
      });
    };
    secureSocket.on('data', (chunk) => { buffer = Buffer.concat([buffer, chunk]); finish(); });
    secureSocket.on('end', () => { finish(); if (!settled) { settled = true; reject(new Error('closed before a full response')); } });
    secureSocket.on('error', (err) => { if (!settled) { settled = true; reject(err); } });

    const headerLines = [
      `${method} ${requestPath} HTTP/1.1`,
      `Host: ${host}`,
      'Accept: application/json',
      'User-Agent: wp8-store-lab-rehearsal',
      ...Object.entries(extraHeaders).map(([k, v]) => `${k}: ${v}`),
      'Connection: close',
      '', '',
    ];
    secureSocket.write(headerLines.join('\r\n'));
  });
}

function connectThroughProxy({ targetHost, targetPort, ca = caPem }) {
  return new Promise((resolve, reject) => {
    const request = http.request({
      host: proxyHost,
      port: proxyPort,
      method: 'CONNECT',
      path: `${targetHost}:${targetPort}`,
      timeout: 15000,
    });
    request.on('timeout', () => request.destroy(new Error('CONNECT timed out')));
    request.on('error', reject);
    request.on('connect', (response, socket) => {
      if (response.statusCode !== 200) {
        socket.destroy();
        reject(new Error(`CONNECT answered ${response.statusCode}`));
        return;
      }
      const secureSocket = tls.connect({
        socket,
        host: targetHost,
        servername: targetHost,
        ...(ca ? { ca } : {}),
        ALPNProtocols: ['http/1.1'],
      });
      secureSocket.on('error', reject);
      secureSocket.on('secureConnect', () => resolve({
        secureSocket,
        authorized: secureSocket.authorized,
        authorizationError: secureSocket.authorizationError,
        peer: secureSocket.getPeerCertificate(),
        protocol: secureSocket.getProtocol(),
      }));
    });
    request.end();
  });
}

function tcpReachable(host, port) {
  return new Promise((resolve) => {
    const socket = net.connect({ host, port }, () => { socket.destroy(); resolve(true); });
    socket.setTimeout(6000, () => { socket.destroy(); resolve(false); });
    socket.on('error', () => resolve(false));
  });
}

function latestCaptureCount() {
  if (!fs.existsSync(captureRoot)) return 0;
  const sessions = fs.readdirSync(captureRoot).filter((n) => n.startsWith('session-')).sort();
  if (!sessions.length) return 0;
  const indexPath = path.join(captureRoot, sessions[sessions.length - 1], 'index.jsonl');
  try { return fs.readFileSync(indexPath, 'utf8').split('\n').filter(Boolean).length; } catch { return 0; }
}

console.log(`rehearsal against proxy ${proxyHost}:${proxyPort} and DNS ${dnsHost}:${dnsPort}`);
console.log(`CA: ${path.resolve(config.pki.dir, 'ca.crt')}\n`);

const before = latestCaptureCount();
const hosts = targetHosts();

if (hosts.length === 0) {
  console.error('no hijacked names configured: nothing to rehearse');
  process.exit(2);
}

for (const host of hosts) {
  console.log(`--- ${host}`);

  // 1. the phone asks the lab, not the router
  let resolved = null;
  try {
    const reply = await query(host, { server: dnsHost, port: dnsPort, type: 'A' });
    resolved = reply.answers[0]?.value || null;
  } catch (err) {
    check(`dns  ${host}`, false, err.message);
    continue;
  }
  check(`dns  ${host} resolves to the lab`, resolved === config.__hijackIp, `-> ${resolved || 'no answer'}`);

  // 2. the address it got back must actually accept connections
  const reachable = await tcpReachable(resolved || proxyHost, proxyPort);
  check(`tcp  ${host} reaches the proxy`, reachable, `${resolved}:${proxyPort}`);
  if (!reachable) continue;

  // 3-4. TLS terminated by the lab with a certificate valid for that hostname
  let session;
  try {
    session = await connectThroughProxy({ targetHost: host, targetPort: 443 });
  } catch (err) {
    check(`tls  ${host} handshake through the proxy`, false, err.message);
    continue;
  }
  const cn = session.peer?.subject?.CN;
  check(`tls  ${host} certificate accepted, issued for that name`,
    session.authorized === true && cn === host,
    `authorized=${session.authorized} CN=${cn} ${session.protocol}`);

  // 5. the request is intercepted and captured
  let response = null;
  try {
    response = await rawRequest(session.secureSocket, { method: 'GET', requestPath: '/', host });
  } catch (err) {
    response = { status: 0, headers: {}, body: `error: ${err.message}` };
  } finally {
    session.secureSocket.destroy();
  }

  const handled = response.headers['x-wp8-lab'] === '1';
  check(`http ${host} is intercepted by the lab`, handled || response.status > 0,
    `status=${response.status} lab=${handled ? 'yes' : 'no'}`);

  if (response.status === 502) {
    let detail = null;
    try { detail = JSON.parse(response.body)?.detail; } catch { detail = null; }
    console.log(`     expected: backend dead since 2019 -> emulate this endpoint (${detail || 'no detail'})`);
  }
}

// The DNS-only setup: no proxy configured on the device at all, it just connects
// to whatever address the (hijacked) name resolved to, on port 443.
console.log('--- direct TLS (device told about DNS only, no proxy setting)');
if (config.proxy.tlsEnabled) {
  const directHost = hosts[0];
  try {
    const secureSocket = await new Promise((resolve, reject) => {
      const socket = tls.connect({
        host: proxyHost,
        port: config.proxy.tlsPort,
        servername: directHost,
        ca: caPem,
        ALPNProtocols: ['http/1.1'],
      });
      socket.on('error', reject);
      socket.on('secureConnect', () => resolve(socket));
    });
    const cn = secureSocket.getPeerCertificate()?.subject?.CN;
    const authorized = secureSocket.authorized;
    const response = await rawRequest(secureSocket, { method: 'GET', requestPath: '/', host: directHost });
    secureSocket.destroy();
    check(`direct tls on :${config.proxy.tlsPort} intercepts ${directHost}`,
      authorized === true && cn === directHost && response.headers['x-wp8-lab'] === '1',
      `authorized=${authorized} CN=${cn} status=${response.status}`);
  } catch (err) {
    check(`direct tls on :${config.proxy.tlsPort} intercepts ${directHost}`, false, err.message);
  }
} else {
  console.log('      skipped: proxy.tlsEnabled is false');
}

// The health handler proves a request can be answered entirely from the lab.
console.log('--- handler rehearsal');
const healthHost = hosts[0];
try {
  const session = await connectThroughProxy({ targetHost: healthHost, targetPort: 443 });
  const response = await rawRequest(session.secureSocket, {
    method: 'GET', requestPath: '/__store/health', host: healthHost,
  });
  let parsed = null;
  try { parsed = JSON.parse(response.body); } catch { parsed = null; }
  session.secureSocket.destroy();
  check(`handler answers on ${healthHost}`, response.status === 200 && parsed?.intercepted === true,
    `status=${response.status} intercepted=${parsed?.intercepted}`);
} catch (err) {
  check(`handler answers on ${healthHost}`, false, err.message);
}

// A host that is NOT hijacked must go through untouched.
//
// The proof is the certificate: the tunnel is byte-for-byte, so the client sees
// the site's genuine chain issued by a public CA. Trusting the system roots (not
// the lab CA) makes a MITM'd connection fail here, which is exactly the point.
console.log('--- untouched traffic');
try {
  const session = await connectThroughProxy({ targetHost: 'example.com', targetPort: 443, ca: null });
  const issuer = session.peer?.issuer?.O || session.peer?.issuer?.CN || 'unknown';
  const notOurs = !/WP Store Lab/i.test(String(issuer));
  const response = await rawRequest(session.secureSocket, { method: 'GET', requestPath: '/', host: 'example.com' });
  session.secureSocket.destroy();
  check('non-hijacked host keeps its real certificate (traffic untouched)',
    session.authorized === true && notOurs && response.headers['x-wp8-lab'] === undefined,
    `status=${response.status} authorized=${session.authorized} issuer="${issuer}"`);
} catch (err) {
  check('non-hijacked host keeps its real certificate (traffic untouched)', false, err.message);
}

const after = latestCaptureCount();
check('every rehearsed request was captured', after - before >= hosts.length,
  `new entries=${after - before}`);

const failed = results.filter((r) => !r.ok);
console.log('');
console.log(`${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) {
  console.log('failed:');
  for (const f of failed) console.log(`  - ${f.name}`);
}
process.exit(failed.length ? 1 : 0);
