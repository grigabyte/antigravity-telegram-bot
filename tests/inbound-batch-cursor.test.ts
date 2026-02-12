import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  getInboundBatchCursor,
  resetInboundBatchCursor,
  setInboundBatchCursor,
} from '../src/db/supabase.js';
import { installFetchMock, jsonResponse } from './helpers/http.js';

beforeEach(() => {
  process.env.SUPABASE_URL = 'https://example.supabase.co';
  process.env.SUPABASE_KEY = 'sb-secret';
  process.env.TELEGRAM_BOT_TOKEN = 'test-token';
});

test('getInboundBatchCursor returns latest stored cursor value', async () => {
  const fetchMock = installFetchMock((url, init) => {
    if (url.includes('/rest/v1/processed_updates') && init?.method === 'GET') {
      assert.ok(url.includes('update_type=eq.batch_cursor'));
      return jsonResponse([{ update_id: 456 }], 200);
    }

    return jsonResponse([], 200);
  });

  const cursor = await getInboundBatchCursor(777, 12345);
  assert.equal(cursor, 456);

  fetchMock.restore();
});

test('setInboundBatchCursor replaces previous cursor row', async () => {
  const calls: Array<{ url: string; method?: string }> = [];

  const fetchMock = installFetchMock((url, init) => {
    calls.push({ url, method: init?.method });

    if (url.includes('/rest/v1/processed_updates') && init?.method === 'DELETE') {
      assert.ok(url.includes('update_type=eq.batch_cursor'));
      return jsonResponse([], 200);
    }

    if (url.includes('/rest/v1/processed_updates') && init?.method === 'POST') {
      const body = typeof init?.body === 'string' ? JSON.parse(init.body) as { update_id: number; update_type: string } : null;
      assert.equal(body?.update_id, 789);
      assert.equal(body?.update_type, 'batch_cursor');
      return jsonResponse([{ id: 1 }], 201);
    }

    return jsonResponse([], 200);
  });

  await setInboundBatchCursor(777, 12345, 789);

  const methods = calls.map((call) => call.method);
  assert.deepEqual(methods.slice(0, 2), ['DELETE', 'POST']);

  fetchMock.restore();
});

test('resetInboundBatchCursor deletes chat cursor', async () => {
  const fetchMock = installFetchMock((url, init) => {
    if (url.includes('/rest/v1/processed_updates') && init?.method === 'DELETE') {
      assert.ok(url.includes('update_type=eq.batch_cursor'));
      assert.ok(url.includes('user_id=eq.777'));
      assert.ok(url.includes('chat_id=eq.12345'));
      return jsonResponse([], 200);
    }

    return jsonResponse([], 200);
  });

  await resetInboundBatchCursor(777, 12345);
  fetchMock.restore();
});
