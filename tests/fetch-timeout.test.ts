import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fetchWithTimeout } from '../src/network/fetch.js';

test('passes AbortSignal to fetch and aborts on timeout', async () => {
  const originalFetch = globalThis.fetch;
  let receivedSignal: AbortSignal | undefined;

  globalThis.fetch = (async (_url: RequestInfo | URL, init?: RequestInit) => {
    receivedSignal = init?.signal as AbortSignal | undefined;
    return await new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => {
        reject(new Error('aborted'));
      });
    });
  }) as typeof fetch;

  await assert.rejects(fetchWithTimeout('https://example.com', {}, 5), /aborted/);
  assert.ok(receivedSignal);
  assert.equal(receivedSignal?.aborted, true);

  globalThis.fetch = originalFetch;
});
