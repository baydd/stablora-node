import { createServer } from 'node:http';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, open, link, unlink } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { webhooks } from '@stablora/node';

/**
 * Express-style (req, res) handler using only node:http. Mount this before any
 * JSON middleware. enqueueEvent must commit a durable inbox record keyed by
 * event.id before resolving, treating existing IDs as successful duplicates.
 */
export function createWebhookHandler({ secret, enqueueEvent, maxBodyBytes = 1_048_576 }) {
  if (!secret || typeof enqueueEvent !== 'function') throw new TypeError('secret and enqueueEvent are required');
  return async (req, res) => {
    const reply = (status, message) => {
      res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end(message);
    };
    if (req.url !== '/webhooks') return reply(404, 'Not found');
    if (req.method !== 'POST') return reply(405, 'Use POST');
    let event;
    try {
      const chunks = [];
      let size = 0;
      for await (const chunk of req) {
        const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        size += bytes.length;
        if (size > maxBodyBytes) {
          reply(413, 'Body too large');
          return;
        }
        chunks.push(bytes);
      }
      event = webhooks.verify(Buffer.concat(chunks), req.headers['stablora-signature'], secret);
      if (typeof event.id !== 'string' || !event.id || typeof event.type !== 'string' || !event.type) {
        return reply(400, 'Invalid event envelope');
      }
    } catch {
      return reply(400, 'Invalid webhook');
    }

    try {
      // Store first; acknowledge second. A separate worker processes the inbox.
      await enqueueEvent(event);
      return reply(200, 'Received');
    } catch {
      // Let Stablora retry when the durable store is unavailable.
      return reply(500, 'Event storage unavailable');
    }
  };
}

/**
 * Local demonstration inbox. Flush a complete temporary file, then atomically
 * publish it by event ID without overwriting an existing receipt. This only
 * stores events; it does not implement fulfillment or a financial ledger.
 * A deployed application should use its database and a unique event-ID index.
 */
export function createFileInbox(directory) {
  return async (event) => {
    await mkdir(directory, { recursive: true });
    const filename = `${createHash('sha256').update(event.id).digest('hex')}.json`;
    const temporary = join(directory, `${randomUUID()}.tmp`);
    const destination = join(directory, filename);
    const file = await open(temporary, 'wx', 0o600);
    try {
      try {
        await file.writeFile(`${JSON.stringify(event)}\n`, 'utf8');
        await file.sync();
      } finally {
        await file.close();
      }
      try {
        await link(temporary, destination);
      } catch (error) {
        if (error.code !== 'EEXIST') throw error;
      }
    } finally {
      await unlink(temporary);
    }
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const secret = process.env.STABLORA_WEBHOOK_SECRET;
  if (!secret) throw new Error('Set STABLORA_WEBHOOK_SECRET to the dashboard webhook signing secret');
  const inbox = resolve('data/webhook-inbox');
  const handler = createWebhookHandler({ secret, enqueueEvent: createFileInbox(inbox) });
  createServer(handler).listen(4001, '127.0.0.1', () => {
    console.log(`Local webhook receiver: http://127.0.0.1:4001/webhooks; inbox: ${inbox}`);
  });
}
