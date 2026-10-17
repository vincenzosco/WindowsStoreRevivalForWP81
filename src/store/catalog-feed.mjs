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
function applicationFields(app, now, { withTitle = true } = {}) {
  return (withTitle ? `<title>${text(app.name || app.title || 'Untitled')}</title>` : '')
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

/**
 * The application as a list feed carries it.
 *
 * Two fields of this entry are set from what the archived responses of the real
 * service carry, and both are read off the raw bytes rather than remembered:
 *
 * `rank` writes `<k>`, the one element that appears in **both** archived
 * generations of this endpoint - `/v9/catalog/apps` (2016-05-06) and
 * `/v8/catalog/apps` (2013-12-16) - and in nothing this lab has ever served. It
 * sits immediately after `<impressionId>`, before `<isUniversal>`, on every
 * entry of both captures, and its arithmetic is the same in both: **4** on the
 * first entry, +1 each, which is `position + 3` over 14 entries and over 50. The
 * offset of 3 is observed and not explained; it is a configurable seed rather
 * than a constant for exactly that reason. `null` writes no `<k>` at all, which
 * is every feed this lab served before.
 *
 * `entryTitle` writes the bare `<title>` that every entry this lab served before
 * carried and that **neither** archived feed entry carries: in both captures the
 * only `<title>` at entry level is the one inside a `<category>`, and the app's
 * own name travels as `<a:title type="text">` plus `<sortTitle>`. The archived
 * *page* (`/v8/catalog/hubs`) is the opposite - its `<application>` blocks do
 * carry a bare `<title>` - which is why that one is written by
 * `applicationFields` and only the list entry turns it off.
 */
function applicationEntryXml(app, now, feedImpression, { rank = null, entryTitle = true } = {}) {
  return '<a:entry>'
    + `<a:updated>${feedStamp(now)}</a:updated>`
    + `<a:title type="text">${text(app.name || app.title || 'Untitled')}</a:title>`
    + `<a:id>urn:uuid:${uuidForApp(app.id)}</a:id>`
    + '<isHardwareCompatible>true</isHardwareCompatible>'
    + applicationFields(app, now, { withTitle: entryTitle })
    + `<impressionId>${text(feedImpression)}:API.BDIGeneric</impressionId>`
    + (rank === null ? '' : `<k>${text(rank)}</k>`)
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
 *
 * `dataSource` is the other, and it is not an arrangement of the same content: it
 * is a *pointer*, and the client downloads what it points at. The pane's own
 * property map (`PANE_FIELDS` in vocabulary.mjs) holds `/DataSource/Type` and
 * `/DataSource/Url`, `ProcessEntryFromType` creates its objects from `FeedType` and
 * `Url` together, and `PendingListDownload::*` is the download that follows. So a
 * pane has two ways to be given content - inline, and by reference - and until now
 * this lab served only the first.
 *
 * The three capitalised fields are written here because the pane's map spells them
 * that way (`/Id`, `/Title`) where the entries below spell theirs in lower case
 * (`/id`, `/title`). Both are written for the title rather than one replacing the
 * other: which of the two a *pane* is read through is not settled, and the lower
 * case one was already being sent.
 *
 * @param {object} options
 * @param {boolean} [options.withItems]
 * @param {{type: string, urlFor: Function, maxItems: number, minItems: number}} [options.dataSource]
 * @param {string} [options.paneType] what a pane *is*, when the caller wants it said
 * @param {string} [options.paneSubType]
 */
function panesXml({ sections, withItems = false, now, dataSource = null, paneType = '', paneSubType = '' }) {
  const panes = sections.map((section, index) => {
    const collection = uuidForCollection(section.title || `section-${index + 1}`);
    const items = section.items || [];
    const title = text(section.title || 'List Of Items');
    return `<${PANE_ELEMENT}>`
      + `<Id>${collection}</Id>`
      + `<Title>${title}</Title>`
      + paneKindXml(paneType, paneSubType)
      + `<index>${index + 1}</index>`
      + `<title>${title}</title>`
      + `<link><type>${CONTENT_LINK_TYPE}</type><target>${collection}</target></link>`
      + `<CollectionId>${collection}</CollectionId>`
      + dataSourceXml(section, dataSource)
      + (withItems ? editorialItemsXml(items) + applicationsXml(items, now) : '')
      + `</${PANE_ELEMENT}>`;
  }).join('');
  return `<${PANE_CONTAINER}>${panes}</${PANE_CONTAINER}>`;
}

/**
 * What kind of object a pane is, as the pane's own property map spells it.
 *
 * These are the last two fields of that map this lab writes nothing for (`/Type`,
 * `/SubType`), and there is one piece of evidence for a value rather than none: the
 * literal pool of `ProcessEntryFromType` - the function that logs `Found %d Store
 * Panes`, reads `/Panes/Pane` and creates objects from a `FeedType` and a `Url` -
 * holds the token **`inv`**, twice, between `/Templates/Template` and `/Templates`.
 * The same token opens the object-code table at @20112, where every other code
 * (`app`, `fea`, `col`, `sto`) names a family this shop deals in.
 *
 * Omitted when nothing is configured, so a page can be served with no type at all -
 * which is the page that has been delivered so far and whose result is already
 * recorded. An empty value is not a claim that empty is right.
 */
function paneKindXml(paneType, paneSubType) {
  const type = String(paneType || '').trim();
  const subType = String(paneSubType || '').trim();
  return (type ? `<Type>${text(type)}</Type>` : '')
    + (subType ? `<SubType>${text(subType)}</SubType>` : '');
}

/**
 * Where a pane's content comes from: a type, a URL, and how much of it to take.
 *
 * Omitted entirely when no data source was asked for, so that the page this lab
 * served before is still servable byte for byte - an experiment that cannot be
 * un-armed is not an experiment.
 *
 * A section whose URL builder returns nothing (no data source for it) is left
 * pointing at the collection it already names, which is what every page before
 * this did.
 */
function dataSourceXml(section, dataSource) {
  if (!dataSource) return '';
  const url = dataSource.urlFor ? dataSource.urlFor(section) : null;
  if (!url) return '';
  return '<DataSource>'
    + `<Type>${text(dataSource.type)}</Type>`
    + `<Url>${escapeXml(url)}</Url>`
    + '</DataSource>'
    + `<MaxItems>${text(dataSource.maxItems)}</MaxItems>`
    + `<MinItems>${text(dataSource.minItems)}</MinItems>`;
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
  blocks = true, dataSource = null, paneType = '', paneSubType = '',
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
    + (blocks && sections ? panesXml({ sections, dataSource, paneType, paneSubType }) : '')
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
 * @param {{type: string, urlFor: Function, maxItems: number, minItems: number}} [options.dataSource]
 *   the per-pane data source; omitted means the panes carry none, which is what
 *   every page this lab served before did.
 * @param {string} [options.paneType] the pane's own type, written into every pane
 *   when set. Empty means the pages this lab served before, which carried none.
 * @param {string} [options.paneSubType] the pane's own sub type, same rule.
 * @param {Date} [options.now]
 * @returns {string} XML
 */
export function buildStorePageFeed({
  sections = [], selfHref = '/', id = 'storePage', title = 'List Of Items',
  templateName, templateType, typeKeyForm, pageFormat, dataSource = null,
  paneType = '', paneSubType = '', now = new Date(),
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
  // the feed beside them, rather than the feed holding everything. In `panes`
  // format the panes additionally carry the items their entries already carry, so
  // that variant adds to this document instead of replacing it.
  //
  // The root declares the same three namespaces the feed used to declare alone.
  // Declaring them only on the nested feed left `StorePage`, `Panes`, `Template`
  // and everything inside a pane in *no* namespace, which is a document no
  // Microsoft service emits: the archived real response declares them on its own
  // root, and the parser references `http://schemas.zune.net/catalog/apps/2008/02`
  // (at `@118040`, beside `XMLSchema-instance`) and the literal `xmlns` inside
  // `PendingListDownload::ParseFromStream` (`@27812`). The declarations therefore
  // belong on the document element. The feed keeps its own copies, which are
  // redundant, legal, and leave the archive-verified subtree byte-identical.
  const header = feedHeader({
    selfHref, updated: stamp, title, id, impression,
    sections: wantsPageRoot ? null : sections,
    templateName, templateType, typeKeyForm,
    blocks: !wantsPageRoot,
    dataSource, paneType, paneSubType,
  });
  const feed = header + entries + feedFooter();

  if (!wantsPageRoot) return feed;

  // The XML declaration belongs to the document, not to the root element, so it
  // is lifted out before the root is wrapped around the feed.
  const withoutDeclaration = feed.replace(/^<\?xml[^?]*\?>/, '');
  return '<?xml version="1.0" encoding="utf-8"?>'
    + `<${STORE_PAGE_ROOT} xmlns:a="${ATOM_NS}" xmlns:os="${OPEN_SEARCH_NS}" xmlns="${CATALOG_NS}">`
    + panesXml({ sections, withItems: format === 'panes', now, dataSource, paneType, paneSubType })
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
 * The answer to `GET /v8/Configuration/Stores/OEMStores/<oem>` and
 * `/MOStores/`, the two requests this phone makes when the Store opens.
 *
 * **The grammar is the device's own; the values are this lab's.** That distinction
 * is the whole of what changed on 2026-10-17 and it is worth stating exactly.
 *
 * The frame is taken from a configuration file the client itself ships and reads:
 * `<ConfigurationFile version="81000" forceupdate="0"><Domains><Domain id="PROD">
 * <setting id="...">value</setting>`. That file is on the device and in the
 * offline image (`RMRoot\Windows\System32\...\*ConfigurationFile*.xml`), it is the
 * one `ZMarketplace.dll` parses, and its settings are exactly the
 * `MktConfigSetting_*` names the DLL's own pool enumerates. Inside it every service
 * base is a `<setting>`, e.g.
 * `<setting id="WPAppsMarketplaceShopSecure" nexus="WPAppsMarketplaceShopSecure">
 * https://marketplaceedgeservice.windowsphone.com/</setting>`, and those settings
 * are the `{Placeholder}` tokens the endpoint table substitutes:
 * `{WPAppsMarketplaceShopSecure}v8/Configuration/Stores/OEMStores/{DeviceRawOEMID}`.
 *
 * What is *inferred* - one step, and not hidden: that these two endpoints answer in
 * that same grammar. The inference is strong for a reason worth writing down. The
 * device's own file lists every `WPAppsMarketplace*` base but **not one store
 * setting** (`OEMStoreID`, `MOStoreID`, `MOUniqueID`, `CatalogLocale` are all
 * absent - checked against the image, not assumed), so the store family is
 * supplied from somewhere else, and the two places the client asks at start-up are
 * these. No capture of either endpoint exists (F-020, F-021), so the frame is
 * evidenced and the pairing of frame to endpoint is not.
 *
 * This replaces an invented `<StoreConfiguration>` document whose element names
 * were this lab's from first byte to last. `x-lab-invented: 1` still rides the
 * response, because the *values* (which store answered, where the page comes from,
 * the locale) are this lab's answers to a service that no longer exists - the
 * header now means that, and not "this markup is made up".
 *
 * Two omissions are deliberate. `WPAppsMarketplaceTunerService`
 * (`marketplaceconfigservice.windowsphone.com`) is left out: it is not hijacked,
 * so writing it would point the client's next configuration fetch at the real
 * server, and a wrong base is a failure this lab injects. And the build stamp is
 * the one the shipped file declares (`81000`), not a value derived from
 * `mpcVersion`, because a file version the client has never seen is a rejection
 * nobody would trace back to here.
 *
 * @param {object} options
 * @param {'OEMStore'|'MOStore'} [options.storeType] which of the two endpoints this answers.
 * @param {string} [options.storeId] the OEM/operator id the request path named, e.g. `NOKIA`.
 * @param {string} [options.cc] market.
 * @param {string} [options.lang] locale, written as `CatalogLocale` and as `{locale}`'s base.
 * @param {string} [options.scheme] the scheme the request arrived on.
 * @param {string} [options.host] the host the request arrived on.
 * @param {string} [options.mpcVersion] the `mpcVersion` the client asked with.
 * @param {Date} [options.now]
 * @returns {string} XML
 */
export function buildStoreConfiguration({
  storeType = 'MOStore', storeId = '', cc = 'IT', lang = 'it-IT',
  scheme = 'http', host = 'marketplaceedgeservice.windowsphone.com',
  mpcVersion = '8.10', now = new Date(),
} = {}) {
  const secure = scheme === 'http' ? 'https' : 'http';
  const lines = [];
  // A service base carries `nexus=` in the shipped file; a store setting does not.
  // Both spellings are copied from it rather than unified, because a normalised
  // document is a document this client has never parsed.
  const base = (id, written) => lines.push(`\n      <setting id="${id}" nexus="${id}">${text(written)}</setting>`);
  const value = (id, written) => lines.push(`\n      <setting id="${id}">${text(written)}</setting>`);

  // Where the page, the list, the images and the update check come from. The host
  // is the one the request arrived on, so the client keeps talking to this lab…
  base('WPAppsMarketplaceShop', `${scheme}://${host}/`);
  base('WPAppsMarketplaceShopSecure', `${secure}://${host}/`);
  base('WPAppsMarketplaceBuy', `${secure}://${host}/`);
  base('WPAppsMarketplaceAccounts', `${secure}://${host}/`);
  base('WPAppsMarketplaceReview', `${secure}://${host}/`);
  base('WPAppsMarketplaceTelemetry', `${secure}://${host}/`);
  // …and the two CDNs are named, not derived: a CDN base built as `cdn.<ip>` is a
  // hostname no resolver can answer, and these two are the names `config.json`
  // already hijacks (`*.marketplaceedgeservice.*`, `*.marketplaceimages.*`) and the
  // ones the shipped file itself supplies for this family.
  base('WPAppsMarketplaceShopCdn', `${scheme}://cdn.marketplaceedgeservice.windowsphone.com/`);
  base('WPAppsMarketplaceImageService', 'http://cdn.marketplaceimages.windowsphone.com/');

  // The store family: the settings the shipped file does *not* carry, which is why
  // this endpoint exists at all. An empty id is left out rather than written blank,
  // because a setting with no value is a store this client cannot name.
  if (storeId) value(storeType === 'OEMStore' ? 'OEMStoreID' : 'MOStoreID', storeId);
  // Nothing from the request's own query is echoed back as a setting. `cc`, `lang`
  // and `mpcVersion` are `EndpointParameter`s in the shipped file - values the
  // client supplies per call - so writing them here would be this lab answering a
  // question the client did not ask, in a document whose parser has never seen it.

  return '<?xml version="1.0" encoding="utf-8"?>'
    + '<ConfigurationFile version="81000" forceupdate="0">'
    + '<Domains>'
    + '<Domain id="PROD">'
    + lines.join('')
    + '</Domain>'
    + '</Domains>'
    + '</ConfigurationFile>';
}

/**
 * A flat application list, the shape `/v8/catalog/apps` and `/v9/catalog/apps`
 * answer with. That endpoint is what a browse or search screen reads.
 *
 * @param {number|string|null} [options.entryRank] the `<k>` the **first** entry
 *   carries; each next entry carries one more. `null` or `''` writes none, which
 *   is the feed this lab served before either archived response was read. The
 *   value the real service uses is 4 - see `applicationEntryXml` for why the 4
 *   is recorded as a number rather than as a meaning.
 * @param {boolean} [options.entryTitle] whether an entry also writes the bare
 *   `<title>` this lab wrote before. The archived feeds of both generations say
 *   no; the archived page says yes for its `<application>` blocks, so the two
 *   builders answer separately.
 *
 * The feed's own framing is already the archived one and is not affected by
 * either option: feed-level `rel="self"`, `a:updated`, `a:title`, `a:id`,
 * `impressionId`, then the entries, then `a:author`. The v8 capture additionally
 * carries `<a:link rel="next">` and `<pagingToken>` - and the v9 capture of the
 * same endpoint does not - so paging is a property of the older generation's
 * service and not of the entry shape, and nothing here writes it.
 */
export function buildApplicationListFeed({
  apps = [], selfHref = '/', id = 'apps', title = 'List Of Items', now = new Date(),
  entryRank = null, entryTitle = true,
}) {
  const stamp = feedStamp(now);
  const impression = impressionId(`${id}:${stamp}`);
  const seed = entryRank === null || entryRank === '' ? NaN : Number(entryRank);
  const rankFor = Number.isFinite(seed) ? (index) => seed + index : () => null;
  return feedHeader({
    selfHref, updated: stamp, title, id, impression, templateName: null,
  }) + apps.map((app, index) => applicationEntryXml(app, now, impression, {
    rank: rankFor(index), entryTitle,
  })).join('') + feedFooter();
}
