// Router for intercepted Store traffic.
//
// This is the extension point the whole lab exists to feed. The proxy consults it
// before applying config rules, so a handler can implement the real Store protocol
// in code while everything unmatched falls through to normal passthrough.
//
// A handler is:
//   {
//     name: 'catalog-bridge',
//     description: '...',
//     match: (ctx) => boolean,
//     handle: async (ctx, deps) => ({ status, headers, body }) | null
//   }
// Returning null (or throwing) means "not mine", and the next handler is tried.
// Throwing is contained: the router logs it and falls through, so a bug in a
// handler degrades to passthrough instead of breaking the device.

export class StoreRouter {
  constructor({ handlers = [], logger }) {
    this.handlers = handlers;
    this.log = logger;
    this.stats = { consulted: 0, handled: 0, failed: 0, byHandler: {} };
  }

  /**
   * @param {object} ctx intercepted request context from the proxy
   * @param {object} deps { config, logger, proxy, zinc }
   * @returns {Promise<{status:number, headers:object, body:Buffer, decision:string, error?:string}|null>}
   */
  async handle(ctx, deps) {
    this.stats.consulted += 1;

    for (const handler of this.handlers) {
      let matches = false;
      try {
        matches = Boolean(handler.match(ctx));
      } catch (err) {
        this.stats.failed += 1;
        this.log.warn(`handler ${handler.name} match() threw: ${err.message}`);
        continue;
      }
      if (!matches) continue;

      try {
        const result = await handler.handle(ctx, deps);
        if (!result) continue;
        this.stats.handled += 1;
        this.stats.byHandler[handler.name] = (this.stats.byHandler[handler.name] || 0) + 1;
        return {
          status: result.status ?? 200,
          headers: result.headers || {},
          body: Buffer.isBuffer(result.body) ? result.body : Buffer.from(result.body ?? ''),
          decision: result.decision || `store:${handler.name}`,
        };
      } catch (err) {
        this.stats.failed += 1;
        this.log.error(`handler ${handler.name} failed for ${ctx.method} ${ctx.host}${ctx.path}: ${err.message}`);
        // Fall through: passthrough or the next handler is a better answer than 500.
        continue;
      }
    }

    return null;
  }

  describe() {
    return this.handlers.map((handler) => ({
      name: handler.name,
      description: handler.description || '',
    }));
  }
}
