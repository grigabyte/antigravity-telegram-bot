import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getProactiveCronSecret } from '../src/config.js';
import { runDueProactiveJobs } from '../src/proactive/scheduler.js';

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

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const expectedSecret = getProactiveCronSecret().trim();
  if (!expectedSecret && process.env.NODE_ENV === 'production') {
    return res.status(500).json({ ok: false, error: 'cron_secret_not_configured' });
  }

  if (expectedSecret) {
    const providedSecret = extractAuthToken(req);
    if (providedSecret !== expectedSecret) {
      return res.status(401).json({ ok: false, error: 'unauthorized' });
    }
  }

  try {
    const sent = await runDueProactiveJobs();
    return res.status(200).json({ ok: true, sent });
  } catch (error: any) {
    return res.status(500).json({ ok: false, error: error?.message || 'unknown_error' });
  }
}
