// The Store protocol, served instead of relayed.
//
// Why this exists now and did not before: the backend the device's Store talks to
// is gone, and that is measured, not assumed. Asking the real host from this PC,
// with a public resolver so the lab's own hijack cannot answer instead:
//
//   cdn.marketplaceedgeservice.windowsphone.com  still resolves (CNAME to
//     ...edgesuite.net -> Akamai) but the edge answers
//     503 Service Unavailable - DNS failure: the front door is up, its origin is
//     not. A relay to it returns an HTML error page.
//   marketplaceedgeservice.windowsphone.com, catalog.zune.net,
//   wscont1.apps.microsoft.com - NXDOMAIN.
//
// So the two requests this phone makes to open the Store -
//
//   GET  http://cdn.marketplaceedgeservice.windowsphone.com/v9/catalog/storePages?typeId=DynamicHub.Main&...
//   POST http://marketplaceedgeservice.windowsphone.com/v8/catalog/updates?...
//
// - cannot be forwarded anywhere useful. The first one is what this handler
// answers, in the format src/store/catalog-feed.mjs documents. The second is left
// as passthrough: the capture shows the device proceeds to storePages after it
// fails, and its request body is a BatchGetProductUpdates document whose answer
// no capture describes.
//
// Enable in config.json:
//   "livestore": { "protocol": { "enabled": true, "catalogFile": "..." } }
//
// What this handler does NOT do, said plainly because a Store that opens is not a
// Store that installs: it serves the browse surfaces (the home page, the hub
// pages, the application lists, and the detail for a GUID it minted itself). It
// does not serve images, nor licenses, nor a download, so an application tapped
// on the device reaches a detail page and no further.

import fs from 'node:fs';
import path from 'node:path';
import { isInterceptedHost } from '../config.mjs';
import {
  buildApplicationListFeed,
  buildProductUpdatesResponse,
  buildStorePageFeed,
  findAppByUuid,
  isUuid,
  normalizePageFormat,
  uuidForApp,
} from './catalog-feed.mjs';
import { DEFAULT_TEMPLATE_TYPE, TYPE_KEY_FORMS, checkTemplateType, templateTypesForPageType } from './vocabulary.mjs';

function protocolSettings(config) {
  return {
    enabled: false,
    catalogFile: 'src/store/fixtures/sample-catalog.json',
    hubTemplate: 'DynamicHub',
    templateType: DEFAULT_TEMPLATE_TYPE,
    templateTypeForm: 'both',
    pageFormat: 'storePage',
    pageSize: 25,
    // 'generated' builds the page from the catalog; 'archive' serves a response of
    // the real service byte for byte.
    //
    // It was built as a one-variable experiment and is not one, which the reading
    // of the phone in src/store/vocabulary.mjs made plain afterwards. The archived
    // response is the `hub=games` page of an older generation, so substituting it
    // changes the page type (the games hub, not the store hub this request names),
    // the grammar (`<templateName>` where the v9 client walks /Templates/Template
    // and reads TEMPLATETYPE), and the template's owner (`GamesHub` belongs to the
    // Xbox Games hub app, not to the Store). It is kept because a genuine page is
    // still worth having, not because the comparison isolates anything - the
    // headers it is served with say so, so a later reader of the capture finds the
    // confound rather than inferring it.
    serve: 'generated',
    archiveFile: 'src/store/fixtures/archive/real-hub-page-20130813.xml',
    ...(config.livestore?.protocol || {}),
  };
}

/** Read a file once and again only when it changes, so an edit needs no restart. */
function readChangingFile(file, cache) {
  const absolute = path.resolve(file);
  let stat;
  try {
    stat = fs.statSync(absolute);
  } catch {
    throw new Error(`store protocol: file not found: ${absolute}`);
  }
  if (cache.value && cache.file === absolute && cache.mtimeMs === stat.mtimeMs) return cache.value;
  cache.file = absolute;
  cache.mtimeMs = stat.mtimeMs;
  cache.value = fs.readFileSync(absolute);
  return cache.value;
}

function atomResponse(xml, extraHeaders = {}) {
  const body = Buffer.from(xml, 'utf8');
  return {
    status: 200,
    headers: {
      'content-type': 'application/atom+xml; charset=utf-8',
      'content-length': String(body.length),
      // The device must not show a page from before the catalog changed: that is
      // how an edit here would look like it had no effect.
      'cache-control': 'no-store',
      ...extraHeaders,
    },
    body,
  };
}

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

// --------------------------------------------------------------- the catalog

let catalogCache = null;
const archiveCache = { file: null, mtimeMs: 0, value: null };

/**
 * Read the catalog document, re-reading it when the file changes.
 *
 * The mtime check is the point: an operator iterating on what the device shows
 * should not have to restart the lab between attempts, and a stale in-memory
 * catalog would make a changed file look like a changed file that had no effect.
 */
function loadCatalog(file) {
  const absolute = path.resolve(file);
  let stat;
  try {
    stat = fs.statSync(absolute);
  } catch {
    throw new Error(`catalog file not found: ${absolute}`);
  }
  if (catalogCache && catalogCache.file === absolute && catalogCache.mtimeMs === stat.mtimeMs) {
    return catalogCache.catalog;
  }

  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(absolute, 'utf8'));
  } catch (err) {
    throw new Error(`catalog file ${absolute} is not valid JSON: ${err.message}`);
  }

  const categories = Array.isArray(parsed.categories)
    ? parsed.categories.map((name) => String(name).trim()).filter(Boolean)
    : [];
  const apps = Array.isArray(parsed.apps) ? parsed.apps : [];
  const missingId = apps.find((app) => app?.id === undefined || app?.id === null || String(app.id) === '');
  if (missingId) {
    // Without an id there is no stable GUID, and the device would be handed a
    // handle that cannot be resolved back. Better to refuse than to mint one.
    throw new Error(`catalog file ${absolute} has an entry with no id`);
  }

  catalogCache = { file: absolute, mtimeMs: stat.mtimeMs, catalog: { categories, apps } };
  return catalogCache.catalog;
}

/** Category sections: the declared order first, then whatever the apps add. */
export function pageSections(catalog, pageSize) {
  const apps = catalog.apps || [];
  const names = [...(catalog.categories || [])];
  for (const app of apps) {
    const name = String(app.category || '').trim();
    if (name && !names.some((known) => known.toLowerCase() === name.toLowerCase())) names.push(name);
  }

  const sections = [];
  for (const name of names) {
    const items = apps
      .filter((app) => String(app.category || '').trim().toLowerCase() === name.toLowerCase())
      .slice(0, pageSize);
    if (items.length) sections.push({ title: name, items });
  }

  // An entry with no category at all would otherwise be invisible on the page.
  const uncategorised = apps.filter((app) => !String(app.category || '').trim()).slice(0, pageSize);
  if (uncategorised.length) sections.push({ title: 'All apps', items: uncategorised });

  return sections;
}

// ------------------------------------------------------------------ matching

// Matched on the path alone, deliberately. The lab is the only thing left that can
// answer these paths - the backend behind them is gone - so a method the protocol
// does not define should get the protocol's own refusal, not a passthrough into a
// host that cannot reply. Matching the method here instead made the 405 branch
// below unreachable, which is how a POST to the home page came back 200.
const ROUTES = [
  { name: 'appDetail', pattern: /^\/v[89]\/catalog\/apps\/([^/?]+)\/?(?:\?|$)/ },
  { name: 'storePages', pattern: /^\/v9\/catalog\/storePages\/?(?:\?|$)/ },
  { name: 'hubs', pattern: /^\/v8\/catalog\/hubs\/?(?:\?|$)/ },
  { name: 'updates', pattern: /^\/v8\/catalog\/updates\/?(?:\?|$)/, method: 'POST' },
  { name: 'appList', pattern: /^\/v[89]\/catalog\/apps\/?(?:\?|$)/ },
];

function routeFor(ctx) {
  for (const route of ROUTES) {
    const match = route.pattern.exec(ctx.path);
    if (match) return { route, match };
  }
  return null;
}

/**
 * @param {object} config the shared config; read live so a hot reload of
 *   livestore.protocol takes effect without rebuilding the router.
 */
export function createStoreProtocol(config) {
  return {
    name: 'store-protocol',
    description: 'Serves the Store home page, hub pages and application lists in the Zune catalog XML the phone reads.',

    match(ctx) {
      const settings = protocolSettings(config);
      if (!settings.enabled) return false;
      if (!isInterceptedHost(config, ctx.host)) return false;
      return Boolean(routeFor(ctx));
    },

    async handle(ctx, { logger }) {
      const settings = protocolSettings(config);
      if (!isInterceptedHost(config, ctx.host)) {
        return jsonResponse({ error: 'host_not_intercepted', host: ctx.host }, 421);
      }

      const found = routeFor(ctx);
      if (!found) return null;
      const method = String(ctx.method || 'GET').toUpperCase();
      // One route is a POST - the update check - and it is matched on its method
      // too, because a GET to it would be a different request with a different
      // answer, and answering it as if it were the update check would be a lie
      // told by omission.
      const wantedMethod = found.route.method || 'GET';
      if (method !== wantedMethod) {
        return jsonResponse({
          error: 'method_not_allowed',
          hint: `${found.route.name} is answered for ${wantedMethod}`, got: method,
        }, 405);
      }

      const url = new URL(ctx.path, `http://${ctx.host}`);
      const requestPath = `${url.pathname}${url.search}`;
      // The label every branch below carries, declaring which route answered.
      const headers = { 'x-lab-protocol': found.route.name };
      const now = new Date();

      // The update check. The phone POSTs this while the Store is starting, and it
      // was passthrough until now: the capture shows it answered 502 four times in
      // a row, and nothing else in the flow fails except the page. Its request body
      // is a BatchGetProductUpdatesRequest naming the SKUs the device has, and the
      // parser describes the answer's shape (/BatchGetProductUpdatesResponse/
      // Resources/Resource with ProductId, CurrentPayloadId, IsRevoked, Result).
      //
      // What it answers is deliberately the emptiest true thing: every SKU the
      // device asked about is reported unchanged. The lab serves no package, so
      // there is never an update to hand out, and saying "no update" is the answer
      // that matches reality rather than one invented to look plausible. The SKUs
      // come from the request, so whatever the device holds is what is reported on.
      if (found.route.name === 'updates') {
        const asked = [...String(ctx.body?.toString?.('utf8') ?? ctx.body ?? '')
          .matchAll(/<InputSkuId>([^<]+)<\/InputSkuId>/g)].map((m) => m[1].trim());
        const xml = buildProductUpdatesResponse({ skus: asked });
        return {
          status: 200,
          headers: {
            'content-type': 'application/atom+xml; charset=utf-8',
            'content-length': String(Buffer.byteLength(xml)),
            'cache-control': 'no-store',
            ...headers,
            'x-lab-skus': String(asked.length),
          },
          body: Buffer.from(xml, 'utf8'),
        };
      }

      if (settings.serve === 'archive' && (found.route.name === 'storePages' || found.route.name === 'hubs')) {
        try {
          const body = readChangingFile(settings.archiveFile, archiveCache);
          // The archived response is not the page the request asked for, and
          // saying so is the point of serving it at all. It is the games hub of
          // an older generation of the grammar, so it carries a template this
          // Store client does not own (see NOT_A_TEMPLATE in vocabulary.mjs) and
          // describes a page type this request did not name. Naming both in the
          // headers puts the confound in the capture, where a later reading of
          // the log will find it, instead of leaving it in a comment.
          const archivedName = (/<templateName>([^<]*)<\/templateName>/.exec(body.toString('utf8')) || [])[1] || null;
          const archivedPage = (/<a:id>([^<]*)<\/a:id>/.exec(body.toString('utf8')) || [])[1] || null;
          return {
            status: 200,
            headers: {
              'content-type': 'application/atom+xml; charset=utf-8',
              'content-length': String(body.length),
              'cache-control': 'no-store',
              ...headers,
              'x-lab-protocol': `${found.route.name}:archive`,
              'x-lab-source': settings.archiveFile,
              'x-lab-archive-template': archivedName || 'unknown',
              'x-lab-archive-page': archivedPage || 'unknown',
              'x-lab-archive-warning': 'archived response of a different page and grammar generation: '
                + 'not a one-variable substitution for the requested page',
            },
            body,
          };
        } catch (err) {
          logger.warn(`store protocol: ${err.message}`);
          return jsonResponse({ error: 'archive_unavailable', message: err.message }, 502, headers);
        }
      }

      let catalog;
      try {
        catalog = loadCatalog(settings.catalogFile);
      } catch (err) {
        // A missing or malformed catalog is an operator problem, not a protocol
        // one, so it is named as that instead of becoming an anonymous 502.
        logger.warn(`store protocol: ${err.message}`);
        return jsonResponse({ error: 'catalog_unavailable', message: err.message }, 502);
      }

      if (found.route.name === 'storePages' || found.route.name === 'hubs') {
        const typeId = url.searchParams.get('typeId') || url.searchParams.get('hub') || 'DynamicHub.Main';
        // The phone asks for `typeId=DynamicHub.Main`: a page type and a variant
        // within it. The template type belongs to the page type, so it is the part
        // before the dot that selects which set of template types applies.
        const pageType = typeId.split('.')[0];
        const cc = url.searchParams.get('cc') || 'US';
        const typeKeyForm = TYPE_KEY_FORMS.includes(settings.templateTypeForm)
          ? settings.templateTypeForm
          : 'both';
        const templateCheck = checkTemplateType(pageType, settings.templateType);
        if (!templateCheck.ok) {
          // Not refused, because trying a type outside the set is how the set gets
          // tested. It is labelled instead, so the capture of the attempt says what
          // was attempted and what the phone styles, and a page that renders
          // nothing is not mistaken for a page that was rejected on its shape.
          logger.warn(`store protocol: template type ${settings.templateType} for page type ${pageType}: ${templateCheck.reason}`);
        }
        if (settings.hubTemplate && !/^[A-Za-z][A-Za-z0-9]*$/.test(String(settings.hubTemplate))) {
          logger.warn(`store protocol: template name "${settings.hubTemplate}" is not shaped like a UI style name`);
        }
        let sections = pageSections(catalog, settings.pageSize);

        // `/v8/catalog/hubs?hub=games` asks for one hub. When the catalog has a
        // section for it, that section is the page; when it does not, the whole
        // page is served rather than an empty one, which would look like a
        // catalog with nothing in it.
        if (found.route.name === 'hubs') {
          const hub = String(url.searchParams.get('hub') || '').toLowerCase();
          if (hub) {
            const only = sections.filter((section) => section.title.toLowerCase() === hub);
            if (only.length) sections = only;
          }
        }

        const xml = buildStorePageFeed({
          sections,
          selfHref: requestPath,
          // Same construction the archived page feeds use, for both their title
          // (`games-PK-WindowsPhone80`) and their id
          // (`games-PK-WindowsPhone80-ALL-ALL`).
          title: `${typeId}-${cc}-WindowsPhone81`,
          id: `${typeId}-${cc}-WindowsPhone81-ALL-ALL`,
          templateName: settings.hubTemplate,
          templateType: settings.templateType,
          typeKeyForm,
          pageFormat: normalizePageFormat(settings.pageFormat),
          now,
        });
        return atomResponse(xml, {
          ...headers,
          'x-lab-source': settings.catalogFile,
          'x-lab-sections': String(sections.length),
          'x-lab-page-type': pageType,
          'x-lab-page-format': normalizePageFormat(settings.pageFormat),
          'x-lab-template-type': String(settings.templateType),
          'x-lab-template-types-known': templateTypesForPageType(pageType).join(',') || 'none',
          ...(templateCheck.ok ? {} : { 'x-lab-template-type-warning': templateCheck.reason }),
        });
      }

      if (found.route.name === 'appDetail') {
        const guid = found.match[1];
        const app = findAppByUuid(catalog.apps, guid);
        if (!app) {
          return jsonResponse({
            error: 'app_not_found',
            id: guid,
            hint: `No catalog entry hashes to ${guidForLog(guid)}.`,
          }, 404, headers);
        }
        const xml = buildApplicationListFeed({
          apps: [app],
          selfHref: requestPath,
          id: `tag:catalog.zune.net,${now.toISOString().slice(0, 10)}:/apps/${guid.toLowerCase()}`,
          now,
        });
        return atomResponse(xml, { ...headers, 'x-lab-source': settings.catalogFile });
      }

      // The flat application list - what a browse or search screen reads. The
      // catalog is not searched here: the lab serves the whole list and lets the
      // device filter, because the tag vocabulary the client sends is one no
      // capture has shown us.
      const chunkSize = Number(url.searchParams.get('chunkSize')) || 0;
      const apps = chunkSize > 0 ? catalog.apps.slice(0, chunkSize) : catalog.apps;
      const xml = buildApplicationListFeed({
        apps,
        selfHref: requestPath,
        id: `tag:catalog.zune.net,${now.toISOString().slice(0, 10)}:/apps`,
        now,
      });
      return atomResponse(xml, {
        ...headers,
        'x-lab-source': settings.catalogFile,
        'x-lab-apps': String(apps.length),
      });
    },
  };
}

/** The GUID as the catalog would have minted it, for a diagnostic message. */
function guidForLog(value) {
  return isUuid(value) ? value.toLowerCase() : `(not a GUID: "${sanitizeForLog(value)}")`;
}

function sanitizeForLog(value) {
  return String(value).replace(/[^\x20-\x7e]/g, '').slice(0, 60);
}

/** Exported for the self-test: the GUID a catalog entry is served under. */
export { uuidForApp };
