import { isAllowedUrl } from '../security/url-guard.js';
import { escapeHtml } from '../utils/text.js';

function splitLongText(text: string, maxLen: number): string[] {
  if (text.length <= maxLen) return [text];

  const chunks: string[] = [];
  let cursor = 0;

  while (cursor < text.length) {
    let next = Math.min(cursor + maxLen, text.length);
    if (next < text.length) {
      const breakPoint = text.lastIndexOf('\n', next);
      if (breakPoint > cursor + Math.floor(maxLen * 0.6)) {
        next = breakPoint;
      }
    }
    const chunk = text.slice(cursor, next).trim();
    if (chunk) chunks.push(chunk);
    cursor = next;
  }

  return chunks;
}

export function convertToTelegramHtml(text: string): string {
  const placeholders: string[] = [];
  let result = text.replace(/```([\s\S]*?)```/g, (_match, code) => {
    const escaped = escapeHtml(code.trim());
    const token = `@@CODEBLOCK_${placeholders.length}@@`;
    placeholders.push(`<pre>${escaped}</pre>`);
    return token;
  });

  result = result.replace(/`([^`]+)`/g, (_match, code) => {
    const escaped = escapeHtml(code);
    const token = `@@INLINE_${placeholders.length}@@`;
    placeholders.push(`<code>${escaped}</code>`);
    return token;
  });

  result = result.replace(/<b>([\s\S]*?)<\/b>/gi, (_match, content) => {
    const escaped = escapeHtml(content);
    const token = `@@TAG_${placeholders.length}@@`;
    placeholders.push(`<b>${escaped}</b>`);
    return token;
  });
  result = result.replace(/<i>([\s\S]*?)<\/i>/gi, (_match, content) => {
    const escaped = escapeHtml(content);
    const token = `@@TAG_${placeholders.length}@@`;
    placeholders.push(`<i>${escaped}</i>`);
    return token;
  });
  result = result.replace(/<code>([\s\S]*?)<\/code>/gi, (_match, content) => {
    const escaped = escapeHtml(content);
    const token = `@@TAG_${placeholders.length}@@`;
    placeholders.push(`<code>${escaped}</code>`);
    return token;
  });
  result = result.replace(/<pre>([\s\S]*?)<\/pre>/gi, (_match, content) => {
    const escaped = escapeHtml(content);
    const token = `@@TAG_${placeholders.length}@@`;
    placeholders.push(`<pre>${escaped}</pre>`);
    return token;
  });
  result = result.replace(/<a\s+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi, (_match, href, label) => {
    const safeHref = isAllowedUrl(href) ? escapeHtml(href) : '#';
    const safeLabel = escapeHtml(label);
    const token = `@@TAG_${placeholders.length}@@`;
    placeholders.push(`<a href="${safeHref}">${safeLabel}</a>`);
    return token;
  });

  result = escapeHtml(result);

  result = result.replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>');
  result = result.replace(/\*([^*]+)\*/g, '<b>$1</b>');
  result = result.replace(/__([^_]+)__/g, '<i>$1</i>');
  result = result.replace(/_([^_]+)_/g, '<i>$1</i>');
  result = result.replace(/^#{1,6}\s+/gm, '');
  result = result.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1 ($2)');

  for (let i = 0; i < placeholders.length; i++) {
    result = result.replace(`@@CODEBLOCK_${i}@@`, placeholders[i]);
    result = result.replace(`@@INLINE_${i}@@`, placeholders[i]);
    result = result.replace(`@@TAG_${i}@@`, placeholders[i]);
  }

  return result;
}

export function splitTelegramHtml(text: string, maxLen: number = 3900): string[] {
  return splitLongText(text, maxLen);
}
