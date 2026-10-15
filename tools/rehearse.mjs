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
import { countJsonl } from '../src/capture.mjs';
import { query } from './dnsprobe.mjs';
import {
  PAGE_TYPES, TEMPLATE_GRAMMAR, checkTemplateType, isKnownPageType,
  templateTypesForPageType, whyNotATemplate,
} from '../src/store/vocabulary.mjs';

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

async function latestCaptureCount() {
  if (!fs.existsSync(captureRoot)) return 0;
  const sessions = fs.readdirSync(captureRoot).filter((n) => n.startsWith('session-')).sort();
  if (!sessions.length) return 0;
  const indexPath = path.join(captureRoot, sessions[sessions.length - 1], 'index.jsonl');
  // Never read the whole index into a string: past Node's maximum string length
  // that throws, and swallowing it reported "0 captured" for a session that had
  // thousands of exchanges.
  try { return await countJsonl(indexPath); } catch { return 0; }
}

console.log(`rehearsal against proxy ${proxyHost}:${proxyPort} and DNS ${dnsHost}:${dnsPort}`);
console.log(`CA: ${path.resolve(config.pki.dir, 'ca.crt')}\n`);

const before = await latestCaptureCount();
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

// The endpoint the phone's own Store opens with, on the name the capture shows it
// asking. This is the one that decides whether the Store opens at all, so the
// deployment rehearsal asks it too - not only the self-test.
console.log('--- store protocol');
if (config.livestore?.protocol?.enabled) {
  const storeHost = 'cdn.marketplaceedgeservice.windowsphone.com';
  // The query the capture shows the phone sending when it opens the Store: the
  // page type it names, its OS, its locale and the handset identifiers it adds on
  // the second, real request. Rehearsed verbatim rather than approximated.
  const storeQuery = '/v9/catalog/storePages?typeId=DynamicHub.Main&os=8.10.14219.0&cc=IT&lang=it-IT'
    + '&hw=402699266&dm=RM-941_eu_france_308&oemId=NOKIA&moId=&cf=&optedOut=true';
  const requestedTypeId = (new URL(storeQuery, 'http://x').searchParams.get('typeId') || '');
  const requestedPageType = requestedTypeId.split('.')[0];
  check(`the page type the phone asks for is one the client names`,
    isKnownPageType(requestedPageType),
    `typeId=${requestedTypeId} known=[${PAGE_TYPES.map((p) => p.id).join(',')}]`);
  try {
    const session = await connectThroughProxy({ targetHost: storeHost, targetPort: 443 });
    const response = await rawRequest(session.secureSocket, {
      method: 'GET', requestPath: storeQuery, host: storeHost,
    });
    session.secureSocket.destroy();
    const template = (response.body.match(/<templateName>([^<]*)<\/templateName>/) || [])[1];
    const items = (response.body.match(/<editorialItem>/g) || []).length;
    // 'storePages' when the page is built from the catalog, 'storePages:archive'
    // when it is the archived response. Both are a page served; the label is what
    // says which, so the rehearsal accepts either and prints it.
    const label = response.headers['x-lab-protocol'] || '';
    check(`${storeHost} serves a Store home page`,
      response.status === 200
        && response.headers['content-type'] === 'application/atom+xml; charset=utf-8'
        && label.startsWith('storePages')
        && response.body.includes('http://schemas.zune.net/catalog/apps/2008/02'),
      `status=${response.status} template=${template} items=${items} label=${label}`);

    // The check the whole vocabulary exists for: a page can be well-formed and
    // still name a layout this device has never heard of, which is a rejection
    // that looks exactly like a bad page. When the served page is generated, its
    // template type is held to the set the phone's own UI assets style. When it is
    // the archived page, that check cannot apply - the archive is a different page
    // from a different generation - so what is asserted instead is that the lab
    // *says so* in the headers, and the confound is printed rather than assumed
    // away.
    if (label === 'storePages') {
      const typeKey = (response.body.match(new RegExp(`<${TEMPLATE_GRAMMAR.typeKey}>([^<]*)<`)) || [])[1]
        || (response.body.match(new RegExp(`${TEMPLATE_GRAMMAR.typeKey}="([^"]*)"`)) || [])[1];
      const verdict = checkTemplateType(requestedPageType, typeKey);
      check(`the served page names a template type the phone styles`,
        verdict.ok,
        verdict.ok
          ? `type=${typeKey} styled=[${templateTypesForPageType(requestedPageType).join(',')}]`
          : `${verdict.reason} (served type=${typeKey})`);
      const rejected = whyNotATemplate(template);
      check(`the served page's template name belongs to the Store client, not another app`,
        rejected === null, rejected || `templateName=${template}`);
      // The parser counts panes before it counts templates. A page that answers
      // with a template and no panes is a template with nothing to render, and the
      // device's answer to that was to ask twice and then ask for nothing else.
      const panes = (response.body.match(/<Pane>/g) || []).length;
      check(`the served page carries the panes the parser counts`,
        panes > 0 && (response.body.match(/<\/Pane>/g) || []).length === panes,
        `panes=${panes} templates=${(response.body.match(/<Template[ >]/g) || []).length}`);
      // The document type: the page root has to be the element the parser's
      // store-page grammar names, not the Atom feed the older generation used.
      const root = (response.body.match(/^<\?xml[^?]*\?>\s*<([A-Za-z:]+)/) || [])[1];
      check(`the served page is rooted where the parser looks`,
        root === 'StorePage',
        `root=<${root}> format=${response.headers['x-lab-page-format']}`);
    } else {
      const archivedType = response.headers['x-lab-archive-template'];
      const confound = whyNotATemplate(archivedType);
      check(`the archived page declares what it carries and that it is not a substitute`,
        Boolean(response.headers['x-lab-archive-warning']) && confound !== null,
        `template=${archivedType} page=${response.headers['x-lab-archive-page']}`);
      console.log(`     this is not the page the request asked for: it is ${response.headers['x-lab-archive-page']},`);
      console.log(`     and its template ${archivedType} is ${confound ? 'not the Store client\'s' : 'unknown'}.`);
      console.log('     set livestore.protocol.serve to "generated" to rehearse the page the phone actually asks for.');
    }
  } catch (err) {
    check(`${storeHost} serves a Store home page`, false, err.message);
  }

  // The other endpoint in the same flow, and the only one that still failed: the
  // update check. Answered over the phone's own transport, with the body shape the
  // capture shows it sending.
  const updatesHost = 'marketplaceedgeservice.windowsphone.com';
  const updatesQuery = '/v8/catalog/updates?os=8.10.14219.0&cc=IT&lang=it-IT'
    + '&hw=402699266&dm=RM-941_eu_france_308&oemId=NOKIA';
  const updatesBody = '<?xml version="1.0" encoding="UTF-8"?>'
    + '<BatchGetProductUpdatesRequest xmlns="http://schemas.zune.net/catalog/apps/2008/02">'
    + '<Resources><Resource><InputSkuId>1076f542-8a6f-4cda-86e2-012bb248c9ef</InputSkuId>'
    + '<InputLicenseRight>Purchase</InputLicenseRight></Resource></Resources>'
    + '</BatchGetProductUpdatesRequest>';
  const updatesReply = await new Promise((resolve) => {
    const req = http.request({
      host: proxyHost,
      port: config.proxy.httpPort,
      path: updatesQuery,
      method: 'POST',
      headers: {
        host: updatesHost,
        'user-agent': 'ZDM/4.0; Windows Mobile 8.1',
        'content-type': 'application/xml',
        'content-length': String(Buffer.byteLength(updatesBody)),
        connection: 'keep-alive',
      },
    }, (res) => {
      let body = '';
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }));
    });
    req.on('error', (err) => resolve({ error: err.message }));
    req.end(updatesBody);
  });
  check(`the update check is answered instead of failing`,
    updatesReply.status === 200
      && updatesReply.body.includes('<BatchGetProductUpdatesResponse')
      && updatesReply.body.includes('<ProductId>1076f542-8a6f-4cda-86e2-012bb248c9ef</ProductId>')
      && updatesReply.headers['x-lab-skus'] === '1',
    updatesReply.error
      || `status=${updatesReply.status} skus=${updatesReply.headers?.['x-lab-skus']} bytes=${updatesReply.body?.length}`);

  // The same request over the transport the phone actually uses.
  //
  // The capture is unambiguous about it: the Store's page request is plain HTTP
  // on port 80, not TLS on 443, with no Accept header and this user agent -
  //
  //   GET http://cdn.marketplaceedgeservice.windowsphone.com/v9/catalog/storePages?...
  //   user-agent: ZDM/4.0; Windows Mobile 8.1
  //
  // - so the rehearsal that decides whether the Store opens has to be made on
  // port 80 too. Rehearsing only over TLS would leave the listener the device
  // really talks to unproven, which is the failure that once made the phone look
  // idle while it was retrying.
  console.log('--- store protocol, over the phone\'s own transport (plain HTTP on port 80)');
  const plainReply = await new Promise((resolve) => {
    const req = http.request({
      host: proxyHost,
      port: config.proxy.httpPort,
      path: storeQuery,
      method: 'GET',
      headers: {
        host: storeHost,
        'user-agent': 'ZDM/4.0; Windows Mobile 8.1',
        connection: 'keep-alive',
      },
    }, (res) => {
      let body = '';
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }));
    });
    req.on('error', (err) => resolve({ error: err.message }));
    req.end();
  });
  check(`port ${config.proxy.httpPort} answers the Store page for ${storeHost}`,
    plainReply.status === 200
      && plainReply.headers['content-type'] === 'application/atom+xml; charset=utf-8'
      && String(plainReply.headers['x-lab-protocol'] || '').startsWith('storePages')
      && plainReply.body.includes('http://schemas.zune.net/catalog/apps/2008/02'),
    plainReply.error
      || `status=${plainReply.status} label=${plainReply.headers?.['x-lab-protocol']} bytes=${plainReply.body?.length}`);
} else {
  console.log('      skipped: livestore.protocol.enabled is false');
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

const after = await latestCaptureCount();
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
