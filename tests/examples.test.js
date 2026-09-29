import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { Readable } from 'node:stream';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { createWebhookHandler, createFileInbox } from '../examples/webhook-server.js';
import { createUsdOrder } from '../examples/create-usd-order.js';
import { requestWithdrawal } from '../examples/casino-withdrawal.js';

const secret = 'whsec_test_example';
function request(body, { url = '/webhooks', method = 'POST', signature } = {}) {
  const req = Readable.from([Buffer.from(body)]);
  const timestamp = Math.floor(Date.now() / 1000);
  req.url = url;
  req.method = method;
  req.headers = { 'stablora-signature': signature ?? `t=${timestamp},v1=${createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex')}` };
  return req;
}
function response() {
  return {
    status: undefined,
    body: undefined,
    writeHead(status) { this.status = status; },
    end(body) { this.body = body; },
  };
}

test('webhook example authenticates raw bytes and commits the inbox before acknowledging', async () => {
  const raw = '{\n "id": "evt_1", "type": "payment.completed", "data": {"amount":"1"}\n}';
  const res = response();
  const received = [];
  const handler = createWebhookHandler({ secret, enqueueEvent: async (event) => {
    assert.equal(res.status, undefined);
    received.push(event);
  } });
  await handler(request(raw), res);
  assert.equal(res.status, 200);
  assert.deepEqual(received, [JSON.parse(raw)]);
});

test('webhook example returns 500 when durable storage fails so delivery can retry', async () => {
  const res = response();
  const handler = createWebhookHandler({ secret, enqueueEvent: async () => { throw new Error('Database unavailable'); } });
  await handler(request('{"id":"evt_1","type":"payment.completed"}'), res);
  assert.equal(res.status, 500);
});

test('webhook example rejects tampering and invalid envelopes before storing', async () => {
  let stored = 0;
  const handler = createWebhookHandler({ secret, enqueueEvent: async () => { stored++; } });
  for (const req of [request('{}', { signature: 'malformed' }), request('{}')]) {
    const res = response();
    await handler(req, res);
    assert.equal(res.status, 400);
  }
  assert.equal(stored, 0);
});

test('webhook example limits request size and checks method/path', async () => {
  let stored = 0;
  const handler = createWebhookHandler({ secret, maxBodyBytes: 5, enqueueEvent: async () => { stored++; } });
  for (const [req, status] of [
    [request('123456'), 413],
    [request('{}', { method: 'GET' }), 405],
    [request('{}', { url: '/elsewhere' }), 404],
  ]) {
    const res = response();
    await handler(req, res);
    assert.equal(res.status, status);
  }
  assert.equal(stored, 0);
});

async function localInboxDirectory(t) {
  const testRoot = fileURLToPath(new URL('.', import.meta.url));
  const directory = await mkdtemp(join(testRoot, '.webhook-inbox-'));
  t.after(async () => {
    // Delete only this test's freshly created directory inside the SDK test root.
    const child = relative(testRoot, resolve(directory));
    assert.ok(child && !child.startsWith('..') && !isAbsolute(child));
    await rm(directory, { recursive: true, force: true });
  });
  return directory;
}

test('local inbox publishes one complete receipt for concurrent duplicate events', async (t) => {
  const directory = await localInboxDirectory(t);
  const enqueue = createFileInbox(directory);
  const event = { id: '../evt_1', type: 'payment.completed', data: { amount: '1' } };
  await Promise.all([enqueue(event), enqueue(event)]);
  const files = await readdir(directory);
  assert.equal(files.length, 1);
  assert.match(files[0], /^[a-f0-9]{64}\.json$/);
  assert.deepEqual(JSON.parse(await readFile(join(directory, files[0]), 'utf8')), event);
});

test('local inbox does not publish a receipt when serialization fails', async (t) => {
  const directory = await localInboxDirectory(t);
  const event = { id: 'evt_1' };
  event.circular = event;
  await assert.rejects(() => createFileInbox(directory)(event), TypeError);
  assert.deepEqual(await readdir(directory), []);
});

test('USD example constructs a checkout redirect against the platform origin', async () => {
  let sent;
  const client = { payments: { create: async (params) => {
    sent = params;
    return { id: 'pay_1', paymentUrl: '/checkout/pay_1', depositAddress: 'qtest_order' };
  } } };
  const result = await createUsdOrder(client, { reference: 'saved-1', amount: '200' }, 'http://localhost:3000/api/v1');
  assert.equal(sent.amount, '200');
  assert.equal(sent.currency, 'USD');
  assert.equal(sent.reference, 'saved-1');
  assert.equal(result.redirectUrl, 'http://localhost:3000/checkout/pay_1');
});

test('USD example refuses a checkout redirect to an unexpected origin', async () => {
  const client = { payments: { create: async () => ({ id: 'pay_1', paymentUrl: 'https://unexpected.example/checkout' }) } };
  await assert.rejects(() => createUsdOrder(client, { reference: 'saved-1', amount: '200' }), /Unexpected checkout origin/);
});

test('withdrawal example uses the saved withdrawal ID and preserves exact money strings', async () => {
  const requests = [];
  const client = { payouts: {
    quote: async (params) => { requests.push(params); return { net: '24.5' }; },
    create: async (params, options) => { requests.push({ params, options }); return { id: 'out_1', status: 'pending_approval' }; },
  } };
  const result = await requestWithdrawal(client, { withdrawalId: 'withdrawal-1', customerId: 'cus_1', amount: '25', address: 'qtest_player' });
  assert.equal(requests[1].options.idempotencyKey, 'withdrawal-1');
  assert.equal(requests[1].params.amount, '25');
  assert.equal(requests[1].params.customerId, 'cus_1');
  assert.deepEqual(requests[0], requests[1].params);
  assert.equal(result.payout.status, 'pending_approval');
});
