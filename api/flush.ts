import type { VercelRequest, VercelResponse } from '@vercel/node';
import { flushHandler } from '../src/handlers/flush.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  return flushHandler(req, res);
}
