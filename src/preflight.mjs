// Preflight port checks.
//
// Two ports matter and both are easy to lose to unrelated software:
//   53/udp  DNS        - Windows Internet Connection Sharing (svchost) grabs it
//                        whenever Mobile hotspot / connection sharing is on
//   8080/tcp proxy     - a very popular port; Steam's web helper takes it too
//   80/tcp  plain HTTP - frequently claimed by IIS, Skype and various updaters
//
// A conflict found here is reported with the owning process and a concrete fix,
// instead of a bare EADDRINUSE stack trace half way through startup.

import net from 'node:net';
import dgram from 'node:dgram';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { dnsBindCandidates } from './config.mjs';

const execFileAsync = promisify(execFile);

/**
 * Try to bind exactly the way the real service will.
 *
 * Windows lets a wildcard bind succeed while a more specific address on the same
 * port is already taken (`127.0.0.1:8888` held by IpOverUsbSvc, for example),
 * and then routes loopback traffic to the *other* process. Both addresses are
 * therefore probed, because the operator will open the dashboard on loopback.
 */
export function probeTcp(port) {
  return (async () => {
    for (const address of ['0.0.0.0', '127.0.0.1']) {
      const result = await new Promise((resolve) => {
        const server = net.createServer();
        server.once('error', (err) => resolve({ ok: false, code: err.code }));
        server.listen(port, address, () => server.close(() => resolve({ ok: true })));
      });
      if (!result.ok) return { ...result, address };
    }
    return { ok: true };
  })();
}

/** UDP probe: succeeds if ANY of the candidate addresses can be bound. */
export function probeUdp(port, addresses = ['0.0.0.0']) {
  return (async () => {
    const failures = [];
    for (const address of addresses) {
      const result = await new Promise((resolve) => {
        const socket = dgram.createSocket('udp4');
        socket.once('error', (err) => resolve({ ok: false, code: err.code }));
        socket.bind(port, address, () => socket.close(() => resolve({ ok: true })));
      });
      if (result.ok) return { ok: true, address };
      failures.push(`${address}=${result.code}`);
    }
    return { ok: false, code: 'EADDRINUSE', failures };
  })();
}

/** Best-effort "who holds this port" for the operator. */
export async function describePortOwner(port, type, address = null) {
  if (process.platform !== 'win32') return null;
  try {
    const filter = address ? ` | Where-Object { $_.LocalAddress -eq '${address}' }` : '';
    const script = type === 'udp'
      ? `$e = Get-NetUDPEndpoint -LocalPort ${port} -ErrorAction SilentlyContinue${filter} | Select-Object -First 1;`
        + ` if ($e) { $p = Get-Process -Id $e.OwningProcess -ErrorAction SilentlyContinue;`
        + ' "$($e.OwningProcess)|$($p.ProcessName)" }'
      : `$e = Get-NetTCPConnection -LocalPort ${port} -State Listen -ErrorAction SilentlyContinue${filter} | Select-Object -First 1;`
        + ` if ($e) { $p = Get-Process -Id $e.OwningProcess -ErrorAction SilentlyContinue;`
        + ' "$($e.OwningProcess)|$($p.ProcessName)" }';
    const { stdout } = await execFileAsync('powershell', ['-NoProfile', '-Command', script], { timeout: 15000 });
    const text = stdout.trim();
    if (!text) return null;
    const [pid, name] = text.split('|');
    return { pid: Number(pid), name: name || 'unknown' };
  } catch {
    return null;
  }
}

function remediation(port, type, owner) {
  if (port === 443 && type === 'tcp') {
    return [
      'The direct TLS listener needs 443 so a DNS-only device can reach the lab.',
      owner
        ? `Stop ${owner.name} (PID ${owner.pid}), or set proxy.tlsEnabled=false and use an explicit HTTP proxy on the device instead.`
        : 'Change proxy.tlsPort, or set proxy.tlsEnabled=false and configure an HTTP proxy on the device instead.',
    ];
  }
  if (port === 80 && type === 'tcp') {
    return [
      'The plain-HTTP listener captures Windows Phone 8.1 store lookups, which are served over HTTP on 80.',
      owner
        ? `Stop ${owner.name} (PID ${owner.pid}), or set proxy.httpEnabled=false and rely on DNS + 443 only.`
        : 'Change proxy.httpPort, or set proxy.httpEnabled=false and rely on DNS + 443 only.',
    ];
  }
  if (port === 53 && type === 'udp') {
    return [
      'DNS must answer on 53; the phone cannot be told to use another port.',
      owner?.name === 'svchost'
        ? 'Windows Internet Connection Sharing (SharedAccess) is holding it. '
          + 'Turn off Mobile hotspot / Internet connection sharing, or run: sc stop SharedAccess'
        : 'Stop whichever service owns the port, then start the lab again.',
    ];
  }
  if (owner) {
    return [`Stop ${owner.name} (PID ${owner.pid}) or change the port in config.json.`];
  }
  return ['Change the port in config.json.'];
}

/**
 * @returns {Promise<{ok: boolean, problems: Array<{label:string,port:number,type:string,owner:object|null,advice:string[]}>}>}
 */
export async function preflight(config, { only = null } = {}) {
  const checks = [];
  if (config.dns.enabled && only !== 'proxy') {
    const addresses = dnsBindCandidates(config);
    checks.push({
      label: 'DNS',
      port: config.dns.port,
      type: 'udp',
      probe: (port) => probeUdp(port, addresses),
    });
  }
  if (config.proxy.enabled && only !== 'dns') {
    checks.push({ label: 'proxy', port: config.proxy.port, type: 'tcp', probe: probeTcp });
    if (config.proxy.tlsEnabled) {
      checks.push({ label: 'tls', port: config.proxy.tlsPort, type: 'tcp', probe: probeTcp });
    }
    if (config.proxy.httpEnabled) {
      checks.push({ label: 'http', port: config.proxy.httpPort, type: 'tcp', probe: probeTcp });
    }
  }

  const problems = [];
  for (const check of checks) {
    const result = await check.probe(check.port);
    if (result.ok) continue;
    const owner = result.code === 'EADDRINUSE'
      ? await describePortOwner(check.port, check.type, result.address || null)
      : null;
    problems.push({
      label: check.label,
      port: check.port,
      type: check.type,
      address: result.address || null,
      code: result.code,
      owner,
      advice: result.code === 'EADDRINUSE'
        ? remediation(check.port, check.type, owner)
        : ['The operating system refused the bind; check permissions and firewall rules.'],
    });
  }

  return { ok: problems.length === 0, problems };
}

/** Rendered for the console. */
export function formatProblems(problems) {
  const lines = ['', 'Cannot start: these ports are not available.', ''];
  for (const problem of problems) {
    const who = problem.owner ? ` held by ${problem.owner.name} (PID ${problem.owner.pid})` : '';
    const where = problem.address ? ` on ${problem.address}` : '';
    lines.push(`  ${problem.label.padEnd(6)} ${problem.type}/${problem.port}${where}  ${problem.code}${who}`);
    for (const advice of problem.advice) lines.push(`         -> ${advice}`);
    lines.push('');
  }
  lines.push('  Fix the conflicts and start again, or pass --force to try anyway.', '');
  return lines.join('\n');
}
