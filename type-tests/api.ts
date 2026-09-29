import Stablora, {
  Stablora as NamedStablora, StabloraError, webhooks, verifyWebhook,
  type Payment, type Page, type ListPromise, type Payout, type WebhookEvent,
} from '@stablora/node';

// Compile-only consumer contract; this file never sends network requests.
async function consumer() {
  const client: NamedStablora = new Stablora({ apiKey: 'qk_test_example', maxRetries: 0 });
  const customer = await client.customers.create({ externalId: 'player-42' });
  await client.wallets.assign({ customerId: customer.id, network: 'tron' });
  const payment: Payment = await client.payments.create({
    reference: 'order-1', amount: '200', currency: 'USD', network: 'dogecoin', asset: 'DOGE',
  });
  const request: ListPromise<Payment> = client.payments.list({ limit: 10 });
  const page: Page<Payment> = await request;
  const next: string | null = page.nextCursor;
  for await (const item of request) {
    const id: string = item.id;
    void id;
  }
  request.catch((error: unknown) => { throw error; }).finally(() => {});
  const payout: Payout = await client.payouts.create({
    amount: '25', network: 'tron', asset: 'USDT', address: 'qtest_destination',
  }, { idempotencyKey: 'withdrawal-1' });
  await client.payments.refunds.create(payment.id, { amount: '1', address: 'qtest_return' }, { idempotencyKey: 'refund-1' });
  await client.refunds.list(payment.id);
  await client.payouts.quote({ amount: '25', network: 'tron', asset: 'USDT' });
  await client.payouts.approve(payout.id);
  await client.payouts.cancel(payout.id);
  await client.payouts.retrieve(payout.id);
  await client.payments.retrieve(payment.id);
  await client.balances.list();
  await client.balances.unallocated();
  await client.topupWallets.create({ network: 'tron' });
  await client.topupWallets.list();
  await client.events.replay('evt_1');
  await client.invoices.retrieve('2026-09');
  await client.statement('2026-09-01', '2026-09-30');
  for await (const value of client.customers.list()) void value.id;
  for await (const value of client.wallets.list()) void value.address;
  for await (const value of client.deposits.list()) void value.amount;
  for await (const value of client.swaps.list()) void value.providerFee;
  for await (const value of client.events.list()) void value.status;
  for await (const value of client.payouts.list()) void value.status;
  const event: WebhookEvent = webhooks.verify(new Uint8Array(), 'header', 'secret');
  const typed = verifyWebhook<WebhookEvent<{ paymentId: string }>>('{}', 'header', 'secret', { now: 123 });
  const paymentId: string = typed.data.paymentId;
  client.webhooks.verify('{}', 'header', 'secret');
  const error = new StabloraError('failure', { status: 400, code: 'invalid', requestId: 'req_1', cause: new Error() });
  const status: number | undefined = error.status;
  void [next, event, paymentId, status];

  // @ts-expect-error Monetary amounts cannot be numbers.
  client.payments.create({ reference: 'x', amount: 0.1, network: 'tron', asset: 'USDT' });
  // @ts-expect-error Payouts require request options with an idempotency key.
  client.payouts.create({ amount: '1', network: 'tron', asset: 'USDT', address: 'qtest_x' });
  // @ts-expect-error An empty options object does not supply a payout idempotency key.
  client.payouts.create({ amount: '1', network: 'tron', asset: 'USDT', address: 'qtest_x' }, {});
  // @ts-expect-error Refunds require an idempotency key too.
  client.payments.refunds.create('pay_1', { amount: '1', address: 'qtest_x' });
  // @ts-expect-error Numeric refund amounts are forbidden.
  client.refunds.create('pay_1', { amount: 1, address: 'qtest_x' }, { idempotencyKey: 'refund-1' });
  // @ts-expect-error Numeric quote amounts are forbidden.
  client.payouts.quote({ amount: 1, network: 'tron', asset: 'USDT' });
  // @ts-expect-error Only USD is a documented fiat input currency.
  client.payments.create({ reference: 'x', amount: '1', currency: 'EUR', network: 'tron', asset: 'USDT' });
  // @ts-expect-error A parsed object is not a raw webhook body.
  webhooks.verify({ id: 'evt_1' }, 'header', 'secret');
}

void consumer;
