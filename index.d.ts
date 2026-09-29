/** Decimal text, never a JavaScript number. Input values must be positive. */
export type DecimalString = string;

export interface StabloraOptions {
  apiKey: string;
  /** Defaults to https://stablora.xyz/api/v1 (http:// only for localhost). */
  baseUrl?: string;
  /** Per-attempt timeout including response-body reads. Default: 30000. */
  timeoutMs?: number;
  /** Additional attempts after the first request. Default: 2. */
  maxRetries?: number;
}

export interface RequestOptions {
  /** Reuse this key for every retry of the same operation and payload. */
  idempotencyKey?: string;
}

export interface IdempotentRequestOptions extends RequestOptions {
  idempotencyKey: string;
}

export interface ListParams {
  /** Integer from 1 to 200. The server default is 50. */
  limit?: number;
  cursor?: string;
  customerId?: string;
  status?: string;
  /** Payments only: every invoice picked on one checkout session (cs_…). */
  checkoutSessionId?: string;
  [filter: string]: string | number | boolean | null | undefined;
}

export interface DataList<T> {
  data: T[];
  [field: string]: unknown;
}

export interface Page<T> extends DataList<T> {
  nextCursor: string | null;
}

/** Await for one page, or use for-await-of to lazily fetch all pages. */
export interface ListPromise<T> extends Promise<Page<T>>, AsyncIterable<T> {}

/** Unspecified API fields are preserved and deliberately typed as unknown. */
export interface ApiObject {
  [field: string]: unknown;
}

export interface Resource extends ApiObject {
  id: string;
}

export interface CustomerCreateParams {
  externalId: string;
  name?: string;
}

export interface Customer extends Resource {
  externalId?: string;
  name?: string;
}

export interface WalletAssignParams {
  customerId: string;
  network: string;
}

export interface Wallet extends Resource {
  address: string;
  network?: string;
  customerId?: string;
}

export interface PaymentCreateParams {
  reference: string;
  amount: DecimalString;
  network: string;
  asset: string;
  /** Omit for a crypto-denominated amount; USD locks the coin amount on the server. */
  currency?: 'USD';
  description?: string;
  customerId?: string;
  /** Integer from 5 to 1440; server default is 60. */
  expirationMinutes?: number;
}

export interface Payment extends Resource {
  paymentUrl: string;
  depositAddress: string;
  status: string;
  amount?: DecimalString;
  refunded?: DecimalString;
  reference?: string;
  network?: string;
  asset?: string;
}

export interface PayoutQuoteParams {
  network: string;
  asset: string;
  amount: DecimalString;
  address?: string;
  customerId?: string;
}

export interface PayoutCreateParams extends PayoutQuoteParams {
  address: string;
}

export interface PayoutQuote extends ApiObject {
  networkFee: DecimalString;
  withdrawalFee: DecimalString;
  net: DecimalString;
}

export interface Payout extends Resource {
  status: string;
  amount?: DecimalString;
  networkFee?: DecimalString;
  withdrawalFee?: DecimalString;
  net?: DecimalString;
  tx_hash?: string | null;
  kind?: string;
  payment_id?: string;
}

export interface RefundCreateParams {
  amount: DecimalString;
  address: string;
  reason?: string;
}

export interface RefundList extends DataList<Payout> {
  refundable: DecimalString;
  refunded: DecimalString;
}

export interface Balance extends ApiObject {
  network: string;
  asset: string;
  available?: DecimalString;
  reserved?: DecimalString;
}

/** The reference does not specify the complete balance response envelope. */
export interface BalanceList extends ApiObject {
  data?: Balance[];
  balances?: Balance[];
}

export interface Deposit extends Resource {
  amount?: DecimalString;
  network?: string;
  asset?: string;
}

export interface Swap extends Resource {
  sourceAmount?: DecimalString;
  gross?: DecimalString;
  providerFee?: DecimalString;
  platformFee?: DecimalString;
  net?: DecimalString;
  sourceNetwork?: string;
  sourceAsset?: string;
  targetNetwork?: string;
  targetAsset?: string;
  provider?: string;
  route?: unknown[];
  rate_label?: string;
}

export interface EventDelivery extends Resource {
  type?: string;
  status?: string;
}

export interface WebhookEvent<T = unknown> extends Resource {
  type: string;
  createdAt: string;
  mode: string;
  data: T;
}

export interface WebhookVerifyOptions {
  /** Default: 300. Zero means exact timestamp equality, not disabled checking. */
  toleranceSeconds?: number;
  /** Current Unix time in seconds, not milliseconds. Defaults to Date.now() / 1000. */
  now?: number;
}

export interface TopupWalletCreateParams {
  network: string;
}

export interface TopupWallet extends Wallet {}

/** These responses are passed through; their full schemas are not in the reference. */
export interface TopupWalletList extends ApiObject {
  data?: TopupWallet[];
}
export interface FeeInvoice extends ApiObject {}
export interface Statement extends ApiObject {}

export interface CustomersResource {
  create(params: CustomerCreateParams, options?: RequestOptions): Promise<Customer>;
  list(params?: ListParams, options?: RequestOptions): ListPromise<Customer>;
}

export interface WalletsResource {
  assign(params: WalletAssignParams, options?: RequestOptions): Promise<Wallet>;
  list(params?: ListParams, options?: RequestOptions): ListPromise<Wallet>;
}

export interface RefundsResource {
  create(paymentId: string, params: RefundCreateParams, options: IdempotentRequestOptions): Promise<Payout>;
  list(paymentId: string, options?: RequestOptions): Promise<RefundList>;
}

export interface PaymentsResource {
  create(params: PaymentCreateParams, options?: RequestOptions): Promise<Payment>;
  retrieve(id: string, options?: RequestOptions): Promise<Payment>;
  list(params?: ListParams, options?: RequestOptions): ListPromise<Payment>;
  readonly refunds: RefundsResource;
}

export interface PayoutsResource {
  quote(params: PayoutQuoteParams, options?: RequestOptions): Promise<PayoutQuote>;
  create(params: PayoutCreateParams, options: IdempotentRequestOptions): Promise<Payout>;
  retrieve(id: string, options?: RequestOptions): Promise<Payout>;
  approve(id: string, options?: RequestOptions): Promise<Payout>;
  cancel(id: string, options?: RequestOptions): Promise<Payout>;
  list(params?: ListParams, options?: RequestOptions): ListPromise<Payout>;
}

export interface BalancesResource {
  list(options?: RequestOptions): Promise<BalanceList>;
  unallocated(options?: RequestOptions): Promise<BalanceList>;
}

export interface DepositsResource {
  list(params?: ListParams, options?: RequestOptions): ListPromise<Deposit>;
}

export interface SwapsResource {
  list(params?: ListParams, options?: RequestOptions): ListPromise<Swap>;
}

export interface EventsResource {
  list(params?: ListParams, options?: RequestOptions): ListPromise<EventDelivery>;
  replay(id: string, options?: RequestOptions): Promise<ApiObject>;
}

export interface TopupWalletsResource {
  create(params: TopupWalletCreateParams, options?: RequestOptions): Promise<TopupWallet>;
  list(options?: RequestOptions): Promise<TopupWalletList>;
}

export interface CheckoutOption {
  network: string;
  asset: string;
}

export interface CheckoutSessionCreateParams {
  reference: string;
  /** USD amount. */
  amount: DecimalString;
  description?: string;
  /** Coins to offer; default is every enabled sandbox option. */
  options?: CheckoutOption[];
  successUrl?: string;
  customerId?: string;
  expirationMinutes?: number;
}

export interface CheckoutSession extends Resource {
  /** Absolute hosted checkout URL where the customer picks the coin. */
  url: string;
  usdAmount: DecimalString;
  description: string;
  options: (CheckoutOption & { networkName: string; testnet: boolean })[];
  expires_at: string;
  expired: boolean;
  payment: Payment | null;
}

export interface CheckoutSessionsResource {
  create(params: CheckoutSessionCreateParams, options?: RequestOptions): Promise<CheckoutSession>;
}

export interface WebhookEndpointCreateParams {
  /** https:// URL that receives signed events (Stablora-Signature, Stablora-Event-Id). */
  url: string;
  /** '*' (default) or event types such as 'payment.completed'. */
  events?: '*' | string[];
  label?: string;
}
export interface WebhookEndpoint {
  id: string;
  url: string;
  events: '*' | string[];
  label: string | null;
  connectionId: string | null;
  createdAt: string;
  active: boolean;
  /** Signing secret, returned only by create(). Verify deliveries with webhooks.verify(raw, header, secret). */
  secret?: string;
}
export interface WebhookEndpointsResource {
  create(params: WebhookEndpointCreateParams, options?: RequestOptions): Promise<WebhookEndpoint>;
  list(options?: RequestOptions): Promise<{ data: WebhookEndpoint[] }>;
  delete(id: string, options?: RequestOptions): Promise<{ id: string; deleted: true }>;
}

export interface PaymentLinkCreateParams {
  title: string;
  /** Fixed USD price. Omit to let the buyer choose between minAmount and maxAmount. */
  amount?: DecimalString;
  minAmount?: DecimalString;
  maxAmount?: DecimalString;
  description?: string;
  options?: CheckoutOption[];
  successUrl?: string;
}

export interface PaymentLink extends Resource {
  slug: string;
  /** Relative public URL, e.g. /l/xnt1_yKaKiAH. */
  url: string;
  title: string;
  active: boolean;
  amount: DecimalString | null;
  minAmount: DecimalString | null;
  maxAmount: DecimalString | null;
  sessions: number;
  paidCount: number;
  paidUsd: DecimalString;
}

export interface PaymentLinksResource {
  create(params: PaymentLinkCreateParams, options?: RequestOptions): Promise<PaymentLink>;
  list(options?: RequestOptions): Promise<{ data: PaymentLink[] }>;
  activate(id: string, options?: RequestOptions): Promise<PaymentLink>;
  deactivate(id: string, options?: RequestOptions): Promise<PaymentLink>;
}

export interface InvoicesResource {
  retrieve(month: string, options?: RequestOptions): Promise<FeeInvoice>;
}

export interface StabloraErrorDetails {
  status?: number;
  code?: string;
  requestId?: string;
  cause?: unknown;
}

export class StabloraError extends Error {
  constructor(message: string, details?: StabloraErrorDetails);
  readonly status: number | undefined;
  readonly code: string | undefined;
  readonly requestId: string | undefined;
}

/** Verifies signature and JSON object syntax; callers must validate business data. */
export function verifyWebhook<T = WebhookEvent>(
  rawBody: string | Uint8Array,
  signatureHeader: string,
  secret: string | Uint8Array,
  options?: WebhookVerifyOptions,
): T;

export const webhooks: Readonly<{ verify: typeof verifyWebhook }>;

export class Stablora {
  constructor(options: StabloraOptions);
  readonly customers: CustomersResource;
  readonly wallets: WalletsResource;
  readonly payments: PaymentsResource;
  /** Alias of payments.refunds. */
  readonly refunds: RefundsResource;
  readonly payouts: PayoutsResource;
  readonly balances: BalancesResource;
  readonly deposits: DepositsResource;
  readonly swaps: SwapsResource;
  readonly events: EventsResource;
  readonly topupWallets: TopupWalletsResource;
  readonly checkoutSessions: CheckoutSessionsResource;
  readonly paymentLinks: PaymentLinksResource;
  readonly webhookEndpoints: WebhookEndpointsResource;
  readonly invoices: InvoicesResource;
  readonly webhooks: typeof webhooks;
  statement(from: string, to: string, options?: RequestOptions): Promise<Statement>;
}

export default Stablora;
