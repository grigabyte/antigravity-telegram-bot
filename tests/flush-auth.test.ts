import { afterEach, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createMockVercelResponse, toVercelResponse } from './helpers/vercel.js';
import { installFetchMock, jsonResponse } from './helpers/http.js';

async function loadFlushHandler(): Promise<(req: VercelRequest, res: VercelResponse) => Promise<unknown>> {
  const module = await import(`../api/flush.js?nonce=${Date.now()}-${Math.random()}`);
  return module.default as (req: VercelRequest, res: VercelResponse) => Promise<unknown>;
}

beforeEach(() => {
  process.env.TELEGRAM_BOT_TOKEN = 'test-token';
  process.env.SUPABASE_URL = 'https://example.supabase.co';
  process.env.SUPABASE_KEY = 'sb-secret';
  process.env.PROACTIVE_CRON_SECRET = 'cron-secret';
  process.env.NODE_ENV = 'production';
  process.env.ADMIN_USER_ID = '777';
  process.env.TELEGRAM_WEBHOOK_SECRET = 'hook-secret';
  process.env.FLUSH_TRIGGER_SECRET = 'cron-secret';
});

afterEach(() => {
  delete process.env.PROACTIVE_CRON_SECRET;
  delete process.env.NODE_ENV;
  delete process.env.ADMIN_USER_ID;
  delete process.env.TELEGRAM_WEBHOOK_SECRET;
  delete process.env.FLUSH_TRIGGER_SECRET;
});

test('returns 401 for unauthorized flush request', async () => {
  const flushHandler = await loadFlushHandler();
  const fetchMock = installFetchMock(() => jsonResponse([], 200));
  const req = { method: 'POST', headers: {}, body: {} } as unknown as VercelRequest;
  const res = createMockVercelResponse();

  await flushHandler(req, toVercelResponse(res));

  assert.equal(res.statusCode, 401);
  assert.deepEqual(res.body, { ok: false, error: 'unauthorized' });
  fetchMock.restore();
});

test('accepts authorized flush request and returns summary', async () => {
  const flushHandler = await loadFlushHandler();
  const fetchMock = installFetchMock((url, init) => {
    if (url.includes('/rest/v1/inbound_events') && init?.method === 'GET') {
      return jsonResponse([], 200);
    }
    return jsonResponse([], 200);
  });

  const req = {
    method: 'POST',
    headers: {
      authorization: 'Bearer cron-secret',
    },
    body: {},
  } as unknown as VercelRequest;
  const res = createMockVercelResponse();

  await flushHandler(req, toVercelResponse(res));

  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, {
    ok: true,
    processed: 0,
    skipped: 0,
    failed: 0,
    debounceMs: 3000,
  });
  fetchMock.restore();
});
