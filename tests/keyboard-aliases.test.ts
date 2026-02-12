import { beforeEach, test } from 'node:test';
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

test('keyboard alias routes to /stats command path', async () => {
  const fetchMock = installFetchMock((url, init) => {
    if (url.includes('/rest/v1/processed_updates') && init?.method === 'POST') {
      return jsonResponse([{ id: 1 }], 201);
    }

    if (url.includes('/rest/v1/user_settings') && init?.method === 'GET') {
      return jsonResponse([], 200);
    }

    if (url.includes('/rest/v1/long_term_memory') && init?.method === 'GET') {
      return jsonResponse([], 200);
    }

    if (url.includes('/rest/v1/chat_history') && init?.method === 'GET') {
      return jsonResponse([], 200);
    }

    if (url.includes('/rest/v1/chat_summaries') && init?.method === 'GET') {
      return jsonResponse([], 200);
    }

    if (url.includes('/rest/v1/proactive_jobs') && init?.method === 'GET') {
      return jsonResponse([], 200);
    }

    if (url.includes('/sendMessage') && init?.method === 'POST') {
      return jsonResponse({ ok: true, result: { message_id: 999 } }, 200);
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
        text: '📊 Статистика',
      },
    }),
  } as unknown as VercelRequest;

  const res = createMockVercelResponse();
  await webhookHandler(req, toVercelResponse(res));

  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { ok: true });

  const sentBodies = fetchMock.calls
    .filter((call) => call.url.includes('/sendMessage'))
    .map((call) => {
      if (!call.init?.body || typeof call.init.body !== 'string') return null;
      return JSON.parse(call.init.body) as { text?: string };
    })
    .filter((body): body is { text?: string } => Boolean(body));

  assert.ok(sentBodies.length > 0);
  assert.ok(sentBodies.some((body) => body.text?.includes('📊 Статистика')));

  fetchMock.restore();
});

test('webhook accepts message and queues background flush', async () => {
  const fetchMock = installFetchMock((url, init) => {
    if (url.includes('/rest/v1/processed_updates') && init?.method === 'POST') {
      return jsonResponse([{ id: 1 }], 201);
    }

    if (url.includes('/rest/v1/inbound_events') && init?.method === 'POST') {
      return jsonResponse([{ id: 201, event_ts: Date.now() }], 201);
    }

    if (url.includes('/rest/v1/inbound_events') && init?.method === 'GET' && url.includes('order=id.desc&limit=1')) {
      return jsonResponse([{ id: 201, event_ts: Date.now() }], 200);
    }

    if (url.includes('/rest/v1/inbound_events') && init?.method === 'GET' && url.includes('id=gt.0&id=lte.201')) {
      return jsonResponse(
        [
          {
            id: 201,
            user_id: 777,
            chat_id: 12345,
            event_ts: Date.now(),
            processed: false,
            payload: {
              messageId: 99,
              date: Math.floor(Date.now() / 1000),
              text: 'тест',
              attachments: [],
            },
          },
        ],
        200
      );
    }

    if (url.includes('/rest/v1/user_settings') && init?.method === 'GET') {
      return jsonResponse([], 200);
    }

    if (url.includes('/rest/v1/chat_history') && init?.method === 'GET') {
      return jsonResponse([], 200);
    }

    if (url.includes('/rest/v1/chat_summaries') && init?.method === 'GET') {
      return jsonResponse([], 200);
    }

    if (url.includes('/rest/v1/long_term_memory') && init?.method === 'GET') {
      return jsonResponse([], 200);
    }

    if (url.includes('/rest/v1/inbound_events') && init?.method === 'PATCH') {
      return jsonResponse([], 200);
    }

    if (url.includes('/rest/v1/chat_history') && init?.method === 'POST') {
      return jsonResponse([], 201);
    }

    if (url.includes('/sendMessage') && init?.method === 'POST') {
      return jsonResponse({ ok: true, result: { message_id: 1000 } }, 200);
    }

    if (url.includes('/rest/v1/processed_updates') && init?.method === 'DELETE') {
      return jsonResponse([], 200);
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
        message_id: 99,
        date: Math.floor(Date.now() / 1000),
        chat: { id: 12345, type: 'private' },
        from: { id: 777, first_name: 'Test' },
        text: 'тест',
      },
    }),
  } as unknown as VercelRequest;

  const res = createMockVercelResponse();
  await webhookHandler(req, toVercelResponse(res));

  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { ok: true });
  assert.ok(fetchMock.calls.some((call) => call.url.includes('/rest/v1/inbound_events') && call.init?.method === 'POST'));

  fetchMock.restore();
});
