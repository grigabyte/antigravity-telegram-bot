import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { clearProcessedInboundEventsBeforeOrEqual } from '../src/db/supabase.js';
import { installFetchMock, jsonResponse } from './helpers/http.js';

beforeEach(() => {
  process.env.SUPABASE_URL = 'https://example.supabase.co';
  process.env.SUPABASE_KEY = 'sb-secret';
  process.env.TELEGRAM_BOT_TOKEN = 'test-token';
});

test('clearProcessedInboundEventsBeforeOrEqual scopes delete to user/chat/processed/id', async () => {
  const fetchMock = installFetchMock((url, init) => {
    if (url.includes('/rest/v1/inbound_events') && init?.method === 'DELETE') {
      assert.ok(url.includes('user_id=eq.777'));
      assert.ok(url.includes('chat_id=eq.12345'));
      assert.ok(url.includes('processed=eq.true'));
      assert.ok(url.includes('id=lte.321'));
      return jsonResponse([], 200);
    }

    return jsonResponse([], 200);
  });

  await clearProcessedInboundEventsBeforeOrEqual(777, 12345, 321);
  fetchMock.restore();
});

test('clearProcessedInboundEventsBeforeOrEqual skips invalid id bounds', async () => {
  const fetchMock = installFetchMock(() => {
    assert.fail('No fetch expected for invalid maxEventIdInclusive');
  });

  await clearProcessedInboundEventsBeforeOrEqual(777, 12345, 0);
  await clearProcessedInboundEventsBeforeOrEqual(777, 12345, Number.NaN);

  fetchMock.restore();
});
