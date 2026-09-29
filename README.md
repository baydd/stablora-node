# @stablora/node

Official Node.js SDK for the [Stablora](https://stablora.xyz) crypto payments API.
Node.js **20+**, ESM, zero runtime dependencies; uses global `fetch` and `node:crypto`.
Includes JSDoc, TypeScript declarations, and runnable examples.

```sh
npm install @stablora/node
```

`qk_live_…` keys take real payments on mainnets; `qk_test_…` keys use testnets and the
sandbox. Create keys in the dashboard under **Developers → API keys**.

## Quick start

Import the package by name:

```js
import Stablora from '@stablora/node';

const stablora = new Stablora({
  apiKey: process.env.STABLORA_API_KEY, // qk_live_... or qk_test_... from Developers → API keys
  baseUrl: 'https://stablora.xyz/api/v1', // default (http:// only for localhost)
  timeoutMs: 30_000,                     // default; per attempt, including body reads
  maxRetries: 2,                        // default; additional attempts
});

const order = await stablora.payments.create({
  reference: 'your-saved-order-1001',
  amount: '200',
  currency: 'USD',
  network: 'dogecoin',
  asset: 'DOGE',
});

// Resolve the relative paymentUrl against your trusted platform origin.
const origin = 'https://stablora.xyz';
const checkout = new URL(order.paymentUrl, origin);
if (checkout.origin !== origin) throw new Error('Unexpected checkout origin');
console.log(checkout.href); // Redirect your customer here from your own backend.
```

Omit `currency` to denominate `amount` in the chosen crypto asset. In USD mode the
server locks the required coin amount at creation. Reusing the same order reference
returns the original order; later price changes do not reprice it. Every order gets
its own deposit address, separate from persistent customer wallets.

All monetary inputs must be **positive decimal strings**, such as `'1'` or
`'0.000001'`. Numbers, zero, negatives, exponent notation, leading zeros, and surrounding
whitespace are rejected before a request is sent. Do not convert a floating-point
calculation into a string after precision has already been lost. Use integer base
units (`BigInt`) for arithmetic in your application. API responses are passed
through without coercing money to numbers.

## Resources

`options` is an optional `{ idempotencyKey?: string }` object unless marked required.
Payout/refund keys belong in options, never in the JSON body.

| Method | Parameters / behavior |
| --- | --- |
| `customers.create(params, options?)` | `{ externalId, name? }` |
| `customers.list(params?, options?)` | Paginated customers |
| `wallets.assign(params, options?)` | `{ customerId, network }`; persistent address |
| `wallets.list(params?, options?)` | Paginated wallets |
| `payments.create(params, options?)` | `{ reference, amount, network, asset, currency?: 'USD', description?, customerId?, expirationMinutes? }` |
| `payments.retrieve(id, options?)` | Payment status/details |
| `payments.list(params?, options?)` | Page promise and async record iterator |
| `payments.refunds.create(paymentId, params, options)` | `{ amount, address, reason? }`; **required** `{ idempotencyKey }` |
| `payments.refunds.list(paymentId, options?)` | `{ refundable, refunded, data }` |
| `payouts.quote(params, options?)` | `{ network, asset, amount, address?, customerId? }`; preview fees/net |
| `payouts.create(params, options)` | `{ network, asset, amount, address, customerId? }`; **required** `{ idempotencyKey }` |
| `payouts.retrieve(id, options?)` | Status, fees, transaction hash |
| `payouts.approve(id, options?)` | Approve a pending approval request |
| `payouts.cancel(id, options?)` | Cancel a cancellable pending request |
| `payouts.list(params?, options?)` | Paginated payouts |
| `balances.list(options?)` | Merchant balances per network/asset |
| `balances.unallocated(options?)` | Business funds excluding customer allocations |
| `deposits.list(params?, options?)` | Paginated deposits |
| `swaps.list(params?, options?)` | Paginated conversions and fees |
| `events.list(params?, options?)` | Paginated delivery statuses |
| `events.replay(id, options?)` | Request webhook redelivery |
| `topupWallets.create(params, options?)` | `{ network }`; merchant funding wallet |
| `topupWallets.list(options?)` | Merchant funding wallets |
| `checkoutSessions.create(params, options?)` | `{ reference, amount (USD), description?, options?: [{ network, asset }], successUrl?, customerId?, expirationMinutes? }`; returns an absolute `url` where the customer picks the coin |
| `webhookEndpoints.create(params, options?)` | `{ url, events?: '*' \| string[], label? }`; extra signed webhook destination, returns its `secret` once |
| `webhookEndpoints.list(options?)` / `webhookEndpoints.delete(id, options?)` | List or remove extra destinations |
| `paymentLinks.create(params, options?)` | `{ title, amount? }` for a fixed USD price, or `{ title, minAmount?, maxAmount? }` to let the buyer choose; `description?`, `options?`, `successUrl?` |
| `paymentLinks.list(options?)` | Links with `sessions`, `paidCount`, `paidUsd` |
| `paymentLinks.activate(id, options?)` / `paymentLinks.deactivate(id, options?)` | Turn a reusable link on or off |
| `invoices.retrieve(month, options?)` | Fee invoice; `month` is `YYYY-MM` |
| `statement(from, to, options?)` | Statement; dates are `YYYY-MM-DD`, inclusive |

`stablora.refunds` is an alias of `stablora.payments.refunds`. Customer, wallet,
payment, payout, deposit, swap, and event lists all support `limit` (1–200), `cursor`,
and filters supported by the server, such as `customerId` and `status`.
Refund, balance, and top-up wallet lists retain their own server response envelopes.

The later Pagination section of [API-REFERENCE.md](API-REFERENCE.md) supersedes its
earlier capped-list description. This SDK expects `{ data, nextCursor }` for
paginated endpoints; it does not silently treat a legacy capped list as complete.
Schemas not fully specified by the reference retain `unknown` extension fields in
the declarations rather than inventing response properties.

## Pagination

```js
const page = await stablora.payments.list({ limit: 50, status: 'completed' });
console.log(page.data, page.nextCursor);

for await (const payment of stablora.payments.list({ limit: 100 })) {
  console.log(payment.id);
  // break stops iteration without fetching another page.
}
```

A list call starts the first request. Await it for one page or iterate the promise
directly for individual records. Later pages are fetched on demand with the original
filters. If you await and then iterate the same promise, its first page is reused.
Repeated cursors throw `StabloraError` instead of looping forever.

## Payouts, refunds, and retries

```js
const payout = await stablora.payouts.create({
  customerId: 'cus_123',
  network: 'tron',
  asset: 'USDT',
  amount: '25',
  address: 'qtest_tron_destination',
}, { idempotencyKey: 'your-saved-withdrawal-88213' });

const refund = await stablora.payments.refunds.create('pay_123', {
  amount: '5',
  address: 'qtest_tron_return_address',
  reason: 'Customer request',
}, { idempotencyKey: 'your-saved-refund-1001' });
```

Save a unique key and the exact parameters before submitting a withdrawal/refund.
Reuse both after a timeout or when retrying from a job. A new key can create a new
operation; the same key with different parameters yields a conflict. The SDK never
generates or changes a key for you.

Only GETs and POSTs carrying `Idempotency-Key` are eligible for automatic retries,
and only after a network/timeout failure, HTTP 429, or HTTP 500–599. Other statuses,
including 409, and malformed successful responses are not retried. Unkeyed POSTs,
including quotes, approvals, cancellations, and event replays, get one attempt.
Optional keys are forwarded; supplying one does not create server-side deduplication
where an endpoint does not implement it. Follow the server's idempotency contract.

Backoff uses full jitter from zero to `min(10000, 250 * 2^retryIndex)` milliseconds.
Each attempt has its own timeout; total operation time can be longer. Set
`maxRetries: 0` to disable retries. Redirects are refused; configure the canonical
API base URL. No request is sent by the constructor.

```js
import { StabloraError } from '@stablora/node';

try {
  await stablora.payouts.retrieve('out_123');
} catch (error) {
  if (error instanceof StabloraError) {
    console.error(error.status, error.code, error.message, error.requestId);
  } else {
    throw error;
  }
}
```

HTTP errors preserve `error.message`, `error.code`, status and any request ID.
Legacy errors without a code use `http_error`. Transport errors use `network_error`
or `request_timeout` and retain the original `cause`; status can be absent.
Invalid JSON/page responses use `invalid_response`; cursor loops use
`pagination_error`. Invalid local arguments throw `TypeError`.

## Webhook verification

```js
import { webhooks } from '@stablora/node';

const event = webhooks.verify(
  rawBody, // Untouched Buffer, Uint8Array, or UTF-8 string, before JSON middleware!
  request.headers['stablora-signature'],
  process.env.STABLORA_WEBHOOK_SECRET,
);
```

Also available as `stablora.webhooks.verify` and the named `verifyWebhook` export.
The verifier checks HMAC-SHA256 over the exact `<timestamp>.<rawBody>` bytes with
`crypto.timingSafeEqual`, enforces a 300-second age/future tolerance, then parses
the event object. Multiple `v1` signatures are supported. Invalid/missing headers,
tampering, stale timestamps, and invalid signed JSON throw `StabloraError`.
It does not validate your event-specific business schema or deduplicate deliveries.

An optional fourth argument is `{ toleranceSeconds: 300, now: 1800000000 }`.
`now` is **Unix seconds**, useful for deterministic tests; it defaults to
`Date.now() / 1000`. Zero tolerance means exact timestamp equality.

Persist a durable inbox record with a unique event ID before acknowledging success.
Process that inbox with atomic, idempotent business transactions. Duplicates and
out-of-order delivery are normal. Do not independently credit `deposit.confirmed`,
`payment.completed`, and `swap.completed` for the same money. Query authoritative
status/balances; a redirect or client-side paid flag is not proof of payment.

## Examples and local testing

PowerShell, from this SDK directory (replace placeholder credentials):

```powershell
$env:STABLORA_API_KEY = 'qk_test_your_key'
$env:STABLORA_WEBHOOK_SECRET = 'your-dashboard-signing-secret'
node examples/create-usd-order.js order-1001 200
node examples/casino-withdrawal.js withdrawal-88213 25 qtest_tron_player
node examples/webhook-server.js
```

- [USD order + redirect](examples/create-usd-order.js): stable order reference,
  locked USD pricing, and a checkout URL restricted to the trusted origin.
- [Casino withdrawal](examples/casino-withdrawal.js): saved withdrawal ID as the
  idempotency key, fee preview, and approval/status handling notes. Your backend
  must authenticate the player and reserve its ledger balance before submission.
- [HTTP webhook receiver](examples/webhook-server.js): an Express-style `(req, res)`
  handler implemented with `node:http`, raw-body verification, a 1 MiB body limit,
  and storage-before-acknowledgement. Running it writes a local event inbox under
  `data/webhook-inbox/`, relative to your working directory. It only records events;
  your application must implement a worker/ledger. Use a database unique event-ID
  constraint for a deployed or multi-process business workflow.

The receiver listens on `127.0.0.1:4001/webhooks`. Configure this URL in platform
Settings, allowlist `http://127.0.0.1:4001` in the platform's
`WEBHOOK_ALLOWED_ORIGINS`, and run its webhook worker. These are separate platform
configuration steps, not SDK initialization. `.env` files are not loaded by the SDK.

Sandbox `qtest_...` addresses and `sim_out_...` transaction hashes are simulations.
Use the platform's authenticated `/test/deposits` facility to simulate a sandbox
deposit. If the optional Sepolia adapter is configured on your platform, use only
no-value Sepolia ETH/USDC and real testnet addresses; `/test/deposits` is refused
for Sepolia. Wait for configured chain confirmations and verified API status.
This SDK implements no signer, chain adapter, or blockchain integration itself.

## Safety

- Test with a `qk_test_` key first; a `qk_live_` key moves real funds. Never supply
  private keys to this SDK: Stablora holds deposit addresses, and this client only
  calls the API.
- Mark an order paid only after a verified webhook **and** a server-side
  `payments.get(id)` showing `completed`; never from a browser redirect.
- Keep API keys and signing secrets on your backend. Use the appropriate `read`,
  `payments`, and `payouts` scopes; do not log credentials or commit `.env`/`data/`.
- Keep each merchant's credentials, records, and authorizations isolated. Keep
  assets and networks separate; matching symbols do not imply matching tokens.
- All balance changes belong in atomic, balanced, idempotent ledger transactions.
  In pooled mode your application remains responsible for player-level balances.
- Underpaid, late, expired, and other discrepant payments require explicit handling.
  A pending payout is not completed; a timeout does not prove that it failed.
- Query balances after swaps. Deposits describe the original asset, while the
  available balance may already have been converted. Do not infer lifetime totals
  from a single page.

## Development

```sh
node --test
npm install --ignore-scripts --cache .npm-cache
npm run typecheck
npm run build
```

Tests mock global `fetch`; they do not need a running platform or send any funds.
The package ships native JavaScript, so `build` performs syntax checks without
generating output. TypeScript is a development-only dependency; no runtime packages
are needed. `type-tests/api.ts` checks package exports, typed methods, and rejection
of numeric money or missing payout/refund keys at compile time.

On restricted Node 24 environments that forbid spawning test workers, run
`node --test --test-isolation=none`. The ordinary `node --test` command works with
Node 20+ where subprocesses are permitted.
