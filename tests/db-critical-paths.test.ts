import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  markUpdateProcessed,
  replaceHistorySafely,
  replaceLongTermMemorySafely,
  setMemoryPinned,
} from '../src/db/supabase.js';
import { installFetchMock, jsonResponse, parseJsonBody, textResponse } from './helpers/http.js';

beforeEach(() => {
  process.env.SUPABASE_URL = 'https://example.supabase.co';
  process.env.SUPABASE_KEY = 'sb-secret';
  process.env.TELEGRAM_BOT_TOKEN = 'test-token';
});

test('setMemoryPinned includes user scope to prevent IDOR', async () => {
  const fetchMock = installFetchMock((url, init) => {
    if (url.includes('/rest/v1/memory_items_v2') && init?.method === 'PATCH') {
      assert.ok(url.includes('id=eq.42'));
      assert.ok(url.includes('user_id=eq.777'));
      return jsonResponse([{ id: 42 }], 200);
    }

    return jsonResponse([], 200);
  });

  const updated = await setMemoryPinned(777, 42, true);
  assert.equal(updated, true);
  fetchMock.restore();
});

test('markUpdateProcessed returns false on duplicate key', async () => {
  const fetchMock = installFetchMock((url, init) => {
    if (url.includes('/rest/v1/processed_updates') && init?.method === 'POST') {
      return textResponse(
        JSON.stringify({
          code: '23505',
          message: 'duplicate key value violates unique constraint',
        }),
        409
      );
    }

    return jsonResponse([], 200);
  });

  const accepted = await markUpdateProcessed(1001, 777, 12345, 'message');
  assert.equal(accepted, false);
  fetchMock.restore();
});

test('replaceHistorySafely restores backup when import fails', async () => {
  let postCounter = 0;
  const recordedBodies: unknown[] = [];

  const fetchMock = installFetchMock((url, init) => {
    if (url.includes('/rest/v1/chat_history') && init?.method === 'GET') {
      return jsonResponse([
        { role: 'user', content: 'old-1', timestamp: 1 },
        { role: 'model', content: 'old-2', timestamp: 2 },
      ]);
    }

    if (url.includes('/rest/v1/chat_history') && init?.method === 'DELETE') {
      return jsonResponse([], 200);
    }

    if (url.includes('/rest/v1/chat_history') && init?.method === 'POST') {
      postCounter += 1;
      recordedBodies.push(parseJsonBody(init));

      if (postCounter === 1) {
        return textResponse('forced failure', 500);
      }

      return jsonResponse([], 201);
    }

    return jsonResponse([], 200);
  });

  await assert.rejects(
    replaceHistorySafely(777, [{ role: 'user', content: 'new history', timestamp: 11 }]),
    /Supabase error/i
  );

  assert.equal(postCounter, 2);
  const restoreBody = recordedBodies[1] as Array<{ content: string }>;
  assert.equal(Array.isArray(restoreBody), true);
  assert.deepEqual(restoreBody.map((row) => row.content), ['old-1', 'old-2']);
  fetchMock.restore();
});

test('replaceLongTermMemorySafely rejects duplicate payload before destructive writes', async () => {
  const fetchCalls: string[] = [];

  const fetchMock = installFetchMock((url, init) => {
    fetchCalls.push(`${init?.method || 'GET'} ${url}`);

    if (url.includes('/rest/v1/long_term_memory') && init?.method === 'GET') {
      return jsonResponse([
        { type: 'fact', content: 'old-fact' },
        { type: 'preference', content: 'old-pref' },
      ]);
    }

    if (url.includes('/rest/v1/long_term_memory') && init?.method === 'DELETE') {
      return jsonResponse([], 200);
    }

    if (url.includes('/rest/v1/long_term_memory') && init?.method === 'POST') {
      return jsonResponse([{ id: 1 }], 201);
    }

    return jsonResponse([], 200);
  });

  await assert.rejects(
    replaceLongTermMemorySafely(777, {
      facts: ['new-fact', 'new-fact'],
      preferences: ['new-pref'],
      goals: ['new-goal'],
    }),
    /LONG_TERM_MEMORY_DUPLICATES_DETECTED/i
  );

  assert.equal(fetchCalls.some((call) => call.includes('DELETE /rest/v1/long_term_memory')), false);
  assert.equal(fetchCalls.some((call) => call.includes('POST /rest/v1/long_term_memory')), false);
  fetchMock.restore();
});
