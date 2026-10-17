// The Store's image CDN, answered with a placeholder.
//
// WHY THIS EXISTS. On 2026-10-17 the handset searched its Store for `f` and the lab
// answered the list (`/v9/catalog/apps?...&q=f`, 200, the fixture's 17 apps) - and
// the client then asked for **420** images in two and a half minutes, every one of them
// `cdn.marketplaceimages.windowsphone.com/v8/images/<guid>?imagetype=icon_small`,
// every one answered `502 upstream_loop` because no handler matched the host. The
// host is already in `dns.hijack.names` and `proxy.mitm.hosts`: the lab had been
// swapping a real service's pictures for an injected failure without ever saying
// so. This handler replaces that failure with an actual picture - and on
// 2026-10-17 16:4x local the handset confirmed it decodes: the square where an
// app's logo is drawn went from grey to this PNG's dark blue, so the client read
// the bytes and painted them, where the 502 body had painted nothing.
//
// WHAT IT SERVES, AND WHAT IT DOES NOT CLAIM. A 48x48 solid PNG, generated here,
// the same bytes for every guid and every `imagetype`. It is not artwork, it is not
// the icon of any app, and it is not scaled per `imagetype` - the client asks for
// icon_small, tile, background and more, and all of them get the same 48x48. Every
// response says `x-lab-invented: 1` and carries `x-lab-image: placeholder`, so a
// capture can never read as "the real CDN answered".
//
// The other half of that session is deliberately NOT answered here: `/v8/catalog/queries`
// (the search-box suggestions) and `/v8/catalog/appCategories/<category>` still fall
// through to `502`. No capture of either document exists, their grammar would have to
// be invented, and an invented document is a second variable in the same run - which
// is how E-004 earned its note.

import { isInterceptedHost } from '../config.mjs';

// A 48x48 opaque square, RGBA, one IDAT. Built once as a constant so the handler
// allocates nothing per request and the bytes cannot drift with a library version.
const PLACEHOLDER_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAADAAAAAwCAYAAABXAvmHAAAAZUlEQVR4nO3PMQ0AIADAMBTx4Qb/NkAER0OyY3835trn'
  + '54YGNKABDWhAAxrQgAY0oAENaEADGtCABjSgAQ1oQAMa0IAGNKABDWhAAxrQgAY0oAENaEADGtCABjSgAQ1oQAMa8NoF'
  + 'Xweu4jcpxR8AAAAASUVORK5CYII=',
  'base64',
);

/** The bytes, for a test or a script that wants to verify them. */
export function placeholderPng() {
  return PLACEHOLDER_PNG;
}

export function imageSettings(config) {
  return {
    enabled: false,
    hosts: ['*.marketplaceimages.windowsphone.com'],
    // Any path under the host: the client's image URLs carry their size and kind in
    // the query string, and a path filter would only decide which of its own
    // requests this lab answers - the failure it is here to remove.
    pathPrefix: '/',
    ...(config.livestore?.images || {}),
  };
}

/** True when a pattern list matches the host, without pulling in the glob matcher's config shape. */
function hostMatches(host, patterns) {
  const lc = String(host || '').toLowerCase();
  return (patterns || []).some((pattern) => {
    const re = new RegExp(`^${String(pattern).toLowerCase().replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.')}$`);
    return re.test(lc);
  });
}

export function createStoreImages(config) {
  return {
    name: 'store-images',
    description: 'Answers the Store image CDN with a placeholder PNG instead of a 502.',

    match(ctx) {
      const settings = imageSettings(config);
      if (!settings.enabled) return false;
      return hostMatches(ctx.host, settings.hosts) && String(ctx.path || '/').startsWith(settings.pathPrefix);
    },

    async handle(ctx) {
      if (!isInterceptedHost(config, ctx.host)) {
        return {
          status: 421,
          headers: { 'content-type': 'application/json; charset=utf-8' },
          body: Buffer.from(JSON.stringify({ error: 'host_not_intercepted', host: ctx.host })),
        };
      }
      if (ctx.method !== 'GET' && ctx.method !== 'HEAD') {
        return {
          status: 405,
          headers: { 'content-type': 'application/json; charset=utf-8' },
          body: Buffer.from(JSON.stringify({ error: 'method_not_allowed' })),
        };
      }

      return {
        status: 200,
        headers: {
          'content-type': 'image/png',
          'content-length': String(PLACEHOLDER_PNG.length),
          'cache-control': 'no-store',
          'x-lab-source': 'store-images',
          'x-lab-image': 'placeholder',
          'x-lab-invented': '1',
        },
        body: PLACEHOLDER_PNG,
      };
    },
  };
}
