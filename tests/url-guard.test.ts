import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isAllowedUrl } from '../src/security/url-guard.js';

test('blocks localhost and local network URLs', () => {
  assert.equal(isAllowedUrl('http://localhost:3000'), false);
  assert.equal(isAllowedUrl('http://127.0.0.1/admin'), false);
  assert.equal(isAllowedUrl('http://192.168.1.10/private'), false);
  assert.equal(isAllowedUrl('http://10.0.0.10/'), false);
});

test('blocks URLs with embedded credentials', () => {
  assert.equal(isAllowedUrl('http://user:pass@example.com/path'), false);
});

test('allows normal public HTTPS URLs', () => {
  assert.equal(isAllowedUrl('https://example.com/page'), true);
  assert.equal(isAllowedUrl('https://docs.github.com/'), true);
});
