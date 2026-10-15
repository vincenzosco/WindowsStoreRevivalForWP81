// Client for the Live Store public API ("Zinc").
//
//   Base URL : https://zinc.onelive.me/v1
//   Auth     : X-OneLive-Key header, required on every endpoint
//
// Verified against the live service: without the header it answers
// 400 {"success":false,"message":"...missing the X-OneLive-Key..."} even on the
// RSS feeds that the documentation calls keyless.
//
// Responses are normalised: a successful call resolves with the `data` payload,
// anything else throws a ZincError carrying the HTTP status and the service's
// own error code, so a store handler can map it onto whatever the phone expects.

const DEFAULT_BASE_URL = 'https://zinc.onelive.me/v1';
const MIN_SEARCH_LENGTH = 5;

export class ZincError extends Error {
  constructor(message, { status = 0, code = null, retryAfter = null } = {}) {
    super(message);
    this.name = 'ZincError';
    this.status = status;
    this.code = code;
    this.retryAfter = retryAfter;
  }
}

export class ZincClient {
  /**
   * @param {object} opts
   * @param {string} [opts.baseUrl]
   * @param {string} [opts.apiKey]
   * @param {number} [opts.cacheTtlMs]
   * @param {number} [opts.timeoutMs]
   * @param {(msg: string, extra?: object) => void} [opts.log]
   * @param {typeof fetch} [opts.fetchImpl]
   */
  constructor({
    baseUrl = DEFAULT_BASE_URL,
    apiKey = '',
    cacheTtlMs = 300000,
    timeoutMs = 15000,
    log = () => {},
    fetchImpl = globalThis.fetch,
  } = {}) {
    this.baseUrl = String(baseUrl).replace(/\/+$/, '');
    this.apiKey = apiKey;
    this.cacheTtlMs = cacheTtlMs;
    this.timeoutMs = timeoutMs;
    this.log = log;
    this.fetchImpl = fetchImpl;
    this.cache = new Map();
    this.stats = { requests: 0, cacheHits: 0, errors: 0 };
  }

  get configured() {
    return Boolean(this.apiKey);
  }

  #cacheKey(pathname, params) {
    const sorted = new URLSearchParams(params || {});
    sorted.sort();
    return `${pathname}?${sorted.toString()}`;
  }

  /**
   * Raw call. Resolves with the `data` field of a successful envelope.
   * @returns {Promise<any>}
   */
  async request(pathname, params = {}, { method = 'GET', retries = 1 } = {}) {
    if (!this.configured) {
      throw new ZincError(
        'Zinc API key is not configured. Set livestore.apiKey in config.json '
        + '(create an app for the Live Store realm in the One Live Developer Centre).',
        { code: 'NO_API_KEY' },
      );
    }

    const url = new URL(`${this.baseUrl}${pathname}`);
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== null && value !== '') {
        url.searchParams.set(key, String(value));
      }
    }

    const cacheKey = this.#cacheKey(pathname, params);
    const cached = this.cache.get(cacheKey);
    if (method === 'GET' && cached && cached.expires > Date.now()) {
      this.stats.cacheHits += 1;
      return cached.value;
    }

    this.stats.requests += 1;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    let response;
    try {
      response = await this.fetchImpl(url, {
        method,
        headers: {
          'X-OneLive-Key': this.apiKey,
          accept: 'application/json',
          'user-agent': 'wp8-store-lab/0.1',
        },
        signal: controller.signal,
      });
    } catch (err) {
      clearTimeout(timer);
      this.stats.errors += 1;
      throw new ZincError(`Zinc request to ${pathname} failed: ${err.message}`, { code: 'NETWORK' });
    } finally {
      clearTimeout(timer);
    }

    const text = await response.text();
    let payload = null;
    try {
      payload = text ? JSON.parse(text) : null;
    } catch {
      payload = null;
    }

    if (response.status === 429) {
      this.stats.errors += 1;
      throw new ZincError('Zinc rate limit reached', {
        status: 429,
        code: payload?.code || 'TOO_MANY_REQUESTS',
        retryAfter: payload?.data?.retryAfter ?? null,
      });
    }

    if (!response.ok || payload?.success === false) {
      this.stats.errors += 1;
      const message = payload?.message || `Zinc returned HTTP ${response.status}`;
      // The service often reports the code inside the message ("... Error code: AC5")
      // rather than in a field, so it is extracted here.
      const fromMessage = /error code:\s*([A-Z]{2}\d+)/i.exec(message);
      const code = payload?.code || (fromMessage ? fromMessage[1].toUpperCase() : null);

      // A rejected key is worth retrying once: the service has been seen to answer
      // transiently even with a valid header during deploys.
      if (retries > 0 && response.status >= 500) {
        await new Promise((resolve) => setTimeout(resolve, 400));
        return this.request(pathname, params, { method, retries: retries - 1 });
      }

      throw new ZincError(message, { status: response.status, code });
    }

    // Envelopes vary: {status:'OK',data:...} or a bare payload.
    const value = payload && Object.prototype.hasOwnProperty.call(payload, 'data')
      ? payload.data
      : payload;

    if (method === 'GET' && this.cacheTtlMs > 0) {
      this.cache.set(cacheKey, { value, expires: Date.now() + this.cacheTtlMs });
      if (this.cache.size > 500) this.cache.clear();
    }
    return value;
  }

  /** @returns {Promise<{categories: string[]|any, apps: any[]}>} */
  async searchApps({ q, category }) {
    if (!q || String(q).trim().length < MIN_SEARCH_LENGTH) {
      throw new ZincError(`search query must be at least ${MIN_SEARCH_LENGTH} characters`, { code: 'BAD_QUERY' });
    }
    const data = await this.request('/apps/search', { q, category });
    return { categories: data?.categories ?? [], apps: data?.apps ?? [] };
  }

  async searchGames({ q, category }) {
    if (!q || String(q).trim().length < MIN_SEARCH_LENGTH) {
      throw new ZincError(`search query must be at least ${MIN_SEARCH_LENGTH} characters`, { code: 'BAD_QUERY' });
    }
    const data = await this.request('/games/search', { q, category });
    return { categories: data?.categories ?? [], apps: data?.apps ?? [] };
  }

  async appCategories() {
    const data = await this.request('/apps/categories');
    return data?.categories ?? data;
  }

  async gameCategories() {
    const data = await this.request('/games/categories');
    return data?.categories ?? data;
  }

  async app(id) {
    return this.request(`/app/${encodeURIComponent(id)}`);
  }

  async game(id) {
    return this.request(`/game/${encodeURIComponent(id)}`);
  }

  async updateCheck(id, currentVersion, kind = 'app') {
    return this.request(`/${kind}/${encodeURIComponent(id)}/updateCheck`, { currentVersion });
  }

  /** Live reachability probe used by the admin surface. */
  async ping() {
    try {
      const categories = await this.appCategories();
      return { ok: true, categories: Array.isArray(categories) ? categories.length : null };
    } catch (err) {
      return { ok: false, code: err.code || null, status: err.status || 0, error: err.message };
    }
  }
}
