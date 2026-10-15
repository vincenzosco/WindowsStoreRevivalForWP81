#!/usr/bin/env node
// Raw UDP DNS probe: build a query by hand, send it, decode the reply.
//
//   node tools/dnsprobe.mjs wscont1.apps.microsoft.com --port 5353
//   node tools/dnsprobe.mjs example.com --type AAAA
//
// Exists because nslookup cannot target a non-standard port, and the DNS server
// has to be testable while the device is not connected.

import dgram from 'node:dgram';
import { isMainModule } from '../src/paths.mjs';
import { parseQuestion } from '../src/dns-server.mjs';

const TYPE_CODES = { A: 1, NS: 2, CNAME: 5, PTR: 12, MX: 15, TXT: 16, AAAA: 28, SRV: 33, HTTPS: 65 };

export function buildQuery(name, typeCode = 1, id = 0x1234) {
  const header = Buffer.alloc(12);
  header.writeUInt16BE(id, 0);
  header.writeUInt16BE(0x0100, 2); // standard query, recursion desired
  header.writeUInt16BE(1, 4);
  const labels = String(name).split('.').filter(Boolean);
  const parts = labels.map((label) => {
    const buf = Buffer.from(label, 'ascii');
    return Buffer.concat([Buffer.from([buf.length]), buf]);
  });
  // Layout after the labels: [0x00 QNAME terminator][QTYPE][QCLASS]
  const tail = Buffer.alloc(5);
  tail[0] = 0;
  tail.writeUInt16BE(typeCode, 1);
  tail.writeUInt16BE(1, 3); // class IN
  return Buffer.concat([header, ...parts, tail]);
}

/** Decode the answer section well enough to print records. */
export function decodeReply(msg) {
  const question = parseQuestion(msg);
  const result = {
    id: msg.readUInt16BE(0),
    rcode: msg.readUInt16BE(2) & 0x0f,
    flags: msg.readUInt16BE(2),
    qname: question ? question.qname : null,
    answers: [],
  };

  const ancount = msg.readUInt16BE(6);
  if (!question || ancount === 0) return result;

  let offset = question.questionEnd;
  for (let i = 0; i < ancount; i += 1) {
    const first = msg[offset];
    if ((first & 0xc0) === 0xc0) offset += 2;
    else {
      while (offset < msg.length && msg[offset] !== 0) offset += 1 + msg[offset];
      offset += 1;
    }
    const type = msg.readUInt16BE(offset);
    const ttl = msg.readUInt32BE(offset + 4);
    const rdlength = msg.readUInt16BE(offset + 8);
    const rdata = msg.subarray(offset + 10, offset + 10 + rdlength);
    let value = rdata.toString('hex');
    if (type === 1 && rdlength === 4) value = [...rdata].join('.');
    if (type === 28 && rdlength === 16) {
      value = Array.from({ length: 8 }, (_, k) => rdata.readUInt16BE(k * 2).toString(16)).join(':');
    }
    result.answers.push({ type, ttl, value });
    offset += 10 + rdlength;
  }
  return result;
}

export function query(name, { server = '127.0.0.1', port = 53, type = 'A', timeoutMs = 5000 } = {}) {
  const typeCode = TYPE_CODES[String(type).toUpperCase()] ?? Number(type) ?? 1;
  const packet = buildQuery(name, typeCode);
  return new Promise((resolve, reject) => {
    const socket = dgram.createSocket('udp4');
    const timer = setTimeout(() => {
      socket.close();
      reject(new Error(`no reply from ${server}:${port} within ${timeoutMs}ms`));
    }, timeoutMs);
    socket.on('message', (msg) => {
      clearTimeout(timer);
      socket.close();
      resolve(decodeReply(msg));
    });
    socket.on('error', (err) => {
      clearTimeout(timer);
      try { socket.close(); } catch { /* ignore */ }
      reject(err);
    });
    socket.send(packet, port, server, (err) => {
      if (err) {
        clearTimeout(timer);
        try { socket.close(); } catch { /* ignore */ }
        reject(err);
      }
    });
  });
}

if (isMainModule(import.meta.url)) {
  const name = process.argv[2];
  if (!name) {
    console.error('usage: node tools/dnsprobe.mjs <name> [--server ip] [--port n] [--type A]');
    process.exit(2);
  }
  const flag = (key, fallback) => {
    const i = process.argv.indexOf(`--${key}`);
    return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
  };
  try {
    const reply = await query(name, {
      server: flag('server', '127.0.0.1'),
      port: Number(flag('port', 53)),
      type: flag('type', 'A'),
    });
    console.log(JSON.stringify(reply, null, 2));
  } catch (err) {
    console.error(`probe failed: ${err.message}`);
    process.exit(1);
  }
}
