import { StabloraError } from './errors.js';
import { webhooks } from './webhooks.js';

export { StabloraError } from './errors.js';
export { webhooks, verifyWebhook } from './webhooks.js';

/** @typedef {import('../index.js').StabloraOptions} StabloraOptions */
/** @typedef {import('../index.js').RequestOptions} RequestOptions */
/** @typedef {import('../index.js').ListParams} ListParams */
/** @template T @typedef {import('../index.js').Page<T>} Page */
/** @template T @typedef {import('../index.js').ListPromise<T>} ListPromise */

function object(value, name) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)
      || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) {
    throw new TypeError(`${name} must be a plain object`);
  }
  return value;
}

function nonempty(value, name) {
  if (typeof value !== 'string' || !value.trim()) throw new TypeError(`${name} must be a non-empty string`);
  return value;
}

/** Validate without converting money to floating point, even for very large amounts. */
function amount(value) {
  if (typeof value !== 'string' || !/^(0|[1-9]\d*)(\.\d+)?$/.test(value) || !/[1-9]/.test(value)) {
    throw new TypeError('amount must be a positive decimal string, for example "0.01"; numbers are not accepted');
  }
}

function segment(value, name = 'id') {
  nonempty(value, name);
  if (value === '.' || value === '..') throw new TypeError(`${name} must not be a dot path segment`);
  return encodeURIComponent(value);
}

function date(value, name) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new TypeError(`${name} must be a date in YYYY-MM-DD format`);
  }
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    throw new TypeError(`${name} must be a valid calendar date`);
  }
}

function requestId(response, data) {
  return response.headers.get('x-request-id') || response.headers.get('stablora-request-id')
    || response.headers.get('request-id')
    || (typeof data?.error?.requestId === 'string' ? data.error.requestId : undefined)
    || (typeof data?.requestId === 'string' ? data.requestId : undefined);
}

/**
 * Stablora's server-side API client. Uses Node's global fetch. qk_live_ keys act on
 * mainnets (real funds), qk_test_ keys on testnets.
 * All submitted monetary amounts must be positive decimal strings.
 */
export class Stablora {
  #apiKey;
  #baseUrl;
  #timeoutMs;
  #maxRetries;

  /** @param {StabloraOptions} options */
  constructor({ apiKey, baseUrl = 'https://stablora.xyz/api/v1', timeoutMs = 30_000, maxRetries = 2 } = {}) {
    nonempty(apiKey, 'apiKey');
    if (/\s/.test(apiKey)) throw new TypeError('apiKey must not contain whitespace');
    nonempty(baseUrl, 'baseUrl');
    const url = new URL(baseUrl);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
      throw new TypeError('baseUrl must be an HTTP(S) URL without credentials, query, or fragment');
    }
    // The API key travels in a header: plain http only for a local development server.
    if (url.protocol === 'http:' && !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) {
      throw new TypeError('baseUrl must use https:// (http:// only for localhost)');
    }
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 2_147_483_647) {
      throw new TypeError('timeoutMs must be an integer between 1 and 2147483647');
    }
    if (!Number.isSafeInteger(maxRetries) || maxRetries < 0) {
      throw new TypeError('maxRetries must be a non-negative safe integer');
    }
    this.#apiKey = apiKey;
    this.#baseUrl = url.href.replace(/\/+$/, '');
    this.#timeoutMs = timeoutMs;
    this.#maxRetries = maxRetries;

    /** @type {import('../index.js').CustomersResource} */
    this.customers = Object.freeze({
      create: (params, options) => this.#post('/customers', params, options),
      list: (params, options) => this.#list('/customers', params, options),
    });
    /** @type {import('../index.js').WalletsResource} */
    this.wallets = Object.freeze({
      assign: (params, options) => this.#post('/wallets', params, options),
      list: (params, options) => this.#list('/wallets', params, options),
    });
    /** @type {import('../index.js').RefundsResource} */
    this.refunds = Object.freeze({
      create: (paymentId, params, options) => this.#post(`/payments/${segment(paymentId)}/refunds`, params, options, true, true),
      list: (paymentId, options) => this.#request('GET', `/payments/${segment(paymentId)}/refunds`, { options }),
    });
    /** @type {import('../index.js').PaymentsResource} */
    this.payments = Object.freeze({
      create: (params, options) => this.#post('/payments', params, options, true),
      retrieve: (id, options) => this.#request('GET', `/payments/${segment(id)}`, { options }),
      list: (params, options) => this.#list('/payments', params, options),
      refunds: this.refunds,
    });
    /** @type {import('../index.js').PayoutsResource} */
    this.payouts = Object.freeze({
      quote: (params, options) => this.#post('/payouts/quote', params, options, true),
      create: (params, options) => this.#post('/payouts', params, options, true, true),
      retrieve: (id, options) => this.#request('GET', `/payouts/${segment(id)}`, { options }),
      approve: (id, options) => this.#post(`/payouts/${segment(id)}/approve`, {}, options),
      cancel: (id, options) => this.#post(`/payouts/${segment(id)}/cancel`, {}, options),
      list: (params, options) => this.#list('/payouts', params, options),
    });
    /** @type {import('../index.js').BalancesResource} */
    this.balances = Object.freeze({
      list: (options) => this.#request('GET', '/balances', { options }),
      unallocated: (options) => this.#request('GET', '/balances/unallocated', { options }),
    });
    /** @type {import('../index.js').DepositsResource} */
    this.deposits = Object.freeze({ list: (params, options) => this.#list('/deposits', params, options) });
    /** @type {import('../index.js').SwapsResource} */
    this.swaps = Object.freeze({ list: (params, options) => this.#list('/swaps', params, options) });
    /** @type {import('../index.js').EventsResource} */
    this.events = Object.freeze({
      list: (params, options) => this.#list('/events', params, options),
      replay: (id, options) => this.#post(`/events/${segment(id)}/replay`, {}, options),
    });
    /** @type {import('../index.js').TopupWalletsResource} */
    this.topupWallets = Object.freeze({
      create: (params, options) => this.#post('/topup-wallets', params, options),
      list: (options) => this.#request('GET', '/topup-wallets', { options }),
    });
    /** @type {import('../index.js').CheckoutSessionsResource} */
    this.checkoutSessions = Object.freeze({
      create: (params, options) => this.#post('/checkout-sessions', params, options, true),
    });
    /** @type {import('../index.js').WebhookEndpointsResource} */
    this.webhookEndpoints = Object.freeze({
      create: (params, options) => this.#post('/webhook-endpoints', params, options),
      list: (options) => this.#request('GET', '/webhook-endpoints', { options }),
      delete: (id, options) => this.#request('DELETE', `/webhook-endpoints/${segment(id)}`, { options }),
    });
    /** @type {import('../index.js').PaymentLinksResource} */
    this.paymentLinks = Object.freeze({
      create: async (params, options) => {
        object(params, 'params');
        for (const key of ['amount', 'minAmount', 'maxAmount']) if (params[key] !== undefined) amount(params[key]);
        return this.#post('/payment-links', params, options);
      },
      list: (options) => this.#request('GET', '/payment-links', { options }),
      activate: (id, options) => this.#post(`/payment-links/${segment(id)}/activate`, {}, options),
      deactivate: (id, options) => this.#post(`/payment-links/${segment(id)}/deactivate`, {}, options),
    });
    /** @type {import('../index.js').InvoicesResource} */
    this.invoices = Object.freeze({
      retrieve: (month, options) => {
        if (typeof month !== 'string' || !/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
          throw new TypeError('month must be in YYYY-MM format');
        }
        return this.#request('GET', `/invoices/${month}`, { options });
      },
    });
    this.webhooks = webhooks;
  }

  /**
   * Retrieve a merchant statement for an inclusive date range.
   * @param {string} from YYYY-MM-DD
   * @param {string} to YYYY-MM-DD
   * @param {RequestOptions} [options]
   * @returns {Promise<import('../index.js').Statement>}
   */
  statement(from, to, options) {
    date(from, 'from');
    date(to, 'to');
    if (from > to) throw new TypeError('from must not be after to');
    return this.#request('GET', '/statement', { query: { from, to }, options });
  }

  async #post(path, params, options, hasAmount = false, requiresKey = false) {
    object(params, 'params');
    if (hasAmount) amount(params.amount);
    if (requiresKey && !options?.idempotencyKey) {
      throw new TypeError('idempotencyKey is required in request options');
    }
    return this.#request('POST', path, { body: params, options });
  }

  /** A page promise that also iterates records, fetching subsequent pages on demand. */
  #list(path, params = {}, options = {}) {
    const query = { ...object(params, 'list params') };
    const requestOptions = { ...object(options, 'request options') };
    if (query.limit !== undefined && (!Number.isInteger(query.limit) || query.limit < 1 || query.limit > 200)) {
      throw new TypeError('limit must be an integer between 1 and 200');
    }
    if (query.cursor !== undefined) nonempty(query.cursor, 'cursor');
    const getPage = async (pageQuery) => {
      const page = await this.#request('GET', path, { query: pageQuery, options: requestOptions });
      if (!page || !Array.isArray(page.data)
          || (page.nextCursor !== null && (typeof page.nextCursor !== 'string' || !page.nextCursor))) {
        throw new StabloraError('Expected a paginated response with data and nextCursor', { code: 'invalid_response' });
      }
      return page;
    };
    const firstPage = getPage(query);
    firstPage[Symbol.asyncIterator] = async function* () {
      const seen = new Set(query.cursor === undefined ? [] : [query.cursor]);
      let page = await firstPage;
      while (true) {
        yield* page.data;
        if (page.nextCursor === null) return;
        if (seen.has(page.nextCursor)) {
          throw new StabloraError('API returned a repeated pagination cursor', { code: 'pagination_error' });
        }
        seen.add(page.nextCursor);
        page = await getPage({ ...query, cursor: page.nextCursor });
      }
    };
    return firstPage;
  }

  async #request(method, path, { body, query, options = {} } = {}) {
    object(options, 'request options');
    const headers = { Authorization: `Bearer ${this.#apiKey}`, Accept: 'application/json' };
    if (options.idempotencyKey !== undefined) {
      nonempty(options.idempotencyKey, 'idempotencyKey');
      if (!/^[\x21-\x7e]+$/.test(options.idempotencyKey)) {
        throw new TypeError('idempotencyKey must contain only visible ASCII characters without spaces');
      }
      headers['Idempotency-Key'] = options.idempotencyKey;
    }
    const url = new URL(`${this.#baseUrl}${path}`);
    for (const [key, value] of Object.entries(query ?? {})) {
      if (value === undefined || value === null) continue;
      if (!['string', 'number', 'boolean'].includes(typeof value) || (typeof value === 'number' && !Number.isFinite(value))) {
        throw new TypeError(`Query parameter ${key} must be a string, finite number, or boolean`);
      }
      url.searchParams.set(key, String(value));
    }
    // Serialize once: retries must send exactly the same body and idempotency key.
    const serializedBody = body === undefined ? undefined : JSON.stringify(body);
    if (serializedBody !== undefined) headers['Content-Type'] = 'application/json';
    const idempotent = method === 'GET' || (method === 'POST' && headers['Idempotency-Key'] !== undefined);

    for (let attempt = 0; ; attempt++) {
      let result;
      try {
        result = await this.#attempt(url, method, headers, serializedBody);
      } catch (error) {
        if (!(error instanceof StabloraError) || !['network_error', 'request_timeout'].includes(error.code)
            || !idempotent || attempt >= this.#maxRetries) throw error;
        await this.#backoff(attempt);
        continue;
      }
      const { response, text } = result;
      let data;
      let parseError;
      try {
        data = text === '' ? undefined : JSON.parse(text);
      } catch (error) {
        parseError = error;
      }
      if (!response.ok) {
        const error = new StabloraError(
          typeof data?.error?.message === 'string' ? data.error.message : `Stablora request failed (${response.status})`,
          {
            status: response.status,
            code: typeof data?.error?.code === 'string' ? data.error.code : 'http_error',
            requestId: requestId(response, data),
          },
        );
        if (idempotent && attempt < this.#maxRetries
            && (response.status === 429 || (response.status >= 500 && response.status <= 599))) {
          await this.#backoff(attempt);
          continue;
        }
        throw error;
      }
      if (parseError || (text === '' && response.status !== 204)) {
        throw new StabloraError('Stablora returned an invalid JSON response', {
          status: response.status, code: 'invalid_response', requestId: requestId(response, data), cause: parseError,
        });
      }
      return data;
    }
  }

  async #attempt(url, method, headers, body) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.#timeoutMs);
    let response;
    try {
      response = await globalThis.fetch(url.href, {
        method, headers: { ...headers }, signal: controller.signal, redirect: 'error',
        ...(body === undefined ? {} : { body }),
      });
      // Keep the timeout active through body consumption, not just response headers.
      return { response, text: await response.text() };
    } catch (cause) {
      throw new StabloraError(controller.signal.aborted ? 'Stablora request timed out' : 'Stablora network request failed', {
        code: controller.signal.aborted ? 'request_timeout' : 'network_error',
        status: response?.status, requestId: response ? requestId(response) : undefined, cause,
      });
    } finally {
      clearTimeout(timeout);
    }
  }

  async #backoff(attempt) {
    // Full jitter in [0, min(10 seconds, 250 ms * 2^attempt)).
    const delayMs = Math.floor(Math.random() * Math.min(10_000, 250 * 2 ** Math.min(attempt, 6)));
    if (delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
}

export default Stablora;
