// First handlers for intercepted Store traffic.
//
// Both are deliberately narrow and opt-in, so the lab stays predictable: until a
// handler matches, every intercepted request keeps its normal passthrough
// behaviour. Nothing here guesses the shape of the real Microsoft Store protocol,
// because that can only be written once the device has been captured.
//
// Enable the bridge in config.json:
//   "livestore": { "bridge": { "enabled": true, "pathPrefix": "/livestore/", "source": "fixture" } }
//
// source: "zinc"    -> live Live Store catalog (needs livestore.apiKey)
//         "fixture" -> bundled sample catalog, works offline with no key
//
// The JSON API the *Live Store client* on the handset speaks is a different
// handler, `createLiveClient` below: same catalog, the shape that client parses,
// off by default and matched on its own host name (F-029).
//
// Handlers are factories closing over the shared config object, so a hot reload
// that mutates `config.livestore` is picked up without rebuilding the router.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isInterceptedHost } from '../config.mjs';
import { createStoreProtocol } from './protocol.mjs';
import { createStoreImages } from './images.mjs';
import { createDeviceProvisioning } from './provisioning.mjs';
import {
  detailDocument, entryById, listDocument, liveCatalog, liveRoute,
} from './live-client.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_PATH = path.join(HERE, 'fixtures', 'sample-catalog.json');

function jsonResponse(payload, status = 200, extraHeaders = {}) {
  const body = Buffer.from(JSON.stringify(payload, null, 2));
  return {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'content-length': String(body.length),
      ...extraHeaders,
    },
    body,
  };
}

function bridgeSettings(config) {
  return {
    enabled: false,
    pathPrefix: '/livestore/',
    source: 'fixture',
    ...(config.livestore?.bridge || {}),
  };
}

function healthSettings(config) {
  return {
    enabled: true,
    path: '/__store/health',
    ...(config.livestore?.health || {}),
  };
}

let fixtureCache = null;
function loadFixture() {
  if (!fixtureCache) fixtureCache = JSON.parse(fs.readFileSync(FIXTURE_PATH, 'utf8'));
  return fixtureCache;
}

/**
 * Serves the Live Store catalog under a configurable path on intercepted hosts.
 * Query parameters:
 *   ?categories=1              -> categories only
 *   ?q=<term>[&category=<name>] -> search (Zinc requires q of >= 5 characters)
 *   ?app=<id>                  -> single app
 * The `x-lab-source` response header states which source answered.
 */
export function createCatalogBridge(config) {
  return {
    name: 'catalog-bridge',
    description: 'Serves the Live Store catalog on intercepted Store hosts under a path prefix.',

    match(ctx) {
      const settings = bridgeSettings(config);
      if (!settings.enabled) return false;
      return ctx.path.startsWith(settings.pathPrefix);
    },

    async handle(ctx, { zinc, logger }) {
      const settings = bridgeSettings(config);

      if (!isInterceptedHost(config, ctx.host)) {
        return jsonResponse({ error: 'host_not_intercepted', host: ctx.host }, 421);
      }
      if (ctx.method !== 'GET') {
        return jsonResponse({ error: 'method_not_allowed', hint: 'the bridge answers GET only' }, 405);
      }

      const url = new URL(ctx.path, 'http://store.local');
      const relative = url.pathname.slice(settings.pathPrefix.length).replace(/\/+$/, '');
      const wantsCategories = url.searchParams.get('categories') === '1' || relative === 'categories';
      const query = url.searchParams.get('q');
      const category = url.searchParams.get('category');
      const appId = url.searchParams.get('app');

      const useZinc = settings.source === 'zinc';
      const source = useZinc ? 'zinc' : 'fixture';
      const headers = { 'x-lab-source': source };

      try {
        if (useZinc) {
          if (wantsCategories) {
            return jsonResponse({ source, categories: await zinc.appCategories() }, 200, headers);
          }
          if (appId) {
            return jsonResponse({ source, app: await zinc.app(appId) }, 200, headers);
          }
          if (query) {
            const result = await zinc.searchApps({ q: query, category: category || 'tools + productivity' });
            return jsonResponse({ source, ...result }, 200, headers);
          }
          return jsonResponse({
            source,
            error: 'nothing_requested',
            usage: ['?categories=1', '?q=<term>&category=<name>', '?app=<id>'],
          }, 400, headers);
        }

        const fixture = loadFixture();
        if (wantsCategories) {
          return jsonResponse({ source, categories: fixture.categories }, 200, headers);
        }
        if (appId) {
          const app = fixture.apps.find((entry) => String(entry.id) === String(appId));
          if (!app) return jsonResponse({ source, error: 'app_not_found', id: appId }, 404, headers);
          return jsonResponse({ source, app }, 200, headers);
        }
        if (query) {
          const needle = String(query).toLowerCase();
          const apps = fixture.apps.filter((entry) => `${entry.name} ${entry.description} ${entry.category}`
            .toLowerCase().includes(needle));
          return jsonResponse({ source, categories: fixture.categories, apps }, 200, headers);
        }
        return jsonResponse({ source, categories: fixture.categories, apps: fixture.apps }, 200, headers);
      } catch (err) {
        // A missing or rejected Zinc key is an operator problem, not a protocol one.
        logger.warn(`catalog bridge (${source}) failed: ${err.message}`);
        return jsonResponse({
          source,
          error: err.code || 'bridge_failed',
          status: err.status || 0,
          message: err.message,
        }, err.status === 429 ? 429 : 502, headers);
      }
    },
  };
}

/**
 * Answers a synthetic health endpoint on intercepted hosts.
 * Purpose: prove end-to-end that a request from the device reached a handler and
 * that the reply came back through the lab, without touching any backend.
 */
export function createStoreHealth(config) {
  return {
    name: 'store-health',
    description: 'Answers <healthPath> on intercepted hosts so the interception path can be proven.',

    match(ctx) {
      const settings = healthSettings(config);
      if (!settings.enabled) return false;
      return ctx.path.startsWith(settings.path);
    },

    async handle(ctx) {
      if (!isInterceptedHost(config, ctx.host)) {
        return jsonResponse({ error: 'host_not_intercepted', host: ctx.host }, 421);
      }
      return jsonResponse({
        intercepted: true,
        host: ctx.host,
        method: ctx.method,
        path: ctx.path,
        client: ctx.client,
        mitm: ctx.mitm,
        note: 'Produced by the lab, not by Microsoft.',
      });
    },
  };
}

function liveClientSettings(config) {
  return {
    enabled: false,
    host: 'store-api.live.net.co',
    catalogFile: 'src/store/fixtures/demo-catalog.json',
    limit: 0,
    ...(config.livestore?.client || {}),
  };
}

/**
 * The JSON API of the Live Store client found on the handset (F-029).
 *
 * Matched on the host alone, because every path under it belongs to that one
 * client's protocol; the routes and the evidence for each field are in
 * `live-client.mjs`. Nothing here falls back to the operator's real service: the
 * host is either answered by this handler or left alone, and that choice is the
 * `enabled` flag.
 *
 * Arming it for the handset takes three touchpoints, not one: the flag here, the
 * host in `proxy.mitm.hosts` (the guard below refuses anything else with 421,
 * because the router sees every request that reaches the lab), and the host in
 * `dns.hijack.names` (without which the handset never comes here). That client
 * works today against the real service, so no single value may take its catalog
 * away.
 */
export function createLiveClient(config) {
  return {
    name: 'store-live-client',
    description: 'Answers the Live Store client JSON API (/apps, /games, /apps/search, /app/{id}) from the catalog.',

    match(ctx) {
      const settings = liveClientSettings(config);
      if (!settings.enabled) return false;
      const host = String(ctx.host || '').toLowerCase().split(':')[0];
      return host === String(settings.host || '').toLowerCase();
    },

    async handle(ctx) {
      const settings = liveClientSettings(config);
      // Same guard the other Store handlers carry, and here it is what makes the
      // two edits real: the router is consulted for every request that reaches
      // the lab, so without this a bare `Host:` header would be enough to have
      // the lab answer for a name it was never told to intercept.
      if (!isInterceptedHost(config, ctx.host)) {
        return jsonResponse({ error: 'host_not_intercepted', host: ctx.host }, 421, { 'x-lab-source': 'live-client' });
      }

      const headers = {
        'x-lab-source': 'live-client',
        'x-lab-invented': '1',
        'cache-control': 'no-store',
      };

      if (ctx.method !== 'GET') {
        return jsonResponse({ error: 'method_not_allowed', hint: 'this API answers GET only' }, 405, headers);
      }

      const route = liveRoute(ctx.path);
      if (route.action === 'unknown') {
        return jsonResponse({ error: 'not_found', path: ctx.path }, 404, headers);
      }
      if (route.action === 'me') {
        // The real one answers the signed-in account. The lab has no session and
        // will not invent one: a fabricated identity in this field is the one lie
        // a client could act on.
        return jsonResponse({
          success: false,
          error: 'auth_required',
          note: 'the account record needs the client\'s own sign-in, which the lab does not have',
        }, 401, headers);
      }

      const url = new URL(ctx.path, 'http://store.local');
      const query = url.searchParams.get('q') || '';
      if (route.action === 'search' && !query.trim()) {
        return jsonResponse({ error: 'q_required', hint: 'the search routes take ?q=<term>' }, 400, headers);
      }

      const catalog = liveCatalog(settings.catalogFile);

      if (route.action === 'detail') {
        const found = entryById(catalog, route.kind, route.id);
        if (!found) return jsonResponse({ error: 'not_found', id: route.id }, 404, headers);
        return jsonResponse(detailDocument(found.app, found.id), 200, headers);
      }

      const document = listDocument(catalog, {
        kind: route.kind,
        q: query,
        category: url.searchParams.get('category') || '',
        limit: Number(settings.limit) || 0,
      });
      const count = (document[route.kind] || []).length;
      if (!count && route.kind === 'games' && !catalog.games.length) {
        headers['x-lab-note'] = 'the catalog this lab serves carries no games';
      }
      headers['x-lab-count'] = String(count);
      return jsonResponse(document, 200, headers);
    },
  };
}

/** Handler list in priority order. */
export function buildHandlers(config) {
  return [
    createStoreHealth(config),
    // Before the protocol handler: the image CDN is another host, and an image
    // path that reached the page routes would be answered with a page.
    createStoreImages(config),
    // Its own host and its own path prefix, so it cannot shadow a Store route; it
    // sits before the protocol handler only to keep the two host families apart in
    // the router's per-handler counters.
    createDeviceProvisioning(config),
    createStoreProtocol(config),
    createLiveClient(config),
    createCatalogBridge(config),
  ];
}
