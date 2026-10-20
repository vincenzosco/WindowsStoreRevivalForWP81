// The Store's image CDN, answered with a placeholder.
//
// WHY THIS EXISTS. On 2026-10-17 the handset searched its Store for `f` and the lab
// answered the list (`/v9/catalog/apps?...&q=f`, 200, the fixture's 17 apps) - and
// the client then asked for **420** images in two and a half minutes, every one of them
// `cdn.marketplaceimages.windowsphone.com/v8/images/<guid>?imagetype=icon_small`,
// every one answered `502 upstream_loop` because no handler matched the host. The
// host is already in `dns.hijack.names` and `proxy.mitm.hosts`: the lab had been
// swapping a real service's pictures for an injected failure without ever saying
// so. This handler replaces that failure with an actual picture.
//
// WHY THE PICTURE IS NOT A FLAT FIELD. It was, for the first hour, and that was a
// mistake worth writing down: a solid 48x48 square of #2E355C was served, the
// handset's icon slot went from grey to that same dark blue, and the reading taken
// from it was "the client decoded and drew these bytes". It is not a reading that
// blue square could support. A flat field is exactly what a client's *own* empty
// image background looks like, so "painted our bitmap" and "painted its own
// background instead" are the same photograph - and the person looking at the
// handset reported the second thing: the colour changed, no logo is drawn. So the
// placeholder now carries a mark a UI cannot be confused for: a light frame and a
// diagonal cross on the dark field, drawn here pixel by pixel. If the mark appears
// on the device the bitmap is being drawn; if only the colour does, it is not, and
// the difference is now observable rather than arguable.
//
// WHAT IT SERVES, AND WHAT IT DOES NOT CLAIM. A 48x48 PNG, generated here, the same
// bytes for every guid and every `imagetype`. It is not artwork, it is not the icon
// of any app, and it is not scaled per `imagetype` - the client asks for icon_small,
// tile, background and more, and all of them get the same 48x48. Every response
// says `x-lab-invented: 1` and carries `x-lab-image: placeholder`, so a capture can
// never read as "the real CDN answered".
//
// The other half of that session is deliberately NOT answered here: `/v8/catalog/queries`
// (the suggestion download - `PendingSuggestListDownload` in the client, with its own
// `ApplicationSuggestions` feed type and a query that names albums, artists, tracks and
// podcasts beside applications; F-040) and `/v8/catalog/appCategories/<category>` still fall
// through to `502`. No capture of either document exists, their grammar would have to
// be invented, and an invented document is a second variable in the same run - which
// is how E-004 earned its note.

import zlib from 'node:zlib';

import { isInterceptedHost } from '../config.mjs';
import { imageSourceFor } from './catalog-feed.mjs';

const SIZE = 48;
// The field, and the mark. Both are constants so the bytes cannot drift with a
// library version, and so a test can name the colours it expects to find.
const FIELD = [0x2e, 0x35, 0x5c, 0xff]; // #2E355C
const MARK = [0xe8, 0xe9, 0xf5, 0xff]; // #E8E9F5

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buffer) {
  let c = 0xffffffff;
  for (const byte of buffer) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([length, body, crc]);
}

/**
 * The mark: a two-pixel frame inset four pixels from the edge, and a three-pixel
 * diagonal cross. Both are drawn by distance from the nearest edge and from the
 * two diagonals, so the shape is described rather than pasted, and a test can ask a
 * pixel whether it is field or mark.
 */
function isMark(x, y) {
  const inset = 4;
  const last = SIZE - 1 - inset;
  const onFrame = (x >= inset && x <= last && y >= inset && y <= last)
    && (x < inset + 2 || x > last - 2 || y < inset + 2 || y > last - 2);
  const onDiagonal = Math.abs(x - y) <= 1 || Math.abs(x + y - (SIZE - 1)) <= 1;
  const insideFrame = x > inset && x < last && y > inset && y < last;
  return onFrame || (onDiagonal && insideFrame);
}

function buildPlaceholder() {
  const raw = Buffer.alloc((SIZE * 4 + 1) * SIZE);
  let offset = 0;
  for (let y = 0; y < SIZE; y += 1) {
    raw[offset] = 0; // filter type: none, so the bytes below are the pixels
    offset += 1;
    for (let x = 0; x < SIZE; x += 1) {
      const colour = isMark(x, y) ? MARK : FIELD;
      raw[offset] = colour[0];
      raw[offset + 1] = colour[1];
      raw[offset + 2] = colour[2];
      raw[offset + 3] = colour[3];
      offset += 4;
    }
  }

  const header = Buffer.alloc(13);
  header.writeUInt32BE(SIZE, 0);
  header.writeUInt32BE(SIZE, 4);
  header[8] = 8; // bit depth
  header[9] = 6; // colour type: RGBA
  header[10] = 0; // deflate
  header[11] = 0; // adaptive filtering
  header[12] = 0; // no interlace

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const PLACEHOLDER_PNG = buildPlaceholder();

/** The bytes, for a test or a script that wants to verify them. */
export function placeholderPng() {
  return PLACEHOLDER_PNG;
}

/** The two colours the placeholder is made of, for a test that reads the pixels. */
export const PLACEHOLDER_COLOURS = { field: FIELD, mark: MARK, size: SIZE };

export function imageSettings(config) {
  return {
    enabled: false,
    hosts: ['*.marketplaceimages.windowsphone.com'],
    // Any path under the host: the client's image URLs carry their size and kind in
    // the query string, and a path filter would only decide which of its own
    // requests this lab answers - the failure it is here to remove.
    pathPrefix: '/',
    // Whether a guid the catalog registered is answered with its own icon. Off
    // leaves every response the marked placeholder, which is what every delivery
    // before the Live Store catalog was drawn with.
    icons: true,
    ...(config.livestore?.images || {}),
  };
}

// ------------------------------------------------------- the real picture
//
// A catalog entry can state where its own icon lives, and the Live Store's does
// (`https://cdn.store.live.net.co/icons/<hash>.jpg` - the extension varies, which is
// why the content type is copied from the answer instead of assumed). The document
// cannot carry that
// URL - the protocol names a picture by guid - so the page build registers
// guid -> URL in catalog-feed.mjs and this handler reads it back. The bytes are
// fetched here, by the lab, and handed to the phone from the host the phone already
// trusts; the device is never pointed at a third party. When the entry states
// nothing, or the fetch fails, the marked placeholder is served instead and the
// response says which happened, so a screenshot can never be read as the wrong arm.
const ICON_CACHE = new Map();
const MAX_CACHED_ICONS = 256;
const MAX_ICON_BYTES = 512 * 1024;
const ICON_TIMEOUT_MS = 5000;
const ICON_TTL_MS = 30 * 60 * 1000;

let fetchIcon = (url, options) => globalThis.fetch(url, options);

/**
 * Replace the fetcher - the self-test's hook.
 *
 * The suite is offline and deterministic by design, so the live CDN is not something
 * it may dial: the whole point of the checks around this is that they hold whether or
 * not a third party is up.
 */
export function setImageFetch(fn) {
  fetchIcon = fn || ((url, options) => globalThis.fetch(url, options));
}

/** A header value cannot carry a newline, and an error message can. */
function headerSafe(value) {
  return String(value).replace(/[^\x20-\x7e]/g, ' ').slice(0, 300);
}

async function loadIcon(url) {
  const now = Date.now();
  const cached = ICON_CACHE.get(url);
  if (cached && cached.expires > now) return cached;

  const response = await fetchIcon(url, {
    signal: AbortSignal.timeout(ICON_TIMEOUT_MS),
    headers: { 'user-agent': 'wp8-store-lab/0.1' },
  });
  if (!response.ok) throw new Error(`answered ${response.status}`);
  const type = String(response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
  if (!type.startsWith('image/')) throw new Error(`answered ${type || 'no content type'}, not an image`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (!bytes.length) throw new Error('answered an empty body');
  if (bytes.length > MAX_ICON_BYTES) throw new Error(`answered ${bytes.length} bytes, over the ${MAX_ICON_BYTES}-byte cap`);

  const entry = { bytes, type, expires: now + ICON_TTL_MS };
  if (ICON_CACHE.size >= MAX_CACHED_ICONS) ICON_CACHE.clear();
  ICON_CACHE.set(url, entry);
  return entry;
}

/** True when a pattern list matches the host, without pulling in the glob matcher's config shape. */
function hostMatches(host, patterns) {
  const lc = String(host || '').toLowerCase();
  return (patterns || []).some((pattern) => {
    const re = new RegExp(`^${String(pattern).toLowerCase().replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.')}$`);
    return re.test(lc);
  });
}

// How many guids are remembered. The client asks for one per entry it draws and
// repeats the same guids on every redraw, so this is a few dozen in practice; the
// cap exists so a client that invented a guid per request cannot grow this process.
const MAX_TRACKED_GUIDS = 4096;

/** The guid in `/v8/images/<guid>?imagetype=…`, or the last path segment. */
function guidOf(requestPath) {
  const pathname = String(requestPath || '/').split('?')[0];
  const segments = pathname.split('/').filter(Boolean);
  return segments[segments.length - 1] || '(none)';
}

export function createStoreImages(config) {
  // Counters, because until now the only way to know how many icons this lab served
  // was to read a capture file - which needs capture on, a session that survived, and
  // somebody to parse JSONL. These live in the process and are readable at
  // `GET /__lab/images`, so "the 420 requests became 200s" is answerable while the
  // device is still on the screen. They are a count of responses, not of what the
  // device drew: only the screen says that.
  const stats = {
    served: 0,
    servedIcons: 0,
    iconFailures: 0,
    lastIconError: null,
    refusedUnlisted: 0,
    refusedMethod: 0,
    byImagetype: {},
    guids: new Map(),
    droppedGuids: 0,
    lastAt: null,
    lastPath: null,
  };

  const noteServed = (ctx) => {
    stats.served += 1;
    stats.lastAt = new Date().toISOString();
    stats.lastPath = String(ctx.path || '');
    const imagetype = new URLSearchParams(String(ctx.path || '').split('?')[1] || '').get('imagetype') || '(none)';
    stats.byImagetype[imagetype] = (stats.byImagetype[imagetype] || 0) + 1;
    const guid = guidOf(ctx.path);
    if (stats.guids.has(guid)) {
      stats.guids.set(guid, stats.guids.get(guid) + 1);
    } else if (stats.guids.size < MAX_TRACKED_GUIDS) {
      stats.guids.set(guid, 1);
    } else {
      stats.droppedGuids += 1;
    }
  };

  return {
    name: 'store-images',
    description: 'Answers the Store image CDN with a placeholder PNG instead of a 502.',

    /** The counters as JSON, for `GET /__lab/images`. */
    describeStats() {
      const settings = imageSettings(config);
      const guids = [...stats.guids.entries()].sort((a, b) => b[1] - a[1]);
      return {
        enabled: Boolean(settings.enabled),
        hosts: settings.hosts,
        served: stats.served,
        servedIcons: stats.servedIcons,
        iconFailures: stats.iconFailures,
        lastIconError: stats.lastIconError,
        distinctGuids: stats.guids.size,
        refusedUnlisted: stats.refusedUnlisted,
        refusedMethod: stats.refusedMethod,
        byImagetype: { ...stats.byImagetype },
        lastAt: stats.lastAt,
        lastPath: stats.lastPath,
        bytes: PLACEHOLDER_PNG.length,
        shape: `${SIZE}x${SIZE} field+frame+X`,
        // Bounded: the count above is exact, the list is the busiest guids only.
        guids: guids.slice(0, 100).map(([guid, count]) => ({ guid, count })),
        guidsDropped: stats.droppedGuids,
        note: 'A count of responses, not of what the device drew: the screen is the only witness to that.',
      };
    },

    match(ctx) {
      const settings = imageSettings(config);
      if (!settings.enabled) return false;
      return hostMatches(ctx.host, settings.hosts) && String(ctx.path || '/').startsWith(settings.pathPrefix);
    },

    async handle(ctx) {
      if (!isInterceptedHost(config, ctx.host)) {
        stats.refusedUnlisted += 1;
        return {
          status: 421,
          headers: { 'content-type': 'application/json; charset=utf-8' },
          body: Buffer.from(JSON.stringify({ error: 'host_not_intercepted', host: ctx.host })),
        };
      }
      if (ctx.method !== 'GET' && ctx.method !== 'HEAD') {
        stats.refusedMethod += 1;
        return {
          status: 405,
          headers: { 'content-type': 'application/json; charset=utf-8' },
          body: Buffer.from(JSON.stringify({ error: 'method_not_allowed' })),
        };
      }

      noteServed(ctx);

      const placeholder = (reason = null) => ({
        status: 200,
        headers: {
          'content-type': 'image/png',
          'content-length': String(PLACEHOLDER_PNG.length),
          'cache-control': 'no-store',
          'x-lab-source': 'store-images',
          'x-lab-image': 'placeholder',
          'x-lab-invented': '1',
          // Said out loud so a capture can tell a marked placeholder from the flat
          // field it replaced, which is the difference between "the bitmap is drawn"
          // and "the slot is painted".
          'x-lab-image-shape': `${SIZE}x${SIZE} field+frame+X`,
          ...(reason ? { 'x-lab-image-fallback': headerSafe(reason) } : {}),
        },
        body: PLACEHOLDER_PNG,
      });

      const settings = imageSettings(config);
      const source = settings.icons === false ? null : imageSourceFor(guidOf(ctx.path));
      if (source) {
        try {
          const icon = await loadIcon(source);
          stats.servedIcons += 1;
          return {
            status: 200,
            headers: {
              'content-type': icon.type,
              'content-length': String(icon.bytes.length),
              'cache-control': 'no-store',
              'x-lab-source': 'store-images',
              // The app's own picture, fetched by the lab from where its catalog
              // entry says it lives. Named so a capture can tell it apart from the
              // placeholder without comparing pixels.
              'x-lab-image': 'live-store',
              'x-lab-image-origin': headerSafe(source),
            },
            body: icon.bytes,
          };
        } catch (err) {
          // A broken icon is not a broken page: the entry is still drawable, so the
          // marked placeholder is served and the failure is named on the response.
          stats.iconFailures += 1;
          stats.lastIconError = `${source}: ${err.message}`;
          return placeholder(`live store ${err.message}`);
        }
      }

      return placeholder(source === null && settings.icons === false ? 'icons disabled' : null);
    },
  };
}
