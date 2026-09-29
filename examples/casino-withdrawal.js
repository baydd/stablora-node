import { pathToFileURL } from 'node:url';
import Stablora from '@stablora/node';

/**
 * Call only after authenticating your player and atomically reserving their
 * balance in your own ledger. Save withdrawalId and these parameters durably.
 */
export async function requestWithdrawal(client, { withdrawalId, customerId, amount, address }) {
  const params = { network: 'tron', asset: 'USDT', amount, address, ...(customerId ? { customerId } : {}) };
  const quote = await client.payouts.quote(params);
  // For an interactive UI, quote and show net + fees before player confirmation.
  // This function submits a withdrawal your application has already authorized.
  const payout = await client.payouts.create(params, { idempotencyKey: withdrawalId });
  // Save payout.id against withdrawalId. If a request times out, retry the exact
  // same parameters and key: a timeout does not mean the payout was not created.
  return { quote, payout };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [withdrawalId, amount, address, customerId] = process.argv.slice(2);
  if (!withdrawalId || !amount || !address) {
    throw new Error('Usage: node examples/casino-withdrawal.js <saved-withdrawal-id> <amount> <qtest-destination> [customer-id]');
  }
  const client = new Stablora({
    apiKey: process.env.STABLORA_API_KEY,
    baseUrl: process.env.STABLORA_BASE_URL || 'https://stablora.xyz/api/v1',
  });
  const { quote, payout } = await requestWithdrawal(client, { withdrawalId, customerId, amount, address });
  console.log({ payoutId: payout.id, status: payout.status, net: quote.net, networkFee: quote.networkFee, withdrawalFee: quote.withdrawalFee });

  // After your backend's approval checks, if status is pending_approval:
  // await client.payouts.approve(payout.id);
  // To release a cancellable pending request: await client.payouts.cancel(payout.id);
  // pending_review needs platform review; broadcasting cannot be cancelled.
  // Reconcile verified payout.completed/cancelled/rejected/failed notifications
  // once per withdrawal in your ledger, checking client.payouts.retrieve(payout.id).
  // In pooled mode, Stablora does not enforce your player-level balance or winnings.
  // TRON here is simulated: qtest_ addresses and sim_out_ hashes never move funds.
}
