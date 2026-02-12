import { test } from 'node:test';
import assert from 'node:assert/strict';
import { convertToTelegramHtml } from '../src/telegram/formatting.js';

test('convertToTelegramHtml does not leak placeholder tokens', () => {
  const input = 'Тест: `inline` и <b>bold</b> и ```const a = 1;```';
  const output = convertToTelegramHtml(input);

  assert.ok(output.includes('<code>inline</code>'));
  assert.ok(output.includes('<b>bold</b>'));
  assert.ok(output.includes('<pre>const a = 1;</pre>'));
  assert.ok(!/@@(?:CODEBLOCK|INLINE|TAG)_?\d+@@/.test(output));
});

test('convertToTelegramHtml strips dangling placeholders', () => {
  const output = convertToTelegramHtml('Сломанный токен @@INLINE_0@@ должен пропасть');
  assert.ok(!output.includes('@@INLINE0@@'));
  assert.ok(!output.includes('@@INLINE_0@@'));
  assert.ok(output.includes('Сломанный токен'));
});
