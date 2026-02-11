import type { VercelRequest, VercelResponse } from '@vercel/node';
import { runDueProactiveJobs } from '../src/proactive/scheduler.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const sent = await runDueProactiveJobs();
    return res.status(200).json({ ok: true, sent });
  } catch (error: any) {
    return res.status(500).json({ ok: false, error: error?.message || 'unknown_error' });
  }
}
