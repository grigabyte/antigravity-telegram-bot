import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { getPendingInboundEvents } from '../src/db/supabase.js';
import { installFetchMock, jsonResponse } from './helpers/http.js';

beforeEach(() => {
  process.env.SUPABASE_URL = 'https://example.supabase.co';
  process.env.SUPABASE_KEY = 'sb-secret';
  process.env.TELEGRAM_BOT_TOKEN = 'test-token';
});

test('getPendingInboundEvents returns newest pending window and keeps ascending order', async () => {
  const fetchMock = installFetchMock((url, init) => {
    if (url.includes('/rest/v1/inbound_events') && init?.method === 'GET') {
      assert.ok(url.includes('order=id.desc'));
      assert.ok(url.includes('id=gt.100'));
      assert.ok(url.includes('id=lte.999'));
      return jsonResponse(
        [
          {
            id: 105,
            user_id: 777,
            chat_id: 12345,
            event_ts: 105,
            payload: { messageId: 105, date: 1, text: 'msg-105', attachments: [] },
            processed: false,
          },
          {
            id: 104,
            user_id: 777,
            chat_id: 12345,
            event_ts: 104,
            payload: { messageId: 104, date: 1, text: 'msg-104', attachments: [] },
            processed: false,
          },
          {
            id: 103,
            user_id: 777,
            chat_id: 12345,
            event_ts: 103,
            payload: { messageId: 103, date: 1, text: 'msg-103', attachments: [] },
            processed: false,
          },
        ],
        200
      );
    }

    return jsonResponse([], 200);
  });

  const events = await getPendingInboundEvents(777, 12345, 999, 3, 100);

  assert.deepEqual(events.map((event) => event.id), [103, 104, 105]);
  assert.deepEqual(events.map((event) => event.payload.text), ['msg-103', 'msg-104', 'msg-105']);

  fetchMock.restore();
});
