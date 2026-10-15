#!/usr/bin/env node
// Port canary: listen on the ports a Store client might use *instead of* the one
// the lab serves, and report anything that connects.
//
// Why this exists: a device can resolve a hijacked name to the lab and still
// never appear in the proxy, because it connects to a port nothing is listening
// on. Windows answers that with a RST, the client retries, and the retry only
// shows up as another DNS query - so the lab looks idle while the device is in
// fact trying, over and over. A silent port leaves no evidence anywhere.
//
//   node tools/canary.mjs                      # 8080,8000,8443,9443
//   node tools/canary.mjs --ports 80,443       # explicit list
//   node tools/canary.mjs --seconds 600        # stop after 10 minutes
//
// Connections from this PC are labelled as such and never counted as the device,
// for the same reason `watch` filters them: our own probes must not look like
// evidence that the phone arrived.

import net from 'node:net';
import os from 'node:os';

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i !== -1 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : fallback;
};

// 80 is deliberately absent: the lab serves it (proxy.httpPort), so watching it
// here would only collide. These are the ports a client might use *instead*.
const ports = flag('ports', '8080,8000,8443,9443').split(',').map((p) => Number(p.trim())).filter(Boolean);
const seconds = Number(flag('seconds', 0));

const localClients = new Set(['127.0.0.1', '::1', '0.0.0.0']);
for (const addresses of Object.values(os.networkInterfaces())) {
  for (const address of addresses || []) localClients.add(address.address);
}

const stamp = () => new Date().toISOString().slice(11, 19);
let hits = 0;

console.log(`port canary: watching ${ports.join(', ')} for connections the lab does not serve`);
console.log('a device that resolves a hijacked name but never reaches the proxy lands here.\n');

const servers = [];
for (const port of ports) {
  const server = net.createServer((socket) => {
    const self = localClients.has(socket.remoteAddress);
    const from = `${socket.remoteAddress}:${socket.remotePort}`;
    let head = Buffer.alloc(0);

    if (!self) hits += 1;
    console.log(`  ${self ? 'self ' : 'DEVICE'} ${stamp()}  :${port}  from ${from}`
      + (self ? '  (this PC, not the device)' : '  <- the device tried this port'));

    // Capture whatever it says first: for HTTP that is the request line, which
    // names the exact endpoint the client wanted.
    socket.on('data', (chunk) => {
      head = Buffer.concat([head, chunk]).subarray(0, 400);
      const firstLine = head.toString('utf8').split('\r\n')[0];
      if (firstLine) {
        process.stdout.write(`                         says: ${JSON.stringify(firstLine.slice(0, 120))}\n`);
      }
    });
    socket.on('error', () => { /* client vanished; nothing to report */ });
    socket.on('close', () => {
      if (!head.length) console.log('                         connected and sent nothing');
    });

    // Give a real client time to speak, then close so it can retry cleanly.
    setTimeout(() => socket.destroy(), 4000);
  });

  server.on('error', (err) => {
    console.log(`  skip  :${port} - ${err.code === 'EADDRINUSE' ? 'already in use on this PC' : err.message}`);
  });
  server.listen(port, '0.0.0.0', () => servers.push(server));
}

const stop = () => {
  for (const server of servers) { try { server.close(); } catch { /* already closed */ } }
  console.log(`\nport canary stopped. ${hits} connection(s) from outside this PC.`);
  process.exit(hits > 0 ? 0 : 2);
};

if (seconds > 0) setTimeout(stop, seconds * 1000);
process.on('SIGINT', stop);
