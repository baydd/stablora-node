import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { webhooks, verifyWebhook, StabloraError } from '@stablora/node';

const secret = 'whsec_local_test_only';
const now = 1_800_000_000;
const event = { id: 'evt_1', type: 'payment.completed', createdAt: '2026-09-24T00:00:00Z', mode: 'sandbox', data: { amount: '1.25' } };
const body = JSON.stringify(event);
function sign(rawBody = body, timestamp = now, signingSecret = secret) {
  return `t=${timestamp},v1=${createHmac('sha256', signingSecret).update(`${timestamp}.`).update(rawBody).digest('hex')}`;
}

test('verifies and parses a valid signature from a string, Buffer, or Uint8Array', () => {
  for (const rawBody of [body, Buffer.from(body), new Uint8Array(Buffer.from(body))]) {
    assert.deepEqual(webhooks.verify(rawBody, sign(), secret, { now }), event);
  }
  assert.equal(webhooks.verify, verifyWebhook);
});

test('uses current time and 300-second tolerance by default', (t) => {
  t.mock.method(Date, 'now', () => now * 1000);
  assert.deepEqual(webhooks.verify(body, sign(body, now - 300), secret), event);
  assert.throws(() => webhooks.verify(body, sign(body, now - 301), secret), { code: 'webhook_timestamp_outside_tolerance' });
});

test('signs exact UTF-8 bytes, whitespace, and newlines', () => {
  const raw = Buffer.from('{\n "id": "evt_é", "data": "你好 🚀"\n}\n');
  assert.deepEqual(webhooks.verify(raw, sign(raw), secret, { now }), JSON.parse(raw.toString()));
  assert.throws(() => webhooks.verify(JSON.stringify(JSON.parse(raw.toString())), sign(raw), secret, { now }), { code: 'webhook_invalid_signature' });
});

test('respects Uint8Array byte offsets', () => {
  const surrounded = Buffer.from(`prefix${body}suffix`);
  const raw = new Uint8Array(surrounded.buffer, surrounded.byteOffset + 6, Buffer.byteLength(body));
  assert.deepEqual(webhooks.verify(raw, sign(), secret, { now }), event);
});

test('rejects a tampered body, secret, signature, or timestamp', () => {
  for (const verify of [
    () => webhooks.verify(body.replace('1.25', '100'), sign(), secret, { now }),
    () => webhooks.verify(body, sign(), 'wrong_secret', { now }),
    () => webhooks.verify(body, `t=${now},v1=${'0'.repeat(64)}`, secret, { now }),
    () => webhooks.verify(body, sign().replace(`t=${now}`, `t=${now - 1}`), secret, { now }),
  ]) assert.throws(verify, { name: 'StabloraError', code: 'webhook_invalid_signature' });
});

test('rejects stale and excessively future-dated signatures', () => {
  for (const timestamp of [now - 301, now + 301]) {
    assert.throws(() => webhooks.verify(body, sign(body, timestamp), secret, { now }), { code: 'webhook_timestamp_outside_tolerance' });
  }
});

test('tolerance boundaries, custom tolerance and zero tolerance are enforced', () => {
  for (const delta of [-300, 300]) assert.deepEqual(webhooks.verify(body, sign(body, now + delta), secret, { now }), event);
  assert.deepEqual(webhooks.verify(body, sign(body, now - 600), secret, { now, toleranceSeconds: 600 }), event);
  assert.deepEqual(webhooks.verify(body, sign(), secret, { now, toleranceSeconds: 0 }), event);
  assert.throws(() => webhooks.verify(body, sign(body, now - 1), secret, { now, toleranceSeconds: 0 }), { code: 'webhook_timestamp_outside_tolerance' });
});

test('rejects malformed headers without calling timingSafeEqual with mismatched lengths', () => {
  const digest = 'a'.repeat(64);
  const invalid = [
    undefined, null, 123, '', ' ', 'garbage', `t=${now}`, `v1=${digest}`,
    `t=${now},v1=x`, `t=${now},v1=${'g'.repeat(64)}`, `t=${now},v1=${'a'.repeat(62)}`,
    `t=${now},v1=${'a'.repeat(66)}`, `t=NaN,v1=${digest}`, `t=1.5,v1=${digest}`,
    `t=-1,v1=${digest}`, `t=1e9,v1=${digest}`, `t=9007199254740992,v1=${digest}`,
    `t=${now},t=${now},v1=${digest}`, `t=${now},v1=${digest},`, `t=${now},v1=`,
    `t=${now},v1=${digest},broken`, `t=,v1=${digest}`, `t=${now},v2=${digest}`,
  ];
  for (const header of invalid) {
    assert.throws(() => webhooks.verify(body, header, secret, { now }), (error) => {
      assert.ok(error instanceof StabloraError);
      assert.equal(error.code, 'webhook_invalid_header');
      return true;
    });
  }
});

test('supports multiple v1 signatures and ignores unknown version schemes', () => {
  const valid = sign().split('v1=')[1];
  const header = `v0=old, v1=${'0'.repeat(64)}, t=${now}, v1=${valid.toUpperCase()}`;
  assert.deepEqual(webhooks.verify(body, header, secret, { now }), event);
});

test('rejects signed invalid JSON and non-object payloads', () => {
  for (const raw of ['not JSON', '{', 'null', '[]', '1', '"string"']) {
    assert.throws(() => webhooks.verify(raw, sign(raw), secret, { now }), { code: 'webhook_invalid_payload' });
  }
});

test('validates caller-provided webhook options and raw input', () => {
  for (const raw of [event, 123, null, undefined]) assert.throws(() => webhooks.verify(raw, sign(), secret, { now }), TypeError);
  for (const key of ['', 123, null, new Uint8Array()]) assert.throws(() => webhooks.verify(body, sign(), key, { now }), TypeError);
  for (const options of [{ now: NaN }, { now: '123' }, { now: Infinity }, { toleranceSeconds: -1 }, { toleranceSeconds: Infinity }]) {
    assert.throws(() => webhooks.verify(body, sign(), secret, options), TypeError);
  }
});

test('accepts a binary signing secret', () => {
  const binarySecret = new Uint8Array([1, 2, 3, 255]);
  assert.deepEqual(webhooks.verify(body, sign(body, now, binarySecret), binarySecret, { now }), event);
});
