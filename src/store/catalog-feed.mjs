// The Zune catalog XML the Windows Phone Store reads.
//
// The grammar here is not invented. It is taken from archived responses of the
// real service (Wayback Machine captures of marketplaceedgeservice), three
// generations of the same format:
//
//   /v3.2/<locale>/clientTypes/WinMobile 7.1/hubTypes/marketplace/hub
//        -> <templateName>MarketplaceHub</templateName>, one entry with
//           <editorialItems> and <features>, both pointing at applications
//   /v8/catalog/hubs?...&hub=games
//        -> <templateName>GamesHub</templateName>, one entry with
//           <editorialItems> and the <applications> they point at
//   /v8/catalog/apps?..., /v9/catalog/apps?...
//        -> a flat list of <a:entry> application items
//
// All three are an Atom feed in http://schemas.zune.net/catalog/apps/2008/02,
// with a <templates> block naming the UI template that renders the page, and
// entries that carry ordered item lists whose <link><target> is an application
// GUID. That is the shape a store page has, and the reason this module can serve
// one: the phone asks for /v9/catalog/storePages?typeId=DynamicHub.Main, which is
// the same grammar one generation later.
//
// The template block is written from src/store/vocabulary.mjs, which is a reading
// of the phone rather than of an archive. That reading changed what goes in it: a
// store page's template is selected by a NUMERIC type (the phone styles
// Store_Hub_TemplateType003, ..004, ..015, ..017 and Store_Chart_TemplateType010),
// not by a name. The <templateName> an archived page carries is kept because
// archived responses prove the client's generation wrote it, but it is no longer
// the value the page depends on.
//
// Both spellings of the type key are written by default - as an attribute of
// <Template> and as a child element - because nothing readable from the phone can
// decide which the parser expects (see TYPE_KEY_FORMS in vocabulary.mjs). A page
// that carries the value in both places is read correctly whichever way it looks;
// `templateTypeForm` narrows it once the device has said which it accepts.
//
// Everything the client needs in order to come back for more is deterministic:
// a catalog id maps to the same GUID on every run, so a later request for that
// GUID resolves back to the same catalog entry with no state to keep.

import crypto from 'node:crypto';

import { FEED_PATHS, TEMPLATE_GRAMMAR } from './vocabulary.mjs';

export const ATOM_NS = 'http://www.w3.org/2005/Atom';
export const OPEN_SEARCH_NS = 'http://a9.com/-/spec/opensearch/1.1/';
export const CATALOG_NS = 'http://schemas.zune.net/catalog/apps/2008/02';

/** The author the real feeds carry. Protocol data, not a claim about who serves this. */
const FEED_AUTHOR = 'Microsoft Corporation';

/** Client the feed declares its offers for. Observed on the v9 responses. */
const CLIENT_TYPE = 'WindowsPhone81';

/**
 * Namespace for every GUID this lab mints. Fixed on purpose: the same catalog
 * entry must yield the same GUID after a restart, because the GUID is the only
 * handle the device keeps and it is how its follow-up request is mapped back.
 */
const LAB_NAMESPACE = 'c1a9f2b4-6d3e-4a71-9f0b-7e5c2d8a4b16';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The page's structural element names, taken from the paths the parser walks
 * rather than spelled here. `/Panes/Pane` is one entry of FEED_PATHS, so a page
 * built from this module cannot name a container the client does not look for.
 */
const PANE_PATH = FEED_PATHS.find((entry) => entry.path === '/Panes/Pane').path.slice(1).split('/');
const PANE_CONTAINER = PANE_PATH[0];
const PANE_ELEMENT = PANE_PATH[1];
const CONTENT_LINK_TYPE = 'ApplicationCollection';

/**
 * The document root the v9 store page is read from.
 *
 * `/StorePage` is a path in the parser's own table, and nothing served here has
 * ever carried it: every page this lab produced was an Atom `<a:feed>` at the
 * root, which is the shape of the *v8* `catalog/hubs` responses and of the app
 * detail feeds (`/BatchGetApplicationDetailsResponse/Resources/Resource/feed`).
 * The store page endpoint is a different endpoint and the parser keeps a separate
 * grammar run for it - `/Panes/Pane`, `/Templates/Template`, `TEMPLATETYPE` - and
 * `/StorePage` is the only element name in that family that the page was missing.
 *
 * What is evidence and what is inferred, said plainly: `/StorePage` existing as a
 * path is evidence. That it is the *root* is inferred - nothing readable from the
 * phone says where in the document it sits, because the parser matches paths
 * through a rolling context (`XmlPathContext::CommonPush` / `Pop` in the binary)
 * rather than from the document node. Wrapping rather than replacing is the choice
 * that keeps the archive-verified structure intact underneath, so if the element
 * is not the root the entries are still where they were.
 *
 * `pageFormat` in config selects one of three documents, so every version of this
 * decision is one setting and none of them needs code to undo:
 *
 *   `storePage`  the root above, with the panes carrying a title and a reference
 *                to their section and the items in the feed underneath it;
 *   `panes`      the same document, except each pane also carries its own
 *                `<editorialItems>` and `<applications>`. That is the arrangement
 *                of the archived response, where the entry a pane points at holds
 *                its items inline, and it is the one variant in which the client
 *                is never asked to resolve a reference to content it already has;
 *   `atom`       the plain `<a:feed>` root, the older shape, kept because every
 *                earlier page was it and something has to be able to serve it.
 */
const STORE_PAGE_ROOT = 'StorePage';

/**
 * Category names as the real feeds spell them, with the ids they use.
 * Everything below is an observed pair from an archived response except the
 * three marked inferred, which follow the same convention as the observed ones
 * (windowsphone.<Words>, `+` and spaces dropped, `and` kept).
 */
const OBSERVED_CATEGORIES = {
  games: 'windowsphone.Games',
  platformer: 'windowsphone.Platformer',
  'puzzle + trivia': 'windowsphone.PuzzleAndTrivia',
  'strategy + simulation': 'windowsphone.Strategy',
  'action + adventure': 'windowsphone.ActionAndAdventure',
  shooter: 'windowsphone.Shooter',
  'tools + productivity': 'windowsphone.ToolsAndProductivity',
  'books + reference': 'windowsphone.BooksAndReference',
  reference: 'windowsphone.Reference',
  photo: 'windowsphone.Photo',
  social: 'windowsphone.Social',
  sports: 'windowsphone.Sports',
  education: 'windowsphone.Education',
  'music + video': 'windowsphone.MusicAndVideo',
  'health + fitness': 'windowsphone.HealthAndFitness',
  // inferred: never seen in a capture, spelled by the convention above
  lifestyle: 'windowsphone.Lifestyle',
  'kids + family': 'windowsphone.KidsAndFamily',
  'news + weather': 'windowsphone.NewsAndWeather',
};

/** Escape text so it cannot break the document it is embedded in. */
export function escapeXml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Drop characters XML 1.0 cannot carry at all (C0 controls other than tab, LF
 * and CR, plus the lone-surrogate range). A catalog title is data from outside
 * this process, and one stray control byte would make the whole page unparseable
 * on the device - the failure mode this whole module exists to avoid.
 */
export function sanitizeText(value) {
  return String(value ?? '')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g, '')
    .replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/g, '')
    .replace(/(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, '');
}

function text(value) {
  return escapeXml(sanitizeText(value));
}

function formatUuid(bytes) {
  const hex = Buffer.from(bytes).toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

/** RFC 4122 version-5 UUID over the lab namespace. */
export function uuid5(name, namespace = LAB_NAMESPACE) {
  const ns = Buffer.from(String(namespace).replace(/-/g, ''), 'hex');
  const digest = crypto.createHash('sha1').update(ns).update(String(name), 'utf8').digest();
  const bytes = Buffer.from(digest.subarray(0, 16));
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  return formatUuid(bytes);
}

/** The GUID a catalog entry is served under. Stable across runs by construction. */
export function uuidForApp(catalogId) {
  return uuid5(`app:${catalogId}`);
}

/** The GUID an application's primary image is served under. */
export function uuidForImage(catalogId) {
  return uuid5(`image:${catalogId}`);
}

/**
 * The GUID an application's background image is served under. Distinct from the
 * primary image on purpose: every archived entry carries a different value in
 * <backgroundImage> than in <image>, and the device asks for one of them by that
 * value. Sharing it would make it request the icon where it meant the background.
 */
export function uuidForBackground(catalogId) {
  return uuid5(`background:${catalogId}`);
}

/** The GUID a page's section (its collection of items) is served under. */
export function uuidForCollection(name) {
  return uuid5(`collection:${name}`);
}

/** The GUID one display item inside a section is served under. */
export function uuidForEditorial(catalogId) {
  return uuid5(`editorial:${catalogId}`);
}

/** True for a string shaped like a GUID. */
export function isUuid(value) {
  return UUID_RE.test(String(value || ''));
}

/**
 * Resolve a GUID back to the catalog entry it was minted from.
 * The mapping is a one-way hash, so this is a scan: the GUID is recomputed for
 * every entry and compared. That keeps the lab stateless, which matters because
 * the device may come back for a GUID long after the process that minted it.
 */
export function findAppByUuid(apps, uuid) {
  if (!isUuid(uuid)) return null;
  const wanted = String(uuid).toLowerCase();
  return (apps || []).find((app) => uuidForApp(app.id) === wanted) || null;
}

/** `news + weather` -> `windowsphone.NewsAndWeather`, for names never observed. */
export function categoryId(name) {
  const key = String(name || '').trim().toLowerCase();
  if (OBSERVED_CATEGORIES[key]) return OBSERVED_CATEGORIES[key];
  const words = key
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1));
  return `windowsphone.${words.join('') || 'Other'}`;
}

/**
 * The store parses a version as four numbers; every value in an archived response
 * has four parts. A three-part version is padded rather than passed through,
 * because a short one is the form never seen.
 */
export function normalizeVersion(version) {
  const parts = String(version || '').trim().split('.');
  if (parts.length === 0 || parts[0] === '') return '1.0.0.0';
  while (parts.length < 4) parts.push('0');
  return parts.slice(0, 4).join('.');
}

/**
 * A rating as the feeds carry it: a number on a 0-10 scale, not a star count and
 * not a string. The archived responses show `9.793103`, `8.235294` and plain
 * `10`, so the value is passed through rather than reformatted - the form varies
 * in the real thing and inventing a canonical one would be inventing evidence.
 *
 * A rating the catalog does not state becomes `0`, which is what this wrote for
 * every entry before it read one: an unrated app is reported as unrated.
 */
export function normalizeRating(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) return '0';
  return String(Math.min(10, number));
}

/** How many ratings that average is over. Unstated means none, which reads as 0. */
export function normalizeRatingCount(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) return '0';
  return String(Math.floor(number));
}

/**
 * A boolean as the feeds spell it: the word, capitalised. Accepts the truthy
 * shapes a JSON catalog might use for it, because a catalog is hand-written data
 * and `"true"` is a normal way to write a boolean in one.
 */
function boolWord(value) {
  return value === true || value === 'true' || value === 1 || value === '1' ? 'true' : 'false';
}

/** A release date as the feeds carry it: UTC, six fractional digits, `Z`. */
export function normalizeReleaseDate(value) {
  const raw = String(value || '').trim();
  const date = raw ? new Date(/^\d{4}-\d{2}-\d{2}$/.test(raw) ? `${raw}T00:00:00.000Z` : raw) : null;
  const when = date && !Number.isNaN(date.getTime()) ? date : new Date(0);
  return `${when.toISOString().replace(/\.\d{3}Z$/, '.000000Z')}`;
}

function feedStamp(now) {
  const date = now instanceof Date ? now : new Date();
  return `${date.toISOString().replace(/\.\d{3}Z$/, '.000000Z')}`;
}

/** 32 lowercase hex, the form the page feeds carry at feed level. */
export function impressionId(seed = crypto.randomUUID()) {
  return crypto.createHash('md5').update(String(seed)).digest('hex');
}

function categoriesXml(app) {
  const name = String(app.category || '').trim();
  if (!name) return '';
  const id = categoryId(name);
  return `<categories><category><id>${text(id)}</id><title>${text(name)}</title>`
    + '<isRoot>True</isRoot></category></categories>';
}

function offerXml(app) {
  const offerId = uuid5(`offer:${app.id}`);
  const price = app.price === undefined || app.price === null ? '0' : String(app.price);
  const currency = app.currencyCode || 'USD';
  const display = app.displayPrice || (price === '0' ? '$0.00' : `$${price}`);
  return '<offers><offer>'
    + `<offerId>urn:uuid:${offerId}</offerId>`
    + `<clientTypes><clientType>${CLIENT_TYPE}</clientType></clientTypes>`
    + '<paymentTypes><paymentType>Credit Card</paymentType><paymentType>Mobile Operator</paymentType></paymentTypes>'
    + '<store>ZEST</store>'
    + `<price>${text(price)}</price>`
    + `<displayPrice>${text(display)}</displayPrice>`
    + `<priceCurrencyCode>${text(currency)}</priceCurrencyCode>`
    + '<licenseRight>Purchase</licenseRight>'
    + '</offer></offers>';
}

function publisherXml(app) {
  const name = app.publisher || app.developer || 'Unknown';
  return `<publisher><id>${text(name)}</id><name>${text(name)}</name></publisher>`;
}

function imageXml(app) {
  return `<image><id>urn:uuid:${uuidForImage(app.id)}</id></image>`;
}

/**
 * One application record, in the shape `/v8/catalog/hubs` carries inside a
 * section's <applications>, and a list feed carries as its own <a:entry> body.
 *
 * `tag` is the element around it: `application` inside a section, `a:entry` in a
 * list. The two differ only in that envelope, so the fields live here once.
 */
function applicationFields(app, now) {
  return `<title>${text(app.name || app.title || 'Untitled')}</title>`
    + `<sortTitle>${text(app.name || app.title || 'Untitled')}</sortTitle>`
    + `<releaseDate>${normalizeReleaseDate(app.release_date || app.releaseDate)}</releaseDate>`
    + `<version>${text(normalizeVersion(app.version))}</version>`
    // Rating, count and live tile used to be fixed at 0/0/false here, so a
    // catalog that stated them was silently ignored. They are read now, with
    // those same values as what an entry that states nothing gets - which keeps
    // every earlier page byte-identical.
    + `<averageUserRating>${normalizeRating(app.rating ?? app.averageUserRating)}</averageUserRating>`
    + `<userRatingCount>${normalizeRatingCount(app.ratingCount ?? app.userRatingCount)}</userRatingCount>`
    + imageXml(app)
    + `<hasLiveTile>${boolWord(app.hasLiveTile ?? app.has_live_tile)}</hasLiveTile>`
    + categoriesXml(app)
    + '<tags><tag>Independent</tag></tags>'
    + offerXml(app)
    + publisherXml(app);
}

/** The application as a section carries it. */
function applicationXml(app, now) {
  return `<application><id>urn:uuid:${uuidForApp(app.id)}</id>${applicationFields(app, now)}</application>`;
}

/** The application as a list feed carries it. */
function applicationEntryXml(app, now, feedImpression) {
  return '<a:entry>'
    + `<a:updated>${feedStamp(now)}</a:updated>`
    + `<a:title type="text">${text(app.name || app.title || 'Untitled')}</a:title>`
    + `<a:id>urn:uuid:${uuidForApp(app.id)}</a:id>`
    + '<isHardwareCompatible>true</isHardwareCompatible>'
    + applicationFields(app, now)
    + `<impressionId>${text(feedImpression)}:API.BDIGeneric</impressionId>`
    + '<isUniversal>false</isUniversal>'
    + '</a:entry>';
}

/**
 * The ordered items of one section: the editorial items that name the apps, in
 * order, each with its own handle and artwork.
 *
 * Written once and used by both places a section's items can appear - the feed's
 * entry and, in `panes` format, the pane itself - so the two can never disagree
 * about what a section holds or in what order.
 */
function editorialItemsXml(items) {
  const records = (items || []).map((app, position) => {
    const editorial = uuidForEditorial(app.id);
    return `<editorialItem><id>urn:uuid:${editorial}</id>`
      + `<link><type>Application</type><target>${uuidForApp(app.id)}</target></link>`
      + `<title>${text(app.name || app.title || 'Untitled')}</title>`
      + `<sequenceNumber>${position + 1}</sequenceNumber>`
      + imageXml(app)
      + `<backgroundImage><id>urn:uuid:${uuidForBackground(app.id)}</id></backgroundImage>`
      + '</editorialItem>';
  }).join('');
  return `<editorialItems>${records}</editorialItems>`;
}

/** The application records a section's items refer to, as its entry and its pane both carry them. */
function applicationsXml(items, now) {
  return `<applications>${(items || []).map((app) => applicationXml(app, now)).join('')}</applications>`;
}

/**
 * The page's panes: the containers the client builds its page model out of.
 *
 * This block was missing from every page this lab has served, and the parser says
 * so in two strings read from the phone itself - it walks `/Panes/Pane` and
 * reports `Found %d Store Panes` before it reports `Found %d Store Templates`
 * (src/store/vocabulary.mjs carries the offsets). A page with a template block and
 * no panes is a page whose template has nothing to render, which is exactly what
 * the device did with it: it asked twice and then asked for nothing at all - no
 * image, no detail page. That is the signature of a page that parsed and produced
 * an empty model, not of a page that failed to parse.
 *
 * One pane per section, each referring to its section by the same collection GUID
 * the feed's entry carries, so the two views of a section cannot drift apart.
 *
 * Open, and said so rather than hidden: the pane's own child elements. `/Panes/Pane`
 * gives the container and the element, not what is inside it, and nothing else
 * readable from this phone describes a pane - the neighbouring id formats (`tptg%s-%d`,
 * `adp%s`, `off%s-%s-%s-%s`) turn out to belong to in-app product tags, dependency
 * packages and offers, not to page structure. The children below are therefore the
 * tokens the page already proves the client reads (`<index>`, a
 * `<link><type>ApplicationCollection</type>`, a title), which is the least a pane
 * can carry and still say what it is.
 *
 * `withItems` is the one thing `pageFormat: 'panes'` changes, and it is the
 * archived page's own arrangement rather than an invention: in the real response
 * the section's `<a:entry>` carries its `<editorialItems>` and `<applications>`
 * inline, and the pane's collection GUID is that same entry's id. A pane that
 * holds a GUID and no items asks the client to resolve a reference to something it
 * has already been sent, and the client's answer, so far, is to ask for nothing
 * more at all. This variant hands the items over where the pane is. The document
 * is otherwise identical - same root, same template block, same feed underneath -
 * so a change in what the device does is attributable to this and nothing else.
 */
function panesXml({ sections, withItems = false, now }) {
  const panes = sections.map((section, index) => {
    const collection = uuidForCollection(section.title || `section-${index + 1}`);
    const items = section.items || [];
    return `<${PANE_ELEMENT}>`
      + `<index>${index + 1}</index>`
      + `<title>${text(section.title || 'List Of Items')}</title>`
      + `<link><type>${CONTENT_LINK_TYPE}</type><target>${collection}</target></link>`
      + (withItems ? editorialItemsXml(items) + applicationsXml(items, now) : '')
      + `</${PANE_ELEMENT}>`;
  }).join('');
  return `<${PANE_CONTAINER}>${panes}</${PANE_CONTAINER}>`;
}

/**
 * The page's template block: which layout the client renders the page with.
 *
 * Element and container names come from the path the parser walks,
 * `/Templates/Template`, so they are not a style choice. `typeKeyForm` decides
 * whether the type key travels as an attribute, as a child element, or both.
 *
 * @param {object} options
 * @param {string} [options.templateName] the name the client's generation of the
 *   grammar also carried; omitted for feeds that have no page layout.
 * @param {string} [options.templateType] the numeric type the phone styles.
 * @param {'attribute'|'element'|'both'} [options.typeKeyForm]
 */
function templateBlockXml({ templateName, templateType, typeKeyForm = 'both' }) {
  if (!templateName && !templateType) return '';
  const key = TEMPLATE_GRAMMAR.typeKey;
  const asAttribute = templateType && (typeKeyForm === 'attribute' || typeKeyForm === 'both');
  const asElement = templateType && (typeKeyForm === 'element' || typeKeyForm === 'both');
  return `<${TEMPLATE_GRAMMAR.container}><${TEMPLATE_GRAMMAR.element}`
    + (asAttribute ? ` ${key}="${text(templateType)}"` : '')
    + '>'
    + '<mimeType>application/uix</mimeType>'
    + (templateName ? `<templateName>${text(templateName)}</templateName>` : '')
    + (asElement ? `<${key}>${text(templateType)}</${key}>` : '')
    + `</${TEMPLATE_GRAMMAR.element}></${TEMPLATE_GRAMMAR.container}>`;
}

function feedHeader({
  selfHref, updated, title, id, impression, sections, templateName, templateType, typeKeyForm,
  blocks = true,
}) {
  return '<?xml version="1.0" encoding="utf-8"?>'
    + `<a:feed xmlns:a="${ATOM_NS}" xmlns:os="${OPEN_SEARCH_NS}" xmlns="${CATALOG_NS}">`
    + `<a:link rel="self" type="application/atom+xml" href="${escapeXml(selfHref)}" />`
    + `<a:updated>${updated}</a:updated>`
    + `<a:title type="text">${text(title)}</a:title>`
    + `<a:id>${text(id)}</a:id>`
    + (impression ? `<impressionId>${text(impression)}</impressionId>` : '')
    // Panes before templates, the order the parser's own string table holds the
    // two paths in - the closest thing to evidence about document order that the
    // phone offers. Omitted when the caller places them one level up, under the
    // page root, which is where the page grammar puts them.
    + (blocks && sections ? panesXml({ sections }) : '')
    + (blocks ? templateBlockXml({ templateName, templateType, typeKeyForm }) : '');
}

function feedFooter() {
  return `<a:author><a:name>${text(FEED_AUTHOR)}</a:name></a:author></a:feed>`;
}

/**
 * The documents the page endpoint can answer with. Kept as data so the three
 * names live in one place and an unknown value has one defined meaning.
 */
export const PAGE_FORMATS = ['storePage', 'panes', 'atom'];

/**
 * The format a value names, or the default when it names nothing this builder
 * knows. A typo in config must not silently become a document nobody asked for,
 * so anything unrecognised reads as the default the lab served before.
 *
 * @param {unknown} value
 * @returns {'storePage'|'panes'|'atom'}
 */
export function normalizePageFormat(value) {
  const wanted = String(value ?? '').trim();
  return PAGE_FORMATS.includes(wanted) ? wanted : 'storePage';
}

/**
 * A store page: a feed whose entries are the page's sections, each carrying the
 * ordered items to show and the application records those items refer to.
 *
 * @param {object} options
 * @param {{title: string, items: object[]}[]} options.sections
 * @param {string} options.selfHref
 * @param {string} options.id
 * @param {string} [options.title]
 * @param {string} options.templateName
 * @param {string} [options.templateType] numeric template type from the vocabulary.
 * @param {'attribute'|'element'|'both'} [options.typeKeyForm]
 * @param {'storePage'|'panes'|'atom'} [options.pageFormat] the document to answer
 *   with. `storePage` and `panes` are both rooted at `<StorePage>` and differ only
 *   in whether each pane carries its section's items; `atom` is the older
 *   `<a:feed>` root.
 * @param {Date} [options.now]
 * @returns {string} XML
 */
export function buildStorePageFeed({
  sections = [], selfHref = '/', id = 'storePage', title = 'List Of Items',
  templateName, templateType, typeKeyForm, pageFormat, now = new Date(),
} = {}) {
  const format = normalizePageFormat(pageFormat);
  const stamp = feedStamp(now);
  const impression = impressionId(`${id}:${stamp}`);
  const entries = sections.map((section, index) => {
    const collection = uuidForCollection(section.title || `section-${index + 1}`);
    const items = section.items || [];

    return '<a:entry>'
      + `<a:updated>${stamp}</a:updated>`
      + '<a:title type="text">List Of Items</a:title>'
      + `<a:id>urn:uuid:${collection}</a:id>`
      + `<index>${index + 1}</index>`
      + `<link><type>ApplicationCollection</type><target>${collection}</target></link>`
      + editorialItemsXml(items)
      + applicationsXml(items, now)
      + '</a:entry>';
  }).join('');

  const wantsPageRoot = format === 'storePage' || format === 'panes';

  // The page root holds the panes and the template block as its own children and
  // the feed beside them, rather than the feed holding everything. The feed keeps
  // the namespace declarations it needs, which scopes them to that subtree exactly
  // as before, and the archive-verified entries stay where they were. In `panes`
  // format the panes additionally carry the items their entries already carry, so
  // that variant adds to this document instead of replacing it.
  const header = feedHeader({
    selfHref, updated: stamp, title, id, impression,
    sections: wantsPageRoot ? null : sections,
    templateName, templateType, typeKeyForm,
    blocks: !wantsPageRoot,
  });
  const feed = header + entries + feedFooter();

  if (!wantsPageRoot) return feed;

  // The XML declaration belongs to the document, not to the root element, so it
  // is lifted out before the root is wrapped around the feed.
  const withoutDeclaration = feed.replace(/^<\?xml[^?]*\?>/, '');
  return '<?xml version="1.0" encoding="utf-8"?>'
    + `<${STORE_PAGE_ROOT}>`
    + panesXml({ sections, withItems: format === 'panes', now })
    + templateBlockXml({ templateName, templateType, typeKeyForm })
    + withoutDeclaration
    + `</${STORE_PAGE_ROOT}>`;
}

/**
 * The answer to the update check, `POST /v8/catalog/updates`.
 *
 * The phone POSTs a `BatchGetProductUpdatesRequest` naming the SKUs it holds; the
 * parser describes the reply as `/BatchGetProductUpdatesResponse/Resources/Resource`
 * with `ProductId`, `CurrentPayloadId`, `IsRevoked` and `Result` on each resource.
 * Those four element names are the whole of what is evidenced about this document,
 * so those four are all this writes - no invented fields dressed up as observed
 * ones.
 *
 * Every SKU is reported **unchanged**, and that is a statement of fact rather than
 * a placeholder: nothing here serves a package, so no SKU can have an update to
 * offer. Reporting an update would be the only answer that could be wrong.
 *
 * The namespace is the one the request itself arrives in, copied from the captured
 * body, because a request/response pair that disagree on their namespace is a
 * pairing this lab has no evidence for either way.
 *
 * @param {{skus: string[]}} options
 * @returns {string} XML
 */
export function buildProductUpdatesResponse({ skus = [] } = {}) {
  const resources = (skus.length ? skus : []).map((sku) => '<Resource>'
    + `<ProductId>${text(sku)}</ProductId>`
    + '<IsRevoked>false</IsRevoked>'
    + '<Result>0</Result>'
    + '</Resource>').join('');
  return '<?xml version="1.0" encoding="utf-8"?>'
    + `<BatchGetProductUpdatesResponse xmlns="${CATALOG_NS}">`
    + `<Resources>${resources}</Resources>`
    + '</BatchGetProductUpdatesResponse>';
}

/**
 * A flat application list, the shape `/v8/catalog/apps` and `/v9/catalog/apps`
 * answer with. That endpoint is what a browse or search screen reads.
 */
export function buildApplicationListFeed({ apps = [], selfHref = '/', id = 'apps', title = 'List Of Items', now = new Date() }) {
  const stamp = feedStamp(now);
  const impression = impressionId(`${id}:${stamp}`);
  return feedHeader({
    selfHref, updated: stamp, title, id, impression, templateName: null,
  }) + apps.map((app) => applicationEntryXml(app, now, impression)).join('') + feedFooter();
}
