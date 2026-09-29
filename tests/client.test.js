import test from 'node:test';
import assert from 'node:assert/strict';
import Stablora, { Stablora as NamedStablora, StabloraError, webhooks } from '@stablora/node';

const payout = { network: 'tron', asset: 'USDT', amount: '25.000001', address: 'qtest_receiver' };
const payment = { reference: 'order-1', network: 'dogecoin', asset: 'DOGE', amount: '200', currency: 'USD' };
const json = (value, status = 200, headers = {}) => new Response(JSON.stringify(value), {
  status, headers: { 'Content-Type': 'application/json', ...headers },
});
const client = (options = {}) => new Stablora({ apiKey: 'qk_test_example', maxRetries: 0, ...options });

function mockFetch(t, handler = () => json({ id: 'resource_1' })) {
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    const call = { url: new URL(url), ...init };
    calls.push(call);
    return handler(call, calls.length);
  });
  return calls;
}

test('package exports a named/default client and standalone webhook helper', () => {
  assert.equal(Stablora, NamedStablora);
  assert.equal(client().webhooks, webhooks);
  assert.equal(client().payments.refunds.create instanceof Function, true);
  const sdk = client();
  assert.equal(sdk.payments.refunds, sdk.refunds);
});

test('API keys never travel over plain http except to a local server', () => {
  assert.throws(() => new Stablora({ apiKey: 'qk_test_example', baseUrl: 'http://api.example.com/api/v1' }), /https/);
  assert.doesNotThrow(() => new Stablora({ apiKey: 'qk_test_example', baseUrl: 'http://localhost:3000/api/v1' }));
  assert.doesNotThrow(() => new Stablora({ apiKey: 'qk_test_example', baseUrl: 'http://127.0.0.1:3000/api/v1' }));
});

test('builds a USD payment request with the default base URL and authorization', async (t) => {
  const calls = mockFetch(t);
  await client().payments.create(payment);
  assert.equal(calls[0].url.href, 'https://stablora.xyz/api/v1/payments');
  assert.equal(calls[0].method, 'POST');
  assert.equal(calls[0].headers.Authorization, 'Bearer qk_test_example');
  assert.equal(calls[0].headers['Content-Type'], 'application/json');
  assert.equal(calls[0].headers.Accept, 'application/json');
  assert.deepEqual(JSON.parse(calls[0].body), payment);
  assert.ok(calls[0].signal instanceof AbortSignal);
  assert.equal(calls[0].redirect, 'error');
});

test('preserves crypto decimal strings exactly, including values beyond Number precision', async (t) => {
  const calls = mockFetch(t);
  const amount = '123456789012345678901234567890.000000000000000001';
  await client().payments.create({ ...payment, amount, currency: undefined });
  assert.equal(JSON.parse(calls[0].body).amount, amount);
  assert.equal('currency' in JSON.parse(calls[0].body), false);
});

test('normalizes trailing base URL slashes and safely encodes path IDs', async (t) => {
  const calls = mockFetch(t);
  await client({ baseUrl: 'https://sandbox.example/custom/api/v1///' }).payments.retrieve('pay_1/a?x=#');
  assert.equal(calls[0].url.href, 'https://sandbox.example/custom/api/v1/payments/pay_1%2Fa%3Fx%3D%23');
  assert.equal(calls[0].method, 'GET');
  assert.equal(calls[0].body, undefined);
  assert.equal(calls[0].headers['Content-Type'], undefined);
});

test('encodes list filters and cursor without mutating the input', async (t) => {
  const calls = mockFetch(t, () => json({ data: [], nextCursor: null }));
  const params = { limit: 2, customerId: 'cus & 1', status: 'pending_approval', cursor: 'a+/=? &', ignored: undefined };
  await client().payouts.list(params);
  assert.deepEqual(Object.fromEntries(calls[0].url.searchParams), {
    limit: '2', customerId: 'cus & 1', status: 'pending_approval', cursor: 'a+/=? &',
  });
  assert.equal(params.cursor, 'a+/=? &');
});

const routes = [
  ['customers.create', 'POST', '/customers', (q) => q.customers.create({ externalId: 'player-42', name: 'Alex' }), { externalId: 'player-42', name: 'Alex' }],
  ['customers.list', 'GET', '/customers', (q) => q.customers.list()],
  ['wallets.assign', 'POST', '/wallets', (q) => q.wallets.assign({ customerId: 'cus_1', network: 'tron' }), { customerId: 'cus_1', network: 'tron' }],
  ['wallets.list', 'GET', '/wallets', (q) => q.wallets.list()],
  ['payments.retrieve', 'GET', '/payments/pay_1', (q) => q.payments.retrieve('pay_1')],
  ['payments.list', 'GET', '/payments', (q) => q.payments.list()],
  ['refunds.create', 'POST', '/payments/pay_1/refunds', (q) => q.payments.refunds.create('pay_1', { amount: '1.25', address: 'qtest_return', reason: 'requested' }, { idempotencyKey: 'refund-1' }), { amount: '1.25', address: 'qtest_return', reason: 'requested' }],
  ['refunds.list', 'GET', '/payments/pay_1/refunds', (q) => q.payments.refunds.list('pay_1')],
  ['payouts.quote', 'POST', '/payouts/quote', (q) => q.payouts.quote(payout), payout],
  ['payouts.create', 'POST', '/payouts', (q) => q.payouts.create(payout, { idempotencyKey: 'withdrawal-1' }), payout],
  ['payouts.retrieve', 'GET', '/payouts/out_1', (q) => q.payouts.retrieve('out_1')],
  ['payouts.approve', 'POST', '/payouts/out_1/approve', (q) => q.payouts.approve('out_1'), {}],
  ['payouts.cancel', 'POST', '/payouts/out_1/cancel', (q) => q.payouts.cancel('out_1'), {}],
  ['payouts.list', 'GET', '/payouts', (q) => q.payouts.list()],
  ['balances.list', 'GET', '/balances', (q) => q.balances.list()],
  ['balances.unallocated', 'GET', '/balances/unallocated', (q) => q.balances.unallocated()],
  ['deposits.list', 'GET', '/deposits', (q) => q.deposits.list()],
  ['swaps.list', 'GET', '/swaps', (q) => q.swaps.list()],
  ['events.list', 'GET', '/events', (q) => q.events.list()],
  ['events.replay', 'POST', '/events/evt_1/replay', (q) => q.events.replay('evt_1'), {}],
  ['topupWallets.create', 'POST', '/topup-wallets', (q) => q.topupWallets.create({ network: 'tron' }), { network: 'tron' }],
  ['topupWallets.list', 'GET', '/topup-wallets', (q) => q.topupWallets.list()],
  ['invoices.retrieve', 'GET', '/invoices/2026-09', (q) => q.invoices.retrieve('2026-09')],
  ['statement', 'GET', '/statement', (q) => q.statement('2026-09-01', '2026-09-30')],
];

for (const [name, method, path, invoke, body] of routes) {
  test(`routes ${name} to ${method} ${path}`, async (t) => {
    const response = { data: [], nextCursor: null, refundable: '1', refunded: '0' };
    const calls = mockFetch(t, () => json(response));
    assert.deepEqual(await invoke(client()), response);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].method, method);
    assert.equal(calls[0].url.pathname, `/api/v1${path}`);
    if (body !== undefined) assert.deepEqual(JSON.parse(calls[0].body), body);
    else assert.equal(calls[0].body, undefined);
    if (['refunds.create', 'payouts.create'].includes(name)) {
      assert.equal(calls[0].headers['Idempotency-Key'], name === 'refunds.create' ? 'refund-1' : 'withdrawal-1');
      assert.equal('idempotencyKey' in JSON.parse(calls[0].body), false);
    }
    if (name === 'statement') {
      assert.equal(calls[0].url.search, '?from=2026-09-01&to=2026-09-30');
    }
  });
}

test('rejects numeric, nonpositive, and nondecimal amounts on every monetary operation', async (t) => {
  const calls = mockFetch(t);
  const sdk = client();
  const invalid = [1, 0.1, NaN, Infinity, 1n, null, undefined, '', '0', '0.000', '-1', '+1', '.5', '1.', '1e3', ' 1', '1 ', '01', {}, new String('1')];
  for (const amount of invalid) {
    const methods = [
      () => sdk.payments.create({ ...payment, amount }),
      () => sdk.payouts.quote({ ...payout, amount }),
      () => sdk.payouts.create({ ...payout, amount }, { idempotencyKey: 'w1' }),
      () => sdk.refunds.create('pay_1', { amount, address: 'qtest_x' }, { idempotencyKey: 'r1' }),
    ];
    for (const invoke of methods) await assert.rejects(invoke, { name: 'TypeError', message: /decimal string/ });
  }
  assert.equal(calls.length, 0);
});

test('requires a valid idempotency key for payouts and refunds before any request', async (t) => {
  const calls = mockFetch(t);
  for (const options of [undefined, {}, { idempotencyKey: '' }, { idempotencyKey: 123 }, { idempotencyKey: 'with space' }, { idempotencyKey: 'a\r\nb' }]) {
    await assert.rejects(() => client().payouts.create(payout, options), TypeError);
    await assert.rejects(() => client().refunds.create('pay_1', { amount: '1', address: 'qtest_x' }, options), TypeError);
  }
  assert.equal(calls.length, 0);
});

test('rejects invalid client configuration', () => {
  assert.throws(() => new Stablora(), TypeError);
  for (const apiKey of ['', ' ', 1, 'qk_test_\nsecret']) assert.throws(() => new Stablora({ apiKey }), TypeError);
  for (const baseUrl of ['not a url', 'file:///tmp', 'https://user:password@example.com', 'https://example.com?x=1', 'https://example.com#x']) {
    assert.throws(() => client({ baseUrl }), TypeError);
  }
  for (const timeoutMs of [0, -1, NaN, Infinity, 0.5, 2 ** 31]) assert.throws(() => client({ timeoutMs }), TypeError);
  for (const maxRetries of [-1, 0.5, NaN, Infinity, '2']) assert.throws(() => client({ maxRetries }), TypeError);
});

test('rejects invalid identifiers, pagination, months and date ranges locally', async (t) => {
  const calls = mockFetch(t);
  const sdk = client();
  for (const id of ['', '.', '..', 1, undefined]) assert.throws(() => sdk.payments.retrieve(id), TypeError);
  for (const limit of [0, 201, 1.5, '10']) assert.throws(() => sdk.payments.list({ limit }), TypeError);
  for (const cursor of ['', 1]) assert.throws(() => sdk.payments.list({ cursor }), TypeError);
  for (const month of ['2026-9', '2026-13', '../balances', null]) assert.throws(() => sdk.invoices.retrieve(month), TypeError);
  assert.throws(() => sdk.statement('2026-02-30', '2026-03-01'), TypeError);
  assert.throws(() => sdk.statement('2026-09-30', '2026-09-01'), TypeError);
  assert.throws(() => sdk.statement('09/01/2026', '2026-09-30'), TypeError);
  await assert.rejects(() => sdk.customers.create(null), TypeError);
  await assert.rejects(() => sdk.payments.list({ bad: {} }), TypeError);
  assert.equal(calls.length, 0);
});

test('maps API errors, status, code, message, and request ID', async (t) => {
  mockFetch(t, () => json({ error: { message: 'Insufficient balance', code: 'insufficient_balance' } }, 409, { 'X-Request-Id': 'req_1' }));
  await assert.rejects(() => client().payouts.create(payout, { idempotencyKey: 'w1' }), (error) => {
    assert.ok(error instanceof StabloraError);
    assert.ok(error instanceof Error);
    assert.equal(error.name, 'StabloraError');
    assert.equal(error.message, 'Insufficient balance');
    assert.equal(error.status, 409);
    assert.equal(error.code, 'insufficient_balance');
    assert.equal(error.requestId, 'req_1');
    return true;
  });
});

test('accepts legacy errors without a code and JSON request IDs', async (t) => {
  mockFetch(t, () => json({ error: { message: 'Invalid input', requestId: 'req_body' } }, 400));
  await assert.rejects(() => client().payments.retrieve('pay_1'), {
    status: 400, code: 'http_error', message: 'Invalid input', requestId: 'req_body',
  });
});

test('maps non-JSON HTTP errors without exposing response contents', async (t) => {
  mockFetch(t, () => new Response('<html>upstream secret</html>', { status: 502, headers: { 'Stablora-Request-Id': 'req_proxy' } }));
  await assert.rejects(() => client().payments.retrieve('pay_1'), {
    status: 502, code: 'http_error', message: 'Stablora request failed (502)', requestId: 'req_proxy',
  });
});

test('rejects invalid successful JSON without retrying', async (t) => {
  const calls = mockFetch(t, () => new Response('not json', { headers: { 'X-Request-Id': 'req_bad' } }));
  await assert.rejects(() => client({ maxRetries: 3 }).payments.retrieve('pay_1'), { status: 200, code: 'invalid_response', requestId: 'req_bad' });
  assert.equal(calls.length, 1);
});

test('accepts 204 responses and rejects an empty 200 response', async (t) => {
  mockFetch(t, (_call, n) => new Response(null, { status: n === 1 ? 204 : 200 }));
  assert.equal(await client().events.replay('evt_1'), undefined);
  await assert.rejects(() => client().payments.retrieve('pay_1'), { code: 'invalid_response' });
});

for (const status of [429, 500, 502, 503, 599]) {
  test(`retries GET on ${status} and returns the successful attempt`, async (t) => {
    t.mock.method(Math, 'random', () => 0);
    const calls = mockFetch(t, (_call, n) => n === 1 ? json({ error: { message: 'Retry' } }, status) : json({ id: 'pay_1' }));
    assert.deepEqual(await client({ maxRetries: 1 }).payments.retrieve('pay_1'), { id: 'pay_1' });
    assert.equal(calls.length, 2);
    assert.notEqual(calls[0].signal, calls[1].signal);
  });
}

for (const status of [400, 401, 403, 404, 408, 409, 413, 422]) {
  test(`does not retry GET on ${status}`, async (t) => {
    const calls = mockFetch(t, () => json({ error: { message: 'Failure' } }, status));
    await assert.rejects(() => client({ maxRetries: 3 }).payments.retrieve('pay_1'), { status });
    assert.equal(calls.length, 1);
  });
}

test('retries a network failure for GET and preserves the original error as cause', async (t) => {
  t.mock.method(Math, 'random', () => 0);
  const failure = new TypeError('fetch failed');
  const calls = mockFetch(t, () => { throw failure; });
  await assert.rejects(() => client({ maxRetries: 2 }).payments.retrieve('pay_1'), (error) => {
    assert.equal(error.code, 'network_error');
    assert.equal(error.status, undefined);
    assert.equal(error.cause, failure);
    return true;
  });
  assert.equal(calls.length, 3);
});

test('retries keyed POSTs with identical payloads and keys for network, 429 and 5xx errors', async (t) => {
  t.mock.method(Math, 'random', () => 0);
  const input = { ...payout };
  const options = { idempotencyKey: 'stable-withdrawal-1' };
  const calls = mockFetch(t, (_call, n) => {
    input.amount = '999';
    options.idempotencyKey = 'changed';
    if (n === 1) throw new TypeError('Connection reset');
    return n < 4 ? json({ error: { message: 'Retry' } }, n === 2 ? 429 : 503) : json({ id: 'out_1' });
  });
  assert.deepEqual(await client({ maxRetries: 3 }).payouts.create(input, options), { id: 'out_1' });
  assert.equal(calls.length, 4);
  for (const call of calls) {
    assert.deepEqual(JSON.parse(call.body), payout);
    assert.equal(call.headers['Idempotency-Key'], 'stable-withdrawal-1');
  }
});

test('retries refunds with their required idempotency key', async (t) => {
  t.mock.method(Math, 'random', () => 0);
  const calls = mockFetch(t, (_call, n) => n === 1 ? json({ error: { message: 'Busy' } }, 500) : json({ id: 'refund_1' }));
  await client({ maxRetries: 1 }).refunds.create('pay_1', { amount: '1', address: 'qtest_return' }, { idempotencyKey: 'refund-1' });
  assert.equal(calls.length, 2);
  assert.equal(calls[1].headers['Idempotency-Key'], 'refund-1');
});

test('does not retry an unkeyed POST for network, 429, or 5xx failures', async (t) => {
  let failure = 'network';
  const calls = mockFetch(t, () => {
    if (failure === 'network') throw new TypeError('fetch failed');
    return json({ error: { message: 'Failure' } }, failure);
  });
  const sdk = client({ maxRetries: 3 });
  for (failure of ['network', 429, 500]) {
    for (const invoke of [
      () => sdk.payments.create(payment),
      () => sdk.payouts.quote(payout),
      () => sdk.wallets.assign({ customerId: 'cus_1', network: 'tron' }),
      () => sdk.payouts.approve('out_1'),
      () => sdk.payouts.cancel('out_1'),
      () => sdk.events.replay('evt_1'),
    ]) {
      const before = calls.length;
      await assert.rejects(invoke, StabloraError);
      assert.equal(calls.length, before + 1);
    }
  }
});

test('does not retry a keyed POST on conflict', async (t) => {
  const calls = mockFetch(t, () => json({ error: { message: 'Key reused with different parameters' } }, 409));
  await assert.rejects(() => client({ maxRetries: 3 }).payouts.create(payout, { idempotencyKey: 'w1' }), { status: 409 });
  assert.equal(calls.length, 1);
});

test('maxRetries=0 disables retries; exhausted HTTP retries expose the final error', async (t) => {
  t.mock.method(Math, 'random', () => 0);
  const calls = mockFetch(t, (_call, n) => json({ error: { message: `attempt-${n}`, code: 'busy' } }, 503));
  await assert.rejects(() => client().payments.retrieve('pay_1'), { message: 'attempt-1' });
  await assert.rejects(() => client({ maxRetries: 2 }).payments.retrieve('pay_1'), { message: 'attempt-4', status: 503, code: 'busy' });
  assert.equal(calls.length, 4);
});

test('defaults to two additional attempts for retryable requests', async (t) => {
  t.mock.method(Math, 'random', () => 0);
  const calls = mockFetch(t, () => json({ error: { message: 'Busy' } }, 503));
  await assert.rejects(() => new Stablora({ apiKey: 'qk_test_example' }).payments.retrieve('pay_1'), { status: 503 });
  assert.equal(calls.length, 3);
});

test('an optional idempotency key makes a payment POST eligible for retries', async (t) => {
  t.mock.method(Math, 'random', () => 0);
  const calls = mockFetch(t, (_call, n) => n === 1 ? json({ error: { message: 'Busy' } }, 503) : json({ id: 'pay_1' }));
  await client({ maxRetries: 1 }).payments.create(payment, { idempotencyKey: 'order-1' });
  assert.equal(calls.length, 2);
  assert.equal(calls[1].headers['Idempotency-Key'], 'order-1');
});

test('applies exponential backoff with full jitter and a 10-second cap', async (t) => {
  const realSetTimeout = globalThis.setTimeout;
  const delays = [];
  t.mock.method(Math, 'random', () => 0.5);
  t.mock.method(globalThis, 'setTimeout', (callback, ms, ...args) => {
    if (ms === 30_000) return realSetTimeout(callback, ms, ...args);
    delays.push(ms);
    return realSetTimeout(callback, 0, ...args);
  });
  mockFetch(t, () => json({ error: { message: 'Busy' } }, 503));
  await assert.rejects(() => client({ maxRetries: 8 }).payments.retrieve('pay_1'), { status: 503 });
  assert.deepEqual(delays, [125, 250, 500, 1000, 2000, 4000, 5000, 5000]);
});

test('aborts timed-out GET attempts and retries with a fresh signal', async (t) => {
  t.mock.method(Math, 'random', () => 0);
  const calls = mockFetch(t, ({ signal }) => new Promise((_resolve, reject) => {
    signal.addEventListener('abort', () => reject(signal.reason), { once: true });
  }));
  await assert.rejects(() => client({ timeoutMs: 5, maxRetries: 1 }).payments.retrieve('pay_1'), { code: 'request_timeout' });
  assert.equal(calls.length, 2);
  assert.ok(calls.every((call) => call.signal.aborted));
});

test('keeps the timeout active while consuming the response body', async (t) => {
  mockFetch(t, ({ signal }) => ({
    status: 200,
    headers: new Headers({ 'X-Request-Id': 'req_slow' }),
    text: () => new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(signal.reason), { once: true });
    }),
  }));
  await assert.rejects(() => client({ timeoutMs: 5 }).payments.retrieve('pay_1'), {
    code: 'request_timeout', status: 200, requestId: 'req_slow',
  });
});

test('an unkeyed POST timeout is not retried', async (t) => {
  const calls = mockFetch(t, ({ signal }) => new Promise((_resolve, reject) => {
    signal.addEventListener('abort', () => reject(signal.reason), { once: true });
  }));
  await assert.rejects(() => client({ timeoutMs: 5, maxRetries: 2 }).payments.create(payment), { code: 'request_timeout' });
  assert.equal(calls.length, 1);
});

test('awaiting a list fetches exactly one page; iterating reuses it and preserves filters', async (t) => {
  const pages = [
    { data: [{ id: 'pay_3' }, { id: 'pay_2' }], nextCursor: 'cursor/+=&' },
    { data: [{ id: 'pay_1' }], nextCursor: null },
  ];
  const calls = mockFetch(t, (_call, n) => json(pages[n - 1]));
  const params = { limit: 2, status: 'completed', customerId: 'cus_1' };
  const listing = client().payments.list(params);
  assert.ok(listing instanceof Promise);
  assert.deepEqual(await listing, pages[0]);
  assert.equal(calls.length, 1);
  params.status = 'modified';
  const result = [];
  for await (const row of listing) result.push(row.id);
  assert.deepEqual(result, ['pay_3', 'pay_2', 'pay_1']);
  assert.equal(calls.length, 2);
  assert.deepEqual(Object.fromEntries(calls[1].url.searchParams), {
    limit: '2', status: 'completed', customerId: 'cus_1', cursor: 'cursor/+=&',
  });
});

test('breaking iteration does not fetch another page', async (t) => {
  const calls = mockFetch(t, () => json({ data: [{ id: 'pay_1' }], nextCursor: 'next' }));
  for await (const row of client().payments.list()) {
    assert.equal(row.id, 'pay_1');
    break;
  }
  assert.equal(calls.length, 1);
});

test('iterates empty pages and stops on a null cursor', async (t) => {
  const calls = mockFetch(t, (_call, n) => json(n === 1
    ? { data: [], nextCursor: 'next' } : { data: [{ id: 'pay_1' }], nextCursor: null }));
  const rows = [];
  for await (const row of client().payments.list()) rows.push(row.id);
  assert.deepEqual(rows, ['pay_1']);
  assert.equal(calls.length, 2);
});

test('rejects repeated pagination cursors instead of looping indefinitely', async (t) => {
  const calls = mockFetch(t, () => json({ data: [], nextCursor: 'same' }));
  await assert.rejects(async () => {
    for await (const _row of client().payments.list()) { /* exhaust */ }
  }, { code: 'pagination_error' });
  assert.equal(calls.length, 2);
});

test('checks an initial cursor when detecting loops', async (t) => {
  const calls = mockFetch(t, () => json({ data: [], nextCursor: 'start' }));
  await assert.rejects(async () => {
    for await (const _row of client().payments.list({ cursor: 'start' })) { /* exhaust */ }
  }, { code: 'pagination_error' });
  assert.equal(calls.length, 1);
});

test('rejects malformed page envelopes', async (t) => {
  let body;
  mockFetch(t, () => json(body));
  for (body of [[], null, {}, { data: [] }, { data: {}, nextCursor: null }, { data: [], nextCursor: '' }, { data: [], nextCursor: 123 }]) {
    await assert.rejects(() => client().payments.list(), { code: 'invalid_response' });
  }
});

test('propagates errors from later pages', async (t) => {
  mockFetch(t, (_call, n) => n === 1 ? json({ data: [{ id: 'pay_1' }], nextCursor: 'next' }) : json({ error: { message: 'Denied' } }, 403));
  const rows = [];
  await assert.rejects(async () => {
    for await (const row of client().payments.list()) rows.push(row.id);
  }, { status: 403 });
  assert.deepEqual(rows, ['pay_1']);
});

test('checkout sessions and payment links map to their endpoints and validate amounts', async (t) => {
  const calls = mockFetch(t, () => json({ id: 'pl_1', url: '/l/abcdefghijkl' }, 201));
  const sdk = client();
  await sdk.checkoutSessions.create({ reference: 'cart-1', amount: '19.99', options: [{ network: 'tron', asset: 'USDT' }] });
  assert.equal(calls[0].url.pathname, '/api/v1/checkout-sessions');
  assert.deepEqual(JSON.parse(calls[0].body), { reference: 'cart-1', amount: '19.99', options: [{ network: 'tron', asset: 'USDT' }] });
  await sdk.paymentLinks.create({ title: 'Donate', minAmount: '2', maxAmount: '500' });
  assert.equal(calls[1].url.pathname, '/api/v1/payment-links');
  await sdk.paymentLinks.list();
  assert.equal(calls[2].method, 'GET');
  await sdk.paymentLinks.deactivate('pl_1');
  assert.equal(calls[3].url.pathname, '/api/v1/payment-links/pl_1/deactivate');
  await sdk.paymentLinks.activate('pl_1');
  assert.equal(calls[4].url.pathname, '/api/v1/payment-links/pl_1/activate');
  await assert.rejects(sdk.checkoutSessions.create({ reference: 'x', amount: 19.99 }), TypeError);
  await assert.rejects(sdk.paymentLinks.create({ title: 'x', maxAmount: 5 }), TypeError);
  assert.equal(calls.length, 5, 'invalid amounts never reach the network');
  await sdk.paymentLinks.deactivate('../admin');
  assert.equal(calls[5].url.pathname, '/api/v1/payment-links/..%2Fadmin/deactivate', 'ids are path-encoded, never traversed');
});

test('webhook endpoints map to their endpoints', async (t) => {
  const calls = mockFetch(t, () => json({ id: 'we_1', url: 'https://hooks.example.com/x', events: '*', secret: 'whsec_x' }, 201));
  const sdk = client();
  const created = await sdk.webhookEndpoints.create({ url: 'https://hooks.example.com/x', events: ['payment.completed'] });
  assert.equal(created.secret, 'whsec_x');
  assert.equal(calls[0].url.pathname, '/api/v1/webhook-endpoints'); assert.equal(calls[0].method, 'POST');
  await sdk.webhookEndpoints.list();
  assert.equal(calls[1].method, 'GET');
  await sdk.webhookEndpoints.delete('we_1');
  assert.equal(calls[2].method, 'DELETE'); assert.equal(calls[2].url.pathname, '/api/v1/webhook-endpoints/we_1');
  await assert.rejects(async () => sdk.webhookEndpoints.delete('..'), TypeError);
});
