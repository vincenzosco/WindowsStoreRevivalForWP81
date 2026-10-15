#!/usr/bin/env node
// End-to-end self-test.
//
// Starts a fake Store backend, a plain TCP echo server, the real DNS server and
// the real proxy, then talks to the proxy exactly like the phone would (HTTP
// CONNECT, then TLS). Every assertion is about observable behaviour, not
// internals, so a green run means the lab actually works.
//
//   node tools/selftest.mjs
//
// Needs outbound DNS/TCP for the "forwarding still works" check; everything
// else is hermetic and runs offline.

import crypto from 'node:crypto';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import tls from 'node:tls';
import { spawn } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { loadConfig } from '../src/config.mjs';
import { createLogger } from '../src/log.mjs';
import { Pki } from '../src/pki.mjs';
import { Capture } from '../src/capture.mjs';
import { DnsServer } from '../src/dns-server.mjs';
import { MitmProxy } from '../src/proxy.mjs';
import { ZincClient } from '../src/zinc.mjs';
import { describeDirectHandshakeFailure } from '../src/proxy.mjs';
import { StoreRouter } from '../src/store/router.mjs';
import { buildHandlers } from '../src/store/handlers.mjs';
import { query } from './dnsprobe.mjs';
import { buildPatchSet, readZipEntries, zipEntry, readCertificateDer, CAPABILITY } from './app.mjs';
import { buildCertBlob } from './make-rootreg.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const WORK = path.join(ROOT, '.selftest');

const PROXY_PORT = 18080;
const PLAIN_HTTP_PORT = 18081;
const DIRECT_TLS_PORT = 18443;
const DNS_PORT = 15353;
const UPSTREAM_PORT = 19443;
const ECHO_PORT = 19301;
const FAKE_LAN_IP = '192.0.2.10';

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  ${detail}` : ''}`);
}

/**
 * A minimal ZIP holding one stored (uncompressed) entry.
 *
 * The XAP reader in tools/app.mjs is what proves the built artifact carries the
 * patch set and the interop capability. Exercising it on a zip built here keeps
 * that check independent of whether an XAP happens to be on disk.
 */
function makeStoredZip(name, text) {
  const data = Buffer.from(text, 'utf8');
  const nameBytes = Buffer.from(name, 'utf8');

  const local = Buffer.alloc(30 + nameBytes.length);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4);              // version needed to extract
  local.writeUInt16LE(0, 6);               // flags
  local.writeUInt16LE(0, 8);               // method 0: stored
  local.writeUInt32LE(0, 14);              // crc32: not validated by the reader
  local.writeUInt32LE(data.length, 18);    // compressed size
  local.writeUInt32LE(data.length, 22);    // uncompressed size
  local.writeUInt16LE(nameBytes.length, 26);
  nameBytes.copy(local, 30);

  const central = Buffer.alloc(46 + nameBytes.length);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(0, 10);            // method 0: stored
  central.writeUInt32LE(data.length, 20);
  central.writeUInt32LE(data.length, 24);
  central.writeUInt16LE(nameBytes.length, 28);
  central.writeUInt32LE(0, 42);            // local header offset
  nameBytes.copy(central, 46);

  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(1, 8);
  eocd.writeUInt16LE(1, 10);
  eocd.writeUInt32LE(central.length, 12);
  eocd.writeUInt32LE(local.length + data.length, 16);

  return Buffer.concat([local, data, central, eocd]);
}

/**
 * Speak HTTP/1.1 by hand over a TLS socket.
 * Node's HTTP client refuses a pre-established socket unless a custom Agent is
 * supplied, and hand-rolled bytes are also closer to what the phone sends.
 */
function rawHttp(socket, { method = 'GET', requestPath = '/', host }) {
  return new Promise((resolve, reject) => {
    let buffer = Buffer.alloc(0);
    let settled = false;

    const finish = () => {
      if (settled) return;
      const headerEnd = buffer.indexOf('\r\n\r\n');
      if (headerEnd === -1) return;
      const head = buffer.subarray(0, headerEnd).toString('utf8');
      const lines = head.split('\r\n');
      const status = Number(lines[0].split(' ')[1]);
      const headers = {};
      for (const line of lines.slice(1)) {
        const idx = line.indexOf(':');
        if (idx > 0) headers[line.slice(0, idx).toLowerCase().trim()] = line.slice(idx + 1).trim();
      }
      const declaredLength = headers['content-length'] !== undefined ? Number(headers['content-length']) : null;
      const available = buffer.length - headerEnd - 4;
      if (declaredLength !== null && available < declaredLength) return;
      settled = true;
      const body = declaredLength === null
        ? buffer.subarray(headerEnd + 4).toString('utf8')
        : buffer.subarray(headerEnd + 4, headerEnd + 4 + declaredLength).toString('utf8');
      resolve({ status, headers, body });
    };

    socket.on('data', (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
      finish();
    });
    socket.on('end', () => { finish(); if (!settled) { settled = true; reject(new Error('connection closed before a full response')); } });
    socket.on('error', (err) => { if (!settled) { settled = true; reject(err); } });

    socket.write(
      `${method} ${requestPath} HTTP/1.1\r\n`
      + `Host: ${host}\r\n`
      + `Accept: application/json\r\n`
      + `User-Agent: selftest\r\n`
      + `Connection: close\r\n\r\n`,
    );
  });
}

/** HTTPS request routed through the proxy with an explicit CONNECT, like the device does. */
function httpsViaProxy({ proxyPort, targetHost, targetPort, requestPath, method = 'GET', ca }) {
  return new Promise((resolve, reject) => {
    const connectRequest = http.request({
      host: '127.0.0.1',
      port: proxyPort,
      method: 'CONNECT',
      path: `${targetHost}:${targetPort}`,
    });

    connectRequest.on('error', reject);
    connectRequest.on('connect', (connectResponse, socket) => {
      if (connectResponse.statusCode !== 200) {
        socket.destroy();
        reject(new Error(`CONNECT returned ${connectResponse.statusCode}`));
        return;
      }
      const secureSocket = tls.connect({ socket, host: targetHost, ca, ALPNProtocols: ['http/1.1'] });
      secureSocket.on('error', reject);
      secureSocket.on('secureConnect', () => {
        rawHttp(secureSocket, { method, requestPath, host: targetHost })
          .then((response) => { secureSocket.destroy(); resolve(response); })
          .catch((err) => { secureSocket.destroy(); reject(err); });
      });
    });
    connectRequest.end();
  });
}

function plainHttp(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (response) => {
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () => resolve({
        status: response.statusCode,
        body: Buffer.concat(chunks).toString('utf8'),
      }));
    }).on('error', reject);
  });
}

function connectTunnel({ proxyPort, targetHost, targetPort, payload }) {
  return new Promise((resolve, reject) => {
    const connectRequest = http.request({
      host: '127.0.0.1',
      port: proxyPort,
      method: 'CONNECT',
      path: `${targetHost}:${targetPort}`,
    });
    connectRequest.on('error', reject);
    connectRequest.on('connect', (connectResponse, socket) => {
      if (connectResponse.statusCode !== 200) {
        socket.destroy();
        reject(new Error(`CONNECT returned ${connectResponse.statusCode}`));
        return;
      }
      let received = Buffer.alloc(0);
      socket.on('data', (chunk) => {
        received = Buffer.concat([received, chunk]);
        if (received.length >= payload.length) {
          socket.destroy();
          resolve(received.toString('utf8'));
        }
      });
      socket.on('error', reject);
      socket.write(payload);
    });
    connectRequest.end();
  });
}

async function main() {
  fs.rmSync(WORK, { recursive: true, force: true });
  await fsp.mkdir(WORK, { recursive: true });

  const configPath = path.join(WORK, 'config.json');
  await fsp.writeFile(configPath, JSON.stringify({
    network: { advertiseIp: FAKE_LAN_IP },
    dns: {
      enabled: true,
      port: DNS_PORT,
      upstream: ['1.1.1.1', '8.8.8.8'],
      hijack: { ip: 'auto', names: ['store.test.invalid'] },
      logQueries: true,
    },
    proxy: {
      enabled: true,
      port: PROXY_PORT,
      mitm: { mode: 'listed', hosts: ['127.0.0.1'] },
      tunnel: { blockHosts: [] },
      tlsEnabled: true,
      tlsPort: DIRECT_TLS_PORT,
      httpEnabled: true,
      httpPort: PLAIN_HTTP_PORT,
    },
    pki: { dir: path.join(WORK, 'ca'), commonName: 'WP Store Lab Test CA', days: 365, leafDays: 90, openssl: '' },
    capture: { enabled: true, dir: path.join(WORK, 'captures'), inlineBodyMaxBytes: 4096, maxBodyBytes: 2097152 },
    upstream: { insecure: true, timeoutMs: 8000 },
    livestore: {
      baseUrl: 'https://zinc.onelive.me/v1',
      apiKey: '',
      cacheTtlMs: 60000,
      bridge: { enabled: true, pathPrefix: '/livestore/', source: 'fixture' },
    },
    rules: [
      {
        name: 'mocked-endpoint',
        match: { host: '127.0.0.1', path: '^/mocked', methods: ['GET'] },
        action: 'mock',
        status: 200,
        body: { mocked: true, source: 'rule' },
      },
      {
        name: 'patched-endpoint',
        match: { host: '127.0.0.1', path: '^/patch' },
        action: 'rewrite',
        rewrites: [
          { op: 'json.set', path: 'status', value: 'fresh' },
          { op: 'json.set', path: 'apps[0].name', value: 'Zinc App' },
        ],
      },
      {
        name: 'blocked-endpoint',
        match: { host: '127.0.0.1', path: '^/blocked' },
        action: 'block',
      },
      {
        name: 'passthrough-endpoint',
        match: { host: '127.0.0.1', path: '^/ok' },
        action: 'passthrough',
      },
      {
        // Matches a real store host so the plain-HTTP path is exercised the way
        // the phone uses it: a relative path with the target only in Host.
        name: 'store-lookup',
        match: { host: 'marketplaceedgeservice.windowsphone.com', path: '^/v2/', methods: ['GET'] },
        action: 'mock',
        status: 200,
        body: { intercepted: 'plain-http' },
      },
    ],
  }, null, 2));

  const config = loadConfig(configPath);
  const logger = createLogger('selftest');

  check('config: hijack list is merged into mitm hosts',
    config.proxy.mitm.hosts.includes('store.test.invalid'),
    JSON.stringify(config.proxy.mitm.hosts));
  check('config: advertiseIp override respected', config.__hijackIp === FAKE_LAN_IP, config.__hijackIp);

  // --- fake backend -------------------------------------------------------
  const pki = await new Pki({
    dir: config.pki.dir,
    commonName: config.pki.commonName,
    days: config.pki.days,
    leafDays: config.pki.leafDays,
    log: () => {},
  }).init();

  const localLeaf = await pki.leafFor('127.0.0.1');
  let upstreamHits = 0;
  const upstream = https.createServer(
    { key: fs.readFileSync(localLeaf.key), cert: fs.readFileSync(localLeaf.cert) },
    (req, res) => {
      upstreamHits += 1;
      const payload = req.url.startsWith('/patch')
        ? { status: 'stale', apps: [] }
        : { hello: 'world', path: req.url };
      const body = Buffer.from(JSON.stringify(payload));
      res.writeHead(200, { 'content-type': 'application/json', 'content-length': String(body.length) });
      res.end(body);
    },
  );
  await new Promise((resolve, reject) => {
    upstream.once('error', reject);
    upstream.listen(UPSTREAM_PORT, '127.0.0.1', resolve);
  });

  const echo = net.createServer((socket) => socket.pipe(socket));
  await new Promise((resolve, reject) => {
    echo.once('error', reject);
    echo.listen(ECHO_PORT, resolve);
  });

  // --- lab services -------------------------------------------------------
  const dns = new DnsServer({ config, logger: logger.child('dns') });
  await dns.start();

  const capture = await new Capture({ config, logger: logger.child('capture') }).init();
  const zinc = new ZincClient({ baseUrl: config.livestore.baseUrl, apiKey: config.livestore.apiKey });
  const router = new StoreRouter({ handlers: buildHandlers(config), logger: logger.child('store') });

  // Capture the proxy's own lines so a check can assert what the operator would
  // actually see, instead of trusting an internal counter that could be right
  // while the log stays silent - the exact failure this guards against.
  const proxyLog = [];
  const proxyLoggerBase = logger.child('proxy');
  const proxyLogger = {
    debug: (m) => { proxyLog.push(`DEBUG ${m}`); proxyLoggerBase.debug(m); },
    info: (m) => { proxyLog.push(`INFO ${m}`); proxyLoggerBase.info(m); },
    warn: (m) => { proxyLog.push(`WARN ${m}`); proxyLoggerBase.warn(m); },
    error: (m) => { proxyLog.push(`ERROR ${m}`); proxyLoggerBase.error(m); },
    child: () => proxyLogger,
  };
  const proxy = new MitmProxy({ config, logger: proxyLogger, pki, capture, router, zinc });
  await proxy.start();

  const caPem = await pki.caPem();
  const target = { proxyPort: PROXY_PORT, targetHost: '127.0.0.1', targetPort: UPSTREAM_PORT, ca: caPem };

  try {
    // --- DNS --------------------------------------------------------------
    const hijacked = await query('store.test.invalid', { port: DNS_PORT, type: 'A' });
    check('dns: hijacked name answers with the lab IP',
      hijacked.answers[0]?.value === FAKE_LAN_IP,
      `got ${hijacked.answers.map((a) => a.value).join(',') || 'nothing'}`);

    const hijackedV6 = await query('store.test.invalid', { port: DNS_PORT, type: 'AAAA' });
    check('dns: hijacked name returns no AAAA (forces IPv4)',
      hijackedV6.rcode === 0 && hijackedV6.answers.length === 0,
      `rcode=${hijackedV6.rcode} answers=${hijackedV6.answers.length}`);

    let forwarded = null;
    try {
      forwarded = await query('example.com', { port: DNS_PORT, type: 'A' });
    } catch (err) {
      forwarded = null;
      logger.warn(`forwarding check skipped: ${err.message}`);
    }
    check('dns: unrelated names still resolve normally',
      forwarded !== null && forwarded.rcode === 0 && forwarded.answers.length > 0,
      forwarded ? forwarded.answers.map((a) => a.value).join(',') : 'no upstream available');

    // --- proxy ------------------------------------------------------------
    const passthrough = await httpsViaProxy({ ...target, requestPath: '/ok', method: 'GET' });
    check('proxy: passthrough returns the real backend body',
      passthrough.status === 200 && passthrough.body.includes('"hello":"world"'),
      `status=${passthrough.status} body=${passthrough.body.slice(0, 60)}`);
    check('proxy: passthrough response is tagged by the lab', passthrough.headers['x-wp8-lab'] === '1');

    const hitsBeforeMock = upstreamHits;
    const mocked = await httpsViaProxy({ ...target, requestPath: '/mocked', method: 'GET' });
    check('proxy: mock rule answers without touching the backend',
      mocked.status === 200 && mocked.body.includes('"mocked":true') && upstreamHits === hitsBeforeMock,
      `status=${mocked.status} upstreamHits=${upstreamHits - hitsBeforeMock}`);

    const patched = await httpsViaProxy({ ...target, requestPath: '/patch', method: 'GET' });
    let patchedJson = null;
    try { patchedJson = JSON.parse(patched.body); } catch { patchedJson = null; }
    check('proxy: rewrite rule patches the JSON body',
      patchedJson?.status === 'fresh' && patchedJson?.apps?.[0]?.name === 'Zinc App',
      `body=${patched.body}`);

    const blocked = await httpsViaProxy({ ...target, requestPath: '/blocked', method: 'GET' });
    check('proxy: block rule returns 403', blocked.status === 403, `status=${blocked.status}`);

    // --- direct TLS (device configured with DNS only) ----------------------
    let direct = null;
    try {
      const socket = await new Promise((resolve, reject) => {
        const s = tls.connect({
          host: '127.0.0.1',
          port: DIRECT_TLS_PORT,
          servername: '127.0.0.1',
          ca: caPem,
        });
        s.on('error', reject);
        s.on('secureConnect', () => resolve(s));
      });
      // /mocked exercises interception and the rule engine without depending on
      // the upstream port, which is what this check is about.
      direct = await rawHttp(socket, { method: 'GET', requestPath: '/mocked', host: '127.0.0.1' });
      direct.cn = socket.getPeerCertificate()?.subject?.CN;
      socket.destroy();
    } catch (err) {
      direct = { error: err.message };
    }
    check('proxy: direct TLS listener intercepts without a CONNECT',
      direct?.status === 200 && direct.body.includes('"mocked":true') && direct.cn === '127.0.0.1',
      direct?.error || `status=${direct?.status} cn=${direct?.cn} body=${String(direct?.body).slice(0, 40)}`);

    // Let the teardown events settle: the accept watchdog reports on 'close', so
    // checking too early would hide a false "handshake failed" report.
    await new Promise((r) => setTimeout(r, 250));
    const falseAlarms = proxyLog.filter((l) => l.startsWith('WARN') && /handshake/.test(l));
    check('proxy: a successful direct handshake is never reported as a failure',
      proxy.stats.directTcp >= 1 && falseAlarms.length === 0,
      `directTcp=${proxy.stats.directTcp} falseAlarms=${falseAlarms.length}${falseAlarms[0] ? ` :: ${falseAlarms[0]}` : ''}`);

    // --- the decision behind a device that reaches us but cannot be read ----
    const device = describeDirectHandshakeFailure({
      from: '192.0.2.55:51234', port: DIRECT_TLS_PORT, self: false, errorCode: 'ECONNRESET',
      reason: 'connection closed before the handshake completed',
    });
    check('proxy: a device that reaches the port but cannot complete a handshake is reported',
      device.level === 'warn' && device.countsAsDevice === true
        && device.message.includes('192.0.2.55') && /root CA/.test(device.message),
      device.message);

    const selfProbe = describeDirectHandshakeFailure({
      from: '127.0.0.1:51235', port: DIRECT_TLS_PORT, self: true, errorCode: 'ECONNRESET',
      reason: 'connection closed before the handshake completed',
    });
    check('proxy: a self-probe on the direct port is never counted as device traffic',
      selfProbe.level === 'debug' && selfProbe.countsAsDevice === false,
      `${selfProbe.level} counted=${selfProbe.countsAsDevice}`);

    // The 8.1 store lookups are served over HTTP on port 80, so a device that is
    // only redirected by DNS lands here. Without this listener it would get a RST
    // and leave no trace at all, which is exactly the failure that made the phone
    // look idle while it was retrying.
    const plain = await new Promise((resolve) => {
      const req = http.request({
        host: '127.0.0.1', port: PLAIN_HTTP_PORT, path: '/v2/apps?store=1', method: 'GET',
        headers: { host: 'marketplaceedgeservice.windowsphone.com' },
      }, (res) => {
        let body = '';
        res.on('data', (c) => { body += c; });
        res.on('end', () => resolve({ status: res.statusCode, body, contentType: res.headers['content-type'] }));
      });
      req.on('error', (err) => resolve({ error: err.message }));
      req.end();
    });
    let plainJson = null;
    try { plainJson = JSON.parse(plain.body); } catch { plainJson = null; }
    check('proxy: plain HTTP on port 80 is intercepted for a real store host',
      plain.status === 200 && plainJson?.intercepted === 'plain-http',
      plain.error || `status=${plain.status} body=${String(plain.body).slice(0, 40)}`);

    // --- store handlers ---------------------------------------------------
    const health = await httpsViaProxy({ ...target, requestPath: '/__store/health', method: 'GET' });
    let healthJson = null;
    try { healthJson = JSON.parse(health.body); } catch { healthJson = null; }
    check('store: health handler answered on an intercepted host',
      health.status === 200 && healthJson?.intercepted === true && healthJson?.host === '127.0.0.1',
      `status=${health.status} intercepted=${healthJson?.intercepted}`);

    const catalog = await httpsViaProxy({ ...target, requestPath: '/livestore/?categories=1', method: 'GET' });
    let catalogJson = null;
    try { catalogJson = JSON.parse(catalog.body); } catch { catalogJson = null; }
    check('store: catalog bridge serves the fixture source',
      catalog.status === 200 && catalog.headers['x-lab-source'] === 'fixture'
        && Array.isArray(catalogJson?.categories) && catalogJson.categories.length > 0,
      `status=${catalog.status} source=${catalog.headers['x-lab-source']} categories=${catalogJson?.categories?.length}`);

    const search = await httpsViaProxy({ ...target, requestPath: '/livestore/?q=sample', method: 'GET' });
    let searchJson = null;
    try { searchJson = JSON.parse(search.body); } catch { searchJson = null; }
    check('store: catalog bridge filters on the query term',
      search.status === 200 && Array.isArray(searchJson?.apps) && searchJson.apps.length === 3,
      `matches=${searchJson?.apps?.length}`);

    const postBridge = await httpsViaProxy({ ...target, requestPath: '/livestore/?categories=1', method: 'POST' });
    check('store: catalog bridge rejects non-GET', postBridge.status === 405, `status=${postBridge.status}`);

    // Handlers read the shared config object live, so flipping the source here
    // also proves that a hot reload changing livestore.bridge takes effect
    // without rebuilding the router.
    config.livestore.bridge.source = 'zinc';
    const zincResponse = await httpsViaProxy({ ...target, requestPath: '/livestore/?categories=1', method: 'GET' });
    let zincJson = null;
    try { zincJson = JSON.parse(zincResponse.body); } catch { zincJson = null; }
    config.livestore.bridge.source = 'fixture';
    check('store: zinc source without an API key fails with a clear code',
      zincResponse.status === 502 && zincJson?.error === 'NO_API_KEY'
        && zincResponse.headers['x-lab-source'] === 'zinc',
      `status=${zincResponse.status} error=${zincJson?.error} source=${zincResponse.headers['x-lab-source']}`);

    // --- blind tunnel -----------------------------------------------------
    let tunnelOk = false;
    let tunnelDetail = '';
    try {
      const echoed = await connectTunnel({
        proxyPort: PROXY_PORT,
        targetHost: 'localhost',
        targetPort: ECHO_PORT,
        payload: 'transparent-tunnel-check',
      });
      tunnelOk = echoed.includes('transparent-tunnel-check');
      tunnelDetail = `echoed ${echoed.length} bytes`;
    } catch (err) {
      tunnelDetail = err.message;
    }
    check('proxy: non-listed host is tunnelled byte-for-byte', tunnelOk, tunnelDetail);

    // The tunnel is opaque on purpose, so the log line is the only thing that
    // records where the device wanted to go. Without it, a device that uses an
    // explicit proxy looks silent until the root CA is installed on it.
    const connectLines = proxyLog.filter((l) => l.includes('CONNECT ') && !l.includes('BLOCK'));
    check('proxy: a tunnelled CONNECT still names its endpoint in the log',
      connectLines.some((l) => /^INFO CONNECT localhost:\d+ from \S+ -> tunnel$/.test(l)),
      JSON.stringify(connectLines.slice(-3)));
    check('proxy: an intercepted CONNECT is labelled as intercepted',
      connectLines.some((l) => /^INFO CONNECT 127\.0\.0\.1:\d+ from \S+ -> mitm$/.test(l)),
      JSON.stringify(connectLines.slice(-3)));

    // --- admin surface ----------------------------------------------------
    const status = await plainHttp(`http://127.0.0.1:${PROXY_PORT}/__lab/status`);
    let statusJson = null;
    try { statusJson = JSON.parse(status.body); } catch { statusJson = null; }
    check('admin: /__lab/status reports live state',
      status.status === 200 && statusJson?.proxy?.port === PROXY_PORT && statusJson?.ca?.sha1Thumbprint,
      `status=${status.status}`);

    const reload = await new Promise((resolve, reject) => {
      const request = http.request(
        { host: '127.0.0.1', port: PROXY_PORT, path: '/__lab/reload', method: 'POST' },
        (response) => {
          const chunks = [];
          response.on('data', (chunk) => chunks.push(chunk));
          response.on('end', () => resolve({ status: response.statusCode, body: Buffer.concat(chunks).toString('utf8') }));
        },
      );
      request.on('error', reject);
      request.end();
    });
    let reloadJson = null;
    try { reloadJson = JSON.parse(reload.body); } catch { reloadJson = null; }
    check('admin: /__lab/reload is wired but returns 501 without a reload hook',
      reload.status === 501 || reloadJson?.reloaded === true,
      `status=${reload.status}`);

    // --- capture ----------------------------------------------------------
    await capture.flush();
    const indexLines = (await fsp.readFile(capture.indexPath, 'utf8')).split('\n').filter(Boolean).map((l) => JSON.parse(l));
    const decisions = indexLines.map((e) => e.decision);
    // One entry per intercepted request made above:
    // 4 rule cases + 1 plain-HTTP case + 1 direct-TLS case + 5 store-handler cases.
    check('capture: every intercepted exchange was indexed',
      indexLines.length === 11,
      `entries=${indexLines.length} decisions=${JSON.stringify(decisions)}`);
    check('capture: decisions are labelled per rule',
      decisions.some((d) => d === 'passthrough:passthrough-endpoint')
        && decisions.includes('mock:mocked-endpoint')
        && decisions.includes('rewrite:patched-endpoint')
        && decisions.includes('block:blocked-endpoint'),
      JSON.stringify(decisions));
    check('store: handler decisions are labelled with the handler name',
      decisions.includes('store:store-health') && decisions.includes('store:catalog-bridge'),
      JSON.stringify(decisions.filter((d) => d.startsWith('store:'))));
    const firstCapture = indexLines[0];
    check('capture: request and response bodies are stored',
      firstCapture.request.method === 'GET' && Boolean(firstCapture.response)
        && firstCapture.response.status === 200,
      JSON.stringify({ method: firstCapture.request?.method, status: firstCapture.response?.status }));

    const dnsLogPath = path.resolve(config.capture.dir, `dns-queries-${new Date().toISOString().slice(0, 10)}.jsonl`);
    const dnsLines = (await fsp.readFile(dnsLogPath, 'utf8').catch(() => '')).split('\n').filter(Boolean);
    check('capture: DNS queries are logged', dnsLines.length >= 3, `entries=${dnsLines.length}`);

    // --- 502 when the backend is unreachable ------------------------------
    // Port 19445 has nothing listening: the host is MITM'd, no rule matches, and
    // the relay to the real backend must fail with a readable 502 rather than a
    // hang or a truncated response.
    const deadTarget = { ...target, targetPort: 19445 };
    const dead = await httpsViaProxy({ ...deadTarget, requestPath: '/ok', method: 'GET' })
      .catch((err) => ({ status: 0, body: err.message }));
    let deadJson = null;
    try { deadJson = JSON.parse(dead.body); } catch { deadJson = null; }
    check('proxy: unreachable backend answers 502 with a diagnostic body',
      dead.status === 502 && deadJson?.error === 'upstream_unreachable',
      `status=${dead.status} error=${deadJson?.error || dead.body.slice(0, 60)}`);

    // --- the tools the operator actually reads ----------------------------
    // `watch` and `canary` both encode a judgement - is this the device, did it
    // connect - that is easy to get wrong and impossible to notice when wrong,
    // because a wrong answer looks exactly like a quiet lab. They are driven here
    // against stub admin surfaces so the judgement is asserted, not assumed.
    const runTool = (file, args) => new Promise((resolve) => {
      const child = spawn(process.execPath, [path.join(ROOT, 'tools', file), ...args], { cwd: ROOT });
      let out = '';
      child.stdout.on('data', (d) => { out += d; });
      child.stderr.on('data', (d) => { out += d; });
      child.on('close', (code) => resolve({ out, code }));
      setTimeout(() => { try { child.kill(); } catch { /* already gone */ } }, 20000);
    });

    const statusStub = (port, stats) => new Promise((resolve, reject) => {
      const server = http.createServer((req, res) => {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify(req.url.startsWith('/__lab/status')
          ? { advertiseIp: '192.0.2.10', stats }
          : { exchanges: [] }));
      });
      server.once('error', reject);
      server.listen(port, '127.0.0.1', () => resolve(server));
    });

    const busyPort = 18091;
    const busyStub = await statusStub(busyPort, {
      directTcp: 4, directTls: 1, directHandshakeErrors: 3, plainTcp: 5, plainDevice: 2,
    });
    const watchBusy = await runTool('watch.mjs', ['--once', '--admin', `http://127.0.0.1:${busyPort}`, '--root', WORK]);
    check('tools: watch reports a refused handshake as device activity',
      watchBusy.code === 0 && /refused handshake/.test(watchBusy.out) && /root CA/.test(watchBusy.out),
      `exit=${watchBusy.code} last=${watchBusy.out.trim().split('\n').pop()}`);
    check('tools: watch also reports a device arriving on the plain HTTP port',
      /connection\(s\) on the plain HTTP port/.test(watchBusy.out),
      watchBusy.out.split('\n').find((l) => l.includes('plain HTTP port')) || 'missing');
    await new Promise((resolve) => busyStub.close(resolve));

    // ... and stays quiet when nothing happened: the report must be a signal, not
    // background noise that reads the same either way.
    const idlePort = 18092;
    const idleStub = await statusStub(idlePort, { directTcp: 0, directTls: 0, directHandshakeErrors: 0 });
    const watchIdle = await runTool('watch.mjs', ['--once', '--admin', `http://127.0.0.1:${idlePort}`, '--root', WORK]);
    check('tools: watch stays silent and exits 2 when nothing happened',
      watchIdle.code === 2 && /no device activity observed/.test(watchIdle.out),
      `exit=${watchIdle.code}`);
    await new Promise((resolve) => idleStub.close(resolve));

    // The canary must recognise its own probe as this PC. Reporting a device that
    // never connected is the one false positive that sends someone chasing a
    // phone for an hour.
    const canaryPort = 18093;
    const canaryRun = runTool('canary.mjs', ['--ports', String(canaryPort), '--seconds', '4']);
    await new Promise((r) => setTimeout(r, 1200));
    await new Promise((resolve) => {
      const probe = net.connect(canaryPort, '127.0.0.1', () => {
        probe.write('GET /probe HTTP/1.1\r\nHost: cdn.example\r\n\r\n');
      });
      probe.on('error', resolve);
      probe.on('close', resolve);
      setTimeout(() => { probe.destroy(); resolve(); }, 1200);
    });
    const canary = await canaryRun;
    check('tools: canary labels a local probe as this PC and reads what it asked for',
      canary.code === 2 && /this PC, not the device/.test(canary.out) && /GET \/probe/.test(canary.out),
      `exit=${canary.code} deviceHits=${(canary.out.match(/DEVICE/g) || []).length}`);
    // --- the app's patch set (generated here, applied on the phone) --------
    // The app carries no certificate of its own: it carries this patch set, and
    // the blob inside it must be the exact value Windows writes for the lab CA.
    // If that drifts, the phone is patched with bytes the desktop side never
    // verified - the failure this whole arrangement exists to prevent.
    const caDer = await fsp.readFile(path.join(config.pki.dir, 'ca.der'));
    const testHosts = ['store.test.invalid', 'catalog.test.invalid'];
    const patchSet = buildPatchSet({
      caDer,
      advertiseIp: FAKE_LAN_IP,
      hosts: testHosts,
      generatedAt: '2026-10-15T00:00:00.000Z',
    });
    const patch = patchSet.patches[0];
    const expectedThumbprint = crypto.createHash('sha1').update(caDer).digest('hex').toUpperCase();

    check('app: the patch set carries the CA thumbprint',
      patch.thumbprint === expectedThumbprint,
      `thumbprint=${patch.thumbprint}`);
    check('app: the patch blob is the byte-exact value Windows writes',
      Buffer.from(patch.blobBase64, 'base64').equals(buildCertBlob(caDer)),
      `blob=${Buffer.from(patch.blobBase64, 'base64').length} bytes, der=${patch.derBase64.length} base64 chars`);
    check('app: the patch is a cert-root naming the lab and requiring a reboot',
      patch.kind === 'cert-root' && patch.hive === 'HKLM' && patch.store === 'Root'
        && patch.requiresReboot === true && patchSet.lab.advertiseIp === FAKE_LAN_IP,
      JSON.stringify({ kind: patch.kind, hive: patch.hive, store: patch.store, reboot: patch.requiresReboot }));
    // The details screen reads the address and the name list off the patch set. If
    // the generator stopped carrying them, the screen would say "not in this patch
    // set" and look like a device problem instead of a build one.
    check('app: the patch set carries the lab address and the names it answers for',
      patchSet.lab.advertiseIp === FAKE_LAN_IP
        && Array.isArray(patchSet.lab.hosts)
        && patchSet.lab.hosts.length === testHosts.length
        && patchSet.lab.hosts[0] === testHosts[0],
      `ip=${patchSet.lab.advertiseIp} hosts=${JSON.stringify(patchSet.lab.hosts)}`);

    // The picker on the phone compares authorities by their bytes, and the operator
    // compares them by thumbprint. Both readings have to agree with what the desktop
    // pushes, including when the file on disk is PEM rather than DER - which is the
    // form people actually have.
    const pushedFromPem = readCertificateDer(path.join(config.pki.dir, 'ca.crt'));
    const pushedFromDer = readCertificateDer(path.join(config.pki.dir, 'ca.der'));
    check('app: a pushed CA is read identically from PEM and from DER',
      pushedFromPem.equals(caDer) && pushedFromDer.equals(caDer),
      `pem=${pushedFromPem.length} bytes, der=${pushedFromDer.length} bytes, ca=${caDer.length} bytes`);
    check('app: a pushed CA carries the same thumbprint as the patch set',
      crypto.createHash('sha1').update(pushedFromPem).digest('hex').toUpperCase() === expectedThumbprint,
      `thumbprint=${expectedThumbprint}`);

    // A file that is not a certificate must be refused here, not uploaded and then
    // shown on the phone as an unreadable entry.
    const notACertificate = path.join(WORK, 'not-a-certificate.txt');
    await fsp.writeFile(notACertificate, 'this is not a certificate\n');
    let refusal = null;
    try {
      readCertificateDer(notACertificate);
    } catch (err) {
      refusal = err.message;
    }
    check('app: push-ca refuses a file that is not a certificate',
      Boolean(refusal) && /neither DER \(does not start with 0x30\) nor a PEM/.test(refusal),
      refusal ? refusal.slice(0, 90) : 'accepted the file');

    const probeZip = makeStoredZip('WMAppManifest.xml', `<Capability Name="${CAPABILITY}"/>`);
    const zipEntries = readZipEntries(probeZip);
    check('app: the XAP reader reads an entry out of a zip',
      zipEntries.length === 1 && zipEntries[0].name === 'WMAppManifest.xml'
        && zipEntry(probeZip, 'WMAppManifest.xml').data.toString('utf8').includes(CAPABILITY),
      `entries=${zipEntries.map((e) => e.name).join(',')}`);
    check('app: the XAP reader reports a missing entry as missing',
      zipEntry(probeZip, 'patches.json') === null,
      'asked for patches.json, which the test zip does not contain');
  } finally {
    await proxy.stop();
    await dns.stop();
    await capture.flush();
    await new Promise((resolve) => upstream.close(resolve));
    await new Promise((resolve) => echo.close(resolve));
  }

  const failed = results.filter((r) => !r.ok);
  console.log('');
  console.log(`${results.length - failed.length}/${results.length} checks passed`);
  if (failed.length) {
    console.log('failed checks:');
    for (const f of failed) console.log(`  - ${f.name}`);
  }
  process.exit(failed.length ? 1 : 0);
}

main().catch((err) => {
  console.error(`selftest crashed: ${err.stack || err.message}`);
  process.exit(1);
});
