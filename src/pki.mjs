// PKI for the WP8.1 interception lab.
//
// Zero-dependency: the root CA and every leaf certificate are produced by the
// openssl CLI (OpenSSL 3.x) and cached on disk under <caDir>/. Leaf certificates
// are generated on first use per hostname and reused afterwards, so the noise of
// spawning openssl happens once per host.
//
// Leaf profile (chosen for the Windows Phone 8.1 TLS stack):
//   RSA 2048, SHA-256, exact match subjectAltName, EKU serverAuth.
//   WP8.1 rejects SHA-1 certificates and does not honour CN-only matches.

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import net from 'node:net';
import tls from 'node:tls';
import crypto from 'node:crypto';

const execFileAsync = promisify(execFile);

/** Candidate openssl binaries, tried in order until one answers `openssl version`. */
const OPENSSL_CANDIDATES = [
  process.env.OPENSSL_BIN,
  'openssl',
  'openssl.exe',
  'C:/Program Files/Git/usr/bin/openssl.exe',
  'C:/Program Files/Git/mingw64/bin/openssl.exe',
  'C:/Program Files/OpenSSL-Win64/bin/openssl.exe',
  '/usr/bin/openssl',
  '/usr/local/bin/openssl',
].filter(Boolean);

export function isIpLiteral(host) {
  return net.isIP(host) !== 0;
}

/** Filesystem-safe name for a hostname. */
export function safeHostName(host) {
  return String(host).replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 180);
}

export class Pki {
  /**
   * @param {object} opts
   * @param {string} opts.dir        Directory for the CA and the leaf cache.
   * @param {string} opts.commonName CA subject common name.
   * @param {number} opts.days       CA validity in days.
   * @param {number} opts.leafDays   Leaf validity in days.
   * @param {string} [opts.openssl]  Explicit openssl path; auto-detected when empty.
   * @param {(msg: string, extra?: object) => void} [opts.log]
   */
  constructor({ dir, commonName, days, leafDays, openssl = '', log = () => {} }) {
    this.dir = dir;
    this.leafDir = path.join(dir, 'leaves');
    this.commonName = commonName;
    this.days = days;
    this.leafDays = leafDays;
    this.opensslPreference = openssl;
    this.log = log;

    this.caKeyPath = path.join(dir, 'ca.key');
    this.caCrtPath = path.join(dir, 'ca.crt');
    this.caDerPath = path.join(dir, 'ca.der');
    this.caInfoPath = path.join(dir, 'ca-info.json');
    this.serialPath = path.join(dir, 'ca.srl');
    this.opensslBin = null;

    /** @type {Map<string, tls.SecureContext>} */
    this.contexts = new Map();
    /** @type {Map<string, Promise<{key: string, cert: string}>>} */
    this.inflight = new Map();
  }

  async init() {
    await fsp.mkdir(this.leafDir, { recursive: true });
    this.opensslBin = await this.#resolveOpenssl();
    await this.#ensureCa();
    return this;
  }

  async #resolveOpenssl() {
    const candidates = this.opensslPreference
      ? [this.opensslPreference, ...OPENSSL_CANDIDATES]
      : OPENSSL_CANDIDATES;
    const errors = [];
    for (const candidate of candidates) {
      try {
        const { stdout } = await execFileAsync(candidate, ['version'], { timeout: 15000 });
        const version = stdout.trim();
        if (/^OpenSSL/i.test(version)) {
          this.log(`openssl: ${candidate} (${version})`);
          return candidate;
        }
      } catch (err) {
        errors.push(`${candidate}: ${err.code || err.message}`);
      }
    }
    throw new Error(
      `Cannot find a working openssl binary. Tried: ${candidates.join(', ')}. ` +
        `Install OpenSSL or set "pki.openssl" in config.json. Details: ${errors.join(' | ')}`,
    );
  }

  async #run(args, opts = {}) {
    try {
      return await execFileAsync(this.opensslBin, args, {
        timeout: 60000,
        maxBuffer: 16 * 1024 * 1024,
        windowsHide: true,
        ...opts,
      });
    } catch (err) {
      const stderr = err.stderr ? String(err.stderr).trim() : '';
      throw new Error(`openssl ${args.join(' ')} failed: ${stderr || err.message}`);
    }
  }

  async #ensureCa() {
    const haveKey = fs.existsSync(this.caKeyPath);
    const haveCrt = fs.existsSync(this.caCrtPath);

    if (haveKey && haveCrt) {
      this.log(`CA loaded from ${this.caCrtPath}`);
    } else {
      if (haveKey !== haveCrt) {
        this.log('CA material is incomplete on disk; regenerating both parts');
        await fsp.rm(this.caKeyPath, { force: true });
        await fsp.rm(this.caCrtPath, { force: true });
      }
      this.log(`Generating root CA "${this.commonName}" (${this.days} days)`);
      await this.#run([
        'req', '-x509', '-newkey', 'rsa:2048', '-sha256',
        '-days', String(this.days),
        '-nodes',
        '-keyout', this.caKeyPath,
        '-out', this.caCrtPath,
        '-subj', `/CN=${this.commonName}`,
        '-addext', 'basicConstraints=critical,CA:TRUE,pathlen:0',
        '-addext', 'keyUsage=critical,keyCertSign,cRLSign',
        '-addext', 'subjectKeyIdentifier=hash',
      ]);
      await fsp.rm(this.serialPath, { force: true });
    }

    if (!fs.existsSync(this.caDerPath)) {
      await this.#run(['x509', '-in', this.caCrtPath, '-outform', 'DER', '-out', this.caDerPath]);
    }
    if (!fs.existsSync(this.caInfoPath)) {
      await this.#writeCaInfo();
    }
  }

  async #writeCaInfo() {
    const der = await fsp.readFile(this.caDerPath);
    const thumbprint = crypto.createHash('sha1').update(der).digest('hex').toUpperCase();
    const sha256 = crypto.createHash('sha256').update(der).digest('hex').toUpperCase();
    const { stdout } = await this.#run(['x509', '-in', this.caCrtPath, '-noout', '-subject', '-dates']);
    const info = {
      commonName: this.commonName,
      subject: stdout.trim(),
      sha1Thumbprint: thumbprint,
      sha256Fingerprint: sha256,
      caPem: path.relative(process.cwd(), this.caCrtPath),
      caDer: path.relative(process.cwd(), this.caDerPath),
      generatedAt: new Date().toISOString(),
    };
    await fsp.writeFile(this.caInfoPath, JSON.stringify(info, null, 2));
    return info;
  }

  async info() {
    if (!fs.existsSync(this.caInfoPath)) await this.#writeCaInfo();
    return JSON.parse(await fsp.readFile(this.caInfoPath, 'utf8'));
  }

  /** PEM of the root CA, for serving on a download endpoint to the device. */
  async caPem() {
    return fsp.readFile(this.caCrtPath, 'utf8');
  }

  /**
   * Ensure a leaf certificate exists for `host`.
   * @returns {Promise<{key: string, cert: string, pem: string}>} paths plus PEM text
   */
  async leafFor(host) {
    const safe = safeHostName(host);
    const keyPath = path.join(this.leafDir, `${safe}.key`);
    const csrPath = path.join(this.leafDir, `${safe}.csr`);
    const crtPath = path.join(this.leafDir, `${safe}.crt`);

    if (fs.existsSync(keyPath) && fs.existsSync(crtPath)) {
      return { key: keyPath, cert: crtPath, pem: await fsp.readFile(crtPath, 'utf8') };
    }

    // Serialise generation per host so concurrent SNI handshakes do not race.
    if (this.inflight.has(host)) return this.inflight.get(host);

    const job = (async () => {
      const altName = isIpLiteral(host) ? `IP:${host}` : `DNS:${host}`;
      await this.#run([
        'req', '-new', '-newkey', 'rsa:2048', '-sha256', '-nodes',
        '-keyout', keyPath,
        '-out', csrPath,
        '-subj', `/CN=${host}`,
        '-addext', 'basicConstraints=critical,CA:FALSE',
        '-addext', 'keyUsage=critical,digitalSignature,keyEncipherment',
        '-addext', 'extendedKeyUsage=serverAuth',
        '-addext', `subjectAltName=${altName}`,
      ]);

      const serialArgs = fs.existsSync(this.serialPath)
        ? ['-CAserial', this.serialPath]
        : ['-CAcreateserial'];

      await this.#run([
        'x509', '-req',
        '-in', csrPath,
        '-CA', this.caCrtPath,
        '-CAkey', this.caKeyPath,
        ...serialArgs,
        '-days', String(this.leafDays),
        '-sha256',
        '-copy_extensions', 'copy',
        '-out', crtPath,
      ]);

      await fsp.rm(csrPath, { force: true });
      this.log(`leaf certificate issued for ${host}`);
      return { key: keyPath, cert: crtPath, pem: await fsp.readFile(crtPath, 'utf8') };
    })().finally(() => this.inflight.delete(host));

    this.inflight.set(host, job);
    return job;
  }

  /**
   * Sign a PKCS#10 request the *device* sent, returning the chain to hand back.
   *
   * This is the one place where a caller-supplied key pair becomes a certificate
   * this CA vouches for, so the extensions are fixed here and the request's own
   * are **not** copied: `-copy_extensions` would let a CSR ask for `CA:TRUE` or for
   * a subjectAltName of its choosing, which on a CA that is trusted by the phone
   * for TLS interception is a way to mint a valid certificate for any host. A
   * device certificate needs to be a client certificate and nothing else.
   *
   * The chain is a certs-only PKCS#7 (DER) - the leaf followed by this CA - which
   * is the form `application/c-x509-ca-cert` carries. Results are cached by the
   * hash of the request, so a client that retries the same CSR gets the same
   * certificate instead of a new serial per attempt.
   *
   * @param {Buffer} csrDer DER bytes of the request, exactly as received.
   * @returns {Promise<{der: Buffer, base64: string, pem: string, subject: string, cached: boolean}>}
   */
  async signCsr(csrDer) {
    if (!Buffer.isBuffer(csrDer) || csrDer.length === 0) {
      throw new Error('signCsr needs the DER bytes of a PKCS#10 request');
    }
    const stamp = crypto.createHash('sha256').update(csrDer).digest('hex').slice(0, 32);
    const derPath = path.join(this.leafDir, `device-${stamp}.der`);
    const csrPath = path.join(this.leafDir, `device-${stamp}.csr`);
    const extPath = path.join(this.leafDir, `device-${stamp}.ext`);
    const crtPath = path.join(this.leafDir, `device-${stamp}.crt`);
    const p7bPath = path.join(this.leafDir, `device-${stamp}.p7b`);

    const read = async (cached) => ({
      der: await fsp.readFile(p7bPath),
      base64: (await fsp.readFile(p7bPath)).toString('base64'),
      pem: await fsp.readFile(crtPath, 'utf8'),
      subject: (await this.#run(['x509', '-in', crtPath, '-noout', '-subject']))
        .stdout.trim().replace(/^subject=\s*/, ''),
      cached,
    });

    if (fs.existsSync(p7bPath) && fs.existsSync(crtPath)) return read(true);

    // Serialised per request so two retries cannot both take a serial.
    if (this.inflight.has(stamp)) return this.inflight.get(stamp);

    const job = (async () => {
      await fsp.writeFile(derPath, csrDer);
      // Conversion is also the parse: openssl refuses anything that is not a
      // well-formed PKCS#10, and `-verify` refuses one whose own signature does
      // not check out, so a garbage body cannot reach the signing step. The two
      // are separate calls because `-noout` suppresses the `-out` file as well -
      // one command doing both writes nothing and fails later, on the next step.
      await this.#run(['req', '-inform', 'DER', '-in', derPath, '-out', csrPath]);
      await this.#run(['req', '-in', csrPath, '-noout', '-verify']);

      // Fixed profile. `clientAuth` only, no SAN, `CA:FALSE` - see the method note.
      await fsp.writeFile(extPath, [
        'basicConstraints=critical,CA:FALSE',
        'keyUsage=critical,digitalSignature,keyEncipherment',
        'extendedKeyUsage=clientAuth',
        '',
      ].join('\n'));

      const serialArgs = fs.existsSync(this.serialPath)
        ? ['-CAserial', this.serialPath]
        : ['-CAcreateserial'];

      await this.#run([
        'x509', '-req',
        '-in', csrPath,
        '-CA', this.caCrtPath,
        '-CAkey', this.caKeyPath,
        ...serialArgs,
        '-days', String(this.leafDays),
        '-sha256',
        '-extfile', extPath,
        '-out', crtPath,
      ]);

      // The chain, not just the leaf: a client that validates what it was given
      // needs the issuer in the same blob, which is what the real endpoint's
      // `application/c-x509-ca-cert` carries.
      await this.#run([
        'crl2pkcs7', '-nocrl',
        '-certfile', crtPath,
        '-certfile', this.caCrtPath,
        '-outform', 'DER',
        '-out', p7bPath,
      ]);

      await fsp.rm(csrPath, { force: true });
      await fsp.rm(extPath, { force: true });
      this.log(`device certificate issued for ${stamp}`);
      return read(false);
    })().finally(() => {
      this.inflight.delete(stamp);
      fsp.rm(derPath, { force: true }).catch(() => {});
    });

    this.inflight.set(stamp, job);
    return job;
  }

  /** Cached tls.SecureContext for a host. */
  async secureContextFor(host) {
    if (this.contexts.has(host)) return this.contexts.get(host);
    const { key, cert } = await this.leafFor(host);
    const context = tls.createSecureContext({
      key: fs.readFileSync(key),
      cert: fs.readFileSync(cert),
      ca: fs.readFileSync(this.caCrtPath),
    });
    this.contexts.set(host, context);
    return context;
  }

  /** SNICallback factory for a shared TLS server. */
  sniCallback(fallbackHost) {
    return async (servername, cb) => {
      try {
        const ctx = await this.secureContextFor(servername || fallbackHost);
        cb(null, ctx);
      } catch (err) {
        this.log(`SNI error for ${servername || fallbackHost}: ${err.message}`);
        cb(err);
      }
    };
  }
}
