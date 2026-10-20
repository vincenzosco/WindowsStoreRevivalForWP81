// The Live Store (Zinc) as the catalog behind the Store this phone talks to.
//
// WHY IT IS ASSEMBLED AND NOT LISTED. Zinc has no "everything" endpoint - `/apps`,
// `/apps/all` and `/apps/featured` answer 404 on the live service - and the two
// that exist state their own terms: `/apps/categories` names the categories, and
// `/apps/search` refuses with `400 {"error":"Query and category are required"}`
// unless it is given BOTH a query and a category. The query has a floor too:
// `q=app` and `q=the` answer that same 400 while `q=store` answers 200, which is
// the five-character minimum `src/zinc.mjs` already states. So a catalog is
// assembled by asking every category a small set of generic terms and unioning
// the replies, the way a browse page would; the union is what makes it a catalog
// rather than one search.
//
// Ties to the client, not to HTTP. `ZincClient` is created once in src/main.mjs and
// handed to every handler, so this module takes that client instead of building
// requests of its own: the key, the base URL, the caching and the retry rule stay
// in one place. The cost is that the 404 of the endpoints that do not exist is
// stated here rather than measured per call, which is why it is stated at all.
//
// Nothing here invents an app: every field is copied from the reply. The values
// Zinc's own apps carry are a price, a display price, a rating and its count, and
// where a reply omits one the archived feeds' value for a free, unrated app is
// used - said out loud here rather than buried in a builder.

/** Terms asked of every category, each at least the service's own minimum. */
export const ZINC_TERMS = ['store', 'windows', 'phone', 'live'];

/** The service's own floor, measured: three-character queries answer 400. */
export const ZINC_MIN_TERM_LENGTH = 5;

const str = (value, fallback = '') => (value === undefined || value === null ? fallback : String(value));

/**
 * One Zinc app, in the shape the catalog file carries and the builders consume.
 *
 * The id is the service's own (`"859"`), not a slug: it is the seed a GUID is
 * minted from, so it only has to be stable, and copying it keeps every handle the
 * phone sees traceable to one row of the live service.
 *
 * @param {object} raw
 * @param {string} [fallbackCategory] the category that was being asked
 * @returns {object|null} null when the entry has no id - the one field without
 *   which the device would be handed a handle it cannot resolve back.
 */
export function mapZincApp(raw, fallbackCategory = '') {
  if (!raw || str(raw.id).trim() === '') return null;
  const developer = str(raw.developer);
  return {
    id: str(raw.id).trim(),
    name: str(raw.name).trim() || `App ${str(raw.id).trim()}`,
    description: str(raw.description),
    developer,
    publisher: str(raw.publisher, developer),
    // The reply's own category wins; the one being asked is what an entry with no
    // category of its own belongs to in *this* catalog, so the page's sections
    // still partition the entries instead of dropping them into one bucket.
    category: (str(raw.category).trim() || str(fallbackCategory).trim()).toLowerCase(),
    version: str(raw.version),
    release_date: str(raw.release_date),
    icon: str(raw.icon),
    url: str(raw.url),
    protoUrl: str(raw.protoUrl),
    price: Number.isFinite(raw.price) ? raw.price : 0,
    displayPrice: str(raw.displayPrice, 'Gratis'),
    currencyCode: str(raw.currencyCode, 'EUR'),
    rating: Number.isFinite(raw.rating) ? raw.rating : 0,
    ratingCount: Number.isFinite(raw.ratingCount) ? raw.ratingCount : 0,
    hasLiveTile: raw.hasLiveTile === undefined ? true : Boolean(raw.hasLiveTile),
  };
}

/**
 * The whole catalog: every category, asked a handful of terms, unioned.
 *
 * A failed request is not swallowed. The caller needs to know that the catalog is
 * partial or missing, because serving half a store silently is worse than serving
 * the file the operator can see and saying so in the headers.
 *
 * @param {object} options
 * @param {{appCategories(): Promise<any>, searchApps(o: object): Promise<{apps: any[]}>}} options.client
 * @param {string[]} [options.terms]
 * @param {number} [options.perCategory] stop asking a category once it holds this many
 * @param {number} [options.maxCategories] 0 means every category the service names
 * @param {number} [options.concurrency] categories asked at once
 * @param {(msg: string) => void} [options.logger]
 * @returns {Promise<{categories: string[], apps: object[]}>}
 */
export async function zincCatalog({
  client,
  terms = ZINC_TERMS,
  perCategory = 25,
  maxCategories = 0,
  concurrency = 4,
  logger = () => {},
} = {}) {
  if (!client) throw new Error('zincCatalog needs a Zinc client');
  const asked = terms.map((term) => str(term).trim()).filter((term) => term.length >= ZINC_MIN_TERM_LENGTH);
  if (!asked.length) {
    throw new Error(`every term is shorter than the service's ${ZINC_MIN_TERM_LENGTH}-character minimum`);
  }

  const named = await client.appCategories();
  const all = Array.isArray(named) ? named : (Array.isArray(named?.categories) ? named.categories : []);
  const categories = all.map((name) => str(name).trim()).filter(Boolean);
  const wanted = maxCategories > 0 ? categories.slice(0, maxCategories) : categories;

  // One category at a time costs about as much as the phone's patience: sixteen
  // categories x up to four searches, each ~170 ms, is eleven seconds of a page
  // request the device is holding open. A few categories at once cuts it to
  // seconds without hammering the service, and the results are concatenated in
  // category order so the catalog - and therefore the page - stays deterministic.
  const perCategoryApps = new Array(wanted.length);
  let next = 0;
  const worker = async () => {
    for (let index = next++; index < wanted.length; index = next++) {
      const category = wanted[index];
      const held = [];
      const seen = new Set();
      for (const q of asked) {
        if (perCategory > 0 && held.length >= perCategory) break;
        const data = await client.searchApps({ q, category });
        const list = Array.isArray(data?.apps) ? data.apps : [];
        for (const raw of list) {
          const app = mapZincApp(raw, category);
          if (!app || seen.has(app.id)) continue;
          seen.add(app.id);
          held.push(app);
          if (perCategory > 0 && held.length >= perCategory) break;
        }
      }
      logger(`zinc: ${category}: ${held.length} app(s)`);
      perCategoryApps[index] = held;
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(concurrency, wanted.length)) }, worker));

  // An app is reached through every one of its category's terms, and a category
  // can name another's app, so the union is taken by id across all of them.
  const apps = [];
  const seen = new Set();
  for (const list of perCategoryApps) {
    for (const app of list || []) {
      if (seen.has(app.id)) continue;
      seen.add(app.id);
      apps.push(app);
    }
  }

  return { categories, apps };
}
