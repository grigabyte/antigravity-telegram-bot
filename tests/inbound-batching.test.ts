import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { buildInboundBatch, collectBatchUpperEventId } from '../src/telegram/inbound-events.js';
import { installFetchMock, jsonResponse } from './helpers/http.js';

beforeEach(() => {
  process.env.SUPABASE_URL = 'https://example.supabase.co';
  process.env.SUPABASE_KEY = 'sb-secret';
  process.env.TELEGRAM_BOT_TOKEN = 'test-token';
});

test('collectBatchUpperEventId waits quiet window and captures latest pending event', async () => {
  let latestCalls = 0;

  const fetchMock = installFetchMock((url, init) => {
    if (url.includes('/rest/v1/inbound_events') && init?.method === 'GET' && url.includes('order=id.desc&limit=1')) {
      latestCalls += 1;
      if (latestCalls === 2) {
        return jsonResponse([{ id: 12, event_ts: Date.now() }], 200);
      }
      return jsonResponse([{ id: 10, event_ts: Date.now() }], 200);
    }

    return jsonResponse([], 200);
  });

  const upperEventId = await collectBatchUpperEventId(777, 12345, 10, {
    debounceMs: 250,
    maxWindowMs: 1500,
    pollMs: 100,
  });

  assert.equal(upperEventId, 12);
  assert.ok(latestCalls >= 3);

  fetchMock.restore();
});

test('buildInboundBatch uses neutral placeholder instead of greeting fallback', async () => {
  const fetchMock = installFetchMock((url, init) => {
    if (url.includes('/rest/v1/inbound_events') && init?.method === 'GET' && url.includes('order=id.desc')) {
      return jsonResponse(
        [
          {
            id: 21,
            user_id: 777,
            chat_id: 12345,
            event_ts: Date.now(),
            processed: false,
            payload: {
              messageId: 55,
              date: Math.floor(Date.now() / 1000),
              text: '',
              attachments: [],
            },
          },
        ],
        200
      );
    }

    return jsonResponse([], 200);
  });

  const batch = await buildInboundBatch(777, 12345, 21, 50);

  assert.equal(batch.parts.length, 1);
  assert.equal(batch.parts[0].text, '[Пользователь отправил сообщение без текста.]');
  assert.equal(batch.historyText, '[Пользователь отправил сообщение без текста.]');
  assert.ok(!batch.parts[0].text?.includes('Привет'));

  fetchMock.restore();
});
