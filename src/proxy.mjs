// Selective MITM proxy.
//
// Two very different paths:
//   * Hosts NOT in proxy.mitm.hosts  -> blind TCP tunnel. Bytes are never
//     decrypted and never inspected, so the rest of the device's traffic is
//     bit-for-bit what it was before.
//   * Hosts in proxy.mitm.hosts      -> TLS is terminated with a leaf signed by
//     the lab CA, the request is captured, a rule may patch it, and the reply is
//     either synthesised locally or relayed to the real backend.
//
// A local admin surface is served at /__lab/ so the operator can watch traffic,
// fetch the CA and hot-reload rules while the device stays connected.

import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import os from 'node:os';
import tls from 'node:tls';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { matchesAny } from './config.mjs';
import { decide, applyRewrites, resolveMockBody } from './rules.mjs';
import { prettyPath } from './paths.mjs';

const ADMIN_PREFIX = '/__lab/';
const MAX_REQUEST_BODY = 8 * 1024 * 1024;
/** How long a direct connection may stay open without completing a handshake. */
const HANDSHAKE_GRACE_MS = 5000;

/**
 * Addresses that mean "this PC".
 *
 * The operator's own tools probe the lab from the same host it runs on, so a
 * self-probe is otherwise indistinguishable from the device connecting - the one
 * false positive that makes someone believe the phone is set up when it is not.
 */
let cachedLocalAddresses = null;
function isLocalAddress(address) {
  if (!address) return false;
  if (!cachedLocalAddresses) {
    cachedLocalAddresses = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1', '0.0.0.0']);
    for (const addresses of Object.values(os.networkInterfaces())) {
      for (const entry of addresses || []) cachedLocalAddresses.add(entry.address);
    }
  }
  return cachedLocalAddresses.has(address);
}

/**
 * Decide how to report a direct connection that never completed a TLS handshake.
 *
 * This is the branch a device with no root CA installed hits, and it is the one
 * signal that distinguishes "the phone never reached us" from "the phone reached
 * us and we refused it". Kept as a pure function so the decision - who counts as
 * the device, and how loudly to say it - can be asserted without a second machine
 * on the LAN, which is the only way to produce a genuinely remote peer.
 */
export function describeDirectHandshakeFailure({ from, port, self, errorCode = null, reason = '' }) {
  const detail = errorCode ? ` (${errorCode})` : '';
  if (self) {
    // The operator's own probes are not the device; never dress them up as a finding.
    return {
      level: 'debug',
      countsAsDevice: false,
      message: `no TLS handshake from ${from}${detail}: ${reason}`,
    };
  }
  return {
    level: 'warn',
    countsAsDevice: true,
    message: `device at ${from} reached :${port} but no TLS handshake completed${detail}: ${reason}`
      + ' - the device most likely does not have the lab root CA installed yet',
  };
}

/** Self-contained live dashboard: no build step, no external assets. */
const DASHBOARD_HTML = `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>WP Store Lab</title>
<style>
 :root{color-scheme:dark}
 body{margin:0;font:13px/1.45 ui-monospace,Consolas,monospace;background:#111418;color:#d7dde5}
 header{padding:14px 18px;border-bottom:1px solid #23292f;display:flex;gap:18px;align-items:baseline;flex-wrap:wrap}
 h1{font-size:15px;margin:0;letter-spacing:.04em}
 .muted{color:#7d8894}
 main{padding:14px 18px}
 table{border-collapse:collapse;width:100%;font-size:12px}
 th,td{text-align:left;padding:4px 8px;border-bottom:1px solid #1d2228;vertical-align:top}
 th{color:#8b96a2;font-weight:500;position:sticky;top:0;background:#111418}
 tr:hover td{background:#161b21}
 .ok{color:#5fbf7f}.warn{color:#d4a24a}.err{color:#e0705f}.passthrough{color:#7d8894}.mock{color:#6fa8dc}
 .bar{display:flex;gap:14px;flex-wrap:wrap;margin-bottom:10px}
 .bar b{font-weight:600}
 input,button{background:#181d23;color:#d7dde5;border:1px solid #2a3138;border-radius:4px;padding:4px 8px;font:inherit}
</style></head><body>
<header>
  <h1>WP STORE LAB</h1>
  <span class="muted" id="summary">loading...</span>
  <span style="flex:1"></span>
  <input id="filter" placeholder="filter host / path" size="26">
  <button id="reload">Reload config</button>
  <button id="pause">Pause</button>
</header>
<main>
  <div class="bar" id="counters"></div>
  <table><thead><tr>
    <th>time</th><th>decision</th><th>method</th><th>host + path</th><th>status</th><th>bytes</th><th>ms</th>
  </tr></thead><tbody id="rows"></tbody></table>
</main>
<script>
let paused=false;
async function tick(){
  if(!paused){
    try{
      const s=await (await fetch('/__lab/status')).json();
      document.getElementById('summary').textContent =
        'ip '+s.advertiseIp+'  dns:'+s.dns.port+'  proxy:'+s.proxy.port+'  mitm:'+s.proxy.mitmMode+
        '  rules:'+s.rules.length+'  ca:'+s.ca.sha1Thumbprint.slice(0,12);
      document.getElementById('counters').innerHTML = Object.entries(s.stats)
        .map(([k,v])=>'<span class="muted">'+k+' <b>'+v+'</b></span>').join('');
      const c=await (await fetch('/__lab/captures?limit=80')).json();
      const f=document.getElementById('filter').value.toLowerCase();
      document.getElementById('rows').innerHTML = c.exchanges.slice().reverse()
        .filter(e=>!f || (e.request.host+e.request.path).toLowerCase().includes(f))
        .map(e=>{
          const d=e.decision||'';
          const cls=d.startsWith('mock')?'mock':d.startsWith('block')?'err':d.indexOf('502')>=0?'err':'';
          const st=e.response?e.response.status:'-';
          const stc=st>=400?'err':st>=300?'warn':'ok';
          const bytes=e.response&&e.response.body?e.response.body.bytes:'-';
          return '<tr><td class="muted">'+e.ts.slice(11,19)+'</td><td class="'+cls+'">'+d+'</td><td>'+e.request.method+
            '</td><td>'+e.request.host+e.request.path.slice(0,70)+'</td><td class="'+stc+'">'+st+
            '</td><td class="muted">'+bytes+'</td><td class="muted">'+(e.durationMs||'')+'</td></tr>';
        }).join('');
    }catch(err){ document.getElementById('summary').textContent='server unreachable'; }
  }
  setTimeout(tick,3000);
}
document.getElementById('pause').onclick=(e)=>{paused=!paused;e.target.textContent=paused?'Resume':'Pause';};
document.getElementById('reload').onclick=async()=>{
  const r=await fetch('/__lab/reload',{method:'POST'});
  document.getElementById('reload').textContent = r.ok ? 'Reloaded' : 'Reload failed';
  setTimeout(()=>document.getElementById('reload').textContent='Reload config',1500);
};
tick();
</script></body></html>`;

/** `host:port` (or `[v6]:port`) -> { host, port } */
export function splitHostPort(value) {
  const text = String(value || '');
  const v6 = text.match(/^\[([^\]]+)\]:(\d+)$/);
  if (v6) return { host: v6[1], port: Number(v6[2]) };
  const idx = text.lastIndexOf(':');
  if (idx === -1) return { host: text, port: null };
  const host = text.slice(0, idx);
  const port = Number(text.slice(idx + 1));
  return { host, port: Number.isFinite(port) ? port : null };
}

export class MitmProxy {
  constructor({ config, logger, pki, capture, router = null, zinc = null, onReload = null }) {
    this.config = config;
    this.log = logger;
    this.pki = pki;
    this.capture = capture;
    this.router = router;
    this.zinc = zinc;
    this.onReload = onReload;
    this.requestCounter = 0;
    this.startedAt = Date.now();
    this.stats = {
      connect: 0, mitm: 0, tunnel: 0, requests: 0, mock: 0, passthrough: 0,
      rewrite: 0, redirect: 0, block: 0, upstreamErrors: 0, tunnelBytes: 0,
      // Direct (DNS-only) path counters. Kept separate from `mitm` so a device
      // that merely reaches the port is never counted as successfully intercepted.
      directTcp: 0, directHandshakeErrors: 0, directNoSni: 0, directRejected: 0, directTls: 0,
      // Plain-HTTP path: separate from `requests` so a device that only reached
      // port 80 is never mixed up with one that was actually intercepted.
      plainTcp: 0, plainDevice: 0,
    };
    this.sockets = new Set();
    this.httpServer = null;
    this.tlsServer = null;
    this.plainServer = null;
  }

  async start() {
    this.httpServer = http.createServer((req, res) => {
      this.#onRequest(req, res).catch((err) => {
        this.stats.upstreamErrors += 1;
        this.log.error(`request handling failed: ${err.message}`);
        if (!res.headersSent) {
          res.writeHead(502, { 'content-type': 'text/plain; charset=utf-8' });
        }
        res.end(`proxy error: ${err.message}`);
      });
    });

    this.httpServer.on('connect', (req, socket, head) => {
      this.#onConnect(req, socket, head).catch((err) => {
        this.log.error(`CONNECT ${req.url} failed: ${err.message}`);
        try { socket.end('HTTP/1.1 502 Bad Gateway\r\n\r\n'); } catch { /* gone */ }
      });
    });

    this.httpServer.on('clientError', (err, socket) => {
      this.log.debug(`client error: ${err.message}`);
      if (socket.writable) socket.end('HTTP/1.1 400 Bad Request\r\n\r\n');
    });

    this.httpServer.on('connection', (socket) => {
      this.sockets.add(socket);
      socket.on('close', () => this.sockets.delete(socket));
    });

    await new Promise((resolve, reject) => {
      const onError = (err) => reject(err);
      this.httpServer.once('error', onError);
      this.httpServer.listen(this.config.proxy.port, '0.0.0.0', () => {
        this.httpServer.removeListener('error', onError);
        resolve();
      });
    });

    if (this.config.proxy.tlsEnabled) {
      await this.#startDirectTlsListener();
    }

    if (this.config.proxy.httpEnabled) {
      await this.#startPlainHttpListener();
    }

    const { mode, hosts } = this.config.proxy.mitm;
    this.log.info(`proxy listening on 0.0.0.0:${this.config.proxy.port} (HTTP + CONNECT)`);
    this.log.info(
      mode === 'all'
        ? 'MITM mode "all": every CONNECT is decrypted'
        : `MITM mode "listed": ${hosts.length} host pattern(s) decrypted, everything else tunnelled`,
    );
    this.log.info(`admin surface: http://${this.config.__advertiseIp}:${this.config.proxy.port}${ADMIN_PREFIX}status`);
    return this;
  }

  #shouldMitm(host) {
    const { mode, hosts } = this.config.proxy.mitm;
    if (mode === 'all') return true;
    return matchesAny(host, hosts);
  }

  /**
   * Plain-HTTP listener.
   *
   * The Windows Phone 8.1 store lookups, search and app images are served over
   * HTTP, not TLS: Microsoft partners' own firewall guidance for Windows 8.1
   * store access lists `http://marketplaceedgeservice.windowsphone.com` and
   * `http://cdn.marketplaceimages.windowsphone.com` on port 80 ("HTTPS 443,
   * HTTP 80").
   *
   * Without this listener a DNS-only redirect fails in the most deceptive way
   * possible: the device resolves the hijacked name to us, opens port 80, gets a
   * RST because nothing is listening, retries - and the retry looks like nothing
   * but another DNS query. The lab appears idle while the device keeps trying.
   *
   * Requests arrive with a relative path, so the target comes from the Host
   * header; `#onRequest` already resolves that case, which means rules, store
   * handlers and captures all apply unchanged.
   */
  async #startPlainHttpListener() {
    const port = this.config.proxy.httpPort;

    this.plainServer = http.createServer((req, res) => {
      this.#onRequest(req, res).catch((err) => {
        this.stats.upstreamErrors += 1;
        this.log.error(`request handling failed: ${err.message}`);
        if (!res.headersSent) {
          res.writeHead(502, { 'content-type': 'text/plain; charset=utf-8' });
        }
        res.end(`proxy error: ${err.message}`);
      });
    });

    this.plainServer.on('connection', (socket) => {
      this.stats.plainTcp += 1;
      this.sockets.add(socket);
      socket.on('close', () => this.sockets.delete(socket));
      if (isLocalAddress(socket.remoteAddress)) return; // our own probes are not the device
      this.stats.plainDevice += 1;
      this.log.info(`device opened HTTP :${port} from ${socket.remoteAddress}:${socket.remotePort}`);
    });

    this.plainServer.on('clientError', (err, socket) => {
      this.log.debug(`plain HTTP client error: ${err.message}`);
      if (socket.writable) socket.end('HTTP/1.1 400 Bad Request\r\n\r\n');
    });

    await new Promise((resolve, reject) => {
      const onError = (err) => reject(err);
      this.plainServer.once('error', onError);
      this.plainServer.listen(port, '0.0.0.0', () => {
        this.plainServer.removeListener('error', onError);
        resolve();
      });
    });

    this.log.info(`plain HTTP listener on 0.0.0.0:${port} - the 8.1 store lookups use HTTP, not TLS`);
  }

  /**
   * Direct TLS listener.
   *
   * This is the path a device uses when its DNS was redirected but it was NOT
   * told about an HTTP proxy - which matters because Windows Phone 8.1 will not
   * always let you edit the DNS field, and almost never the proxy one. The device
   * resolves a Store name to us and opens a plain TLS connection to port 443.
   *
   * There is no CONNECT to tell us the target, so the hostname comes from SNI.
   * Only intercepted names are accepted: a direct connection for anything else
   * cannot be forwarded, because the original destination address is gone.
   */
  async #startDirectTlsListener() {
    const port = this.config.proxy.tlsPort;

    this.tlsServer = tls.createServer(
      {
        minVersion: 'TLSv1.2',
        SNICallback: (servername, cb) => {
          this.pki.secureContextFor(servername)
            .then((ctx) => cb(null, ctx))
            .catch((err) => cb(err));
        },
      },
      (tlsSocket) => this.#onDirectTls(tlsSocket),
    );

    // A raw TCP accept fires BEFORE the TLS handshake and is the only event that
    // always carries the peer address, so it is the one place a device's arrival
    // can be proven. Registration used to happen only after a successful
    // handshake, which made "the phone never connected" indistinguishable from
    // "the phone connected and we refused it" - and the second is the normal
    // state until the root CA is installed on the device.
    //
    // `tlsClientError` cannot answer this by itself: by the time it fires the
    // socket is torn down, so both `socket.remoteAddress` and
    // `socket._parent.remoteAddress` read back as undefined. The watchdog below is
    // therefore armed here and cleared from secureConnection, where
    // `tlsSocket._parent` is still this exact socket object.
    this.tlsServer.on('connection', (socket) => {
      this.stats.directTcp += 1;
      this.sockets.add(socket);

      const from = `${socket.remoteAddress}:${socket.remotePort}`;
      const self = isLocalAddress(socket.remoteAddress);
      socket.__labPeer = from;
      socket.__labHandshakeDone = false;
      socket.on('error', (err) => { socket.__labError = err.code || err.message; });

      if (self) {
        this.log.debug(`direct TCP from ${from} (this PC, not the device)`);
      } else {
        this.log.info(`device opened TCP :${port} from ${from} - awaiting TLS handshake`);
      }

      const noHandshake = (reason) => {
        if (socket.__labHandshakeDone || socket.__labWarned) return;
        socket.__labWarned = true;
        const notice = describeDirectHandshakeFailure({
          from, port, self, errorCode: socket.__labError, reason,
        });
        if (notice.countsAsDevice) this.stats.directHandshakeErrors += 1;
        this.log[notice.level](notice.message);
      };

      socket.__labWatchdog = setTimeout(() => noHandshake(`still open after ${HANDSHAKE_GRACE_MS / 1000}s`), HANDSHAKE_GRACE_MS);
      socket.on('close', () => {
        this.sockets.delete(socket);
        clearTimeout(socket.__labWatchdog);
        // A device that rejects our certificate drops the connection within
        // milliseconds, long before the watchdog fires, so the close event is what
        // actually reports the missing root CA in the common case.
        noHandshake('connection closed before the handshake completed');
      });
    });

    // Kept for visibility only. This event carries no usable peer address and also
    // fires for an abrupt client teardown after a *successful* handshake, so it is
    // never used to report that the device failed.
    this.tlsServer.on('tlsClientError', (err) => {
      this.log.debug(`direct TLS client error: ${err.code || ''} ${err.message}`);
    });

    await new Promise((resolve, reject) => {
      const onError = (err) => reject(err);
      this.tlsServer.once('error', onError);
      this.tlsServer.listen(port, '0.0.0.0', () => {
        this.tlsServer.removeListener('error', onError);
        resolve();
      });
    });

    this.log.info(`direct TLS listener on 0.0.0.0:${port} - device needs DNS only, no proxy setting`);
  }

  #onDirectTls(tlsSocket) {
    this.stats.directTls += 1;

    // Silence the accept watchdog and reuse the peer address captured then:
    // `tlsSocket._parent` is the exact socket passed to the server's 'connection'
    // event (verified on this Node), and `remoteAddress` is already reliable here.
    const parent = tlsSocket._parent;
    if (parent) {
      parent.__labHandshakeDone = true;
      clearTimeout(parent.__labWatchdog);
    }

    const servername = tlsSocket.servername || null;
    const remote = (parent && parent.__labPeer) || `${tlsSocket.remoteAddress}:${tlsSocket.remotePort}`;

    if (!servername) {
      this.stats.directNoSni += 1;
      this.log.warn(`direct TLS from ${remote} sent no SNI; cannot tell which Store host it wanted`);
      tlsSocket.destroy();
      return;
    }

    if (!this.#shouldMitm(servername)) {
      this.stats.directRejected += 1;
      this.log.warn(`direct TLS from ${remote} for ${servername}, which is not intercepted; dropping`);
      tlsSocket.destroy();
      return;
    }

    this.stats.mitm += 1;
    tlsSocket.__network = {
      host: servername,
      // The port the *device* means, not the port we happen to listen on: a
      // hijacked URL is ordinary HTTPS, so the upstream is reached on 443 even
      // when the listener was moved (port forwarding, tests).
      port: 443,
      listenPort: this.config.proxy.tlsPort,
      mitm: true,
      direct: true,
      clientAddress: tlsSocket.remoteAddress,
      clientPort: tlsSocket.remotePort,
    };
    tlsSocket.on('error', (err) => this.log.debug(`direct TLS error for ${servername}: ${err.message}`));
    this.log.info(`DIRECT ${servername} from ${remote} (DNS-only setup)`);

    this.httpServer.emit('connection', tlsSocket);
  }

  // ---------------------------------------------------------------- CONNECT

  async #onConnect(req, clientSocket, head) {
    this.stats.connect += 1;
    const { host, port } = splitHostPort(req.url);
    const effectivePort = port || 443;

    if (!host) {
      clientSocket.end('HTTP/1.1 400 Bad Request\r\n\r\n');
      return;
    }
    if (matchesAny(host, this.config.proxy.tunnel.blockHosts)) {
      this.log.warn(`BLOCK CONNECT ${host}:${effectivePort}`);
      clientSocket.end('HTTP/1.1 403 Forbidden\r\n\r\n');
      return;
    }

    // Name the target on every CONNECT, tunnelled ones included.
    //
    // A tunnel is still evidence: it records the endpoint the device asked for,
    // even though the body is deliberately never decrypted. It matters because
    // this is the only path that works *before* the root CA is installed on the
    // device, so the endpoint map must survive the default log level. Previously
    // a tunnel was only mentioned in a debug line on close, which made an
    // explicit-proxy device look silent to anyone running without LOG_LEVEL=debug.
    const mitm = this.#shouldMitm(host);
    this.log.info(`CONNECT ${host}:${effectivePort} from ${req.socket.remoteAddress} -> ${mitm ? 'mitm' : 'tunnel'}`);

    if (!mitm) {
      if (matchesAny(host, this.config.dns.hijack.names)) {
        // Would loop straight back into this server.
        this.log.error(`CONNECT ${host} is hijacked but not in mitm.hosts: refusing to tunnel into ourselves`);
        clientSocket.end('HTTP/1.1 502 Bad Gateway\r\n\r\n');
        return;
      }
      this.#tunnel(host, effectivePort, clientSocket, head);
      return;
    }

    this.stats.mitm += 1;

    let context;
    try {
      context = await this.pki.secureContextFor(host);
    } catch (err) {
      this.log.error(`cannot MITM ${host}, falling back to tunnel: ${err.message}`);
      this.#tunnel(host, effectivePort, clientSocket, head);
      return;
    }

    clientSocket.write('HTTP/1.1 200 Connection Established\r\nProxy-Agent: wp8-store-lab\r\n\r\n');

    const tlsSocket = new tls.TLSSocket(clientSocket, {
      isServer: true,
      secureContext: context,
      SNICallback: (servername, cb) => {
        this.pki.secureContextFor(servername || host)
          .then((ctx) => cb(null, ctx))
          .catch((err) => cb(err));
      },
    });

    tlsSocket.__network = {
      host,
      port: effectivePort,
      mitm: true,
      clientAddress: clientSocket.remoteAddress,
      clientPort: clientSocket.remotePort,
    };
    tlsSocket.on('error', (err) => this.log.debug(`TLS error on ${host}: ${err.message}`));

    this.httpServer.emit('connection', tlsSocket);
  }

  #tunnel(host, port, clientSocket, head) {
    this.stats.tunnel += 1;
    const startedAt = Date.now();
    let bytesUp = 0;
    let bytesDown = 0;

    const upstream = net.connect({ host, port }, () => {
      clientSocket.write('HTTP/1.1 200 Connection Established\r\nProxy-Agent: wp8-store-lab\r\n\r\n');
      if (head && head.length) {
        upstream.write(head);
        bytesUp += head.length;
      }
      upstream.pipe(clientSocket);
      clientSocket.pipe(upstream);
    });

    clientSocket.on('data', (chunk) => { bytesUp += chunk.length; });
    upstream.on('data', (chunk) => { bytesDown += chunk.length; });

    upstream.on('error', (err) => {
      this.log.warn(`tunnel ${host}:${port} upstream error: ${err.message}`);
      try { clientSocket.end('HTTP/1.1 502 Bad Gateway\r\n\r\n'); } catch { /* gone */ }
    });
    clientSocket.on('error', () => { try { upstream.destroy(); } catch { /* gone */ } });

    upstream.on('close', () => {
      this.stats.tunnelBytes += bytesUp + bytesDown;
      this.log.debug(`tunnel ${host}:${port} closed up=${bytesUp} down=${bytesDown} in ${Date.now() - startedAt}ms`);
      try { clientSocket.end(); } catch { /* gone */ }
    });
    clientSocket.on('close', () => { try { upstream.end(); } catch { /* gone */ } });
  }

  // ---------------------------------------------------------------- requests

  #isAdminRequest(host, pathname) {
    if (!pathname.startsWith(ADMIN_PREFIX)) return false;
    const local = new Set(['127.0.0.1', 'localhost', '::1', this.config.__advertiseIp, '0.0.0.0']);
    return local.has(host);
  }

  async #onRequest(req, res) {
    this.stats.requests += 1;
    const startedAt = Date.now();
    const id = ++this.requestCounter;
    const network = req.socket.__network;

    let host;
    let port;
    let scheme;
    let requestPath;

    if (network) {
      // We only ever terminate TLS, so a CONNECTed request is always an HTTPS
      // request upstream regardless of which port the client addressed.
      host = network.host;
      port = network.port;
      scheme = 'https';
      requestPath = req.url;
    } else if (/^https?:\/\//i.test(req.url)) {
      const url = new URL(req.url);
      host = url.hostname;
      scheme = url.protocol.replace(':', '');
      port = Number(url.port || (scheme === 'https' ? 443 : 80));
      requestPath = `${url.pathname}${url.search}`;
    } else {
      const [rawHost, rawPort] = String(req.headers.host || '').split(':');
      host = rawHost;
      port = Number(rawPort || 80);
      scheme = 'http';
      requestPath = req.url;
    }

    const pathname = requestPath.split('?')[0];

    if (this.#isAdminRequest(host, pathname)) {
      await this.#handleAdmin(req, res, { host, port, scheme, path: requestPath });
      return;
    }

    const body = await this.#readRequestBody(req);
    const ctx = {
      id,
      host,
      port,
      scheme,
      method: req.method,
      path: requestPath,
      headers: req.headers,
      body,
      mitm: Boolean(network),
      client: network
        ? { address: network.clientAddress, port: network.clientPort }
        : { address: req.socket.remoteAddress, port: req.socket.remotePort },
    };

    let decision = 'passthrough';
    let response = null;
    let error = null;

    try {
      if (this.router) {
        const handled = await this.router.handle(ctx, {
          proxy: this, config: this.config, logger: this.log, zinc: this.zinc,
        });
        if (handled) {
          decision = handled.decision || 'router';
          response = { status: handled.status, headers: handled.headers || {}, body: handled.body || Buffer.alloc(0) };
        }
      }

      if (!response) {
        const rule = decide(this.config.rules, ctx);
        const outcome = await this.#applyRule(rule, ctx);
        decision = outcome.decision;
        response = outcome.response;
        error = outcome.error || null;
      }
    } catch (err) {
      error = err.message;
      this.stats.upstreamErrors += 1;
      this.log.error(`upstream failure for ${req.method} ${scheme}://${host}${requestPath}: ${err.message}`);
      response = {
        status: 502,
        headers: { 'content-type': 'application/json; charset=utf-8' },
        body: Buffer.from(JSON.stringify({
          error: 'upstream_unreachable',
          target: `${scheme}://${host}${requestPath}`,
          detail: err.message,
          hint: 'No rule handled this request and the real backend could not be reached.',
        }, null, 2)),
      };
    }

    this.#send(req, res, response);

    void this.capture.record({
      durationMs: Date.now() - startedAt,
      client: ctx.client,
      mitm: ctx.mitm,
      decision,
      request: {
        method: ctx.method,
        scheme: ctx.scheme,
        host: ctx.host,
        port: ctx.port,
        path: ctx.path,
        httpVersion: req.httpVersion,
        headers: ctx.headers,
        body: ctx.body,
      },
      response: { status: response.status, headers: response.headers, body: response.body },
      error,
    });
  }

  async #applyRule(rule, ctx) {
    const action = rule ? rule.action : 'passthrough';

    switch (action) {
      case 'block': {
        this.stats.block += 1;
        return {
          decision: `block:${rule.name}`,
          response: {
            status: rule.status || 403,
            headers: { 'content-type': 'text/plain; charset=utf-8', ...(rule.headers || {}) },
            body: Buffer.from('blocked by rule'),
          },
        };
      }

      case 'mock': {
        this.stats.mock += 1;
        const body = resolveMockBody(rule);
        return {
          decision: `mock:${rule.name}`,
          response: {
            status: rule.status || 200,
            headers: { 'content-type': 'application/json; charset=utf-8', ...(rule.headers || {}) },
            body,
          },
        };
      }

      case 'redirect': {
        const target = new URL(rule.redirect);
        const upstream = await this.#fetchUpstream({
          scheme: target.protocol.replace(':', ''),
          host: target.hostname,
          port: Number(target.port || (target.protocol === 'https:' ? 443 : 80)),
          method: rule.method || 'GET',
          path: `${target.pathname}${target.search}`,
          headers: {},
          body: Buffer.alloc(0),
        });
        this.stats.redirect += 1;
        return {
          decision: `redirect:${rule.name}`,
          response: { status: upstream.status, headers: upstream.headers, body: upstream.body },
        };
      }

      case 'rewrite': {
        const upstream = await this.#fetchUpstream(ctx);
        const patched = applyRewrites(upstream.body, rule.rewrites, {
          contentType: upstream.headers['content-type'] || '',
          contentEncoding: upstream.headers['content-encoding'] || '',
        });
        const headers = { ...upstream.headers };
        delete headers['content-encoding'];
        delete headers['transfer-encoding'];
        headers['content-length'] = String(patched.body.length);
        if (patched.contentTypeHint) headers['content-type'] = patched.contentTypeHint;
        this.stats.rewrite += 1;
        this.log.info(`rewrite ${ctx.method} ${ctx.host}${ctx.path} [${patched.applied.join(', ')}]`);
        return {
          decision: `rewrite:${rule.name}`,
          response: { status: upstream.status, headers, body: patched.body },
        };
      }

      case 'passthrough':
      default: {
        const upstream = await this.#fetchUpstream(ctx);
        this.stats.passthrough += 1;
        return {
          decision: rule ? `passthrough:${rule.name}` : 'passthrough',
          response: { status: upstream.status, headers: upstream.headers, body: upstream.body },
        };
      }
    }
  }

  #readRequestBody(req) {
    return new Promise((resolve, reject) => {
      const chunks = [];
      let size = 0;
      req.on('data', (chunk) => {
        size += chunk.length;
        if (size > MAX_REQUEST_BODY) {
          reject(new Error(`request body exceeds ${MAX_REQUEST_BODY} bytes`));
          req.destroy();
          return;
        }
        chunks.push(chunk);
      });
      req.on('end', () => resolve(Buffer.concat(chunks)));
      req.on('error', reject);
    });
  }

  #fetchUpstream({ scheme, host, port, method, path: requestPath, headers, body }) {
    return new Promise((resolve, reject) => {
      const isHttps = scheme === 'https';
      const transport = isHttps ? https : http;
      const outgoing = { ...(headers || {}) };
      delete outgoing['proxy-connection'];
      delete outgoing['proxy-authorization'];
      delete outgoing.connection;
      delete outgoing['keep-alive'];
      if (body && body.length) outgoing['content-length'] = String(body.length);
      else if (['GET', 'HEAD'].includes(String(method).toUpperCase())) delete outgoing['content-length'];

      const timeoutMs = this.config.upstream.timeoutMs;
      const request = transport.request(
        {
          host,
          port,
          method,
          path: requestPath,
          headers: outgoing,
          servername: isHttps && net.isIP(host) === 0 ? host : undefined,
          rejectUnauthorized: !this.config.upstream.insecure,
          timeout: timeoutMs,
        },
        (upstreamResponse) => {
          const chunks = [];
          upstreamResponse.on('data', (chunk) => chunks.push(chunk));
          upstreamResponse.on('end', () => resolve({
            status: upstreamResponse.statusCode,
            headers: upstreamResponse.headers,
            body: Buffer.concat(chunks),
          }));
          upstreamResponse.on('error', reject);
        },
      );

      request.on('timeout', () => request.destroy(new Error(`upstream timeout after ${timeoutMs}ms`)));
      request.on('error', reject);
      if (body && body.length) request.write(body);
      request.end();
    });
  }

  #send(req, res, response) {
    const headers = { ...response.headers };
    delete headers['transfer-encoding'];
    delete headers.connection;
    delete headers['keep-alive'];
    headers['content-length'] = String(response.body.length);
    headers['x-wp8-lab'] = '1';
    try {
      res.writeHead(response.status, headers);
    } catch {
      // headers already invalid (e.g. duplicate set-cookie in an object); retry minimal
      res.writeHead(response.status, { 'content-type': 'application/octet-stream', 'content-length': String(response.body.length) });
    }
    if (String(req.method).toUpperCase() === 'HEAD') res.end();
    else res.end(response.body);
  }

  // ------------------------------------------------------------------ admin

  async #handleAdmin(req, res, { path: requestPath }) {
    const pathname = requestPath.split('?')[0];
    const json = (status, payload) => {
      const body = Buffer.from(JSON.stringify(payload, null, 2));
      res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'content-length': String(body.length) });
      res.end(body);
    };

    try {
      if (pathname === ADMIN_PREFIX || pathname === `${ADMIN_PREFIX}ui`) {
        res.writeHead(200, {
          'content-type': 'text/html; charset=utf-8',
          'content-length': String(Buffer.byteLength(DASHBOARD_HTML)),
        });
        res.end(DASHBOARD_HTML);
        return;
      }

      if (pathname === `${ADMIN_PREFIX}status`) {
        json(200, {
          pid: process.pid,
          uptimeMs: Date.now() - this.startedAt,
          advertiseIp: this.config.__advertiseIp,
          hijackIp: this.config.__hijackIp,
          dns: { port: this.config.dns.port, hijack: this.config.dns.hijack.names },
          proxy: {
            port: this.config.proxy.port,
            mitmMode: this.config.proxy.mitm.mode,
            mitmHosts: this.config.proxy.mitm.hosts,
          },
          rules: this.config.rules.map((r) => ({ name: r.name, action: r.action })),
          storeHandlers: this.router ? this.router.describe() : [],
          storeRouterStats: this.router ? this.router.stats : null,
          livestore: {
            baseUrl: this.config.livestore.baseUrl,
            apiKeyConfigured: Boolean(this.config.livestore.apiKey),
            bridge: this.config.livestore.bridge || null,
          },
          stats: this.stats,
          captureSession: prettyPath(this.capture.sessionDir),
          ca: await this.pki.info(),
        });
        return;
      }

      if (pathname === `${ADMIN_PREFIX}ca.crt`) {
        const pem = await this.pki.caPem();
        res.writeHead(200, {
          'content-type': 'application/x-pem-file',
          'content-disposition': 'attachment; filename="wp8-store-lab-ca.crt"',
          'content-length': String(Buffer.byteLength(pem)),
        });
        res.end(pem);
        return;
      }

      if (pathname === `${ADMIN_PREFIX}ca.der`) {
        const der = await fsp.readFile(path.join(this.config.pki.dir, 'ca.der'));
        res.writeHead(200, {
          'content-type': 'application/pkix-cert',
          'content-disposition': 'attachment; filename="wp8-store-lab-ca.cer"',
          'content-length': String(der.length),
        });
        res.end(der);
        return;
      }

      if (pathname === `${ADMIN_PREFIX}captures`) {
        const limit = Number(new URL(requestPath, 'http://lab').searchParams.get('limit') || 50);
        const lines = (await fsp.readFile(this.capture.indexPath, 'utf8').catch(() => ''))
          .split('\n')
          .filter(Boolean)
          .slice(-Math.max(1, Math.min(limit, 1000)))
          .map((line) => {
            try { return JSON.parse(line); } catch { return { unparsable: line }; }
          });
        json(200, { session: this.capture.sessionDir, count: lines.length, exchanges: lines });
        return;
      }

      if (pathname === `${ADMIN_PREFIX}reload` && req.method === 'POST') {
        if (!this.onReload) {
          json(501, { error: 'reload not wired up' });
          return;
        }
        const summary = await this.onReload();
        this.log.info('configuration reloaded from disk');
        json(200, { reloaded: true, ...summary });
        return;
      }

      json(404, {
        error: 'unknown admin endpoint',
        endpoints: [
          `GET  ${ADMIN_PREFIX}`,
          `GET  ${ADMIN_PREFIX}status`,
          `GET  ${ADMIN_PREFIX}ca.crt`,
          `GET  ${ADMIN_PREFIX}ca.der`,
          `GET  ${ADMIN_PREFIX}captures?limit=50`,
          `POST ${ADMIN_PREFIX}reload`,
        ],
      });
    } catch (err) {
      json(500, { error: err.message });
    }
  }

  async stop() {
    for (const socket of this.sockets) {
      try { socket.destroy(); } catch { /* gone */ }
    }
    this.sockets.clear();
    if (this.tlsServer) {
      await new Promise((resolve) => this.tlsServer.close(resolve));
    }
    if (this.httpServer) {
      await new Promise((resolve) => this.httpServer.close(resolve));
    }
    if (this.plainServer) {
      await new Promise((resolve) => this.plainServer.close(resolve));
    }
  }
}
