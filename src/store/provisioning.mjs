// Device provisioning: the certificate a Windows Phone asks for before it will
// talk to a service that wants to know the device, not just the user.
//
// Why this exists here at all. The Store's own browse path never reached it, but
// the lab's capture analysis has been treating `devicecertificateservice.windowsphone.com`
// as Store traffic for as long as it has had a host list, and no handler has ever
// answered it - so every such request has been a `502` this lab injected. The
// account wall the install attempts stop at (F-033) is the kind of thing a device
// identity is used for, and no capture of the request or the answer exists on this
// phone, in the archive, or in the FFU.
//
// The one place the protocol *is* written down is another project reversing the
// same era of handsets, ReLiveWP: `POST /dcs/certificaterequest` (and
// `/certificaterequest`), `content-type: application/pkcs10`, three headers -
// `X-Windows-Phone-Activation-Protocol-Version` (1.0 or 2.0),
// `X-Windows-Phone-Activation-Code`, `X-Windows-Phone-Device-Info` (a
// `Name:value,Name:value` list whose `DeviceUniqueID` is mandatory) - a **base64**
// PKCS#10 body, and a **base64** certificate chain back as
// `application/c-x509-ca-cert`. That project answers with a PKCS#7 chain signed by
// its own CA; this one does the same with the lab's CA.
//
// What that means, said on the response and not only here: the *shape* is their
// reading of a Windows Phone 7 flow, not a measurement of this 8.1 handset, so
// every answer carries `x-lab-invented: 1`. It is a hypothesis with an endpoint
// attached - if the phone ever asks for it, the capture shows the request and this
// handler is where its answer comes from; if the 8.1 flow differs, the request it
// actually sends is the evidence that says so, which is more than exists today.
//
// Off by default, like every other handler that does not simply reproduce a
// capture. Arming it takes the same three touchpoints as the live client: this
// flag, the host in `proxy.mitm.hosts`, and the host in `dns.hijack.names`.

import { isInterceptedHost } from '../config.mjs';

/** The two routes the reference implementation answers, spelled as it spells them. */
const ROUTES = ['/dcs/certificaterequest', '/certificaterequest'];

const HEADER_PROTOCOL = 'x-windows-phone-activation-protocol-version';
const HEADER_CODE = 'x-windows-phone-activation-code';
const HEADER_DEVICE = 'x-windows-phone-device-info';

export function provisioningSettings(config) {
  return {
    enabled: false,
    hosts: ['devicecertificateservice.windowsphone.com'],
    // The reference accepts exactly these two and rejects anything else, which is
    // what a client negotiating a version expects. A version this lab accepted but
    // the flow did not define would be an answer to a question not asked.
    protocols: ['1.0', '2.0'],
    // The one activation code the reference refuses outright, kept as a refusal
    // here so the 409 branch is reachable without inventing a policy: in that
    // project it is the "no product key" placeholder.
    refusedCodes: ['NOPVK-NOPVK-NOPVK-NOPVK-NOPVK'],
    ...(config.livestore?.provisioning || {}),
  };
}

/**
 * `DeviceUniqueID:abc,OSVersion:7.10.7720,Locale:0409` -> an object.
 *
 * Lenient on purpose: the pairs this handler does not recognise are kept rather
 * than dropped, because a header field this lab has never seen named is exactly
 * the kind of thing a capture should be able to show without the handler having
 * to expect it first.
 */
export function parseDeviceInfo(value) {
  const info = {};
  for (const pair of String(value || '').split(',')) {
    const colon = pair.indexOf(':');
    if (colon <= 0) continue;
    const key = pair.slice(0, colon).trim();
    if (key) info[key] = pair.slice(colon + 1).trim();
  }
  return info;
}

function routeOf(pathname) {
  const clean = String(pathname || '').split('?')[0].toLowerCase().replace(/\/+$/, '');
  return ROUTES.includes(clean) ? clean : null;
}

function jsonResponse(payload, status, headers = {}) {
  const body = Buffer.from(JSON.stringify(payload, null, 2));
  return {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'content-length': String(body.length),
      'cache-control': 'no-store',
      ...headers,
    },
    body,
  };
}

/**
 * Decode the body as base64 and refuse anything that does not survive the round
 * trip. Node's decoder skips characters it does not like, so a body of text would
 * decode to *some* bytes and reach openssl as a mystery instead of as the error it
 * is; comparing the re-encoded text is what keeps a malformed request a 400.
 */
function decodeBase64(text) {
  const compact = String(text || '').replace(/\s+/g, '');
  if (!compact) return null;
  const bytes = Buffer.from(compact, 'base64');
  if (!bytes.length) return null;
  const normalise = (value) => value.replace(/=+$/, '');
  if (normalise(bytes.toString('base64')) !== normalise(compact)) return null;
  return bytes;
}

export function createDeviceProvisioning(config) {
  return {
    name: 'store-provisioning',
    description: 'Answers the device certificate request (/dcs/certificaterequest) with a chain signed by the lab CA.',

    match(ctx) {
      const settings = provisioningSettings(config);
      if (!settings.enabled) return false;
      return Boolean(routeOf(ctx.path));
    },

    async handle(ctx, deps = {}) {
      const settings = provisioningSettings(config);
      const headers = {
        'x-lab-source': 'provisioning',
        'x-lab-invented': '1',
        'cache-control': 'no-store',
      };

      if (!isInterceptedHost(config, ctx.host)) {
        return jsonResponse({ error: 'host_not_intercepted', host: ctx.host }, 421, headers);
      }
      if (String(ctx.method || '').toUpperCase() !== 'POST') {
        return jsonResponse({ error: 'method_not_allowed', hint: 'this endpoint answers POST only' }, 405, headers);
      }

      // Every refusal names itself in a header, because the operator reading a
      // capture needs to tell "the phone sent something this lab could not sign"
      // from "the phone never sent anything".
      const refuse = (status, reason, detail) => jsonResponse(
        { error: 'provisioning_refused', reason, detail },
        status,
        { ...headers, 'x-lab-refused': reason },
      );

      const protocol = String(ctx.headers?.[HEADER_PROTOCOL] || '').trim();
      if (!protocol) return refuse(400, 'no_protocol_version', `header ${HEADER_PROTOCOL} is absent`);
      if (!settings.protocols.map(String).includes(protocol)) {
        return refuse(400, 'unsupported_protocol_version', `got ${protocol}, this lab answers ${settings.protocols.join('/')}`);
      }

      const code = String(ctx.headers?.[HEADER_CODE] || '').trim().toUpperCase();
      if (!code) return refuse(400, 'no_activation_code', `header ${HEADER_CODE} is absent`);

      const deviceInfo = parseDeviceInfo(ctx.headers?.[HEADER_DEVICE]);
      if (!String(ctx.headers?.[HEADER_DEVICE] || '').trim()) {
        return refuse(400, 'no_device_info', `header ${HEADER_DEVICE} is absent`);
      }
      if (!deviceInfo.DeviceUniqueID) {
        return refuse(400, 'no_device_unique_id', `${HEADER_DEVICE} has no DeviceUniqueID`);
      }

      // Refused before anything is signed: a certificate for a discarded code
      // would be a credential this lab has no reason to exist.
      if (settings.refusedCodes.map((entry) => String(entry).toUpperCase()).includes(code)) {
        return refuse(409, 'activation_code_refused', `the code ${code} is the refusal placeholder`);
      }

      const der = decodeBase64(ctx.body);
      if (!der) return refuse(400, 'malformed_certificate_request', 'body is not base64');

      // The signer is the lab's own PKI, handed in by the proxy. Without it this
      // handler must not pretend: a 503 says the lab is misconfigured, where an
      // unsigned 200 would say the device was provisioned.
      const pki = deps.pki || deps.proxy?.pki;
      if (!pki?.signCsr) return refuse(503, 'pki_unavailable', 'this lab has no CA to sign with');

      let signed;
      try {
        signed = await pki.signCsr(der);
      } catch (err) {
        return refuse(400, 'malformed_certificate_request', err.message);
      }

      deps.logger?.info?.(`provisioning: device ${String(deviceInfo.DeviceUniqueID).slice(0, 16)}… signed for ${protocol}, subject ${signed.subject}`);

      const body = Buffer.from(signed.base64, 'utf8');
      return {
        status: 200,
        headers: {
          // The reference answers `Content(base64, "application/c-x509-ca-cert")`,
          // and that content type is what tells the client this blob is a chain.
          'content-type': 'application/c-x509-ca-cert',
          'content-length': String(body.length),
          ...headers,
          'x-lab-provisioning': 'device-certificate',
          'x-lab-cert-subject': signed.subject,
          'x-lab-cert-cached': signed.cached ? '1' : '0',
          'x-lab-device-unique-id': String(deviceInfo.DeviceUniqueID),
        },
        body,
        decision: 'store:provisioning',
      };
    },
  };
}
