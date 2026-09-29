import { pathToFileURL } from 'node:url';
import Stablora from '@stablora/node';

/** Create on your backend using an order reference already saved in your database. */
export async function createUsdOrder(client, { reference, amount }, baseUrl = 'https://stablora.xyz/api/v1') {
  const payment = await client.payments.create({
    reference,
    amount, // Dollars as a string. The server locks the required DOGE amount.
    currency: 'USD',
    network: 'dogecoin',
    asset: 'DOGE',
    description: `Order ${reference}`,
  });

  const trustedOrigin = new URL(baseUrl).origin;
  const redirectUrl = new URL(payment.paymentUrl, `${trustedOrigin}/`);
  if (redirectUrl.origin !== trustedOrigin) throw new Error('Unexpected checkout origin');

  // In an HTTP handler, after persisting payment.id with your order:
  // res.writeHead(303, { Location: redirectUrl.href });
  // res.end();
  // Fulfill only after verifying a webhook AND checking authoritative payment status.
  return { paymentId: payment.id, redirectUrl: redirectUrl.href, depositAddress: payment.depositAddress };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [reference, amount] = process.argv.slice(2);
  if (!reference || !amount) throw new Error('Usage: node examples/create-usd-order.js <saved-order-id> <usd-amount>');
  const baseUrl = process.env.STABLORA_BASE_URL || 'https://stablora.xyz/api/v1';
  const client = new Stablora({ apiKey: process.env.STABLORA_API_KEY, baseUrl });
  console.log(await createUsdOrder(client, { reference, amount }, baseUrl));
}
