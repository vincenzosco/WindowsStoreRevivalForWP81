#!/usr/bin/env node
// Entry point: bring up the DNS hijacker and the selective MITM proxy together.

import process from 'node:process';
import path from 'node:path';
import { loadConfig } from './config.mjs';
import { createLogger } from './log.mjs';
import { Pki } from './pki.mjs';
import { Capture } from './capture.mjs';
import { DnsServer } from './dns-server.mjs';
import { MitmProxy } from './proxy.mjs';
import { validateRules } from './rules.mjs';
import { preflight, formatProblems } from './preflight.mjs';
import { ZincClient } from './zinc.mjs';
import { StoreRouter } from './store/router.mjs';
import { buildHandlers } from './store/handlers.mjs';
import { warmCatalog } from './store/protocol.mjs';

function parseArgs(argv) {
  const args = { config: 'config.json', only: null };
  for (const arg of argv.slice(2)) {
    if (arg.startsWith('--config=')) args.config = arg.slice('--config='.length);
    else if (arg.startsWith('--only=')) args.only = arg.slice('--only='.length);
    else if (arg === '--force') args.force = true;
    else if (arg === '-h' || arg === '--help') args.help = true;
  }
  return args;
}

function banner(config, ca, logger) {
  const proxyPort = config.proxy.port;
  const lines = [
    '',
    '  Device configuration (Wi-Fi -> advanced -> static IP)',
    `    IP address   : pick a free address, e.g. ${config.__advertiseIp.replace(/\.\d+$/, '.250')}`,
    `    Subnet mask  : 255.255.255.0`,
    `    Gateway      : your router`,
    `    DNS server   : ${config.__advertiseIp}`,
    `    Proxy server : ${config.__advertiseIp}:${proxyPort}`,
    '',
    '  Root CA to install on the device',
    `    file         : ${path.resolve(config.pki.dir, 'ca.der')}`,
    `    SHA-1        : ${ca.sha1Thumbprint}`,
    `    download     : http://${config.__advertiseIp}:${proxyPort}/__lab/ca.crt`,
    '',
    `  Watch traffic  : http://${config.__advertiseIp}:${proxyPort}/__lab/captures?limit=20`,
    `  Hot reload     : curl -X POST http://${config.__advertiseIp}:${proxyPort}/__lab/reload`,
    '',
  ];
  logger.info(`device setup:\n${lines.join('\n')}`);
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.help) {
    console.log(`usage: node src/main.mjs [--config=config.json] [--only=dns|proxy]

  --config=<file>  configuration file to load (default config.json)
  --only=dns       start only the DNS hijacker
  --only=proxy     start only the proxy (use when DNS runs on another host)
  --force          start even if the required ports are already taken
`);
    return;
  }

  const logger = createLogger('main');
  const config = loadConfig(args.config);

  const ruleErrors = validateRules(config.rules);
  if (ruleErrors.length) throw new Error(`Invalid rules:\n  - ${ruleErrors.join('\n  - ')}`);

  const ports = await preflight(config, { only: args.only });
  if (!ports.ok) {
    if (!args.force) {
      logger.error(formatProblems(ports.problems));
      process.exit(1);
    }
    logger.warn('port conflicts ignored because --force was given');
  }

  const pki = await new Pki({
    dir: path.resolve(config.pki.dir),
    commonName: config.pki.commonName,
    days: config.pki.days,
    leafDays: config.pki.leafDays,
    openssl: config.pki.openssl,
    log: (m) => logger.info(m),
  }).init();

  const capture = await new Capture({ config, logger: logger.child('capture') }).init();

  const reloadConfig = () => {
    const fresh = loadConfig(args.config);
    // Mutate the shared object so the DNS server and the proxy see the change
    // without being restarted; the device connection is never dropped.
    config.rules = fresh.rules;
    config.proxy.mitm.hosts = fresh.proxy.mitm.hosts;
    config.proxy.mitm.mode = fresh.proxy.mitm.mode;
    config.dns.hijack.names = fresh.dns.hijack.names;
    config.livestore = fresh.livestore;
    config.__hijackIp = fresh.__hijackIp;
    const errors = validateRules(config.rules);
    if (errors.length) throw new Error(`Invalid rules after reload:\n  - ${errors.join('\n  - ')}`);
    return {
      rules: config.rules.map((r) => ({ name: r.name, action: r.action })),
      mitmHosts: config.proxy.mitm.hosts,
      hijack: config.dns.hijack.names,
    };
  };

  const services = [];

  if (config.dns.enabled && args.only !== 'proxy') {
    const dns = new DnsServer({ config, logger: logger.child('dns') });
    await dns.start();
    services.push(dns);
  } else {
    logger.info('DNS server disabled');
  }

  const zinc = new ZincClient({
    baseUrl: config.livestore.baseUrl,
    apiKey: config.livestore.apiKey,
    cacheTtlMs: config.livestore.cacheTtlMs,
    log: (m) => logger.info(m),
  });
  logger.info(zinc.configured
    ? 'Live Store (Zinc) API key configured'
    : 'Live Store (Zinc) API key not set - set livestore.apiKey to serve the real catalog');

  const router = new StoreRouter({
    handlers: buildHandlers(config),
    logger: logger.child('store'),
  });

  // Assembling the Live Store catalog is the one thing in this process that talks
  // to a third party, and its first run costs seconds - sixteen categories, 203
  // apps, measured at eleven seconds serially. The device holds its page request
  // open while that happens, so it is done once here instead of inside the request
  // the phone makes. Not awaited: the lab must come up whether or not Zinc does.
  warmCatalog(config, { logger: logger.child('store'), zinc })
    .then((result) => logger.info(`Store catalog for the page: ${result.source}`))
    .catch((err) => logger.warn(`Store catalog warm-up failed: ${err.message}`));

  if (config.proxy.enabled && args.only !== 'dns') {
    const proxy = new MitmProxy({
      config,
      logger: logger.child('proxy'),
      pki,
      capture,
      router,
      zinc,
      onReload: reloadConfig,
    });
    await proxy.start();
    services.push(proxy);
  } else {
    logger.info('proxy disabled');
  }

  banner(config, await pki.info(), logger);
  logger.info('ready');

  let shuttingDown = false;
  const shutdown = async (signal) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info(`received ${signal}, shutting down`);
    for (const service of services) {
      try { await service.stop(); } catch (err) { logger.warn(`stop failed: ${err.message}`); }
    }
    await capture.flush();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch((err) => {
  createLogger('main').error(err.message);
  process.exit(1);
});
