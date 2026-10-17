// The Live Store client's JSON API, served from this lab's catalog.
//
// WHICH CLIENT THIS IS FOR. Not the system Store: `ZMarketplace.dll` speaks Atom
// and asks for `<StorePage>` documents. This is the second client found on the
// handset, the community app whose own cache holds the answers (F-029), and it
// speaks JSON over plain HTTPS on `store-api.live.net.co`:
//
//   GET /apps                     { categories, apps: [...], information: [...] }
//   GET /games                    { categories, games: [...], information: [...] }
//   GET /apps/search?q=<term>     the apps envelope, filtered
//   GET /games/search?q=<term>    the games envelope, filtered
//   GET /app/<id>                 one detail document
//   GET /game/<id>                one detail document
//   GET /me                       the account record - 401 here, see below
//
// WHAT IS COPIED AND WHAT IS INVENTED. Every key name, and the *type* of every
// value, is read off those cached responses - the list entry carries exactly the
// seventeen fields below, the detail document exactly the thirteen at its top
// level, `download_count` is a numeric string, `screenshots` is null in a list and
// an array of objects in a detail, `status` reads `approved`, `wp_platform_type`
// reads `Silverlight` or `Windows Phone 8.1 Universal`. The *values* are this
// lab's: the fixture's names, no icons and no download URL (a URL here would point
// the device at the real CDN, which is the one thing a lab must not do), and the
// `information` block names the lab instead of the operator whose notice the real
// responses carry. That is why every response says `x-lab-invented: 1`.
//
// THE IDS ARE THE LAB'S. The real service numbers its apps and the client asks for
// `/app/<that number>`; the fixture's ids are slugs and its own note says they are
// GUID seeds, not store ids. So the served ids are the entry's position, 1-based,
// and the detail route resolves those. A slug in a JSON id would be a value type
// the client never saw.

import fs from 'node:fs';
import path from 'node:path';
import { uuidForApp } from './protocol.mjs';

/** The `information` block. The real one is the operator's; this one says so. */
const INFORMATION = [
  {
    server: 'WP Store Lab',
    developer: 'Lab Fixture',
    notice: 'Served by the WP Store Lab, not by One Live Interactive. Every app here is invented.',
  },
];

const PLATFORM = {
  type: 'Silverlight',
  version: '8.1',
  architecture: 'arm',
};

// ------------------------------------------------------------------ the catalog

let cache = null;

/**
 * Read the catalog, re-reading it when the file changes - the same rule the page
 * endpoint follows, and for the same reason: an operator iterating on what the
 * client shows should not have to restart the lab between attempts.
 */
export function liveCatalog(file) {
  const absolute = path.resolve(file);
  let stat;
  try {
    stat = fs.statSync(absolute);
  } catch {
    throw new Error(`catalog file not found: ${absolute}`);
  }
  if (cache && cache.file === absolute && cache.mtimeMs === stat.mtimeMs) return cache.catalog;

  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(absolute, 'utf8'));
  } catch (err) {
    throw new Error(`catalog file ${absolute} is not valid JSON: ${err.message}`);
  }

  const apps = Array.isArray(parsed.apps) ? parsed.apps : [];
  const games = Array.isArray(parsed.games) ? parsed.games : [];
  const missingId = apps.find((app) => app?.id === undefined || app?.id === null || String(app.id) === '');
  if (missingId) {
    throw new Error(`catalog file ${absolute} has an entry with no id`);
  }

  const catalog = {
    categories: Array.isArray(parsed.categories) ? parsed.categories.map((name) => String(name).trim()).filter(Boolean) : [],
    apps,
    games,
  };
  cache = { file: absolute, mtimeMs: stat.mtimeMs, catalog };
  return catalog;
}

/** The served id of an entry: its 1-based position, as a string. */
export function liveId(collection, index) {
  return String(index + 1);
}

// ------------------------------------------------------------------- the shapes

const asText = (value) => (value === undefined || value === null ? '' : String(value));

/** `2024-03-18` -> `2024-03-18T00:00:00.000Z`, the form the cached entries carry. */
function asStamp(value) {
  const text = asText(value);
  if (!text) return null;
  if (/T\d{2}:\d{2}/.test(text)) return text;
  return `${text.slice(0, 10)}T00:00:00.000Z`;
}

const STAMP = '2026-01-01T00:00:00.000Z';

/**
 * One entry of a list. The seventeen fields and their order are the ones the
 * client's cache holds; nothing is added, because an extra key is a claim.
 */
export function listEntry(app, id) {
  return {
    id,
    name: asText(app.name),
    description: asText(app.description),
    developer: asText(app.developer),
    publisher: asText(app.publisher),
    category: asText(app.category),
    // null rather than a URL: the fixture carries no artwork, and a URL here
    // would send the device to the operator's CDN for a picture of an app that
    // does not exist.
    icon: app.icon ? asText(app.icon) : null,
    screenshots: null,
    r2_url: app.r2_url ? asText(app.r2_url) : null,
    version: asText(app.version),
    release_date: asStamp(app.release_date),
    featured: Boolean(app.featured),
    status: 'approved',
    architecture: PLATFORM.architecture,
    architectures: [PLATFORM.architecture],
    wp_platform_type: PLATFORM.type,
    wp_platform_version: PLATFORM.version,
  };
}

/** One detail document. Thirteen top-level keys, `details` inside the first. */
export function detailDocument(app, id) {
  return {
    details: {
      id,
      created_at: STAMP,
      // A stable GUID per entry, minted by the same function the page endpoint
      // uses, so an app has one identity in the JSON and in the page.
      developer_id: uuidForApp('lab-publisher:Lab Fixture'),
      app_name: asText(app.name),
      app_description: asText(app.description),
      version: asText(app.version),
      r2_url: app.r2_url ? asText(app.r2_url) : null,
      status: 'approved',
      last_modified: STAMP,
      category: asText(app.category),
      developer_name: asText(app.developer),
      icon_url: app.icon ? asText(app.icon) : null,
      featured: Boolean(app.featured),
      publisher_name: asText(app.publisher),
      download_count: '0',
      wp_product_id: uuidForApp(asText(app.id)),
      wp_platform_version: PLATFORM.version,
      wp_capabilities: ['internetClient'],
      wp_platform_type: PLATFORM.type,
      architecture: PLATFORM.architecture,
      architectures: [PLATFORM.architecture],
      unavailable_regions: null,
    },
    available: true,
    availabilityNotice: null,
    updates: [],
    reviews: [],
    // Zero, not the fixture's 0-10 rating: the cached detail carried 0 here and
    // nothing says this field is on the page's scale, so a converted number
    // would be an invented scale dressed as a reading.
    averageRating: 0,
    totalReviews: 0,
    screenshots: [],
    variants: [],
    selectedVariantId: null,
    downloadCount: '0',
    information: INFORMATION,
  };
}

/** The list envelope, with the search and category filters the routes take. */
export function listDocument(catalog, { kind = 'apps', q = '', category = '', limit = 0 } = {}) {
  const collection = kind === 'games' ? catalog.games : catalog.apps;
  const needle = String(q || '').trim().toLowerCase();
  const wanted = String(category || '').trim().toLowerCase();

  const selected = [];
  collection.forEach((app, index) => {
    const id = liveId(collection, index);
    if (needle) {
      const haystack = `${asText(app.name)} ${asText(app.description)} ${asText(app.category)} ${asText(app.developer)}`
        .toLowerCase();
      if (!haystack.includes(needle)) return;
    }
    if (wanted && asText(app.category).toLowerCase() !== wanted) return;
    selected.push(listEntry(app, id));
  });

  const capped = limit > 0 ? selected.slice(0, limit) : selected;
  return {
    categories: catalog.categories,
    [kind]: capped,
    information: INFORMATION,
  };
}

/** Resolve one id against the collection. Returns null when it is not there. */
export function entryById(catalog, kind, id) {
  const collection = kind === 'games' ? catalog.games : catalog.apps;
  const wanted = String(id ?? '').trim();
  if (!wanted) return null;
  const index = collection.findIndex((app, position) => liveId(collection, position) === wanted);
  if (index < 0) return null;
  return { app: collection[index], id: wanted };
}

/**
 * The route table, matched on the path alone for the reason `protocol.mjs`
 * records: the backend behind this name is the operator's and this lab has no
 * business relaying to it, so an unmatched method gets an answer, not a tunnel.
 */
export function liveRoute(pathname) {
  const clean = String(pathname || '/').split('?')[0].replace(/\/+$/, '') || '/';
  if (clean === '/apps') return { kind: 'apps', action: 'list' };
  if (clean === '/games') return { kind: 'games', action: 'list' };
  if (clean === '/apps/search') return { kind: 'apps', action: 'search' };
  if (clean === '/games/search') return { kind: 'games', action: 'search' };
  if (clean === '/me') return { kind: null, action: 'me' };
  const detail = /^\/(app|game)\/(.+)$/.exec(clean);
  if (detail) return { kind: detail[1] === 'game' ? 'games' : 'apps', action: 'detail', id: decodeURIComponent(detail[2]) };
  return { kind: null, action: 'unknown' };
}
