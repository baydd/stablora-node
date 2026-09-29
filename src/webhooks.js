import { createHmac, timingSafeEqual } from 'node:crypto';
import { StabloraError } from './errors.js';

/**
 * Authenticate the exact request bytes before parsing JSON. This does not
 * deduplicate events or validate application-specific event data.
 * @template [T=import('../index.js').WebhookEvent]
 * @param {string | Uint8Array} rawBody Untouched UTF-8 body, Buffer, or Uint8Array.
 * @param {string} signatureHeader The Stablora-Signature header.
 * @param {string | Uint8Array} secret Webhook signing secret, not an API key.
 * @param {{ toleranceSeconds?: number, now?: number }} [options] now is Unix seconds.
 * @returns {T}
 */
export function verifyWebhook(rawBody, signatureHeader, secret, options = {}) {
  if (typeof rawBody !== 'string' && !(rawBody instanceof Uint8Array)) {
    throw new TypeError('rawBody must be a string or Uint8Array containing the original bytes');
  }
  if ((typeof secret !== 'string' && !(secret instanceof Uint8Array)) || secret.length === 0) {
    throw new TypeError('secret must be a non-empty string or Uint8Array');
  }
  const { toleranceSeconds = 300, now = Date.now() / 1000 } = options;
  if (!Number.isFinite(toleranceSeconds) || toleranceSeconds < 0 || !Number.isFinite(now)) {
    throw new TypeError('toleranceSeconds must be a finite non-negative number; now must be Unix seconds');
  }
  const malformed = () => new StabloraError('Malformed Stablora-Signature header', {
    code: 'webhook_invalid_header',
  });
  if (typeof signatureHeader !== 'string' || !signatureHeader.trim()) throw malformed();

  let timestampText;
  const signatures = [];
  for (const component of signatureHeader.split(',')) {
    const match = /^([a-zA-Z0-9_]+)=([^\s,]+)$/.exec(component.trim());
    if (!match) throw malformed();
    const [, name, value] = match;
    if (name === 't') {
      if (timestampText !== undefined || !/^\d+$/.test(value)) throw malformed();
      timestampText = value;
    } else if (name === 'v1') {
      if (!/^[a-fA-F0-9]{64}$/.test(value)) throw malformed();
      signatures.push(value);
    }
  }
  if (timestampText === undefined || signatures.length === 0) throw malformed();
  const timestamp = Number(timestampText);
  if (!Number.isSafeInteger(timestamp)) throw malformed();
  if (Math.abs(now - timestamp) > toleranceSeconds) {
    throw new StabloraError('Webhook timestamp is outside the allowed tolerance', {
      code: 'webhook_timestamp_outside_tolerance',
    });
  }

  const bytes = typeof rawBody === 'string' ? Buffer.from(rawBody, 'utf8') : rawBody;
  const expected = createHmac('sha256', secret).update(`${timestampText}.`).update(bytes).digest();
  let valid = false;
  for (const signature of signatures) {
    // Every candidate is checked; all buffers have the validated SHA-256 length.
    valid = timingSafeEqual(expected, Buffer.from(signature, 'hex')) || valid;
  }
  if (!valid) {
    throw new StabloraError('Webhook signature does not match', { code: 'webhook_invalid_signature' });
  }
  try {
    const event = JSON.parse(Buffer.from(bytes).toString('utf8'));
    if (event === null || typeof event !== 'object' || Array.isArray(event)) {
      throw new TypeError('Expected a JSON event object');
    }
    return event;
  } catch (cause) {
    throw new StabloraError('Webhook body is not a JSON event object', {
      code: 'webhook_invalid_payload', cause,
    });
  }
}

/** Standalone helpers; also available on every Stablora client. */
export const webhooks = Object.freeze({ verify: verifyWebhook });
