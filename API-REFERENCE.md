# API v1

Base URL: `https://stablora.xyz/api/v1`. Authentication:
`Authorization: Bearer qk_live_...` (mainnets, real funds) or `qk_test_...` (testnets). Create keys in the dashboard's Developers page.
Amounts are positive decimal strings, not JSON numbers. Error body:
`{"error":{"message":"..."}}`. Common statuses: 400 invalid, 401 unauthenticated,
403 denied, 404 tenant-scoped missing resource, 409 conflict/insufficient balance,
413 body limit, 429 rate limited. Responses have `Cache-Control: no-store`.

## Endpoints

| Method | Path | Meaning |
| --- | --- | --- |
| GET | /networks | Sandbox network catalogue |
| POST / GET | /customers | Create/reuse by externalId, list owned customers |
| POST / GET | /wallets | Assign/reuse customer + network address, list |
| GET | /customers/:id/balances | That customer's asset/network balances |
| POST / GET | /payments | Create/reuse by reference, list invoices |
| GET | /payments/:id | Owned invoice details |
| GET | /balances | Aggregate merchant balances |
| GET | /balances/unallocated | Business funds excluding customer allocations |
| GET | /deposits | Confirmed sandbox deposits |
| POST | /payouts/quote | Fee preview: networkFee, withdrawalFee, net |
| POST / GET | /payouts | Request with Idempotency-Key; list (`?customerId=&status=`) |
| GET | /payouts/:id | Owned payout status, fees and tx_hash |
| POST | /payouts/:id/approve | Send a pending_approval payout |
| POST | /payouts/:id/cancel | Cancel a pending payout and release funds |
| POST / GET | /topup-wallets | Merchant funding address per network (idempotent), list |
| GET | /swaps | Completed conversion records and separate fee breakdown |
| GET | /events | Recent event delivery statuses |
| GET | /summary | Dashboard aggregate, scoped to the authenticated merchant |
| POST | /test/deposits | Sandbox only, authenticated deposit simulation |

Payment list/deposits/payouts/swaps/events are currently capped at the latest 100
records in their respective views; public pagination is a next milestone. Customer
and wallet lists are currently unpaginated. Do not infer lifetime revenue from a
capped list. The summary stablecoinGross is a complete deposit aggregate.

Dashboard-only: POST /keys, DELETE /keys/:id, POST /settings,
POST /webhook-secret, POST /events/dispatch. Admin browser-only:
GET /admin/overview, POST /admin/payouts/:id/complete or /reject,
POST /admin/merchants/:id/withdrawal-fee `{withdrawalFeeBps}` (0–1000).
Public checkout details: GET `/api/checkout/:paymentId`.

## End-to-end Node example

```js
const base = 'http://localhost:3000/api/v1';
const key = process.env.STABLORA_API_KEY;
async function call(path, body, headers = {}) {
  const response = await fetch(base + path, {
    method: body ? 'POST' : 'GET',
    headers: {Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', ...headers},
    ...(body ? {body: JSON.stringify(body)} : {})
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error.message);
  return data;
}
const customer = await call('/customers', {externalId: 'player-42', name: 'Alex'});
const wallet = await call('/wallets', {customerId: customer.id, network: 'tron'});
// wallet.address is permanent. It is a qtest_ identifier, NOT a real crypto address.
await call('/test/deposits', {
  walletId: wallet.id, asset: 'USDT', amount: '100',
  transactionHash: 'sim_player42_transfer001', eventIndex: 0
});
const balances = await call(`/customers/${customer.id}/balances`);
await call('/payouts', {
  customerId: customer.id, network: 'tron', asset: 'USDT',
  amount: '25', address: 'qtest_tron_receiver'
}, {'Idempotency-Key': 'player42-withdrawal001'});
```

Do not regenerate Idempotency-Key when retrying the same payout. Same key with
different parameters returns 409. Repeating wallet assignment returns the same row.
Different merchants can use the same externalId without sharing wallets or balances.

Invoice create body: `reference`, `amount`, `network`, `asset`, optional
`description`, `customerId`, `expirationMinutes` (5–1440, default 60).
Returned `paymentUrl` is relative; combine with the trusted platform origin.
Hosted invoices are fixed to the specified network/asset in this MVP.
Statuses: pending, completed, underpaid, overpaid, expired, late, reversed. Late/underpaid
funds remain recorded, but do not automatically treat discrepancy as fulfilled.

### Reversals (chain reorganizations)

On chains without instant finality (EVM testnets, Bitcoin) Stablora keeps re-checking
a credited transfer until its block is finalized (`finalized` block tag on EVM, 24
blocks on Bitcoin). If the block is replaced and the transfer is no longer on the
canonical chain, the credit is undone with mirror journal entries (including any
processing fee and automatic conversion), and:

- invoice payments: `received` decreases, status is recomputed (`reversed` when
  nothing remains) and `payment.reversed` is sent with the payment plus
  `reversedDeposit`;
- customer wallet and top-up deposits: `deposit.reversed` is sent.

If the same transfer is confirmed again on the new chain, the credit is reinstated and
`payment.completed` (or `payment.discrepancy`) / `deposit.confirmed` is sent again.
The balance may become negative when reversed funds were already paid out; this is
shown to the merchant and platform admin rather than hidden. Solana (finalized
commitment) and TRON (solidified blocks) only credit final transfers.

Handle `payment.reversed` by putting a fulfilled order back on hold for review; never
refund automatically. Sandbox networks can simulate it:
`POST /api/v1/test/deposits/{depositId}/reverse` (sandbox networks only).

## Automatic conversion

Configure in Settings before a deposit. Only subsequent deposits convert; same target asset/network bypasses exchange. Source and target prices come from CoinGecko. Prices older than 180 seconds are rejected. If auto-conversion cannot obtain a fresh price, the deposit stays in its original asset and emits swap.skipped. No real exchange trade takes place.

Deposit processing fee is 0.5%. Swap provider fee fixture is 0.20% and our markup
is 0.25%, both on gross target proceeds after processing. Fees round up in base
units; the conversion gross rounds down. The record exposes sourceAmount, gross,
providerFee, platformFee, net, source/target network and asset, and rate_label.

## Webhook consumption

Headers: `Stablora-Signature: t=<unixSeconds>,v1=<64 hex HMAC>` and
`Stablora-Event-Id: evt_...`. HMAC-SHA256 over `${timestamp}.${rawBody}`.
Use `verifyWebhook` from `app/lib/platform.mjs` or implement the same algorithm.
Timestamp tolerance: 300 seconds. Timing-safe comparison, exact bytes.

Envelope: `{id, type, createdAt, mode: "sandbox", data}`.
Record event ID durably before acknowledging success. Duplicate deliveries must
be safe. Fulfillment must not independently credit deposit.confirmed AND
payment.completed AND swap.completed for the same money.

For auto-conversion, deposit.confirmed describes the original received asset.
The available balance may already be converted. Use swap.completed as conversion
notification and query authoritative balances, or design explicit debit/credit
handling in your integration. No delivery ordering guarantee should be assumed.

Run `npm run worker` for automatic delivery/retries. Dashboard Deliver pending
processes currently due events. Failed terminal events have no reset UI yet.
Default receiver `local-test` verifies HMAC and stores a receipt in SQLite.

External receiver example: `app/examples/stablora-webhook.mjs`. Set a signing secret
in its environment. Add `http://127.0.0.1:4001` to WEBHOOK_ALLOWED_ORIGINS in the
platform `.env`, restart both app and worker, and save
`http://127.0.0.1:4001/webhooks` in Settings. Only operator-allowlisted origins work.

## USD order pricing and unique order addresses

POST `/payments` with `currency: "USD"`, `amount: "200"`, `network: "dogecoin"`,
`asset: "DOGE"`, and a unique `reference`. Amount means dollars in this mode.
The server fetches a fresh quote and calculates coin units, rounding up at the
asset's base precision. It stores the original USD total and locks the coin amount.
Example: if $200 buys 200 DOGE at creation, the order still requires 200 DOGE after
prices change. A new reference uses the new price; retrying the same reference
returns the original order even if the provider is down. Invoices never reprice.

Every order returns a distinct `depositAddress`, currently `qtest_...`. The address
is stable on retry but differs from other orders and from persistent customer wallets.
All these identifiers remain sandbox-only, not blockchain addresses.

POST `/quotes` with `{network, asset, usdAmount: "200"}` returns an indicative
60-second preview. Preview expiration does NOT alter an existing invoice.
GET `/api/prices` is public and returns CoinGecko source prices, updatedAt, stale
flags and source errors. Clients poll every 30 seconds. Existing locked invoices
can be displayed/paid in sandbox even when current price display is unavailable.

Market assets: BTC, ETH, USDT, USDC, SOL, BNB, POL, AVAX, TRX, DOGE, XMR, LTC, SHIB,
PEPE, BONK and WIF. Network catalogue has 13 entries. Tokens must match their
configured network; symbols do not establish token contract identity for live use.

## Player withdrawals (casinos, games, wallets)

Flow: your user asks to withdraw on your platform → your backend calls
POST `/payouts` with `Idempotency-Key` set to your own withdrawal ID → we reserve
the funds, then either send immediately or wait for your approval → you receive
`payout.completed` (or `payout.cancelled` / `payout.rejected`) by webhook.

Body: `network`, `asset`, `amount` (debited from your balance), `address` (your
user's destination), optional `customerId` (attribution/reporting). The recipient gets
`net = amount − networkFee − withdrawalFee`. The withdrawal commission is set per
merchant by the platform (default 0.5%, rounded up in base units). The network fee
is a labeled SANDBOX FIXTURE per network/asset until real adapters estimate gas.
Amounts that do not cover both fees are rejected (400).

Balance model (Settings → Withdrawals, or POST /settings `balanceModel`):
- `pooled`: customer deposits credit one merchant balance per network/asset; payouts
  draw from it. Use this when your platform keeps its own player balances (winnings
  can exceed what a player deposited). Insufficient pool → 409, top up first.
- `per_customer` (default for existing merchants): customer deposits stay allocated;
  payouts with customerId may only spend that customer's funds.
Switching the model does not move existing balances.

Merchant top-up: POST `/topup-wallets` `{network}` returns your permanent funding
address. Top-ups credit the merchant balance with no processing commission and emit
`topup.confirmed`. Sandbox: POST /test/deposits `{merchantWalletId, asset, amount,
transactionHash: "sim_..."}`.

Approval (Settings, `payoutApproval` + `payoutAutoLimitUsd`): `manual` holds every
request as `pending_approval`; `auto` sends requests whose fresh market USD value is
≤ the limit and holds larger ones. Without a fresh price a request is always held.
Statuses: pending_approval → completed | cancelled | rejected (admin). Legacy
`requested` rows can still be completed/rejected. Retrying the same key returns the
same payout; the same key with different details returns 409.

Sandbox payouts complete instantly with a `sim_out_...` hash and never move real
funds. Live sending requires a chain adapter plus an isolated signer (not built).

```js
const w = await call('/payouts', {
  customerId: player.id, network: 'tron', asset: 'USDT', amount: '250',
  address: 'qtest_tron_player_wallet'
}, {'Idempotency-Key': 'withdrawal-88213'});
// w.status: 'completed' (auto, within limit) or 'pending_approval'
if (w.status === 'pending_approval') await call(`/payouts/${w.id}/approve`, {});
```

## Merchant security

Dashboard (session-only) endpoints:
- GET `/security` — 2FA status, allowlists, current IP, active sessions, keys, last 50 security events.
- POST `/security/2fa/setup` → `{secret, otpauthUrl}`; POST `/security/2fa/enable` `{code}` →
  `{recoveryCodes}` (10 one-time codes, shown once); POST `/security/2fa/disable` `{password, code}`.
- POST `/security/ip-allowlist` `{api: [...], dashboard: [...], code}`. Entries are IPv4/IPv6
  addresses or CIDR ranges (min /8 IPv4, /16 IPv6); empty list = unrestricted. The dashboard
  list must contain the caller's current IP.
- POST `/security/sessions/revoke-others`.
- Admin: POST `/admin/merchants/:id/reset-2fa` (also unlocks and signs out the merchant).

Login: POST `/auth/login` `{email, password, code?}`. With 2FA enabled and no/invalid code the
response is 401 with `error.code = "two_factor_required"`. TOTP is RFC 6238 (SHA-1, 6 digits,
30 s, ±1 step); a step is never accepted twice. Recovery codes (`xxxxx-xxxxx`) work once.
Five failed attempts (password or code) lock the account for 15 minutes.
When 2FA is enabled, creating API keys and changing allowlists need a fresh `code`.

API key scopes (`scopes` on POST /keys): `read` (all GET + POST /payouts/quote),
`payments` (customers, wallets, payments, quotes, top-up wallets, test deposits),
`payouts` (create/approve/cancel payouts). Missing scope → 403. Keys created before
scopes existed keep all three. Keys record last_used_at / last_used_ip.

Client IP comes from X-Forwarded-For. Next only sets that header from the socket when the
client did not send it, so production MUST run behind a proxy that overwrites it and set
`TRUST_PROXY=1`. Without a proxy, IP allowlists are spoofable.

## Platform admin (admin session only)

GET `/admin/dashboard` (counts, 30-day volume, treasury), GET `/admin/merchants`,
POST `/admin/merchants/:id` `{status: active|suspended, feeBps, swapFeeBps, withdrawalFeeBps}`
(0–1000 bps; suspension deletes sessions and refuses API keys), GET `/admin/payouts?status=`,
POST `/admin/payouts/:id/complete|reject`, GET/POST `/admin/risk`
`{maxPayoutUsd, dailyPayoutUsd, blockedAddresses[], disabledNetworks[]}`, GET `/admin/swaps`
(route table, recent and skipped conversions), GET `/admin/activity` (security events,
failing webhooks, audit log), POST `/admin/merchants/:id/reset-2fa`.

Risk enforcement: blocked destination → 403 + security event; payout above
`maxPayoutUsd` (or unpriced while it is set) → status `pending_review`, merchant approve
returns 403, only admin completes/rejects; daily cap (UTC day, priced payouts, excluding
cancelled/rejected) → 409; disabled network → 409 for new invoices, wallets, top-up wallets
and payouts, while deposits still credit.

## Swap routing (account-free, simulated)

No exchange account is used. `lib/swaps.mjs` plans a route per deposit: PancakeSwap v3
(BNB, Base, Arbitrum), Uniswap v3 (Ethereum, Polygon, Optimism, Avalanche), Jupiter (Solana),
SunSwap (TRON), THORChain (BTC/DOGE/LTC → stablecoin on an EVM chain), plus a cross-chain
stablecoin transfer step when the output network differs from the settlement network.
XMR has no account-free route: deposits stay in XMR and emit `swap.skipped`.
Provider fee = venue fixture + 0.10% per bridge step (fixtures, not live quotes); the 0.25%
platform markup is separate. Swap records expose `provider` and `route` steps.

## Sepolia testnet (real, no-value coins)

Network id `sepolia` (assets ETH, USDC = Circle Sepolia USDC
0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238). It behaves like other networks in the API,
except: addresses are real 0x addresses derived from an xpub (index 0 = hot wallet,
1.. = invoices/customer wallets/top-up wallets, never reused); `/test/deposits` is refused
(409) — send coins on-chain; deposits credit after `SEPOLIA_CONFIRMATIONS` (default 12) with a
canonical block-hash re-check; a transfer of the wrong asset to an invoice is held as
`unmatched`; payouts to real 0x destinations go `pending_approval` → `broadcasting` (event
`payout.broadcasting`, cannot be cancelled) → `completed` (`payout.completed`, tx_hash) or
`failed` (`payout.failed`, funds released) after the signed transaction confirms. Network
fee is a flat testnet estimate (0.0005 ETH / 0.5 USDC). Testnet cannot be an auto-conversion
target and has no swap routes. Checkout shows a QR code and live confirmation progress.

Processes: `npm run signer` (127.0.0.1:4100, bearer token, signs chainId 11155111 only,
logs to data/signer/signing.log) and `npm run chain:watch` (scan → confirm → credit →
payouts → sweeps with USDC gas top-ups → on-chain snapshot for Treasury).
Admin: GET `/admin/testnet`.

## Accounting

Double-entry ledger (positive units = debit, negative = credit; each journal sums to zero
per network/asset). Accounts: `treasury` (asset), `available`/`reserved` (owed to merchants),
income `fees`, `swap_fees`, `withdrawal_fees`, `network_fee_income`, expense `gas_expense`,
`provider_cost` (payable to swap providers, borne by merchants).
- Merchant: GET `/statement?from=YYYY-MM-DD&to=YYYY-MM-DD` (opening/closing balances and
  every movement with running balance) and `/statement.csv` (Excel-safe CSV).
- Admin: GET `/admin/accounting?from&to` → `{pnl, trialBalance}`;
  GET `/admin/accounting/journal.csv?from&to` → full journal export.
Testnet payouts book only the net out of treasury and the recipient-paid network fee as
`network_fee_income`; the watcher books the real gas of every own transaction (payout, sweep,
gas top-up, including reverted ones) once as `gas_expense` (journal reference `gas:<txHash>`).
Sandbox payouts treat the network fee as simulated gas (leaves treasury with the payout).

## Account emails, password reset, notifications

Public: POST `/auth/password-reset/request` `{email}` (always `{ok:true}`, no enumeration),
POST `/auth/password-reset/confirm` `{token, password, code?}` (2FA code required when 2FA is on;
signs out every session), POST `/auth/verify-email` `{token}`. Links: `/verify-email?token=` (24h),
`/reset-password?token=` (30 min, single use). Only token hashes are stored.
Dashboard: POST `/account/password` `{currentPassword,newPassword,code?}`, POST
`/account/resend-verification`, POST `/account/notifications` `{notificationEmail?, notifyPayouts}`.
New accounts must verify email before creating API keys or requesting/approving payouts
(403 `error.code = "email_unverified"`). Existing accounts were marked verified on migration.
Emails: verification, password reset/changed, new sign-in IP, lockout, 2FA changes, new API key,
payout requested/completed/failed (switchable), suspension/reactivation; admins get payouts
needing platform review. Outbox with leases and retries (6 attempts, backoff up to 2h).
Webhook replay: POST `/events/:id/replay` (merchant) or `/admin/events/:id/replay`.
Admin: GET `/admin/system` (health checks), POST `/admin/backup`, GET `/admin/mail`,
GET `/admin/mail/:id`, POST `/admin/mail/dispatch`, POST `/admin/mail/test` `{to}`.

## Team members and roles

Owner (the merchant account) plus up to 50 members, each with own password, 2FA, sessions,
lockout and password reset. Roles (dashboard sessions; API keys keep using scopes):
admin = everything incl. team/settings/keys; finance = payments, payouts, refunds, statements;
developer = payments, API keys, webhooks; support = payments, customers, wallets; viewer =
read-only. Everyone can manage their own security (2FA, password, sessions). A forbidden action
returns 403 `error.code = "forbidden_role"`.
Endpoints (session): GET `/team`, POST `/team/invite` `{email,name?,role}` (verified owner email
required), POST `/team/:usr_id` `{role}` or `{status:"removed"}`, POST `/team/:usr_id/resend`,
POST `/team/:usr_id/reset-2fa` `{code?}`, POST `/team/require-2fa` `{required, code?}`.
Public: POST `/auth/accept-invite` `{token, name?, password}` (link `/accept-invite?token=`, 7 days).
Mandatory 2FA: merchant-wide (`require-2fa`) or platform-wide for administrators (admin risk
setting `requireAdmin2fa`). Without 2FA only auth/me, summary and Security setup work (403
`two_factor_setup_required`); required 2FA cannot be disabled.

## Refunds

POST `/payments/:id/refunds` `{amount, address, reason?}` with `Idempotency-Key` (API scope
`payouts`, role finance+). Capped at the payment's received amount minus active refunds; only the
network fee is deducted (no withdrawal commission); same approval/risk rules and lifecycle as
payouts (`kind: "refund"`, `payment_id`). GET `/payments/:id/refunds` → `{refundable, refunded, data}`.
Payments expose `refunded`.

## Pagination

GET `/payments`, `/deposits`, `/payouts`, `/swaps`, `/events` (`?status=&customerId=`), `/customers`,
`/wallets` accept `limit` (1–200, default 50) and `cursor`; responses are `{data, nextCursor}`
(newest first; `nextCursor` null on the last page). `/payments` also takes `?checkoutSessionId=cs_…`
(every invoice picked on that checkout — plugins use it to settle a missed webhook when the customer returns).

## Fee invoices

GET `/invoices/YYYY-MM` (admin: `/admin/merchants/:id/invoices/YYYY-MM`) → monthly statement of
platform fees from the ledger. Printable page `/invoice?month=YYYY-MM` (browser Save as PDF).
Issuer details from PLATFORM_LEGAL_NAME / PLATFORM_ADDRESS / PLATFORM_TAX_ID.
Draft legal pages: `/terms`, `/privacy` (templates; lawyer review required).

## Checkout sessions (customer chooses the coin)

POST `/checkout-sessions` `{reference, amount (USD), description?, options?: [{network, asset}], customerId?, successUrl?, expirationMinutes?}`
→ `{id, url}` (idempotent per reference). Default options: every enabled non-testnet pair; testnets
must be listed explicitly. Public (no auth): GET `/api/checkout-sessions/:id`, POST
`/api/checkout-sessions/:id/select` `{network, asset}` → creates/reuses a locked USD invoice for that
option (reference `<ref>#<network>:<asset>`; an expired one is replaced with a fresh quote); the page
`/checkout/:id` then redirects to `/pay/<invoice>`. After payment the invoice page offers the
session's successUrl. Switching coin before paying creates a separate invoice; once any payment is
received the session is closed.

## Checkout policy and branding (Settings → Checkout, POST /settings)

`underpaidTolerancePercent` (0–20): payments short by up to this share complete as `completed`.
`feePayer`: `merchant` (default) or `customer` — the invoice is grossed up
(`ceil(base × 10000 / (10000 − fee_bps))`) so the merchant nets the base amount; invoices expose
`baseAmount` and `feePayer`. Both are snapshotted on each invoice. Branding: `displayName`,
`brandColor` (#rrggbb), `supportEmail` appear on checkout pages.

## Automatic withdrawals (dashboard only, role owner/admin, 2FA step-up)

GET/POST `/auto-withdrawals` `{network, asset, address, threshold, keep?, code?}`, DELETE
`/auto-withdrawals/:id`. The worker checks every minute: when the merchant's unallocated available
balance ≥ threshold, it requests a pre-approved payout of (balance − keep) to the address
(platform caps/review/daily limit still apply; one automatic payout in flight per asset; idempotency
key chains to the previous automatic payout). Setting a rule emails the merchant.

## Webhook test

POST `/webhooks/test` (scope/role developers) queues and immediately delivers a signed
`test.ping` event; the response includes the delivery status.

Testing guide for merchants: `/docs/testing` (sandbox simulation, real testnets with faucets,
go-live checklist).
