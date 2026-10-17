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
import zlib from 'node:zlib';
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
import { Capture, countJsonl, readJsonl } from '../src/capture.mjs';
import { DnsServer } from '../src/dns-server.mjs';
import { MitmProxy } from '../src/proxy.mjs';
import { ZincClient } from '../src/zinc.mjs';
import { describeDirectHandshakeFailure } from '../src/proxy.mjs';
import { StoreRouter } from '../src/store/router.mjs';
import { buildHandlers } from '../src/store/handlers.mjs';
import { buildStorePageFeed, buildApplicationListFeed, buildProductUpdatesResponse, uuidForApp, uuidForCollection, categoryId, normalizeVersion, findAppByUuid, isUuid, normalizePageFormat, ATOM_NS, CATALOG_NS } from '../src/store/catalog-feed.mjs';
import { pageSections, applyPageMutation } from '../src/store/protocol.mjs';
import { collect, coverage, findFirst, pathsUnder, verdictOf } from '../src/store/page-frame.mjs';
import {
  DEFAULT_TEMPLATE_TYPE, TEMPLATE_GRAMMAR, TEMPLATE_TYPES, PAGE_TYPES, PAGE_PARSE_PATHS,
  PATHS_NEAR_THE_PAGE_GRAMMAR,
  checkTemplateType, templateTypesForPageType, whyNotATemplate, PROVENANCE,
} from '../src/store/vocabulary.mjs';
import { query } from './dnsprobe.mjs';
import * as sequence from './sequence.mjs';
import {
  normalisePath, looksLikeStoreHost, looksLikeWindowsPhoneClient, localAddresses,
  deviceKeyOf, buildDeviceRows, buildClientRows, groupHttpClients, readDnsQueries,
} from './analyze-captures.mjs';
import { buildCertBlob, buildRegEntry, buildRegFileBuffer, buildPhoneCertBlob, phoneElementId, PHONE_ELEMENT_VERSION } from './make-rootreg.mjs';

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
 * Walk a generated XML document and report the first thing that would make it
 * unparseable: an unclosed or mismatched element, or an unescaped `&` in text.
 *
 * Not a validator and not meant to be one. It checks the mistakes a document
 * assembled by string concatenation actually makes, because the device's answer
 * to a malformed page is an error screen with a code in it, which is exactly the
 * bug this suite is meant to catch here rather than on the phone.
 *
 * @returns {string|null} a description of the first problem, or null.
 */
/**
 * Read a document into the chains of element names a path lookup can be run
 * against.
 *
 * Why not a list of hand-written regexes per path: a path is a claim about the
 * client's parser, and the parser's own list is longer than anyone will remember
 * to write a test for. This walks the document once and answers any path from
 * src/store/vocabulary.mjs, so adding a path to the module adds a check here.
 *
 * Namespaces are stripped (`a:feed` is `feed`, which is how the parser spells its
 * paths) and case is **not**: the parser's strings are the authority on spelling,
 * so a page that capitalises a name differently fails rather than passing
 * silently. Matching is relative to the document element, which is how a
 * `/Panes/Pane` path reads: the root's child `Panes`, then its child `Pane`.
 *
 * `scope` decides the reading: `root` (the default) is a path from the document
 * element, `anywhere` is a name the parser reads relative to a node it selects
 * first, so only that it is carried is checkable from here.
 *
 * @returns {{root: string, carries: (path: string, scope?: string) => boolean}}
 */
function elementIndex(xml) {
  const local = (name) => String(name).split(':').pop();
  const root = { name: '', children: [] };
  const stack = [root];
  for (const m of xml.matchAll(/<(\/?)([A-Za-z][\w:.-]*)((?:\"[^\"]*\"|[^>\"])*?)(\/?)>/g)) {
    const [, closing, name, , selfClosing] = m;
    if (closing) {
      if (stack.length > 1) stack.pop();
      continue;
    }
    const node = { name: local(name), children: [] };
    stack[stack.length - 1].children.push(node);
    if (!selfClosing) stack.push(node);
  }
  const chains = [];
  const walk = (node, chain) => {
    for (const child of node.children) {
      const next = [...chain, child.name];
      chains.push(next);
      walk(child, next);
    }
  };
  walk(root, []);
  const rootName = root.children.length ? root.children[0].name : '';
  return {
    root: rootName,
    carries(path, scope = 'root') {
      const segments = String(path).split('/').filter(Boolean).map(local);
      // `/StorePage` names the document element itself, which has no parent chain
      // to be found in: the path is satisfied when it is the root's own name.
      if (segments.length === 1 && segments[0] === rootName) return true;
      if (scope === 'anywhere') {
        return chains.some((chain) => chain.length >= segments.length
          && chain.some((_, start) => start + segments.length <= chain.length
            && segments.every((name, i) => chain[start + i] === name)));
      }
      return chains.some((chain) => chain.length >= segments.length + 1
        && chain[0] === rootName
        && segments.every((name, i) => chain[i + 1] === name));
    },
  };
}

/** The paths in `list` that a document does not carry, ignoring the optional ones. */
function pathsAbsentFrom(xml, list) {
  const index = elementIndex(xml);
  return list.filter((entry) => entry.required !== false && !index.carries(entry.path, entry.scope));
}

function xmlProblem(xml) {
  const stack = [];
  let i = 0;
  while (i < xml.length) {
    const lt = xml.indexOf('<', i);
    if (lt === -1) break;
    if (lt > i) {
      const text = xml.slice(i, lt);
      const bad = text.match(/&(?!(?:amp|lt|gt|quot|apos|#\d+|#x[0-9a-fA-F]+);)/);
      if (bad) return `unescaped & in text near ${JSON.stringify(text.slice(Math.max(0, bad.index - 10), bad.index + 10))}`;
    }
    const gt = xml.indexOf('>', lt);
    if (gt === -1) return 'unterminated tag';
    const raw = xml.slice(lt + 1, gt);
    if (raw.startsWith('?') || raw.startsWith('!')) { i = gt + 1; continue; }
    if (raw.startsWith('/')) {
      const name = raw.slice(1).trim();
      const open = stack.pop();
      if (open !== name) return `</${name}> closes <${open}>`;
    } else {
      const name = (raw.match(/^[^\s/>]+/) || [''])[0];
      if (!name) return 'element with no name';
      if (!raw.endsWith('/')) stack.push(name);
    }
    i = gt + 1;
  }
  return stack.length ? `unclosed <${stack[stack.length - 1]}>` : null;
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
      protocol: {
        enabled: true,
        catalogFile: path.join(ROOT, 'src', 'store', 'fixtures', 'sample-catalog.json'),
        hubTemplate: 'DynamicHub',
        pageSize: 25,
        // Armed here as well as in config.json, so the suite checks the document
        // the lab actually serves rather than the one it served before: a pane
        // that names a data source, and the URL it names answering with that
        // pane's own section.
        dataSource: true,
        dataSourceType: 'Applications',
        // The pane's own type: armed, so the page under test is the page served.
        // `Collection` is the word the client's page parser and its UI both use for
        // one section of apps - see src/store/vocabulary.mjs. `paneSubType` stays
        // empty, deliberately: no reading suggests a value, and two invented fields
        // would be two variables.
        paneType: 'Collection',
        // The application list's entry shape, armed here as well as in config.json
        // for the same reason: the suite has to check the XML the lab serves. Both
        // values come from the archived responses of the real service - see
        // src/store/fixtures/archive/real-apps-feed-*.xml and F-021/F-022 in
        // docs/FINDINGS.md.
        appListRank: 4,
        appListEntryTitle: false,
        // The configuration endpoint, armed here as in config.json: the check below
        // tests the lab as it is configured, and the request it answers is the one
        // the phone makes before it asks for a page (2026-10-16 06:20: eight of
        // them in 735 ms, then no page at all).
        configuration: { enabled: true },
      },
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

  // --- the capture census, before any device --------------------------------
  // These are the readings that decide *whose* traffic a later finding is about,
  // and getting them wrong is not an obvious failure: an aggregate that hands
  // this PC's exchanges to the phone reads as a device behaving in a way it never
  // behaved (F-012). Everything below is hermetic - fixed entries and a scratch
  // capture root - so the rule is checked on every run rather than once by hand.
  check('census: a path collapses ids, uuids and query keys',
    normalisePath('/v9/app/12345/9f8e7d6c5b4a39281706/detail?z=1&a=2') === '/v9/app/{n}/{hex}/detail?a&z'
      && normalisePath('/a/123e4567-e89b-12d3-a456-426614174000/b') === '/a/{uuid}/b'
      && normalisePath('') === '',
    normalisePath('/v9/app/12345/9f8e7d6c5b4a39281706/detail?z=1&a=2'));
  check('census: this PC is recognised from its addresses, including a configured one',
    localAddresses({ network: { advertiseIp: FAKE_LAN_IP }, dns: { hijack: { ip: 'auto' } } }).has(FAKE_LAN_IP)
      && !localAddresses({}).has(FAKE_LAN_IP)
      && localAddresses({}).has('127.0.0.1'),
    `configured=${localAddresses({ network: { advertiseIp: FAKE_LAN_IP } }).has(FAKE_LAN_IP)}`);
  check('census: the phone fingerprint is narrower than "looks like Store"',
    looksLikeStoreHost('sqm.telemetry.microsoft.com')
      && !looksLikeWindowsPhoneClient('sqm.telemetry.microsoft.com')
      && looksLikeWindowsPhoneClient('discoveryservice.windowsphone.com')
      && looksLikeWindowsPhoneClient('account.nokia.com')
      && looksLikeWindowsPhoneClient('catalog.zune.net'),
    `telemetry is store-ish only=${looksLikeStoreHost('sqm.telemetry.microsoft.com') && !looksLikeWindowsPhoneClient('sqm.telemetry.microsoft.com')}`);

  // One phone, two addresses: the id is what decides, not the address. And two
  // phones that share a model are still two, which is why the id and not the
  // model is the key.
  const phoneA = '40752FEDCD7E0095C8BFAFB9D58575C236517C15679D2C37046971F4FD5A1872';
  const phoneB = '3499541B3396EB6C0BD654A634128C90CCBB2C06EC52F957266FE4DE12EEA32B';
  const censusRequest = (address, requestPath, headers = {}) => ({
    ts: '2026-01-01T00:00:00.000Z',
    client: { address, port: 5000 },
    decision: 'passthrough',
    request: { method: 'GET', scheme: 'https', host: 'cdn.marketplaceedgeservice.windowsphone.com', port: 443, path: requestPath, headers },
    response: { status: 200, headers: {}, body: null },
  });
  const storePath = '&os=8.10.14219.0&hw=402699266&dm=RM-941_eu_france_308&oemId=NOKIA';
  const hungaryPath = '&os=8.10.14226.0&hw=402699266&dm=RM-941_eu_hungary_356&oemId=NOKIA';

  const censusExchanges = [
    censusRequest('192.168.0.136', `/x?typeId=DynamicHub.Main${storePath}`, { 'x-wp-device-id': phoneA }),
    censusRequest('192.168.0.137', `/x?typeId=DynamicHub.Main${storePath}`, { 'x-wp-device-id': phoneA }),
    // A system component of the same handset: no device id, same hw/dm.
    censusRequest('192.168.0.137', '/v8/Configuration/Stores/OEMStores/NOKIA?mpcVersion=8.10&os=8.10.14219.0&hw=402699266&dm=RM-941_eu_france_308'),
    censusRequest('192.168.0.53', `/x?typeId=DynamicHub.Main${hungaryPath}`, { 'x-wp-device-id': phoneB }),
    // This PC replaying the device's own request: same path, same agent, and
    // even a copied device id - and it must not become a device.
    censusRequest(FAKE_LAN_IP, `/x?typeId=DynamicHub.Main${storePath}`, { 'x-wp-device-id': phoneA, 'user-agent': 'ZDM/4.0; Windows Mobile 8.1' }),
  ];
  const deviceCensus = buildDeviceRows(censusExchanges.filter((entry) => entry.client.address !== FAKE_LAN_IP));
  const censusRows = buildClientRows({
    http: groupHttpClients(censusExchanges),
    dns: new Map([
      ['192.168.0.136', { address: '192.168.0.136', count: 296, first: '2026-01-01T00:00:00.000Z', last: '2026-01-01T01:00:00.000Z', names: new Map([['discoveryservice.windowsphone.com', 41], ['sqm.telemetry.microsoft.com', 11]]), actions: new Map([['forward', 52]]), hijacked: 0 }],
      [FAKE_LAN_IP, { address: FAKE_LAN_IP, count: 8639, first: '2026-01-01T00:00:00.000Z', last: '2026-01-01T01:00:00.000Z', names: new Map([['wscont1.apps.microsoft.com', 56]]), actions: new Map([['hijack', 56]]), hijacked: 56 }],
    ]),
    localIps: new Set([FAKE_LAN_IP]),
  });

  check('census: one device id at two addresses is one device',
    deviceCensus.length === 3
      && deviceCensus[0].ids.has(phoneA)
      && [...deviceCensus[0].addresses.keys()].sort().join(',') === '192.168.0.136,192.168.0.137'
      && deviceCensus[0].count === 2,
    deviceCensus.map((d) => `${[...d.ids].join('') || '(none)'}:${d.count}@${[...d.addresses.keys()].join('+')}`).join(' '));
  const idDevices = deviceCensus.filter((d) => d.ids.size === 1);
  check('census: two handsets of the same model stay two devices',
    idDevices.length === 2
      && idDevices.every((d) => [...d.hardwareKeys].every((key) => key.startsWith('hw=402699266 ')))
      && Boolean(idDevices.find((d) => d.ids.has(phoneA)))
      && Boolean(idDevices.find((d) => d.ids.has(phoneB)))
      && ![...idDevices.find((d) => d.ids.has(phoneA)).hardwareKeys].some((key) => key.includes('hungary'))
      && ![...idDevices.find((d) => d.ids.has(phoneB)).hardwareKeys].some((key) => key.includes('france')),
    idDevices.map((d) => `${[...d.ids][0].slice(0, 8)}=${[...d.hardwareKeys].join(' ')}`).join(' | '));
  check('census: a component with no id but the same hw/dm joins its handset',
    deviceCensus.some((d) => !d.ids.size && d.count === 1 && d.sameAs?.length === 1
      && [...d.requests.keys()].some((r) => r.includes('/v8/Configuration/Stores/OEMStores/'))),
    JSON.stringify(deviceCensus.map((d) => ({ ids: [...d.ids].length, count: d.count, sameAs: d.sameAs || [] }))));
  const pcRow = censusRows.find((row) => row.address === FAKE_LAN_IP);
  const phoneRow = censusRows.find((row) => row.address === '192.168.0.136');
  check('census: this PC is marked, and its copy of a device request is not a device',
    censusRows.length === 4
      && pcRow.thisPc && pcRow.kind === 'this PC' && pcRow.exchanges === 1
      && phoneRow.phoneIsh && !phoneRow.thisPc
      && censusRows.filter((row) => !row.thisPc).length === 3
      && censusRows.at(-1).address === FAKE_LAN_IP,
    censusRows.map((row) => `${row.address}=${row.kind}`).join(' '));
  check('census: the device-side fingerprints are reported per address, never pooled',
    censusRows[0].fingerprint.join(',') === 'discoveryservice.windowsphone.com'
      && censusRows.at(-1).fingerprint.length === 0
      && censusRows.at(-1).storeNames.join(',') === 'wscont1.apps.microsoft.com',
    `device=${censusRows[0].fingerprint.join(',')} pc=${censusRows.at(-1).fingerprint.join(',') || '(none)'}`);

  // Both readers of the DNS log stream it, and the file that broke
  // `readFileSync` is exactly this one (footgun 10). A torn last line and a blank
  // line are the two shapes a live log is read in, so both are checked here.
  const censusRoot = path.join(WORK, 'census');
  await fsp.mkdir(censusRoot, { recursive: true });
  await fsp.writeFile(path.join(censusRoot, 'dns-queries-2026-01-01.jsonl'), [
    '{"ts":"2026-01-01T00:00:00.000Z","client":"192.168.0.136","qname":"discoveryservice.windowsphone.com","qtype":"A","action":"forward"}',
    '',
    '{"ts":"2026-01-01T00:00:01.000Z","client":"192.168.0.136","qname":"catalog.zune.net","qtype":"A","action":"hijack","answer":"192.0.2.10"}',
    '{"ts":"2026-01-01T00:00:02.000Z","client":"192.168.0.1","qname":"www.msftncsi.com","qtype":"A","action":"cache"}',
    '{"ts":"2026-01-01T00:00:03.000Z","client":"192.168.0.2","qname":"tor',
  ].join('\n'));
  const dnsCensus = await readDnsQueries(censusRoot);
  check('census: the DNS log is read per client, and a torn line is dropped',
    dnsCensus.byClient.size === 2
      && dnsCensus.byClient.get('192.168.0.136').count === 2
      && dnsCensus.byClient.get('192.168.0.136').names.size === 2
      && dnsCensus.byClient.get('192.168.0.136').hijacked === 1
      && dnsCensus.byName.size === 3,
    `clients=${dnsCensus.byClient.size} names=${dnsCensus.byName.size} torn=${dnsCensus.byName.has('tor') ? 'counted' : 'dropped'}`);

  // --- the Store protocol's own format, before any device -----------------
  // The grammar is the one archived responses of the real service show (each
  // element in src/store/catalog-feed.mjs names the capture it came from). What
  // can be settled without a phone: the document is well formed, nothing a
  // catalog carries can break it, and a GUID handed to the device resolves back
  // to the entry it was minted from.
  const fixtureCatalog = JSON.parse(
    fs.readFileSync(path.join(ROOT, 'src', 'store', 'fixtures', 'sample-catalog.json'), 'utf8'),
  );
  const fixtureApps = fixtureCatalog.apps;
  const sections = pageSections(fixtureCatalog, 25);

  const homeXml = buildStorePageFeed({
    sections,
    selfHref: '/v9/catalog/storePages?typeId=DynamicHub.Main&cc=IT',
    title: 'DynamicHub.Main-IT-WindowsPhone81',
    id: 'DynamicHub.Main-IT-WindowsPhone81-ALL-ALL',
    templateName: 'DynamicHub',
    templateType: DEFAULT_TEMPLATE_TYPE,
    typeKeyForm: 'both',
  });

  check('store protocol: the home page feed is well-formed',
    xmlProblem(homeXml) === null, xmlProblem(homeXml) || `${homeXml.length} bytes`);
  check('store protocol: the feed declares the catalog namespace and the page template',
    homeXml.includes('xmlns="http://schemas.zune.net/catalog/apps/2008/02"')
      && homeXml.includes('<templateName>DynamicHub</templateName>'),
    homeXml.slice(0, 80));

  // What a pane says it *is*. Written only when a type is configured: every page
  // this lab served before carried none, those are the pages whose readings are on
  // record, and an experiment that cannot be un-armed cannot be read.
  const typedPanes = buildStorePageFeed({
    sections,
    selfHref: '/v9/catalog/storePages?typeId=DynamicHub.Main&cc=IT',
    templateName: 'DynamicHub',
    templateType: DEFAULT_TEMPLATE_TYPE,
    pageFormat: 'panes',
    paneType: 'Collection',
    paneSubType: 'FeaturedApps',
  });
  check('store protocol: a pane writes the type it is given, and writes none when given none',
    homeXml.split('<Type>').length - 1 === 0
      && homeXml.split('<SubType>').length - 1 === 0
      && typedPanes.split('<Type>Collection</Type>').length - 1 === sections.length
      && typedPanes.split('<SubType>FeaturedApps</SubType>').length - 1 === sections.length
      && xmlProblem(typedPanes) === null,
    `${sections.length} pane(s): untyped by default, all typed when configured`);

  // The application list's entry shape, against the archived responses of the real
  // service. Both archived generations of `/v8/catalog/apps` and `/v9/catalog/apps`
  // put `<k>` on every entry, immediately after `impressionId`; neither puts a bare
  // `<title>` at entry level. The default stays this lab's own earlier feed, so the
  // archived shape is a value somebody set and can put back.
  const entryTitleCount = (xml) => xml.split('<isHardwareCompatible>true</isHardwareCompatible><title>').length - 1;
  const archivedEntryShape = buildApplicationListFeed({
    apps: fixtureApps, selfHref: '/v9/catalog/apps', id: 'x', entryRank: 4, entryTitle: false,
  });
  const labEntryShape = buildApplicationListFeed({ apps: fixtureApps, selfHref: '/v9/catalog/apps', id: 'x' });
  check('app list: the configured entry shape is the archived one, and the default is this lab\'s own',
    archivedEntryShape.split('<k>').length - 1 === fixtureApps.length
      && archivedEntryShape.includes('<k>4</k>')
      && archivedEntryShape.includes(`<k>${3 + fixtureApps.length}</k>`)
      && archivedEntryShape.split('</impressionId><k>').length - 1 === fixtureApps.length
      && entryTitleCount(archivedEntryShape) === 0
      && labEntryShape.split('<k>').length - 1 === 0
      && entryTitleCount(labEntryShape) === fixtureApps.length
      && xmlProblem(archivedEntryShape) === null,
    `k=${archivedEntryShape.split('<k>').length - 1} (${archivedEntryShape.match(/<k>\d+<\/k>/g)?.join(' ')}), archived titles=${entryTitleCount(archivedEntryShape)}, lab titles=${entryTitleCount(labEntryShape)}`);

  // The update check. It answered 502 on every attempt before this, and the
  // capture shows the phone retrying it four times in a row while the Store was
  // starting - the only other endpoint in that flow that fails.
  const updatesXml = buildProductUpdatesResponse({
    skus: ['1076f542-8a6f-4cda-86e2-012bb248c9ef', 'a7b0e2f3-0000-4000-8000-000000000001'],
  });
  check('store protocol: the update check answers with the element names the parser names',
    xmlProblem(updatesXml) === null
      && updatesXml.includes('<BatchGetProductUpdatesResponse')
      && updatesXml.includes('<Resources><Resource>')
      && updatesXml.includes('<ProductId>1076f542-8a6f-4cda-86e2-012bb248c9ef</ProductId>')
      && updatesXml.includes('<IsRevoked>false</IsRevoked>')
      && updatesXml.includes('<Result>0</Result>'),
    xmlProblem(updatesXml) || `${updatesXml.length} bytes`);
  check('store protocol: the update check reports every SKU it was asked about, and no update',
    (updatesXml.match(/<Resource>/g) || []).length === 2
      && !/<CurrentPayloadId>[^<]+<\/CurrentPayloadId>/.test(updatesXml)
      && !/true/.test(updatesXml),
    `resources=${(updatesXml.match(/<Resource>/g) || []).length}`);

  // --- the vocabulary the page is built from -------------------------------
  //
  // These are about the page and the phone agreeing, which is the thing that
  // cannot be checked by generating a page and reading it back: a page can be
  // perfectly well-formed and still name a template this device has never heard
  // of. Every name asserted here is in src/store/vocabulary.mjs with the offset it
  // was read from, and `npm run read-vocabulary` re-reads the phone to prove it.
  check('vocabulary: the page names the template type the phone styles, and it is a number',
    /^\d{3}$/.test(DEFAULT_TEMPLATE_TYPE)
      && templateTypesForPageType('DynamicHub').includes(DEFAULT_TEMPLATE_TYPE),
    `type=${DEFAULT_TEMPLATE_TYPE} styled=[${templateTypesForPageType('DynamicHub').join(',')}]`);
  check('vocabulary: the page carries the type key in both spellings, so either reading finds it',
    homeXml.includes(`<${TEMPLATE_GRAMMAR.element} ${TEMPLATE_GRAMMAR.typeKey}="${DEFAULT_TEMPLATE_TYPE}">`)
      && homeXml.includes(`<${TEMPLATE_GRAMMAR.typeKey}>${DEFAULT_TEMPLATE_TYPE}</${TEMPLATE_GRAMMAR.typeKey}>`)
      && homeXml.includes(`<${TEMPLATE_GRAMMAR.container}>`),
    `element=${TEMPLATE_GRAMMAR.element} key=${TEMPLATE_GRAMMAR.typeKey}`);
  check('vocabulary: narrowing the form to one spelling writes the type in that one only',
    ['attribute', 'element'].every((form) => {
      const narrowed = buildStorePageFeed({
        sections: [], templateName: 'DynamicHub', templateType: '015', typeKeyForm: form,
      });
      return form === 'attribute'
        ? narrowed.includes('<Template TEMPLATETYPE="015">') && !narrowed.includes('<TEMPLATETYPE>')
        : narrowed.includes('<TEMPLATETYPE>015</TEMPLATETYPE>') && !narrowed.includes(' TEMPLATETYPE=');
    }),
    'checked on both forms');
  check('vocabulary: the template name the page uses is one the Store client owns',
    whyNotATemplate('DynamicHub') === null && whyNotATemplate('GamesHub') !== null,
    whyNotATemplate('GamesHub') || 'GamesHub is not described as a decoy');
  check('vocabulary: a name that is a template cannot pass as a template type',
    ['GamesHub', 'MarketplaceHub', 'DynamicHub', '999', '', null].every((value) =>
      checkTemplateType('DynamicHub', value).ok === false)
      && checkTemplateType('DynamicHub', '003').ok === true,
    checkTemplateType('DynamicHub', 'GamesHub').reason);
  check('vocabulary: a page type the client does not ask for is refused',
    checkTemplateType('NotAPageType', '003').ok === false
      && PAGE_TYPES.some((page) => page.id === 'DynamicHub')
      && PAGE_TYPES.every((page) => page.parserOffset > 0),
    checkTemplateType('NotAPageType', '003').reason);
  check('vocabulary: every declared name carries the binary offset it was read from',
    Object.values(TEMPLATE_TYPES).every((entries) => entries.every((e) => e.uiOffset > 0))
      && PAGE_TYPES.every((page) => page.parserOffset > 0)
      && Boolean(PROVENANCE.binaries.parser.path),
    `${PROVENANCE.binaries.parser.path} @${PROVENANCE.binaries.parser.dated}`);
  check('vocabulary: the template block is a path the parser walks, not an invented container',
    `${TEMPLATE_GRAMMAR.container}/${TEMPLATE_GRAMMAR.element}` === '/Templates/Template'.slice(1)
      || `${TEMPLATE_GRAMMAR.container}/${TEMPLATE_GRAMMAR.element}` === 'Templates/Template',
    `${TEMPLATE_GRAMMAR.container}/${TEMPLATE_GRAMMAR.element}`);

  // The completeness property the vocabulary makes checkable: every structural
  // path the parser walks has to be present in the page. A page can be
  // well-formed, carry the right template type, and still be missing the container
  // the client builds its model out of - which is what happened here. The panes
  // block was absent from every page the lab had served, and the device's answer to
  // it was to ask twice and then ask for nothing else.
  // ... and it is checked over the parser's whole list rather than the handful of
  // paths a person picked out. The list was previously six entries written by hand
  // here, which meant the check could only ever fail for the six somebody had
  // already thought about - and the paths that mattered in the end (the entry, the
  // editorial items, the offer) were not among them.
  const missingPaths = pathsAbsentFrom(homeXml, PAGE_PARSE_PATHS);
  check('vocabulary: the page carries every structural path the parser walks',
    missingPaths.length === 0,
    missingPaths.length
      ? `missing: ${missingPaths.map((entry) => entry.path).join(', ')}`
      : `${PAGE_PARSE_PATHS.filter((e) => e.required !== false).length} path(s) of `
        + `${PAGE_PARSE_PATHS.length} in the parser's page grammar`);
  const optional = PAGE_PARSE_PATHS.filter((entry) => entry.required === false);
  check('vocabulary: a path the parser names but does not require says so, and says why',
    optional.length > 0 && optional.every((entry) => entry.why && !entry.required),
    optional.map((entry) => `${entry.path} (${entry.why})`).join(' | '));
  // The paths the string table holds that are *not* page requirements are kept too,
  // because the next person to read those strings will find them and has to be able
  // to tell which list they belong in. Each carries the offset it was read from and
  // the reason it is not a page path.
  const nearby = PATHS_NEAR_THE_PAGE_GRAMMAR.flatMap((group) => group.paths);
  check('vocabulary: every path is attributed, with the offset it was read from',
    PAGE_PARSE_PATHS.every((entry) => entry.parserOffset > 0 && entry.scope)
      && PATHS_NEAR_THE_PAGE_GRAMMAR.every((group) => group.why && group.paths.length > 0
        && group.paths.every((entry) => entry.parserOffset > 0)),
    `${PAGE_PARSE_PATHS.length} page path(s), ${nearby.length} read here and not a page path`);
  check('vocabulary: there is one pane per section, and each names its own collection',
    (homeXml.match(/<Pane>/g) || []).length === sections.length
      && sections.every((section) => homeXml.includes(uuidForCollection(section.title))),
    `panes=${(homeXml.match(/<Pane>/g) || []).length} sections=${sections.length}`);

  // The document type. Every page the lab served before this one was an Atom
  // <a:feed> at the root - the shape of the v8 catalog/hubs responses - and the
  // phone asserted on every one of them. `/StorePage` is the one element name in
  // the parser's store-page grammar that a served page never carried, so the root
  // is held here, and the older shape is held to still being what it was.
  // The root tag may carry attributes, and now does: what the element name has to
  // be is `StorePage`, which is what the assertion is about, so the attributes are
  // allowed rather than the name loosened.
  check('vocabulary: the page root is the element the parser looks for',
    /<\?xml[^?]*\?><StorePage(\s[^>]*)?>/.test(homeXml) && homeXml.trimEnd().endsWith('</StorePage>'),
    homeXml.slice(0, 60));
  // The declarations belong on the document element. Declaring them only on the
  // nested <a:feed> left `StorePage`, `Panes` and `Template` in no namespace at
  // all, which is a document no Microsoft service emits - the archived response
  // declares them on its own root, and the parser names the catalog namespace
  // (@118040) and the literal `xmlns` in the download path (@27812).
  const rootTag = (homeXml.match(/<StorePage\b[^>]*>/) || [''])[0];
  check('vocabulary: the page root declares the catalog and atom namespaces',
    rootTag.includes(`xmlns="${CATALOG_NS}"`) && rootTag.includes(`xmlns:a="${ATOM_NS}"`),
    rootTag || 'no root tag found');
  check('vocabulary: the panes and the template block are children of that root, not of the feed',
    /<StorePage(\s[^>]*)?><Panes>[\s\S]*?<\/Panes><Templates>[\s\S]*?<\/Templates>/.test(homeXml),
    'checked on the rendered page');
  const atomPage = buildStorePageFeed({
    sections, templateName: 'DynamicHub', templateType: '003', pageFormat: 'atom',
  });
  check('vocabulary: the older document shape is still available and unchanged',
    /^<\?xml[^?]*\?><a:feed/.test(atomPage)
      && /<a:feed[\s\S]*<Panes>/.test(atomPage)
      && !atomPage.includes('<StorePage>'),
    'the switch is one setting, so the change is one variable');
  // The negative control, without which the check above is only a claim that it
  // passes: the same walk over a document that is not this grammar has to find
  // paths missing. A matcher that says yes to everything would pass the positive
  // check and never catch anything.
  const absentOnAtom = pathsAbsentFrom(atomPage, PAGE_PARSE_PATHS);
  check('vocabulary: the path check fails on a document that is not this grammar',
    absentOnAtom.length > 0,
    `${absentOnAtom.length} missing on the atom page: ${absentOnAtom.map((e) => e.path).join(', ')}`);
  check('store protocol: every catalog entry reaches the page, none is dropped',
    sections.reduce((total, section) => total + section.items.length, 0) === fixtureApps.length
      && fixtureApps.every((app) => homeXml.includes(`urn:uuid:${uuidForApp(app.id)}`)),
    `sections=${sections.length} apps=${fixtureApps.length}`);
  check('store protocol: a GUID handed to the device resolves back to its entry',
    fixtureApps.every((app) => {
      const guid = uuidForApp(app.id);
      return isUuid(guid) && guid === uuidForApp(app.id) && findAppByUuid(fixtureApps, guid)?.id === app.id;
    }) && findAppByUuid(fixtureApps, '00000000-0000-4000-8000-000000000000') === null,
    `${uuidForApp(fixtureApps[0].id)} -> ${findAppByUuid(fixtureApps, uuidForApp(fixtureApps[0].id))?.id}`);
  check('store protocol: the image and the background of one app are not the same handle',
    !new RegExp(`<image><id>(urn:uuid:[0-9a-f-]+)</id></image><hasLiveTile>false</hasLiveTile>[\s\S]{0,400}?<backgroundImage><id>\\1`).test(homeXml),
    'checked on the rendered page');

  // A catalog is data from outside this process: one control character, one raw
  // `&` in a title, and the whole page becomes unparseable on the device.
  const hostileApp = {
    id: 'hostile',
    name: 'A & B <x> "quoted" \u0007 bell',
    category: 'news + weather',
    version: '2.1',
    release_date: '2024-03-04',
  };
  const hostileXml = buildApplicationListFeed({ apps: [hostileApp], selfHref: '/v9/catalog/apps', id: 'x' });
  check('store protocol: a hostile catalog entry cannot break the XML',
    xmlProblem(hostileXml) === null && !/[\u0000-\u0008]/.test(hostileXml)
      && /A &amp; B &lt;x&gt; &quot;quoted&quot;\s+bell/.test(hostileXml),
    xmlProblem(hostileXml)
      || (hostileXml.match(/<a:title type="text">(A[^<]*)</) || [])[1]
      || 'the escaped title is not in the document');
  check('store protocol: a three-part version is padded to the four parts the feeds carry',
    normalizeVersion('2.1') === '2.1.0.0' && normalizeVersion('1.0.8.61') === '1.0.8.61'
      && normalizeVersion('') === '1.0.0.0'
      && hostileXml.includes('<version>2.1.0.0</version>'),
    normalizeVersion('2.1'));
  check('store protocol: category ids are the ones the archive shows, or follow it',
    categoryId('tools + productivity') === 'windowsphone.ToolsAndProductivity'
      && categoryId('health + fitness') === 'windowsphone.HealthAndFitness'
      && categoryId('news + weather') === 'windowsphone.NewsAndWeather'
      && categoryId('something new') === 'windowsphone.SomethingNew',
    `${categoryId('tools + productivity')} ${categoryId('something new')}`);

  // --- the demo catalog, which is the one that actually runs ----------------
  //
  // A catalog is hand-written data, so it can be wrong in ways no builder can
  // notice. A repeated id would mint two entries the same GUID and make the second
  // one unreachable - `findAppByUuid` scans and returns the first match, so the
  // device would silently get the wrong app. An app in a category nobody declared
  // would be quietly sorted into a section of its own further down the page. Both
  // are cheap to check here and expensive to discover from a phone screen.
  const demoCatalog = JSON.parse(
    fs.readFileSync(path.join(ROOT, 'src', 'store', 'fixtures', 'demo-catalog.json'), 'utf8'),
  );
  const demoApps = demoCatalog.apps || [];
  const demoDeclared = (demoCatalog.categories || []).map((name) => String(name).trim().toLowerCase());
  const demoGuids = demoApps.map((app) => uuidForApp(app.id));
  const demoDuplicateGuid = demoGuids.find((guid, i) => demoGuids.indexOf(guid) !== i);
  check('demo catalog: every entry has a unique id, so no two apps share a GUID',
    demoApps.length > 0
      && demoApps.every((app) => String(app.id || '').trim() !== '')
      && new Set(demoGuids).size === demoGuids.length,
    demoDuplicateGuid
      ? `two entries hash to ${demoDuplicateGuid}`
      : `${demoApps.length} apps, ${new Set(demoGuids).size} distinct handles`);
  const strayApps = demoApps.filter((app) => !demoDeclared.includes(String(app.category || '').trim().toLowerCase()));
  const emptyCategories = demoDeclared.filter((name) => !demoApps.some(
    (app) => String(app.category || '').trim().toLowerCase() === name,
  ));
  check('demo catalog: every app sits in a declared category, and no declared category is empty',
    strayApps.length === 0 && emptyCategories.length === 0 && demoDeclared.length > 0,
    [strayApps.length ? `in no declared category: ${strayApps.map((a) => a.name).join(', ')}` : '',
      emptyCategories.length ? `declared but empty: ${emptyCategories.join(', ')}` : '',
      `categories=${demoDeclared.length}`].filter(Boolean).join(' | '));

  const demoSections = pageSections(demoCatalog, 25);
  const demoXml = buildStorePageFeed({
    sections: demoSections,
    selfHref: '/v9/catalog/storePages?typeId=DynamicHub.Main&cc=IT&lang=it-IT',
    title: 'DynamicHub-IT-WindowsPhone81',
    id: 'DynamicHub-IT-WindowsPhone81-ALL-ALL',
    templateName: 'DynamicHub',
    templateType: DEFAULT_TEMPLATE_TYPE,
    typeKeyForm: 'both',
  });
  check('demo catalog: one section per declared category, each holding its own apps',
    demoSections.length === demoDeclared.length
      && demoSections.every((section) => {
        const expected = demoApps.filter(
          (app) => String(app.category).trim().toLowerCase() === section.title.toLowerCase(),
        );
        return expected.length === section.items.length
          && expected.every((app) => section.items.some((item) => item.id === app.id));
      }),
    `${demoSections.length} sections, ${demoApps.length} apps`);
  // Every app has to be on the page exactly once. Counting both places it is
  // named - the link that points at it and the record that describes it - is what
  // makes a dropped or duplicated entry visible; a plain "includes" would pass for
  // an app that had been emitted twice.
  const notOnce = demoApps.filter((app) => {
    const guid = uuidForApp(app.id);
    const links = demoXml.split(`<link><type>Application</type><target>${guid}</target></link>`).length - 1;
    const records = demoXml.split(`<application><id>urn:uuid:${guid}</id>`).length - 1;
    return links !== 1 || records !== 1;
  });
  check('demo catalog: every app reaches the page exactly once',
    notOnce.length === 0,
    notOnce.length
      ? notOnce.map((app) => {
        const guid = uuidForApp(app.id);
        return `${app.name}: ${demoXml.split(guid).length - 1} mentions`;
      }).join(', ')
      : `${demoApps.length} apps, each named once as a link and once as a record`);
  check('demo catalog: the fields the builder used to overwrite are the catalog\'s own',
    demoXml.includes('<averageUserRating>7.416667</averageUserRating>')
      && demoXml.includes('<userRatingCount>48</userRatingCount>')
      && demoXml.includes('<displayPrice>1,99 €</displayPrice>')
      && demoXml.includes('<priceCurrencyCode>EUR</priceCurrencyCode>')
      && demoXml.includes('<hasLiveTile>true</hasLiveTile>'),
    [
      (demoXml.match(/<averageUserRating>([^<]*)</) || [])[1],
      (demoXml.match(/<displayPrice>([^<]*)</) || [])[1],
    ].join(' / '));
  check('demo catalog: an entry that states no rating is reported as unrated, not as a guess',
    buildApplicationListFeed({ apps: [{ id: 'no-rating', name: 'Senza Voti' }], selfHref: '/x', id: 'x' })
      .includes('<averageUserRating>0</averageUserRating><userRatingCount>0</userRatingCount>'),
    'the default is what every page carried before the field was read');

  // --- pageFormat: panes ----------------------------------------------------
  //
  // The third document: the same store page, except each pane carries its
  // section's items instead of only pointing at them. That is the arrangement of
  // the archived response, where the entry a pane refers to holds its
  // editorialItems inline - and the reason it is worth serving is that a variant
  // which asks the client to resolve a reference it has already been sent is the
  // one thing every served page so far has in common.
  //
  // What is held here is that it *adds* to the store page rather than replacing
  // it: same root, same template block, same feed underneath, same handles. So a
  // difference on the device is attributable to the items in the panes.
  const panesXmlDoc = buildStorePageFeed({
    sections: demoSections,
    selfHref: '/v9/catalog/storePages?typeId=DynamicHub.Main&cc=IT&lang=it-IT',
    title: 'DynamicHub-IT-WindowsPhone81',
    id: 'DynamicHub-IT-WindowsPhone81-ALL-ALL',
    templateName: 'DynamicHub',
    templateType: DEFAULT_TEMPLATE_TYPE,
    typeKeyForm: 'both',
    pageFormat: 'panes',
  });
  const panesHalf = panesXmlDoc.split('</Panes>')[0];
  const feedHalf = panesXmlDoc.split('</Panes>')[1] || '';
  // The panes variant is a superset of the store page, so it has to carry the same
  // grammar: an experiment that changes the document shape must not be able to
  // drop a path the client walks without this failing.
  const missingFromPanes = pathsAbsentFrom(panesXmlDoc, PAGE_PARSE_PATHS);
  check('pageFormat panes: the variant carries every path the parser walks, like the store page',
    missingFromPanes.length === 0,
    missingFromPanes.length
      ? `missing: ${missingFromPanes.map((e) => e.path).join(', ')}`
      : `${PAGE_PARSE_PATHS.filter((e) => e.required !== false).length} path(s) carried`);
  check('pageFormat panes: the document is still a well-formed store page',
    xmlProblem(panesXmlDoc) === null
      && /^<\?xml[^?]*\?><StorePage(\s[^>]*)?>/.test(panesXmlDoc)
      && panesXmlDoc.trimEnd().endsWith('</StorePage>')
      && /<Panes>[\s\S]*?<\/Panes><Templates>[\s\S]*?<\/Templates>/.test(panesXmlDoc),
    xmlProblem(panesXmlDoc) || `${panesXmlDoc.length} bytes`);
  check('pageFormat panes: every pane carries its own section\'s items, in order',
    demoSections.every((section) => {
      const pane = panesHalf.split('<Pane>').find((chunk) => chunk.includes(uuidForCollection(section.title)));
      if (!pane) return false;
      const named = (pane.match(/<title>([^<]*)<\/title>/) || [])[1];
      const sequence = [...pane.matchAll(/<sequenceNumber>(\d+)<\/sequenceNumber>/g)].map((m) => Number(m[1]));
      return named === section.title
        && sequence.length === section.items.length
        && sequence.every((position, index) => position === index + 1)
        && section.items.every((app) => pane.includes(`urn:uuid:${uuidForApp(app.id)}`));
    }),
    `${demoSections.length} panes, ${demoSections.reduce((total, s) => total + s.items.length, 0)} items`);
  // Each app is named twice in each view of its section - once as the link that
  // points at it and once as the record that describes it - so the pane's content
  // is the entry's content and not a summary of it. It also has to be in exactly
  // one pane: an app counted in two panes would be an app the device could show
  // in a section it does not belong to.
  const panesOf = (guid) => panesHalf.split('<Pane>').filter((chunk) => chunk.includes(guid)).length;
  const namings = (text2, guid) => text2.split(guid).length - 1;
  const wrong = demoApps.filter((app) => {
    const guid = uuidForApp(app.id);
    return namings(panesHalf, guid) !== 2 || namings(feedHalf, guid) !== 2 || panesOf(guid) !== 1;
  });
  check('pageFormat panes: nothing is lost or duplicated by the items in the panes',
    wrong.length === 0,
    wrong.length
      ? wrong.map((app) => {
        const guid = uuidForApp(app.id);
        return `${app.name}: ${namings(panesHalf, guid)} in the panes, ${namings(feedHalf, guid)} in the feed, ${panesOf(guid)} pane(s)`;
      }).join(', ')
      : `${demoApps.length} apps, twice in each view, each in one pane`);
  // A pane names its collection three ways - as its own id, as the collection it
  // lists, and as its link target - and the entry underneath names it as its id and
  // as its link target. All five are the same GUID: counting them is what keeps the
  // two views from drifting, because a pane pointing at a collection other than the
  // one it is, or an entry belonging to another section, changes these numbers.
  check('pageFormat panes: a pane and its entry name the same collection',
    demoSections.every((section) => {
      const collection = uuidForCollection(section.title);
      const times = (text2, needle) => text2.split(needle).length - 1;
      return times(panesHalf, collection) === 3
        && times(panesHalf, `<target>${collection}</target>`) === 1
        && times(feedHalf, collection) === 2
        && times(feedHalf, `<target>${collection}</target>`) === 1;
    }),
    'the pane\'s target is the entry\'s id, so the two views of a section cannot drift');
  check('pageFormat: an unknown value reads as the store page, not as a document nobody asked for',
    normalizePageFormat('panes') === 'panes'
      && normalizePageFormat('atom') === 'atom'
      && normalizePageFormat('') === 'storePage'
      && normalizePageFormat('Panes') === 'storePage'
      && normalizePageFormat(undefined) === 'storePage',
    `${normalizePageFormat('panes')} / ${normalizePageFormat('nonsense')}`);
  check('pageFormat storePage: the default document is unchanged, its panes still empty',
    !demoXml.split('</Panes>')[0].includes('<editorialItem>')
      && demoXml.split('<editorialItem>').length - 1 === demoApps.length,
    'the items stay in the feed unless panes is asked for');

  // The handler is a decision, not a default: a lab that has not opted in must
  // let the request through to passthrough exactly as before.
  const probeRouter = new StoreRouter({ handlers: buildHandlers(config), logger: logger.child('store') });
  const probeCtx = {
    id: 0, host: '127.0.0.1', port: 443, scheme: 'https', method: 'GET',
    path: '/v9/catalog/storePages?typeId=DynamicHub.Main', headers: {}, body: null, mitm: true, client: {},
  };
  const answeredWhenOn = await probeRouter.handle(probeCtx, { config, logger, zinc: null });
  config.livestore.protocol.enabled = false;
  const answeredWhenOff = await probeRouter.handle(probeCtx, { config, logger, zinc: null });
  config.livestore.protocol.enabled = true;
  check('store protocol: enabled it answers, disabled it falls through to passthrough',
    answeredWhenOn?.status === 200 && answeredWhenOff === null,
    `on=${answeredWhenOn?.status} off=${answeredWhenOff}`);
  check('store protocol: the option is read live, so a hot reload takes effect',
    (await probeRouter.handle(probeCtx, { config, logger, zinc: null }))?.status === 200,
    're-enabled without rebuilding the router');

  // The Live Store client's JSON API (F-029). The two field lists below are not
  // this lab's invention: they are the keys the client's own cache holds, and a
  // renamed or added key here would be a claim about a protocol nobody measured.
  const OBSERVED_ENTRY_FIELDS = ['id', 'name', 'description', 'developer', 'publisher', 'category', 'icon',
    'screenshots', 'r2_url', 'version', 'release_date', 'featured', 'status', 'architecture', 'architectures',
    'wp_platform_type', 'wp_platform_version'];
  const OBSERVED_DOCUMENT_FIELDS = ['details', 'available', 'availabilityNotice', 'updates', 'reviews',
    'averageRating', 'totalReviews', 'screenshots', 'variants', 'selectedVariantId', 'downloadCount', 'information'];
  const liveCtx = (pathname, method = 'GET') => ({
    ...probeCtx, host: 'store-api.live.net.co', method, path: pathname, headers: {},
  });

  const mitmBefore = [...config.proxy.mitm.hosts];
  config.livestore.client = { ...(config.livestore.client || {}), enabled: false };
  const liveOff = await probeRouter.handle(liveCtx('/apps'), { config, logger, zinc: null });
  config.livestore.client = {
    ...(config.livestore.client || {}),
    enabled: true,
    catalogFile: path.join(ROOT, 'src', 'store', 'fixtures', 'demo-catalog.json'),
  };
  // Enabled, but the host is not one the lab was told to intercept: the guard has
  // to refuse rather than answer, because the router sees every request that
  // reaches the lab and a bare Host header is not an instruction.
  const liveNotListed = await probeRouter.handle(liveCtx('/apps'), { config, logger, zinc: null });
  config.proxy.mitm.hosts.push('store-api.live.net.co');
  const liveApps = await probeRouter.handle(liveCtx('/apps'), { config, logger, zinc: null });
  const liveBody = JSON.parse(String(liveApps?.body || '{}'));
  check('live client: a host the lab was not told to intercept is refused, not answered',
    liveNotListed?.status === 421 && liveNotListed.headers['x-lab-source'] === 'live-client',
    `/apps on an unlisted host -> ${liveNotListed?.status}`);
  check('live client: off it falls through, on it answers the list envelope',
    liveOff === null && liveApps?.status === 200
      && Array.isArray(liveBody.categories) && Array.isArray(liveBody.apps)
      && liveApps.headers['x-lab-invented'] === '1',
    `off=${liveOff === null ? 'passthrough' : 'answered'} on=${liveApps?.status} apps=${liveBody.apps?.length}`);
  check('live client: an entry carries exactly the fields the client\'s cache carried',
    JSON.stringify(Object.keys(liveBody.apps?.[0] || {}).sort()) === JSON.stringify([...OBSERVED_ENTRY_FIELDS].sort()),
    Object.keys(liveBody.apps?.[0] || {}).join(','));
  check('live client: the ids are the numeric strings the client asks back for',
    liveBody.apps?.every((entry, index) => entry.id === String(index + 1))
      && typeof liveBody.apps?.[0]?.id === 'string',
    `first=${liveBody.apps?.[0]?.id} last=${liveBody.apps?.[liveBody.apps.length - 1]?.id}`);

  const liveDetail = await probeRouter.handle(liveCtx('/app/1'), { config, logger, zinc: null });
  const liveDetailBody = JSON.parse(String(liveDetail?.body || '{}'));
  check('live client: a detail document carries exactly the thirteen observed keys',
    liveDetail?.status === 200
      && JSON.stringify(Object.keys(liveDetailBody).sort()) === JSON.stringify([...OBSERVED_DOCUMENT_FIELDS].sort())
      && liveDetailBody.details?.id === '1'
      && typeof liveDetailBody.details?.download_count === 'string',
    Object.keys(liveDetailBody).join(','));
  check('live client: an id that is not in the catalog is a 404, not a document',
    (await probeRouter.handle(liveCtx('/app/9999'), { config, logger, zinc: null }))?.status === 404,
    'unknown id');

  const liveSearch = await probeRouter.handle(liveCtx('/apps/search?q='), { config, logger, zinc: null });
  const firstName = String(liveBody.apps?.[0]?.name || '').split(' ')[0];
  // The comparison is case-insensitive because the filter is: the first check of
  // this ran with `Corte` against text holding `scorte` and failed on the harness
  // rather than on the handler, which is the kind of failure a check should not be
  // able to report. The haystack is the same four fields the handler searches.
  const found = await probeRouter.handle(
    liveCtx(`/apps/search?q=${encodeURIComponent(firstName)}`), { config, logger, zinc: null },
  );
  const foundBody = JSON.parse(String(found?.body || '{}'));
  const nothing = await probeRouter.handle(
    liveCtx('/apps/search?q=zzzznosuchapp'), { config, logger, zinc: null },
  );
  const nothingBody = JSON.parse(String(nothing?.body || '{}'));
  check('live client: search needs a term, with one it filters, with none it finds nothing',
    liveSearch?.status === 400
      && found?.status === 200 && foundBody.apps?.length >= 1 && foundBody.apps.length < liveBody.apps.length
      && foundBody.apps.every((entry) => `${entry.name} ${entry.description} ${entry.category} ${entry.developer}`
        .toLowerCase().includes(firstName.toLowerCase()))
      && nothingBody.apps?.length === 0,
    `q='' -> ${liveSearch?.status}, q=${firstName} -> ${foundBody.apps?.length}/${liveBody.apps.length}, q=zzzz -> ${nothingBody.apps?.length}`);

  const liveGames = await probeRouter.handle(liveCtx('/games'), { config, logger, zinc: null });
  const liveGamesBody = JSON.parse(String(liveGames?.body || '{}'));
  check('live client: games is answered as an empty list and says why',
    liveGames?.status === 200 && Array.isArray(liveGamesBody.games) && liveGamesBody.games.length === 0
      && liveGames.headers['x-lab-note'] === 'the catalog this lab serves carries no games',
    `${liveGamesBody.games?.length} games, note=${liveGames.headers['x-lab-note'] ? 'yes' : 'no'}`);
  check('live client: the account record is refused rather than invented',
    (await probeRouter.handle(liveCtx('/me'), { config, logger, zinc: null }))?.status === 401,
    '/me -> 401');
  check('live client: a method the API does not define is a 405, not a passthrough',
    (await probeRouter.handle(liveCtx('/apps', 'POST'), { config, logger, zinc: null }))?.status === 405,
    'POST /apps -> 405');
  // The image CDN (F-031). The check that matters is the bytes: the handler exists
  // to replace an injected 502 with a picture, so a body that is not a decodable PNG
  // would be the same failure wearing a 200.
  config.livestore.images = { ...(config.livestore.images || {}), enabled: false };
  const imageOff = await probeRouter.handle(
    { ...probeCtx, host: 'cdn.marketplaceimages.windowsphone.com', path: '/v8/images/0b8d13d3-d5f8-51ed-8e05-94abb0e42539?imagetype=icon_small' },
    { config, logger, zinc: null },
  );
  config.livestore.images = { ...(config.livestore.images || {}), enabled: true };
  const imageUnlisted = await probeRouter.handle(
    { ...probeCtx, host: 'cdn.marketplaceimages.windowsphone.com', path: '/v8/images/0b8d13d3-d5f8-51ed-8e05-94abb0e42539?imagetype=icon_small' },
    { config, logger, zinc: null },
  );
  config.proxy.mitm.hosts.push('cdn.marketplaceimages.windowsphone.com');
  const imageOn = await probeRouter.handle(
    { ...probeCtx, host: 'cdn.marketplaceimages.windowsphone.com', path: '/v8/images/0b8d13d3-d5f8-51ed-8e05-94abb0e42539?imagetype=icon_small' },
    { config, logger, zinc: null },
  );
  const png = imageOn?.body || Buffer.alloc(0);
  const pngOk = png.length > 60
    && png.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
    && png.subarray(12, 16).toString('latin1') === 'IHDR'
    && png.subarray(png.length - 8, png.length - 4).toString('latin1') === 'IEND'
    && imageOn.headers['content-length'] === String(png.length);
  check('images: off the request falls through, on it is a PNG, and an unlisted host is refused',
    imageOff === null && imageUnlisted?.status === 421 && imageOn?.status === 200 && pngOk
      && imageOn.headers['content-type'] === 'image/png' && imageOn.headers['x-lab-invented'] === '1',
    `off=${imageOff === null ? 'passthrough' : 'answered'} unlisted=${imageUnlisted?.status} on=${imageOn?.status} ${png.length}B png=${pngOk}`);
  check('images: the same bytes for every guid and every imagetype',
    (await probeRouter.handle(
      { ...probeCtx, host: 'cdn.marketplaceimages.windowsphone.com', path: '/v8/images/another-guid?imagetype=background' },
      { config, logger, zinc: null },
    ))?.body.equals(png),
    'one placeholder, not a per-guid invention');

  // The placeholder used to be a flat square of #2E355C, and that made its one
  // observation unreadable: a client painting the bitmap and a client painting its
  // own empty-image background produce the same coloured slot. What the bytes have
  // to carry is a mark no background can be - so the test decodes the PNG it just
  // served (filter 0 for every row, so the pixels are literal) and asks whether the
  // pixels differ from each other. A flat field fails here, which is the point.
  const idat = (() => {
    const parts = [];
    for (let off = 8; off + 8 <= png.length;) {
      const length = png.readUInt32BE(off);
      const type = png.subarray(off + 4, off + 8).toString('latin1');
      if (type === 'IDAT') parts.push(png.subarray(off + 8, off + 8 + length));
      off += 12 + length;
    }
    return Buffer.concat(parts);
  })();
  let pixels = null;
  try {
    pixels = zlib.inflateSync(idat);
  } catch (err) {
    pixels = null;
  }
  const width = png.length > 24 ? png.readUInt32BE(16) : 0;
  const height = png.length > 24 ? png.readUInt32BE(20) : 0;
  const stride = width * 4 + 1;
  const pixelAt = (x, y) => (pixels && pixels.length === stride * height && pixels[y * stride] === 0
    ? [...pixels.subarray(y * stride + 1 + x * 4, y * stride + 1 + x * 4 + 4)].join(',')
    : null);
  const colours = pixels && pixels.length === stride * height
    ? new Set(Array.from({ length: width * height }, (_, i) => pixelAt(i % width, Math.floor(i / width))))
    : new Set();
  const centre = pixelAt(width >> 1, height >> 1);
  const corner = pixelAt(0, 0);
  check('images: the placeholder carries a mark, so a drawn bitmap is not a painted slot',
    width === 48 && height === 48 && colours.size >= 2 && Boolean(centre) && centre !== corner
      && pixels.length === stride * height,
    `${width}x${height}, ${colours.size} colour(s), centre=${centre} corner=${corner}`);
  config.livestore.images.enabled = false;

  config.livestore.client.enabled = false;
  config.proxy.mitm.hosts = mitmBefore;

  // Every pane's source URL, read back out of the page the *demo* catalog produces
  // and fetched through the router exactly as the client fetches what a pane points
  // at. The demo catalog is the one `config.json` runs, so a section whose URL
  // answered with another section's apps - or with nothing - would be a screen with
  // a wrong list or an empty one, and every other check in this file would still
  // pass. The router is driven directly here rather than through the proxy, because
  // the exchanges are already counted further down and these are eight more.
  const demoCatalogFile = config.livestore.protocol.catalogFile;
  config.livestore.protocol.catalogFile = path.join(ROOT, 'src', 'store', 'fixtures', 'demo-catalog.json');
  const demoPage = await probeRouter.handle(
    { ...probeCtx, path: '/v9/catalog/storePages?typeId=DynamicHub.Main&cc=IT&lang=it-IT' },
    { config, logger, zinc: null },
  );
  const paneUrls = [...String(demoPage?.body || '')
    .matchAll(/<DataSource><Type>Applications<\/Type><Url>([^<]+)<\/Url><\/DataSource>/g)]
    .map((m) => new URL(m[1].replace(/&amp;/g, '&')));
  const filled = [];
  for (const url of paneUrls) {
    const response = await probeRouter.handle(
      { ...probeCtx, host: url.host, path: `${url.pathname}${url.search}` },
      { config, logger, zinc: null },
    );
    const body = String(response?.body || '');
    const section = demoSections.find((s) => s.title === url.searchParams.get('category'));
    filled.push(Boolean(section)
      && response?.headers['x-lab-apps'] === String(section.items.length)
      && response?.headers['x-lab-category'] === section.title.toLowerCase()
      && section.items.every((app) => body.includes(`urn:uuid:${uuidForApp(app.id)}`)));
  }
  config.livestore.protocol.catalogFile = demoCatalogFile;
  check('store protocol: every pane the demo page names answers with that section',
    paneUrls.length === demoSections.length && filled.length > 0 && filled.every(Boolean),
    `${filled.filter(Boolean).length}/${paneUrls.length} source(s) answered for ${demoSections.length} section(s)`);

  // The frame, checked against the client's own parser rather than against a
  // snapshot: `page-diff` reports which of PAGE_PARSE_PATHS the served page
  // carries, and this is the same reading asserted as an invariant. A page that
  // stops carrying a construct the parser names would still be well formed, still
  // 200, still pass every other check - and would be the failure that has cost the
  // most runs, so it is the one worth pinning. Spelling is not asserted: twelve of
  // the paths travel under the atom prefix, exactly as the real service shipped
  // them, and which spelling the client accepts is the device's answer.
  const pageFrame = collect(String(demoPage?.body || ''));
  const frameRows = PAGE_PARSE_PATHS
    .filter((entry) => entry.required !== false)
    .map((entry) => ({ entry, result: coverage(pageFrame, entry) }));
  const frameMissing = frameRows.filter((row) => verdictOf(row.result) === 'missing');
  const paneFields = pathsUnder(findFirst(pageFrame, 'Pane'));
  // A pane without a source is the shape F-005 recorded as a client that cannot
  // fetch; while the data source is armed, the source is part of the invariant.
  const paneEssentials = ['/Id', '/Title', '/CollectionId',
    ...(config.livestore.protocol.dataSource ? ['/DataSource/Type', '/DataSource/Url'] : [])]
    .filter((field) => !paneFields.has(field.split('/').filter(Boolean).join('/')));
  check('store protocol: the page carries every path the parser names, and its pane can be fetched',
    frameMissing.length === 0 && paneEssentials.length === 0,
    `${frameRows.length - frameMissing.length}/${frameRows.length} parser path(s) present`
      + (frameMissing.length ? `, missing ${frameMissing.map((row) => row.entry.path).join(' ')}` : '')
      + (paneEssentials.length ? `, pane lacks ${paneEssentials.join(' ')}` : ', pane has its id, title, source and collection'));

  // The update check, routed the way the proxy routes it.
  //
  // This check exists because its absence cost a deployment rehearsal: the first
  // version of the updates branch read `headers` before it was declared, which
  // threw, which the router contains by falling through to passthrough - so the
  // device got a 502 and the only thing that noticed was `npm run rehearse`,
  // against the running lab. Asserting the branch builds its own response, rather
  // than only that the builder produces the right XML, is what would have caught
  // it here.
  const updatesCtx = {
    ...probeCtx,
    method: 'POST',
    path: '/v8/catalog/updates?os=8.10.14219.0&cc=IT&lang=it-IT',
    body: Buffer.from('<?xml version="1.0" encoding="UTF-8"?>'
      + '<BatchGetProductUpdatesRequest xmlns="http://schemas.zune.net/catalog/apps/2008/02">'
      + '<Resources><Resource><InputSkuId>1076f542-8a6f-4cda-86e2-012bb248c9ef</InputSkuId>'
      + '<InputLicenseRight>Purchase</InputLicenseRight></Resource></Resources>'
      + '</BatchGetProductUpdatesRequest>', 'utf8'),
  };
  const updatesRouted = await probeRouter.handle(updatesCtx, { config, logger, zinc: null });
  check('store protocol: the update check is routed, not fallen through',
    updatesRouted?.status === 200
      && updatesRouted.decision === 'store:store-protocol'
      && updatesRouted.body.toString('utf8').includes('<ProductId>1076f542-8a6f-4cda-86e2-012bb248c9ef</ProductId>'),
    `status=${updatesRouted?.status} decision=${updatesRouted?.decision} skus=${updatesRouted?.headers?.['x-lab-skus']}`);
  const updatesAsGet = await probeRouter.handle(
    { ...updatesCtx, method: 'GET' }, { config, logger, zinc: null },
  );
  check('store protocol: the update check refuses a method it does not define',
    updatesAsGet?.status === 405,
    `status=${updatesAsGet?.status} hint=${updatesAsGet?.headers ? '' : ''}${JSON.parse(updatesAsGet?.body?.toString('utf8') || '{}').hint || ''}`);

  // The configuration endpoint, added 2026-10-17. The two requests it answers are
  // the ones the phone makes *before* it asks for a page, and until now the lab had
  // no route for them: the host is hijacked, so the relay resolved the name back to
  // this process and answered 502 upstream_loop. These checks exist because that
  // failure was invisible from the PC side - the lab looked healthy while the one
  // request on the client's critical path was being dropped.
  // The host stays `127.0.0.1` like the rest of these probes: it is the one address
  // this test config intercepts (`proxy.mitm.hosts`), and the routing decision does
  // not depend on which intercepted host the request arrived through.
  const configCtx = {
    ...probeCtx,
    scheme: 'http',
    port: 80,
    path: '/v8/Configuration/Stores/OEMStores/NOKIA?mpcVersion=8.10&os=8.10.14219.0&cc=IT&lang=it-IT',
  };
  const oemConfig = await probeRouter.handle(configCtx, { config, logger, zinc: null });
  const moConfig = await probeRouter.handle(
    { ...configCtx, path: '/v8/Configuration/Stores/MOStores/?mpcVersion=8.10&os=8.10.14219.0&cc=IT&lang=it-IT' },
    { config, logger, zinc: null },
  );
  const oemText = String(oemConfig?.body || '');
  const moText = String(moConfig?.body || '');
  check('store protocol: the configuration endpoint is routed, not fallen through',
    oemConfig?.status === 200
      && oemConfig.decision === 'store:store-protocol'
      && oemConfig.headers['x-lab-protocol'] === 'configuration'
      && xmlProblem(oemText) === null,
    `status=${oemConfig?.status} decision=${oemConfig?.decision} bytes=${oemConfig?.body?.length}`);
  // The document's frame is no longer this lab's invention: it is the
  // `ConfigurationFile` / `Domains` / `Domain id="PROD"` / `<setting id=...>`
  // grammar the client's own shipped file uses, and the settings are the
  // `WPAppsMarketplace*` names that file and the DLL's pool spell. The check
  // asserts the grammar as well as the two store identities, because a body that
  // drifts back to an invented root would otherwise still look like an answer.
  check('store protocol: the configuration answer uses the client\'s ConfigurationFile grammar',
    /^<\?xml[^>]*\?><ConfigurationFile version="81000" forceupdate="0"><Domains><Domain id="PROD">/.test(oemText)
      && oemText.trimEnd().endsWith('</Domain></Domains></ConfigurationFile>')
      && !/<StoreConfiguration/.test(oemText),
    `bytes=${oemConfig?.body?.length} tail=${oemText.slice(-46)}`);
  check('store protocol: each configuration store answers as itself',
    oemText.includes('<setting id="OEMStoreID">NOKIA</setting>')
      && !moText.includes('OEMStoreID')
      && !/MOStoreID/.test(oemText),
    `oem=${oemConfig?.headers?.['x-lab-configuration-store']} mo=${moConfig?.headers?.['x-lab-configuration-store']}`);
  // A CDN base written as `cdn.<address>` is a name no resolver can answer, and the
  // client would be handed a URL it can never fetch - the classic way this reply
  // looks right and disables images.
  check('store protocol: the configuration answer sends the client back to this lab',
    /<setting id="WPAppsMarketplaceShopSecure" nexus="WPAppsMarketplaceShopSecure">https:\/\/127\.0\.0\.1\/<\/setting>/.test(oemText)
      && /<setting id="WPAppsMarketplaceShopCdn"[^>]*>http:\/\/cdn\.marketplaceedgeservice\.windowsphone\.com\//.test(oemText)
      && /<setting id="WPAppsMarketplaceImageService"[^>]*>http:\/\/cdn\.marketplaceimages\.windowsphone\.com\//.test(oemText)
      && !/cdn\.127\.0\.0\.1/.test(oemText),
    oemText.split('<setting').find((line) => line.startsWith(' id="WPAppsMarketplaceShopSecure"')) || 'missing');
  // The values are still this lab's answers for a service that no longer exists,
  // and the capture has to say so: no archived or on-device capture of this
  // endpoint exists, so a reader who took the body for ground truth would be
  // reading a claim nobody made. What the header must *not* claim any more is that
  // the element names are invented - that stopped being true.
  check('store protocol: the configuration answer declares its values inferred',
    oemConfig?.headers['x-lab-invented'] === '1'
      && /frame from the device/.test(String(oemConfig?.headers['x-lab-configuration-evidence'])),
    `invented=${oemConfig?.headers['x-lab-invented']} evidence=${oemConfig?.headers['x-lab-configuration-evidence']}`);

  config.livestore.protocol.configuration = { enabled: false };
  const configOff = await probeRouter.handle(configCtx, { config, logger, zinc: null });
  config.livestore.protocol.configuration = { enabled: true };
  check('store protocol: the configuration endpoint is off unless it is armed',
    configOff === null,
    `off=${configOff === null ? 'falls through to passthrough' : `answered ${configOff?.status}`}`);

  // The negative control. This is the one variable no page experiment has moved:
  // six documents, all plausible, none broken. The check asserts the served body
  // is genuinely unparseable *and* that the response is labelled, because a
  // control that quietly became a normal delivery would turn the device's usual
  // silence into a result.
  config.livestore.protocol.serve = 'control-broken';
  const controlled = await probeRouter.handle(probeCtx, { config, logger, zinc: null });
  const controlledText = String(controlled?.body || '');
  check('store protocol: control mode serves a body no parser can accept',
    controlled?.status === 200
      && controlled.headers['x-lab-control'] === 'malformed'
      && controlled.headers['x-lab-protocol'] === 'storePages:control'
      && xmlProblem(controlledText) !== null
      && !controlledText.trimEnd().endsWith('>')
      && controlled.headers['content-length'] === String(Buffer.byteLength(controlledText)),
    `status=${controlled?.status} label=${controlled?.headers['x-lab-control']} bytes=${controlled?.body?.length}`);

  config.livestore.protocol.controlFile = config.livestore.protocol.archiveFile;
  const repairedControl = await probeRouter.handle(probeCtx, { config, logger, zinc: null });
  config.livestore.protocol.controlFile = 'src/store/fixtures/control/broken-page.xml';
  config.livestore.protocol.serve = 'generated';
  check('store protocol: a repaired control file is refused instead of served',
    repairedControl?.status === 502
      && JSON.parse(String(repairedControl?.body || '{}')).error === 'control_unavailable',
    `status=${repairedControl?.status}`);

  // The mutation probe. E-008 showed the client answers differently to documents
  // it can and cannot accept, so the page it *does* accept can be turned into a
  // question: rename one element and see whether the verdict moves. What is
  // asserted here is that the delivered body is the accepted page with exactly one
  // name changed - not that the device reacts, which no PC-side check can say.
  const baselinePage = await probeRouter.handle(probeCtx, { config, logger, zinc: null });
  const baselineText = String(baselinePage?.body || '');
  config.livestore.protocol.serve = 'mutant';
  config.livestore.protocol.mutant = 'panes-renamed';
  const mutatedPage = await probeRouter.handle(probeCtx, { config, logger, zinc: null });
  const mutatedText = String(mutatedPage?.body || '');
  const expectedMutant = baselineText.split('<Panes>').join('<PanesX>').split('</Panes>').join('</PanesX>');
  config.livestore.protocol.mutant = 'no-such-mutation';
  const unknownMutant = await probeRouter.handle(probeCtx, { config, logger, zinc: null });
  config.livestore.protocol.serve = 'generated';
  config.livestore.protocol.mutant = '';
  check('store protocol: mutant mode serves the accepted page with exactly one construct renamed',
    mutatedPage?.status === 200
      && mutatedPage.headers['x-lab-protocol'] === 'storePages:mutant'
      && mutatedPage.headers['x-lab-mutant'] === 'panes-renamed'
      && mutatedText === expectedMutant
      && mutatedText !== baselineText
      && mutatedText.includes('<PanesX>')
      && !mutatedText.includes('<Panes>')
      && xmlProblem(mutatedText) === null
      && mutatedPage.headers['content-length'] === String(Buffer.byteLength(mutatedText)),
    `status=${mutatedPage?.status} label=${mutatedPage?.headers['x-lab-mutant']} bytes=${mutatedPage?.body?.length} baseline=${baselineText.length}`);
  check('store protocol: an unknown mutant is refused, never served as an ordinary page',
    unknownMutant?.status === 502
      && JSON.parse(String(unknownMutant?.body || '{}')).error === 'unknown_mutant',
    `status=${unknownMutant?.status}`);
  check('store protocol: a mutation whose element is absent is refused',
    applyPageMutation('datasource-renamed', '<StorePage></StorePage>')?.error === 'mutant_unavailable'
      && applyPageMutation('panes-renamed', '<StorePage><Panes></Panes></StorePage>')?.xml
        === '<StorePage><PanesX></PanesX></StorePage>',
    `absent=${applyPageMutation('datasource-renamed', '<StorePage></StorePage>')?.error}`);

  // The counter-proof, checked for what it is: with serve='archive' the page
  // endpoint answers with a response of the real service byte for byte, and every
  // other endpoint is untouched by it. It is NOT a one-variable substitution, and
  // the check below asserts the headers that say so - the archived page is the
  // games hub of an older generation, so it carries a template name (`GamesHub`)
  // that belongs to the Xbox Games hub app and a type key this grammar does not
  // have. Both are reported in the headers, so a later reading of the capture
  // finds the confound instead of inferring it.
  config.livestore.protocol.serve = 'archive';
  const archived = await probeRouter.handle(probeCtx, { config, logger, zinc: null });
  const archivedFile = fs.readFileSync(
    path.resolve(config.livestore.protocol.archiveFile), 'utf8',
  );
  const otherEndpoint = await probeRouter.handle(
    { ...probeCtx, path: '/v9/catalog/apps' }, { config, logger, zinc: null },
  );
  config.livestore.protocol.serve = 'generated';
  check('store protocol: archive mode serves the real archived response byte for byte',
    archived?.status === 200
      && archived.headers['x-lab-protocol'] === 'storePages:archive'
      && archived.body.toString('utf8') === archivedFile
      && xmlProblem(archived.body.toString('utf8')) === null
      && archivedFile.includes('<templateName>GamesHub</templateName>'),
    `bytes=${archived?.body?.length} expected=${Buffer.byteLength(archivedFile)} label=${archived?.headers['x-lab-protocol']}`);
  check('store protocol: archive mode declares the page it actually carries, and warns',
    archived.headers['x-lab-archive-template'] === 'GamesHub'
      && /games/.test(String(archived.headers['x-lab-archive-page']))
      && /not a one-variable substitution/.test(String(archived.headers['x-lab-archive-warning']))
      && whyNotATemplate(archived.headers['x-lab-archive-template']) !== null,
    `template=${archived.headers['x-lab-archive-template']} page=${archived.headers['x-lab-archive-page']}`);
  check('store protocol: a generated page is labelled with the vocabulary it was built from',
    (await probeRouter.handle(probeCtx, { config, logger, zinc: null }))?.headers['x-lab-template-type'] === String(config.livestore.protocol.templateType),
    `type=${(await probeRouter.handle(probeCtx, { config, logger, zinc: null }))?.headers['x-lab-template-type']}`);
  check('store protocol: archive mode leaves the other endpoints alone',
    otherEndpoint?.headers['x-lab-protocol'] === 'appList'
      && !otherEndpoint.body.toString('utf8').includes('GamesHub')
      && fixtureApps.every((app) => otherEndpoint.body.toString('utf8').includes(`urn:uuid:${uuidForApp(app.id)}`)),
    `label=${otherEndpoint?.headers['x-lab-protocol']}`);

  // The same shape read through the router, not from the builder: the header is
  // where a value that reached the builder and never reached the wire was caught
  // once before, and this is the only place the two can disagree.
  const servedList = otherEndpoint.body.toString('utf8');
  check('store protocol: the served application list carries the archived entry shape, and says so',
    otherEndpoint.headers['x-lab-applist-rank'] === String(config.livestore.protocol.appListRank)
      && otherEndpoint.headers['x-lab-applist-entry-title'] === 'no'
      && servedList.split('</impressionId><k>').length - 1 === fixtureApps.length
      && servedList.includes('<k>4</k>'),
    `rank=${otherEndpoint.headers['x-lab-applist-rank']} entryTitle=${otherEndpoint.headers['x-lab-applist-entry-title']} k=${servedList.split('<k>').length - 1}`);

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

    // --- the request the device's Store opens with ------------------------
    // Verbatim from the Lumia's capture, headers and query intact: this is what
    // decided whether the Store opened, and it came back 502 because nothing was
    // there to answer it.
    const storeQuery = '/v9/catalog/storePages?typeId=DynamicHub.Main&os=8.10.14219.0&cc=IT&lang=it-IT'
      + '&hw=402699266&dm=RM-941_eu_france_308&oemId=NOKIA&moId=&cf=&Flight=&SEG0=&SEG1=&SEG2=&SEG3=&SEG4=&SEG5=&optedOut=true';
    // The page cookie is the only header the client reads back from a response
    // (`WPSHeaderHandler::GetStorePageCookie`, @47028). It is set on the live config
    // object here - so the next page request carries it - and cleared lower down, so
    // that both halves are asserted without adding an exchange to the capture, which
    // the checks below count.
    config.livestore.protocol.pageCookie = 'selftest-cookie-value';
    const home = await httpsViaProxy({ ...target, requestPath: storeQuery, method: 'GET' });
    check('store protocol: the Store home page is served as the XML the phone reads',
      home.status === 200
        && home.headers['content-type'] === 'application/atom+xml; charset=utf-8'
        && home.headers['x-lab-protocol'] === 'storePages'
        && xmlProblem(home.body) === null,
      `status=${home.status} type=${home.headers['content-type']} ${xmlProblem(home.body) || ''}`);
    check('store protocol: the query is echoed escaped, not raw',
      home.body.includes('&amp;hw=402699266&amp;dm=RM-941_eu_france_308')
        && !home.body.includes('&hw=402699266')
        && !home.body.includes('&dm=RM-941'),
      'a raw & in the self link would make the whole page unparseable');

    check('store protocol: the page cookie reaches the device when one is configured',
      home.headers['x-wp-storepage-cookie'] === 'selftest-cookie-value',
      `cookie=${home.headers['x-wp-storepage-cookie']}`);
    config.livestore.protocol.pageCookie = '';

    // The pane type, on the page the proxy serves rather than on a page this file
    // built: a value that reaches the builder and not the wire has happened here
    // before, and the header is what makes the served document readable from the PC.
    check('store protocol: the type every pane is given is on the served page and reported in its headers',
      home.headers['x-lab-pane-type'] === 'Collection'
        && home.body.split('<Type>Collection</Type>').length - 1 === sections.length,
      `x-lab-pane-type=${home.headers['x-lab-pane-type']}`
        + ` panes=${home.body.split('<Type>Collection</Type>').length - 1}/${sections.length}`);

    // A pane with no data source is a pane the client downloads nothing for: the
    // binary reads /DataSource/Type and /DataSource/Url per pane and fetches the
    // content from there (@46528, next to /StorePage, /feed, /entry). So the page
    // and the URL it hands out are asserted as one thing - read the source back out
    // of the served page, fetch it exactly as the device would, and require the
    // section the page promised.
    const sourceMatch = /<DataSource><Type>([^<]+)<\/Type><Url>([^<]+)<\/Url><\/DataSource>/.exec(home.body);
    const sourceUrl = sourceMatch ? new URL(sourceMatch[2].replace(/&amp;/g, '&')) : null;
    check('store protocol: a pane names the source its content is downloaded from',
      Boolean(sourceUrl)
        && sourceUrl.host === target.targetHost
        && sourceUrl.searchParams.get('category') === sections[0].title
        && home.headers['x-lab-pane-sources'] === 'Applications',
      sourceUrl ? `${sourceMatch[1]} -> ${sourceUrl.pathname}${sourceUrl.search}` : 'no data source in the page');
    const sourceFeed = sourceUrl
      ? await httpsViaProxy({ ...target, requestPath: `${sourceUrl.pathname}${sourceUrl.search}`, method: 'GET' })
      : { status: 0, headers: {}, body: '' };
    check('store protocol: the source URL answers with that pane\'s own section',
      sourceFeed.status === 200
        && sourceFeed.headers['x-lab-apps'] === String(sections[0].items.length)
        && sourceFeed.headers['x-lab-category'] === sections[0].title.toLowerCase()
        && sections[0].items.every((app) => sourceFeed.body.includes(`urn:uuid:${uuidForApp(app.id)}`)),
      `status=${sourceFeed.status} apps=${sourceFeed.headers['x-lab-apps']}/${sections[0].items.length}`
        + ` category=${sourceFeed.headers['x-lab-category']}`);

    const appList = await httpsViaProxy({ ...target, requestPath: '/v9/catalog/apps?chunkSize=50', method: 'GET' });
    check('store protocol: the application list answers with the catalog',
      appList.status === 200 && appList.headers['x-lab-apps'] === String(fixtureApps.length)
        && xmlProblem(appList.body) === null
        && fixtureApps.every((app) => appList.body.includes(`urn:uuid:${uuidForApp(app.id)}`)),
      `status=${appList.status} apps=${appList.headers['x-lab-apps']}`);

    const detail = await httpsViaProxy({
      ...target, requestPath: `/v9/catalog/apps/${uuidForApp(fixtureApps[0].id)}`, method: 'GET',
    });
    check('store protocol: the GUID the page handed out resolves to that entry',
      detail.status === 200 && detail.body.includes(fixtureApps[0].name),
      `status=${detail.status} name=${fixtureApps[0].name}`);

    const unknown = await httpsViaProxy({
      ...target, requestPath: '/v9/catalog/apps/00000000-0000-4000-8000-000000000000', method: 'GET',
    });
    let unknownJson = null;
    try { unknownJson = JSON.parse(unknown.body); } catch { unknownJson = null; }
    check('store protocol: a GUID the lab never minted is refused, not relayed',
      unknown.status === 404 && unknownJson?.error === 'app_not_found',
      `status=${unknown.status} error=${unknownJson?.error}`);

    const hub = await httpsViaProxy({ ...target, requestPath: '/v8/catalog/hubs?hub=lifestyle&cc=IT', method: 'GET' });
    check('store protocol: a hub page is answered too',
      hub.status === 200 && xmlProblem(hub.body) === null
        && hub.body.includes('lifestyle-IT-WindowsPhone81-ALL-ALL'),
      `status=${hub.status}`);
    // The other half of the cookie, on a page request the suite already makes: an
    // empty setting must leave the header off rather than minting a token.
    check('store protocol: an empty page cookie is not invented',
      hub.headers['x-wp-storepage-cookie'] === undefined,
      `cookie=${hub.headers['x-wp-storepage-cookie']}`);

    const postPage = await httpsViaProxy({ ...target, requestPath: '/v9/catalog/storePages', method: 'POST' });
    check('store protocol: a non-GET is refused rather than answered',
      postPage.status === 405, `status=${postPage.status}`);

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
    // 4 rule cases + 1 plain-HTTP case + 1 direct-TLS case + 5 store-handler
    // cases + 6 store-protocol cases + 1 fetched pane source.
    check('capture: every intercepted exchange was indexed',
      indexLines.length === 18,
      `entries=${indexLines.length} decisions=${JSON.stringify(decisions)}`);
    check('capture: decisions are labelled per rule',
      decisions.some((d) => d === 'passthrough:passthrough-endpoint')
        && decisions.includes('mock:mocked-endpoint')
        && decisions.includes('rewrite:patched-endpoint')
        && decisions.includes('block:blocked-endpoint'),
      JSON.stringify(decisions));
    check('store: handler decisions are labelled with the handler name',
      decisions.includes('store:store-health') && decisions.includes('store:catalog-bridge')
        // Six page/feed requests plus the pane source the page itself named, which
        // the suite fetched back through the proxy the way the device would.
        && decisions.filter((d) => d === 'store:store-protocol').length === 7,
      JSON.stringify(decisions.filter((d) => d.startsWith('store:'))));
    const firstCapture = indexLines[0];
    check('capture: request and response bodies are stored',
      firstCapture.request.method === 'GET' && Boolean(firstCapture.response)
        && firstCapture.response.status === 200,
      JSON.stringify({ method: firstCapture.request?.method, status: firstCapture.response?.status }));

    // --- reading an index too big to be one string -------------------------
    // A long session's index passes Node's maximum string length, where
    // `readFileSync(..., 'utf8')` throws. Every reader that caught that reported
    // **zero exchanges** - the session's own record of what the device did, read
    // as "nothing intercepted yet". The size cannot be reproduced cheaply here,
    // so what is asserted is the reader's contract: every non-blank line, one at a
    // time, including a final line without a trailing newline (a torn line is
    // handed over and the *parser* skips it, which is what `analyze` does).
    const jsonlPath = path.join(WORK, 'reader.jsonl');
    await fsp.writeFile(jsonlPath, '{"n":1}\n\n{"n":2}\n{"n":3');
    const readBack = [];
    for await (const line of readJsonl(jsonlPath)) readBack.push(line);
    check('capture: the index reader streams lines, blank ones ignored, without a trailing newline',
      readBack.length === 3 && readBack[0] === '{"n":1}' && readBack[1] === '{"n":2}'
        && readBack[2] === '{"n":3',
      JSON.stringify(readBack));
    let counted = null;
    try { counted = await countJsonl(jsonlPath); } catch (err) { counted = `threw ${err.message}`; }
    check('capture: the index is counted without ever holding it in memory',
      counted === 3,
      `counted=${counted} (the same three lines doctor and rehearse would report)`);

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

    // --- forwarding upstream to the lab itself ----------------------------
    // The device is told to use the lab as its DNS, but the operator's PC can be
    // pointed at the lab too - and then a hijacked name resolves, on this PC, to
    // one of our own listeners. Relaying "upstream" then dials the lab again and
    // each hop waits on the hop below it: nothing is ever answered, the capture
    // log fills with the lab's own traffic, and it reads exactly like a device
    // that never arrived. The relay has to refuse instead, and refuse at once.
    const startedLoop = Date.now();
    const looped = await new Promise((resolve) => {
      const req = http.request({
        host: '127.0.0.1', port: PLAIN_HTTP_PORT, path: '/v2/apps?store=1', method: 'GET',
        // `localhost` is the smallest real case: it resolves to this machine, on
        // a port this lab is itself listening on.
        headers: { host: `localhost:${PLAIN_HTTP_PORT}` },
      }, (res) => {
        let body = '';
        res.on('data', (c) => { body += c; });
        res.on('end', () => resolve({ status: res.statusCode, body, ms: Date.now() - startedLoop }));
      });
      req.on('error', (err) => resolve({ error: err.message }));
      req.end();
    });
    let loopJson = null;
    try { loopJson = JSON.parse(looped.body); } catch { loopJson = null; }
    check('proxy: forwarding upstream to the lab itself is refused, not dialled',
      looped.status === 502 && loopJson?.error === 'upstream_loop'
        && proxy.stats.upstreamLoops === 1,
      looped.error || `status=${looped.status} error=${loopJson?.error || String(looped.body).slice(0, 60)}`
        + ` loops=${proxy.stats.upstreamLoops}`);
    // A refusal that still costs a full upstream timeout is not a fix: the point
    // is that the operator sees the loop immediately instead of a lab that looks
    // merely slow while it talks to itself.
    check('proxy: the loop is refused without waiting for the upstream timeout',
      looped.ms < 2000,
      `took ${looped.ms}ms, upstream timeout is ${config.upstream.timeoutMs}ms`);

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

    // --- the sequence report -------------------------------------------------
    // The two open experiments are read by *order*, not by count: did the
    // configuration stop retrying, did the page arrive, and did anything follow it.
    // `npm run analyze` answers the census question and cannot answer that one, and
    // reading the index by eye is how E-001's verdict sat unread for hours.
    const exchange = (ts, address, urlPath, status, host = 'marketplaceedgeservice.windowsphone.com') => ({
      ts,
      client: { address, port: 1 },
      request: {
        method: 'GET',
        host,
        path: `${urlPath}?os=8.10.14219.0&hw=402699266&dm=RM-941_eu_france_308`,
        headers: {},
      },
      response: { status },
      decision: status === 200 ? 'store:store-protocol' : 'passthrough',
    });
    const refused = sequence.summarize([
      ...[0, 1, 2, 3].map((i) => exchange(`2026-10-16T06:20:2${i}.000Z`, '192.168.0.137', '/v8/Configuration/Stores/OEMStores/NOKIA', 502)),
      ...[0, 1, 2, 3].map((i) => exchange(`2026-10-16T06:20:24.6${i}0Z`, '192.168.0.137', '/v8/Configuration/Stores/MOStores/', 502)),
    ]);
    check('sequence: a Store open that stops at configuration is read as exactly that',
      refused.configuration.total === 8
        && refused.configuration.byStore.OEM === 4
        && refused.configuration.byStore.MO === 4
        && refused.configuration.retries === 6
        && refused.page.count === 0
        && refused.afterFirstPage.length === 0,
      `config=${refused.configuration.total} (${refused.configuration.byStore.OEM}/${refused.configuration.byStore.MO}) retries=${refused.configuration.retries} pages=${refused.page.count}`);

    const withFollowUp = sequence.summarize([
      exchange('2026-10-16T06:20:23.000Z', '192.168.0.137', '/v8/Configuration/Stores/OEMStores/NOKIA', 200),
      exchange('2026-10-16T06:20:24.000Z', '192.168.0.137', '/v9/catalog/storePages', 200, 'cdn.marketplaceedgeservice.windowsphone.com'),
      exchange('2026-10-16T06:20:25.000Z', '192.168.0.137', '/image/abc123', 200, 'cdn.marketplaceimages.windowsphone.com'),
    ]);
    check('sequence: the first request after the page is what the page is judged by',
      withFollowUp.page.count === 1
        && withFollowUp.afterFirstPage.length === 1
        && /marketplaceimages/.test(withFollowUp.afterFirstPage[0].request.host)
        && withFollowUp.configuration.retries === 0,
      `after the first page: ${withFollowUp.afterFirstPage.map((entry) => entry.request.host).join(', ') || 'nothing'}`);

    // The grouping rule that matters most here: a replay carries the phone's own
    // `hw`/`dm` (F-012, footgun 4), so folding on hardware alone would let this PC's
    // replay answer for the handset it is imitating.
    const replayGroups = sequence.groupByDevice([
      exchange('2026-10-16T05:54:18.000Z', '192.168.0.220', '/v9/catalog/storePages', 200, 'cdn.marketplaceedgeservice.windowsphone.com'),
      exchange('2026-10-16T06:20:23.000Z', '192.168.0.137', '/v8/Configuration/Stores/OEMStores/NOKIA', 502),
    ]);
    check('sequence: a replay and the handset it imitates stay two groups',
      replayGroups.length === 2
        && replayGroups.some((group) => group.addresses.has('192.168.0.220'))
        && replayGroups.some((group) => group.addresses.has('192.168.0.137')),
      `${replayGroups.length} group(s): ${replayGroups.map((group) => [...group.addresses].join('+')).join(' | ')}`);
    // --- the certificate the mass storage route writes ---------------------
    // The CA reaches this phone by loading its own SOFTWARE hive on this PC, so what
    // has to be right here is the value that goes into that hive: the shape the phone
    // itself stores, and the file reg.exe accepts. The WP8.1 app that used to carry
    // the same certificate as a patch set is no longer part of this repo - these
    // checks never needed it, they read the desktop's own output all along.
    const caDer = await fsp.readFile(path.join(config.pki.dir, 'ca.der'));
    const expectedThumbprint = crypto.createHash('sha1').update(caDer).digest('hex').toUpperCase();

    // Two independent readings of the same file: it has to be the encoding reg.exe
    // accepts at all (UTF-16LE with a BOM), and its hex payload has to decode back
    // to the blob the desktop side proved against Windows.
    const desktopRegFile = buildRegFileBuffer({ der: caDer });
    const regText = desktopRegFile.toString('utf16le', 2);
    const keyLine = `[HKLM\\SOFTWARE\\Microsoft\\SystemCertificates\\Root\\Certificates\\${expectedThumbprint}]`;
    check('mass storage: the .reg is UTF-16LE with a BOM and names the registry key to create',
      desktopRegFile[0] === 0xff && desktopRegFile[1] === 0xfe
        && regText.startsWith('Windows Registry Editor Version 5.00')
        && regText.includes(keyLine),
      `first bytes=${desktopRegFile.subarray(0, 2).toString('hex')}, key present=${regText.includes(keyLine)}`);

    // The mass storage route loads the phone's own SOFTWARE hive on this PC, and that
    // hive's root *is* `SOFTWARE`. A path that repeated the component would create a
    // `SOFTWARE\SOFTWARE\...` tree the phone never reads: the certificate would be in
    // the file, the import would report success, and the CA would still not be trusted.
    // The two files must therefore differ by exactly that one prefix and nothing else -
    // same blob, same line wrapping, same encoding.
    const mountedEntry = buildRegEntry({ der: caDer, mount: 'HKLM\\PhoneSoftware' });
    const mountedText = buildRegFileBuffer({ der: caDer, mount: 'HKLM\\PhoneSoftware' }).toString('utf16le', 2);
    check('mass storage: the .reg aims at the loaded hive and repeats nothing else',
      mountedEntry.keyPath === `HKLM\\PhoneSoftware\\Microsoft\\SystemCertificates\\Root\\Certificates\\${expectedThumbprint}`
        && mountedEntry.blob.equals(buildCertBlob(caDer))
        && mountedText === regText.replace('HKLM\\SOFTWARE\\', 'HKLM\\PhoneSoftware\\'),
      `key=${mountedEntry.keyPath}`);

    // The mass storage route does not write the desktop's blob: it writes the shape
    // the phone itself writes, which was read off the device's own entries. If this
    // drifts, the entry goes into the phone's store and the phone silently keeps not
    // trusting the CA - the exact failure the whole arrangement exists to prevent.
    const phoneBlob = buildPhoneCertBlob(caDer);
    const readElement = (buffer) => {
      const element = {
        version: buffer.readUInt32LE(0),
        one: buffer.readUInt32LE(4),
        idLength: buffer.readUInt32LE(8),
        id: buffer.subarray(12, 12 + buffer.readUInt32LE(8)),
        properties: [],
      };
      let off = 12 + element.idLength;
      while (off + 12 <= buffer.length) {
        const propId = buffer.readUInt32LE(off);
        const flag = buffer.readUInt32LE(off + 4);
        const length = buffer.readUInt32LE(off + 8);
        element.properties.push({ propId, flag, data: buffer.subarray(off + 12, off + 12 + length) });
        off += 12 + length;
      }
      element.consumed = off;
      return element;
    };
    const element = readElement(phoneBlob);
    const sha1Prop = element.properties.find((p) => p.propId === 3);
    const certProp = element.properties.find((p) => p.propId === 32);
    check('mass storage: the entry is the shape the phone itself stores',
      element.version === PHONE_ELEMENT_VERSION && element.version === 25
        && element.one === 1 && element.idLength === 16 && element.id.length === 16
        && element.properties.length === 2
        && element.properties.every((p) => p.flag === 1)
        && element.consumed === phoneBlob.length,
      `version=${element.version} idLength=${element.idLength} props=${element.properties.map((p) => p.propId).join(',')} consumed=${element.consumed}/${phoneBlob.length}`);
    check('mass storage: it carries the SHA-1 of the certificate and the certificate',
      Boolean(sha1Prop) && Boolean(certProp)
        && sha1Prop.data.toString('hex').toUpperCase() === expectedThumbprint
        && certProp.data.equals(caDer),
      `sha1=${sha1Prop ? sha1Prop.data.length : 0} bytes, cert=${certProp ? certProp.data.length : 0} bytes`);
    check('mass storage: the same CA always produces the same entry',
      buildPhoneCertBlob(caDer).equals(phoneBlob)
        && !phoneElementId(caDer).equals(phoneElementId(Buffer.concat([caDer, Buffer.from([0])]))),
      `elementId=${phoneElementId(caDer).toString('hex')}`);

    const decodedBlob = Buffer.from(
      regText.slice(regText.indexOf('"Blob"=hex:') + 11).replace(/[^0-9a-fA-F]/g, ''),
      'hex',
    );
    check('mass storage: the .reg payload decodes to the blob the desktop verified',
      decodedBlob.equals(buildCertBlob(caDer)),
      `decoded=${decodedBlob.length} bytes, verified=${buildCertBlob(caDer).length} bytes`);

  } finally {
    await proxy.stop();
    await dns.stop();
    await capture.flush();
    await new Promise((resolve) => upstream.close(resolve));
    await new Promise((resolve) => echo.close(resolve));
  }

  // The census against the capture this run just wrote.
  //
  // Everything the suite drives arrives from loopback, which is how any machine
  // that answers DNS sees its own client, so every row must come out marked. A
  // device row here would mean the rule is wrong in the direction that matters:
  // this PC's own traffic read as the phone's, which is how F-012 was misread the
  // first time.
  const suiteCaptureRoot = path.join(WORK, 'captures');
  const suiteDns = await readDnsQueries(suiteCaptureRoot);
  const suiteExchanges = [];
  for (const entry of fs.readdirSync(suiteCaptureRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const indexPath = path.join(suiteCaptureRoot, entry.name, 'index.jsonl');
    if (!fs.existsSync(indexPath)) continue;
    for await (const line of readJsonl(indexPath)) {
      try { suiteExchanges.push(JSON.parse(line)); } catch { /* torn line */ }
    }
  }
  const suiteRows = buildClientRows({
    http: groupHttpClients(suiteExchanges),
    dns: suiteDns.byClient,
    localIps: localAddresses(config),
  });
  check('census: the capture this run wrote is read, and every row in it is this PC',
    suiteExchanges.length > 0 && suiteDns.byClient.size > 0
      && suiteRows.length > 0 && suiteRows.every((row) => row.thisPc),
    `${suiteExchanges.length} exchanges, ${suiteDns.byClient.size} DNS client(s), rows=`
      + suiteRows.map((row) => `${row.address}=${row.kind}`).join(' '));

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
