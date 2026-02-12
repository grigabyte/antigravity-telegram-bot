import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { enqueueInboundMessageWithText } from '../src/telegram/inbound-events.js';
import { installFetchMock, jsonResponse } from './helpers/http.js';
import { createMessageUpdate } from './helpers/telegram.js';

beforeEach(() => {
  process.env.SUPABASE_URL = 'https://example.supabase.co';
  process.env.SUPABASE_KEY = 'sb-secret';
  process.env.TELEGRAM_BOT_TOKEN = 'test-token';
});

test('enqueueInboundMessageWithText persists message options in payload', async () => {
  const fetchMock = installFetchMock((url, init) => {
    if (url.includes('/rest/v1/inbound_events') && init?.method === 'POST') {
      const body = typeof init.body === 'string' ? JSON.parse(init.body) : null;
      assert.equal(body?.payload?.options?.voiceReply, true);
      assert.equal(body?.payload?.options?.forceSearch, true);
      return jsonResponse([{ id: 500, event_ts: Date.now() }], 201);
    }

    return jsonResponse([], 200);
  });

  const update = createMessageUpdate({
    message: {
      message_id: 10,
      date: Math.floor(Date.now() / 1000),
      chat: { id: 12345, type: 'private' },
      from: { id: 777, first_name: 'Test' },
      text: '/voice /search тест',
    },
  });

  const result = await enqueueInboundMessageWithText(update, 'тест', {
    voiceReply: true,
    forceSearch: true,
  });

  assert.equal(result?.eventId, 500);
  fetchMock.restore();
});
