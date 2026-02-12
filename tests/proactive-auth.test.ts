import { afterEach, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createMockVercelResponse, toVercelResponse } from './helpers/vercel.js';
import { installFetchMock, jsonResponse } from './helpers/http.js';

async function loadProactiveHandler(): Promise<(req: VercelRequest, res: VercelResponse) => Promise<unknown>> {
  const module = await import(`../api/proactive.js?nonce=${Date.now()}-${Math.random()}`);
  return module.default as (req: VercelRequest, res: VercelResponse) => Promise<unknown>;
}

beforeEach(() => {
  process.env.TELEGRAM_BOT_TOKEN = 'test-token';
  process.env.SUPABASE_URL = 'https://example.supabase.co';
  process.env.SUPABASE_KEY = 'sb-secret';
  process.env.PROACTIVE_CRON_SECRET = 'cron-secret';
  process.env.NODE_ENV = 'production';
});

afterEach(() => {
  delete process.env.PROACTIVE_CRON_SECRET;
  delete process.env.NODE_ENV;
});

test('returns 401 for unauthorized proactive request', async () => {
  const proactiveHandler = await loadProactiveHandler();
  const fetchMock = installFetchMock(() => jsonResponse([], 200));
  const req = { method: 'GET', headers: {} } as unknown as VercelRequest;
  const res = createMockVercelResponse();

  await proactiveHandler(req, toVercelResponse(res));

  assert.equal(res.statusCode, 401);
  assert.deepEqual(res.body, { ok: false, error: 'unauthorized' });
  assert.equal(fetchMock.calls.length, 0);
  fetchMock.restore();
});

test('accepts proactive request with bearer secret', async () => {
  const proactiveHandler = await loadProactiveHandler();
  const fetchMock = installFetchMock((url, init) => {
    if (url.includes('/rest/v1/proactive_jobs') && init?.method === 'PATCH') {
      return jsonResponse([], 200);
    }
    return jsonResponse([], 200);
  });

  const req = {
    method: 'GET',
    headers: {
      authorization: 'Bearer cron-secret',
    },
  } as unknown as VercelRequest;
  const res = createMockVercelResponse();

  await proactiveHandler(req, toVercelResponse(res));

  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { ok: true, sent: 0 });
  assert.ok(fetchMock.calls.length > 0);
  fetchMock.restore();
});

test('returns 500 in production when secret is missing', async () => {
  delete process.env.PROACTIVE_CRON_SECRET;
  delete process.env.CRON_SECRET;
  const proactiveHandler = await loadProactiveHandler();

  const fetchMock = installFetchMock(() => jsonResponse([], 200));
  const req = { method: 'GET', headers: {} } as unknown as VercelRequest;
  const res = createMockVercelResponse();

  await proactiveHandler(req, toVercelResponse(res));

  assert.equal(res.statusCode, 500);
  assert.deepEqual(res.body, { ok: false, error: 'cron_secret_not_configured' });
  assert.equal(fetchMock.calls.length, 0);
  fetchMock.restore();
});
