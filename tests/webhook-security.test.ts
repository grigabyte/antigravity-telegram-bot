import { afterEach, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createMockVercelResponse, toVercelResponse } from './helpers/vercel.js';
import { installFetchMock, jsonResponse } from './helpers/http.js';
import { createMessageUpdate } from './helpers/telegram.js';

let webhookHandler: (req: VercelRequest, res: VercelResponse) => Promise<unknown>;

beforeEach(async () => {
  process.env.TELEGRAM_BOT_TOKEN = 'test-token';
  process.env.SUPABASE_URL = 'https://example.supabase.co';
  process.env.SUPABASE_KEY = 'sb-secret';
  process.env.TELEGRAM_WEBHOOK_SECRET = 'hook-secret';
  process.env.ADMIN_USER_ID = '777';
  process.env.NODE_ENV = 'production';

  const module = await import('../src/handlers/webhook.js');
  webhookHandler = module.webhookHandler;
});

afterEach(() => {
  delete process.env.TELEGRAM_WEBHOOK_SECRET;
  delete process.env.ADMIN_USER_ID;
  delete process.env.NODE_ENV;
});

test('rejects webhook call without secret header', async () => {
  const fetchMock = installFetchMock(() => jsonResponse([], 200));
  const req = {
    method: 'POST',
    headers: {},
    body: createMessageUpdate(),
  } as unknown as VercelRequest;
  const res = createMockVercelResponse();

  await webhookHandler(req, toVercelResponse(res));

  assert.equal(res.statusCode, 401);
  assert.deepEqual(res.body, { ok: false, error: 'unauthorized' });
  assert.equal(fetchMock.calls.length, 0);
  fetchMock.restore();
});

test('accepts webhook call with valid secret header', async () => {
  const fetchMock = installFetchMock((url, init) => {
    if (url.includes('/rest/v1/processed_updates') && init?.method === 'POST') {
      return jsonResponse([{ id: 1 }], 201);
    }

    if (url.includes('/rest/v1/inbound_events') && init?.method === 'POST') {
      return jsonResponse([{ id: 10, event_ts: Date.now() }], 201);
    }

    if (url.includes('/rest/v1/inbound_events') && init?.method === 'GET') {
      return jsonResponse([], 200);
    }

    return jsonResponse([], 200);
  });

  const req = {
    method: 'POST',
    headers: {
      'x-telegram-bot-api-secret-token': 'hook-secret',
    },
    body: createMessageUpdate(),
  } as unknown as VercelRequest;
  const res = createMockVercelResponse();

  await webhookHandler(req, toVercelResponse(res));

  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { ok: true });
  assert.ok(fetchMock.calls.some((call) => call.url.includes('/rest/v1/processed_updates')));
  fetchMock.restore();
});

test('returns duplicate marker for duplicate update id', async () => {
  const fetchMock = installFetchMock((url, init) => {
    if (url.includes('/rest/v1/processed_updates') && init?.method === 'POST') {
      return jsonResponse({ code: '23505', message: 'duplicate key value violates unique constraint' }, 409);
    }

    return jsonResponse([], 200);
  });

  const req = {
    method: 'POST',
    headers: {
      'x-telegram-bot-api-secret-token': 'hook-secret',
    },
    body: createMessageUpdate(),
  } as unknown as VercelRequest;
  const res = createMockVercelResponse();

  await webhookHandler(req, toVercelResponse(res));

  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { ok: true, duplicate: true });
  fetchMock.restore();
});
