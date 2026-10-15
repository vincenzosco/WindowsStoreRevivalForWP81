// Configuration loading, defaults and the pattern matcher shared by DNS and proxy.

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

export const DEFAULT_CAPTURE_DIR = 'captures';
export const DEFAULT_PKI_DIR = 'ca';

const DEFAULTS = {
  network: { advertiseIp: 'auto' },
  dns: {
    enabled: true,
    port: 53,
    bind: 'auto',
    upstream: ['1.1.1.1', '8.8.8.8'],
    hijack: { ip: 'auto', names: [] },
    logQueries: true,
  },
  proxy: {
    enabled: true,
    port: 8899,
    // Direct TLS listener: lets a device be redirected with a DNS change only,
    // with no HTTP proxy setting. Matter because Windows Phone 8.1 often will
    // not offer the DNS field, let alone a proxy field.
    tlsEnabled: true,
    tlsPort: 443,
    // Plain-HTTP listener. Windows Phone 8.1 store lookups, search and app images
    // are documented as HTTP on port 80, so a DNS-only redirect that listens on
    // 443 alone fails silently: the device resolves the hijacked name to us,
    // connects to 80, gets a RST and retries, leaving no trace but another DNS
    // query. See proxy.mjs for the source of that claim.
    httpEnabled: true,
    httpPort: 80,
    mitm: { mode: 'listed', hosts: [] },
    tunnel: { blockHosts: [] },
  },
  pki: {
    dir: DEFAULT_PKI_DIR,
    commonName: 'WP Store Lab Root CA',
    days: 3650,
    leafDays: 825,
    openssl: '',
  },
  capture: {
    enabled: true,
    dir: DEFAULT_CAPTURE_DIR,
    inlineBodyMaxBytes: 4096,
    maxBodyBytes: 2097152,
  },
  upstream: { insecure: false, timeoutMs: 20000 },
  livestore: {
    baseUrl: 'https://zinc.onelive.me/v1',
    apiKey: '',
    cacheTtlMs: 300000,
    // The Store protocol handler is off unless asked for: serving the phone's
    // own store page is a decision, not a default. See src/store/protocol.mjs.
    protocol: {
      enabled: false,
      // A fake store of invented apps is the default so the page has enough
      // sections to look at; the three-entry fixture stays for the tests.
      catalogFile: 'src/store/fixtures/demo-catalog.json',
      // The template the page asks the client to render it with. Both values come
      // from src/store/vocabulary.mjs, which is a reading of the phone: the name
      // from the style the Store page is drawn with (Store_DynamicHubStyle_*),
      // the type from the set this phone's UI assets actually style. They are two
      // different things and a store page carries both.
      hubTemplate: 'DynamicHub',
      templateType: '003',
      // Whether the type travels as an attribute of <Template>, as a child
      // element, or both. Nothing readable from the phone decides it, so both are
      // written until the device says which it reads. See TYPE_KEY_FORMS.
      templateTypeForm: 'both',
      // The document the page endpoint answers with. 'storePage' is the v9 store
      // page grammar the phone's parser describes (/StorePage with /Panes/Pane and
      // /Templates/Template), its panes carrying a reference to their section;
      // 'panes' is that same document with the section's items inside the pane as
      // well, which is how the archived response arranges them; 'atom' is the v8
      // <a:feed> shape archived responses show. Kept as a switch so the document
      // type is one variable. See PAGE_FORMATS in src/store/catalog-feed.mjs.
      pageFormat: 'storePage',
      pageSize: 25,
      // 'generated' builds the page from the catalog; 'archive' answers the page
      // endpoints with a real archived response instead. That is an experiment
      // with a known confound, described where it is served in
      // src/store/protocol.mjs - it is not a one-variable change.
      serve: 'generated',
      archiveFile: 'src/store/fixtures/archive/real-hub-page-20130813.xml',
    },
  },
  rules: [],
};

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Recursively overlay `override` onto `base`, ignoring keys starting with `_`. */
function deepMerge(base, override) {
  const out = Array.isArray(base) ? [...base] : { ...base };
  for (const [key, value] of Object.entries(override || {})) {
    if (key.startsWith('_')) continue;
    if (isPlainObject(value) && isPlainObject(out[key])) {
      out[key] = deepMerge(out[key], value);
    } else if (value !== undefined) {
      out[key] = value;
    }
  }
  return out;
}

/**
 * Convert a glob (`*`, `?`) into an anchored RegExp.
 * `*` also crosses dots, which is what we want for `*.apps.microsoft.com`.
 */
export function globToRegExp(pattern) {
  const escaped = String(pattern)
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*')
    .replace(/\?/g, '.');
  return new RegExp(`^${escaped}$`, 'i');
}

const patternCache = new Map();

/** True when `name` matches any glob in `patterns` (case-insensitive). */
export function matchesAny(name, patterns) {
  if (!name || !patterns || patterns.length === 0) return false;
  const lc = String(name).toLowerCase();
  for (const pattern of patterns) {
    let re = patternCache.get(pattern);
    if (!re) {
      re = globToRegExp(pattern);
      patternCache.set(pattern, re);
    }
    if (re.test(lc)) return true;
  }
  return false;
}

/**
 * Hosts the lab is configured to intercept - the only hosts a Store handler may
 * answer for. Shared by every handler so they cannot disagree about it: a handler
 * that answered for a host the device was never told to send here would be
 * inventing traffic.
 */
export function isInterceptedHost(config, host) {
  if (config.proxy.mitm.mode === 'all') return true;
  return matchesAny(host, config.proxy.mitm.hosts);
}

/** Best-effort LAN IPv4: first non-internal IPv4, preferring the default-route interface. */
export function detectLanIp() {
  const entries = [];
  for (const [name, addresses] of Object.entries(os.networkInterfaces())) {
    for (const address of addresses || []) {
      if (address.family === 'IPv4' && !address.internal) {
        entries.push({ name, address: address.address });
      }
    }
  }
  // 192.168/10./172.16-31 rank above Hyper-V-ish 172.26 style host-only switches.
  const preferred = entries.find((e) => /^192\.168\./.test(e.address))
    || entries.find((e) => /^10\./.test(e.address))
    || entries.find((e) => /^172\.(1[6-9]|2\d|3[01])\./.test(e.address));
  return (preferred || entries[0] || { address: '127.0.0.1' }).address;
}

export function loadConfig(configPath = 'config.json') {
  const absolute = path.resolve(configPath);
  let raw = {};
  if (fs.existsSync(absolute)) {
    try {
      raw = JSON.parse(fs.readFileSync(absolute, 'utf8'));
    } catch (err) {
      throw new Error(`${absolute} is not valid JSON: ${err.message}`);
    }
  }
  const config = deepMerge(DEFAULTS, raw);

  const lanIp = detectLanIp();
  config.__configPath = absolute;
  config.__advertiseIp = config.network.advertiseIp === 'auto'
    ? lanIp
    : config.network.advertiseIp;
  config.__hijackIp = config.dns.hijack.ip === 'auto'
    ? config.__advertiseIp
    : config.dns.hijack.ip;

  // A hijacked name that is never intercepted would be a silent black hole,
  // so the hijack list is always part of the MITM list.
  if (config.proxy.mitm.mode === 'listed') {
    config.proxy.mitm.hosts = [...new Set([
      ...config.proxy.mitm.hosts,
      ...config.dns.hijack.names,
    ])];
  }

  const errors = [];
  if (!Array.isArray(config.dns.upstream) || config.dns.upstream.length === 0) {
    errors.push('dns.upstream must list at least one resolver address');
  }
  const portPairs = [
    ['dns.port', config.dns.port],
    ['proxy.port', config.proxy.port],
    ['proxy.tlsPort', config.proxy.tlsPort],
  ];
  for (const [label, port] of portPairs) {
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      errors.push(`${label} must be an integer in 1..65535`);
    }
  }
  if (config.proxy.mitm.mode !== 'listed' && config.proxy.mitm.mode !== 'all') {
    errors.push('proxy.mitm.mode must be "listed" or "all"');
  }
  // An enabled Store protocol handler with no catalog to serve would answer the
  // device with an empty page, which reads as "the Store has nothing" rather than
  // as a missing file. Refuse at load instead, where the operator sees it.
  if (config.livestore?.protocol?.enabled) {
    const catalogFile = path.resolve(config.livestore.protocol.catalogFile || '');
    if (!config.livestore.protocol.catalogFile || !fs.existsSync(catalogFile)) {
      errors.push(`livestore.protocol.catalogFile not found: ${catalogFile}`);
    }
  }
  if (errors.length) {
    throw new Error(`Invalid configuration:\n  - ${errors.join('\n  - ')}`);
  }

  return config;
}

/**
 * Addresses to try for the DNS listener, in order.
 *
 * The wildcard bind is the natural first choice, but on Windows the Internet
 * Connection Sharing service parks itself on 0.0.0.0:53 whenever Mobile hotspot
 * is on. A bind to the LAN address still succeeds in that case and is all the
 * device needs, so falling back to it keeps the lab working without touching a
 * system service.
 */
export function dnsBindCandidates(config) {
  const explicit = config.dns.bind;
  if (explicit && explicit !== 'auto') return [explicit];
  return [...new Set([
    config.__advertiseIp,
    '0.0.0.0',
    '127.0.0.1',
  ].filter(Boolean))];
}

export const CONFIG_DEFAULTS = DEFAULTS;
