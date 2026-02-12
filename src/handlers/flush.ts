import type { VercelRequest, VercelResponse } from '@vercel/node';
import { ADMIN_USER_ID, BATCHING, getFlushTriggerSecret, NODE_ENV } from '../config.js';
import { processInboundQueueForChat } from './webhook.js';
import { getPendingInboundChatPairs } from '../db/supabase.js';

function extractAuthToken(req: VercelRequest): string {
  const authHeader = req.headers.authorization;
  if (typeof authHeader === 'string' && authHeader.toLowerCase().startsWith('bearer ')) {
    return authHeader.slice(7).trim();
  }

  const cronHeader = req.headers['x-cron-secret'];
  if (typeof cronHeader === 'string') {
    return cronHeader.trim();
  }

  return '';
}

function isFlushAuthorized(req: VercelRequest): boolean {
  const expected = getFlushTriggerSecret();
  if (!expected) {
    return NODE_ENV !== 'production';
  }
  return extractAuthToken(req) === expected;
}

export async function flushHandler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'method_not_allowed' });
  }

  if (!isFlushAuthorized(req)) {
    return res.status(401).json({ ok: false, error: 'unauthorized' });
  }

  const body = (req.body || {}) as {
    userId?: number;
    chatId?: number;
    limit?: number;
  };

  const pairs: Array<{ userId: number; chatId: number }> = [];
  const userId = Number(body.userId);
  const chatId = Number(body.chatId);
  const limit = Number.isFinite(Number(body.limit)) ? Math.max(1, Math.min(50, Number(body.limit))) : 20;

  if (Number.isFinite(userId) && Number.isFinite(chatId) && userId > 0 && chatId > 0) {
    pairs.push({ userId, chatId });
  } else {
    const discovered = await getPendingInboundChatPairs(limit);
    if (ADMIN_USER_ID !== null) {
      for (const pair of discovered) {
        if (pair.userId === ADMIN_USER_ID) {
          pairs.push(pair);
        }
      }
    } else {
      pairs.push(...discovered);
    }
  }

  let processed = 0;
  let skipped = 0;
  let failed = 0;

  for (const pair of pairs) {
    try {
      await processInboundQueueForChat(pair.userId, pair.chatId);
      processed += 1;
    } catch {
      failed += 1;
      skipped += 1;
    }
  }

  return res.status(200).json({
    ok: true,
    processed,
    skipped,
    failed,
    debounceMs: BATCHING.debounceMs,
  });
}
