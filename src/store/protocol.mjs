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
  buildStoreConfiguration,
  buildStorePageFeed,
  findAppByUuid,
  isUuid,
  normalizePageFormat,
  uuidForApp,
} from './catalog-feed.mjs';
import {
  DATA_SOURCE_TYPES, DEFAULT_TEMPLATE_TYPE, TYPE_KEY_FORMS, checkTemplateType, templateTypesForPageType,
} from './vocabulary.mjs';

/**
 * The data source type to write, or the one this lab serves when config names
 * something the client has no parser for. A typo must not become a pane pointing
 * at a download the client cannot read, so an unknown name reads as the type that
 * is served and is logged where it happens.
 */
function dataSourceType(value) {
  const wanted = String(value ?? '').trim();
  const known = DATA_SOURCE_TYPES.find((entry) => entry.type.toLowerCase() === wanted.toLowerCase());
  return known ? known.type : DATA_SOURCE_TYPES[0].type;
}

function protocolSettings(config) {
  return {
    enabled: false,
    catalogFile: 'src/store/fixtures/sample-catalog.json',
    hubTemplate: 'DynamicHub',
    templateType: DEFAULT_TEMPLATE_TYPE,
    templateTypeForm: 'both',
    pageFormat: 'storePage',
    // A pane that names a data source is a pane the client downloads content
    // for; a pane that does not is a pane with nothing to fetch. Off by default,
    // because it is the page this lab served before, and armed from config.
    dataSource: false,
    dataSourceType: 'Applications',
    // What a pane says it *is*. Empty by default: every page this lab has served
    // said nothing, and that reading is already recorded as a negative. Armed from
    // config once there is a value worth trying - see the config's own comment for
    // the one piece of evidence there is (`inv`, in the page parser's literal pool).
    paneType: '',
    paneSubType: '',
    // Whether each pane carries `/BackgroundImage/id`, the one absent path of the
    // pane's field map a tile would draw with. Off by default: arming it is the next
    // single variable after F-032, and a page that changed without being asked to
    // would make every earlier delivery incomparable.
    paneBackgroundImage: false,
    pageSize: 25,
    // A "store page cookie" is the only header the client reads back from a
    // response: `WPSHeaderHandler::AddStorePageCookie` / `::GetStorePageCookie`
    // (`@46944`-`@47068`) send and read `X-WP-StorePage-Cookie`, and the value is
    // kept in the registry as `WPSStorePageCookie`. Nothing in the lab ever sent
    // one, so the device has never had a value to send back (its requests carry no
    // such header at all). Empty means off. Any stable string is a candidate,
    // because the client stores and echoes it and the service - which is this lab -
    // is the only thing that could ever interpret it; a 32-hex token is used
    // because the protocol's own ids are spelled that way.
    pageCookie: '',
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
    // The negative control. `serve: 'control-broken'` answers the page endpoints
    // with a body that is truncated mid-element on purpose, so the one thing that
    // differs from a normal delivery is whether the document can be parsed at all.
    // Every page experiment so far varied how *plausible* the document was and
    // never whether it was *valid*, and the two outcomes are read differently: a
    // client that behaves the same for an unparseable body has not reached a parser
    // yet, while a client that behaves differently has. The file is checked before
    // it is served (it must still end mid-tag), because a repaired fixture would
    // silently turn the control into an ordinary delivery.
    controlFile: 'src/store/fixtures/control/broken-page.xml',
    // A page the client already accepts, carrying exactly one renamed construct.
    // The client was measured giving three different verdicts for one URL and one
    // set of request headers - silence for the built page, 0xc00cee23 for a
    // truncated one, 88675309 for the archived page of another generation - so a
    // page validator is observable, and a validator is a probe: rename one element
    // and the answer flips from silence to an error only if the client reads that
    // element. Empty is off. An unknown name, or a name whose element is not in the
    // document, is refused with 502 rather than served as an ordinary page: a
    // silent fallback would look exactly like "the client ignores that construct".
    mutant: '',
    // The configuration endpoint (`/v8/Configuration/Stores/...`). Off by default,
    // like every other experiment: with it off the route does not match and the
    // request falls through to passthrough, which is exactly what the lab did with
    // it before - 502 upstream_loop, because the host is hijacked and the relay
    // resolves itself. See buildStoreConfiguration for why the document it serves
    // is a reply rather than a reconstruction.
    configuration: { enabled: false },
    ...(config.livestore?.protocol || {}),
  };
}

/**
 * One construct of the page, renamed - the probe E-008 made possible.
 *
 * Each entry is `[from[], to[]]` and every `from` must be present, because the
 * failure this guards against is not a typo but a silent no-op: a mutation that
 * matched nothing would serve the ordinary page under a mutant's name, and the
 * client's silence would then read as "it ignores this element" when the document
 * never changed. Both the open and the close tag are renamed, so the result stays
 * well-formed XML - an unparseable body would reproduce the control's answer and
 * say nothing about the validator.
 */
export const PAGE_MUTATIONS = {
  'root-renamed': [['<StorePage', '</StorePage>'], ['<StorePageX', '</StorePageX>']],
  'panes-renamed': [['<Panes>', '</Panes>'], ['<PanesX>', '</PanesX>']],
  'pane-renamed': [['<Pane>', '</Pane>'], ['<PaneX>', '</PaneX>']],
  'templates-renamed': [['<Templates>', '</Templates>'], ['<TemplatesX>', '</TemplatesX>']],
  'template-renamed': [['<Template ', '</Template>'], ['<TemplateX ', '</TemplateX>']],
  'datasource-renamed': [['<DataSource>', '</DataSource>'], ['<DataSourceX>', '</DataSourceX>']],
  'entries-renamed': [['<a:entry>', '</a:entry>'], ['<a:entryX>', '</a:entryX>']],
};

/**
 * Apply one named mutation, or say why it cannot be applied.
 *
 * Returns `{ xml }` on success and `{ error, message }` otherwise; the caller
 * turns the second into a 502, because the two ways this can go wrong - an
 * unknown name and an element the document does not carry - are both operator
 * mistakes that must not be measured as client behaviour.
 */
export function applyPageMutation(name, xml) {
  const pairs = PAGE_MUTATIONS[name];
  if (!pairs) {
    return {
      error: 'unknown_mutant',
      message: `no mutation named "${name}"`,
      known: Object.keys(PAGE_MUTATIONS),
    };
  }
  const [from, to] = pairs;
  let out = String(xml);
  for (let i = 0; i < from.length; i += 1) {
    if (!out.includes(from[i])) {
      return {
        error: 'mutant_unavailable',
        message: `"${name}" renames ${from[i]}, which this page does not carry`,
        name,
      };
    }
    out = out.split(from[i]).join(to[i]);
  }
  if (out === xml) return { error: 'mutant_unavailable', message: `"${name}" changed nothing`, name };
  return { xml: out, name };
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
const controlCache = { file: null, mtimeMs: 0, value: null };

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
  // `uncategorised` is carried so the pane's data source can ask for the whole
  // catalog rather than for a category named "All apps", which no entry has.
  const uncategorised = apps.filter((app) => !String(app.category || '').trim()).slice(0, pageSize);
  if (uncategorised.length) sections.push({ title: 'All apps', items: uncategorised, uncategorised: true });

  return sections;
}

// ------------------------------------------------------------------ matching

// Matched on the path alone, deliberately. The lab is the only thing left that can
// answer these paths - the backend behind them is gone - so a method the protocol
// does not define should get the protocol's own refusal, not a passthrough into a
// host that cannot reply. Matching the method here instead made the 405 branch
// below unreachable, which is how a POST to the home page came back 200.
const ROUTES = [
  { name: 'configuration', pattern: /^\/v8\/Configuration\// },
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
 * Whether the configuration endpoint answers.
 *
 * The bare `true` is accepted as well as `{enabled: true}` because the setting is
 * one switch: a config written as `"configuration": true` must not read as off and
 * look like a change that had no effect.
 */
function configurationOn(settings) {
  const raw = settings.configuration;
  if (raw === true) return true;
  return Boolean(raw && typeof raw === 'object' && raw.enabled === true);
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
      const found = routeFor(ctx);
      if (!found) return false;
      // A disabled configuration endpoint is not a route with a refusal: it is the
      // lab as it was before, which let the request through and answered it 502.
      if (found.route.name === 'configuration' && !configurationOn(settings)) return false;
      return true;
    },

    async handle(ctx, { logger }) {
      const settings = protocolSettings(config);
      if (!isInterceptedHost(config, ctx.host)) {
        return jsonResponse({ error: 'host_not_intercepted', host: ctx.host }, 421);
      }

      const found = routeFor(ctx);
      if (!found) return null;
      if (found.route.name === 'configuration' && !configurationOn(settings)) return null;
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

      // The two configuration requests the Store makes before it asks for a page:
      // `/v8/Configuration/Stores/OEMStores/<oem>` and `/MOStores/`. They have failed
      // here since the lab existed - the host is hijacked, no handler matched, so the
      // relay resolved the name back to this process and answered `502
      // upstream_loop`. That is a lab defect, not a decision, and it sits on the
      // client's own critical path: on 2026-10-16 at 06:20 the device made eight of
      // these in 735 ms, gave up, and never asked for the page at all.
      //
      // What it answers is a reply and not a reconstruction - no capture of this
      // endpoint exists anywhere (F-020, F-021) - which the headers say out loud so
      // a later reader of the capture cannot mistake it for archived ground truth.
      // The frame is not invented any more: it is the `ConfigurationFile` grammar
      // the client's own file uses (sourced from the FFU), and the settings written
      // are the `WPAppsMarketplace*` / `OEMStoreID` names that file and the DLL's
      // pool spell. Only the pairing of that frame to this endpoint is inferred.
      if (found.route.name === 'configuration') {
        const segments = url.pathname.split('/').filter(Boolean);
        const family = segments[3] || '';
        const storeId = segments[4] || '';
        const xml = buildStoreConfiguration({
          storeType: family === 'OEMStores' ? 'OEMStore' : 'MOStore',
          storeId,
          cc: url.searchParams.get('cc') || 'IT',
          lang: url.searchParams.get('lang') || 'it-IT',
          scheme: ctx.scheme,
          host: ctx.host,
          mpcVersion: url.searchParams.get('mpcVersion') || '8.10',
          now,
        });
        return atomResponse(xml, {
          // Not the page's type: nothing observed says which type this endpoint
          // answers with, so the generic one is used and named here rather than
          // borrowed from the page and then read as evidence.
          'content-type': 'application/xml; charset=utf-8',
          ...headers,
          'x-lab-source': 'built: no capture of this endpoint exists',
          // Still 1, with a narrower meaning than it had this morning: the grammar
          // is the device's, the values answered to it are this lab's.
          'x-lab-invented': '1',
          'x-lab-configuration-store': `${family === 'OEMStores' ? 'OEMStore' : 'MOStore'}/${storeId || '-'}`,
          'x-lab-configuration-evidence': 'frame from the device ConfigurationFile grammar; endpoint pairing and values inferred',
        });
      }

      // The negative control: the page endpoints answer with a body no XML parser
      // can turn into a document. Same URL, same content type, same content-length
      // discipline - the body's validity is the only thing that differs from a
      // normal delivery, which is what makes the client's answer attributable.
      if (settings.serve === 'control-broken'
        && (found.route.name === 'storePages' || found.route.name === 'hubs')) {
        try {
          const body = readChangingFile(settings.controlFile, controlCache);
          // A repaired fixture is not a control, and serving one would turn a
          // normal delivery into a result that reads as "the client never parses".
          // Refusing is the only outcome that cannot be mistaken for a measurement.
          if (body.toString('utf8').trimEnd().endsWith('>')) {
            logger.warn(`store protocol: ${settings.controlFile} ends with a closing bracket, so it is no longer malformed`);
            return jsonResponse({
              error: 'control_unavailable',
              message: 'the control document is well-formed at its end; truncate it again or set serve back to generated',
              file: settings.controlFile,
            }, 502, headers);
          }
          return {
            status: 200,
            headers: {
              'content-type': 'application/atom+xml; charset=utf-8',
              'content-length': String(body.length),
              'cache-control': 'no-store',
              ...headers,
              'x-lab-protocol': `${found.route.name}:control`,
              'x-lab-control': 'malformed',
              'x-lab-source': settings.controlFile,
              'x-lab-control-warning': 'deliberately truncated body: not a page, a control for whether the client parses at all',
            },
            body,
          };
        } catch (err) {
          logger.warn(`store protocol: ${err.message}`);
          return jsonResponse({ error: 'control_unavailable', message: err.message }, 502, headers);
        }
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

        // Where each pane's content lives, as an absolute URL on the host the
        // device just reached this lab through, so the download it triggers comes
        // back here. A relative URL would leave the client to pick a host, and the
        // scheme is the one the request used: the page is fetched over plain HTTP
        // on this device, and a source URL that disagreed with it would be a
        // second variable inside the same change.
        const lang = url.searchParams.get('lang') || 'en-US';
        const dataSource = settings.dataSource ? {
          type: dataSourceType(settings.dataSourceType),
          maxItems: settings.pageSize,
          minItems: 1,
          urlFor: (section) => {
            const params = new URLSearchParams();
            params.set('chunkSize', String(settings.pageSize));
            if (!section.uncategorised) params.set('category', String(section.title));
            params.set('cc', cc);
            params.set('lang', lang);
            return `${ctx.scheme}://${ctx.host}/v9/catalog/apps?${params.toString()}`;
          },
        } : null;

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
          dataSource,
          paneType: settings.paneType,
          paneSubType: settings.paneSubType,
          paneBackgroundImage: Boolean(settings.paneBackgroundImage),
          now,
        });
        // The probe: the same page, one construct renamed. Refused rather than
        // served unchanged if the element is missing - see applyPageMutation.
        const mutation = settings.serve === 'mutant'
          ? applyPageMutation(settings.mutant, xml)
          : null;
        if (mutation && mutation.error) {
          logger.warn(`store protocol: mutant "${settings.mutant}": ${mutation.message}`);
          return jsonResponse(mutation, 502, headers);
        }
        return atomResponse(mutation ? mutation.xml : xml, {
          ...headers,
          ...(settings.pageCookie ? { 'x-wp-storepage-cookie': String(settings.pageCookie) } : {}),
          ...(mutation ? {
            'x-lab-protocol': `${found.route.name}:mutant`,
            'x-lab-mutant': settings.mutant,
            'x-lab-mutant-warning': 'the page the client accepts, with one construct renamed: an error from the device means it reads that construct, silence means it does not',
          } : {}),
          'x-lab-source': settings.catalogFile,
          'x-lab-sections': String(sections.length),
          'x-lab-page-type': pageType,
          'x-lab-page-format': normalizePageFormat(settings.pageFormat),
          'x-lab-template-type': String(settings.templateType),
          'x-lab-template-types-known': templateTypesForPageType(pageType).join(',') || 'none',
          'x-lab-pane-sources': dataSource ? dataSource.type : 'none',
          'x-lab-pane-type': String(settings.paneType || '').trim() || 'none',
          // Which of the pane's fields this delivery carried, so an experiment can never
          // be read off a capture that does not say what was armed.
          'x-lab-pane-background': settings.paneBackgroundImage ? 'guid' : 'none',
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
          ...appListShape(settings),
        });
        return atomResponse(xml, {
          ...headers,
          'x-lab-source': settings.catalogFile,
          ...appListHeaders(settings),
        });
      }

      // The flat application list - what a browse or search screen reads, and now
      // also what a pane's data source points at. The catalog is not searched
      // here: the lab serves the list and lets the device filter, because the tag
      // vocabulary the client sends is one no capture has shown us. The one filter
      // implemented is `category`, because a generated page hands each pane its
      // own section by name, and a pane that asked for a section and got the whole
      // catalog would be a page whose panes all show the same thing.
      const chunkSize = Number(url.searchParams.get('chunkSize')) || 0;
      const category = String(url.searchParams.get('category') || '').trim().toLowerCase();
      const forCategory = category
        ? catalog.apps.filter((app) => String(app.category || '').trim().toLowerCase() === category)
        : catalog.apps;
      const apps = chunkSize > 0 ? forCategory.slice(0, chunkSize) : forCategory;
      const xml = buildApplicationListFeed({
        apps,
        selfHref: requestPath,
        id: `tag:catalog.zune.net,${now.toISOString().slice(0, 10)}:/apps`,
        now,
        ...appListShape(settings),
      });
      return atomResponse(xml, {
        ...headers,
        'x-lab-source': settings.catalogFile,
        'x-lab-apps': String(apps.length),
        'x-lab-category': category || 'all',
        ...appListHeaders(settings),
      });
    },
  };
}

/**
 * The entry shape an application list is served with, read from the two config
 * values that describe it.
 *
 * Both defaults are this lab's own earlier feed and **not** the archived one, and
 * that is deliberate: an experiment that cannot be un-armed cannot be read, and
 * the archived shape has to be a value somebody set rather than a value nobody
 * noticed. `appListRank` empty means no `<k>` at all (every feed before the
 * archive was read); a number is what the first entry carries. `appListEntryTitle`
 * false drops the bare `<title>` that neither archived feed entry carries.
 *
 * A value that is not a finite number reads as *no rank* rather than as a rank,
 * so a typo in config cannot put `<k>NaN</k>` on the wire - the same rule
 * `normalizePageFormat` applies to a format nobody asked for.
 */
function appListShape(settings) {
  const raw = settings.appListRank;
  const seed = raw === '' || raw === null || raw === undefined ? NaN : Number(raw);
  return {
    entryRank: Number.isFinite(seed) ? seed : null,
    entryTitle: settings.appListEntryTitle !== false,
  };
}

/**
 * The same two values as response headers, because the header is where a value
 * that reached the builder and not the wire was caught once before: the served
 * shape has to be readable from the PC without parsing the body.
 */
function appListHeaders(settings) {
  const { entryRank, entryTitle } = appListShape(settings);
  return {
    'x-lab-applist-rank': entryRank === null ? 'none' : String(entryRank),
    'x-lab-applist-entry-title': entryTitle ? 'yes' : 'no',
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
