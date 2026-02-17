import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import type { VercelRequest } from '@vercel/node';
import { webhookHandler } from '../src/handlers/webhook.js';
import { createMockVercelResponse, toVercelResponse } from './helpers/vercel.js';
import { installFetchMock, jsonResponse } from './helpers/http.js';
import { createMessageUpdate } from './helpers/telegram.js';

beforeEach(() => {
  process.env.TELEGRAM_BOT_TOKEN = 'test-token';
  process.env.SUPABASE_URL = 'https://example.supabase.co';
  process.env.SUPABASE_KEY = 'sb-secret';
  process.env.TELEGRAM_WEBHOOK_SECRET = 'hook-secret';
  process.env.ADMIN_USER_ID = '777';
  process.env.NODE_ENV = 'production';
});

test('export requests full history without default 500 limit', async () => {
  const fetchMock = installFetchMock((url, init) => {
    if (url.includes('/rest/v1/processed_updates') && init?.method === 'POST') {
      return jsonResponse([{ id: 1 }], 201);
    }

    if (url.includes('/rest/v1/chat_history') && init?.method === 'GET') {
      assert.ok(!url.includes('limit=500'));
      return jsonResponse([], 200);
    }

    if (url.includes('/rest/v1/user_settings') && init?.method === 'GET') {
      return jsonResponse([{ insights: 'ctx' }], 200);
    }

    if (url.includes('/rest/v1/long_term_memory') && init?.method === 'GET') {
      return jsonResponse([], 200);
    }

    if (url.includes('/sendDocument') && init?.method === 'POST') {
      return jsonResponse({ ok: true, result: { message_id: 1 } }, 200);
    }

    return jsonResponse([], 200);
  });

  const req = {
    method: 'POST',
    headers: {
      'x-telegram-bot-api-secret-token': 'hook-secret',
    },
    body: createMessageUpdate({
      message: {
        message_id: 10,
        date: Math.floor(Date.now() / 1000),
        chat: { id: 12345, type: 'private' },
        from: { id: 777, first_name: 'Test' },
        text: '/export',
      },
    }),
  } as unknown as VercelRequest;

  const res = createMockVercelResponse();
  await webhookHandler(req, toVercelResponse(res));

  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { ok: true });
  fetchMock.restore();
});
