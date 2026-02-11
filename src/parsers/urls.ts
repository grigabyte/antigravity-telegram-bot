import { REQUEST_TIMEOUTS } from '../config.js';
import { fetchWithTimeout } from '../network/fetch.js';
import { isAllowedUrl } from '../security/url-guard.js';

export function extractUrls(text: string): string[] {
  const urlRegex = /https?:\/\/[^\s<>"{}|\\^`\[\]]+/gi;
  return text.match(urlRegex) || [];
}

export function isYouTubeUrl(url: string): boolean {
  return url.includes('youtube.com/watch') || url.includes('youtu.be/') || url.includes('youtube.com/shorts/');
}

export function extractYouTubeVideoId(url: string): string | null {
  const patterns = [/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/shorts\/)([a-zA-Z0-9_-]{11})/];
  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match) return match[1];
  }
  return null;
}

export async function fetchYouTubeMetadata(url: string): Promise<string> {
  const videoId = extractYouTubeVideoId(url);
  if (!videoId) {
    return `[YouTube: не удалось извлечь ID видео из ${url}]`;
  }

  try {
    const oembedUrl = `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`;
    const response = await fetchWithTimeout(oembedUrl, {}, REQUEST_TIMEOUTS.youtube);

    if (!response.ok) {
      return `[YouTube видео: ${url}]`;
    }

    const data = await response.json();
    return `[YouTube видео: "${data.title}" от ${data.author_name}]\nСсылка: ${url}`;
  } catch {
    return `[YouTube видео: ${url}]`;
  }
}

export async function fetchUrlContent(url: string): Promise<string> {
  if (!isAllowedUrl(url)) {
    return `[Ссылка недоступна для загрузки: ${url}]`;
  }

  if (isYouTubeUrl(url)) {
    return fetchYouTubeMetadata(url);
  }

  try {
    const response = await fetchWithTimeout(
      url,
      {
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; NeuroCopilotBot/1.0)',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        },
        redirect: 'follow',
      },
      REQUEST_TIMEOUTS.urlFetch
    );

    if (!response.ok) {
      return `[Не удалось загрузить ${url}: ${response.status}]`;
    }

    const contentType = response.headers.get('content-type') || '';
    if (!contentType.includes('text/html') && !contentType.includes('text/plain')) {
      return `[${url} — не текстовый контент: ${contentType}]`;
    }

    const html = await response.text();

    let text = html
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
      .replace(/<nav[^>]*>[\s\S]*?<\/nav>/gi, '')
      .replace(/<footer[^>]*>[\s\S]*?<\/footer>/gi, '')
      .replace(/<header[^>]*>[\s\S]*?<\/header>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/\s+/g, ' ')
      .trim();

    if (text.length > 15000) {
      text = text.substring(0, 15000) + '... [обрезано]';
    }

    return `[Содержимое ${url}]:\n${text}`;
  } catch (error: any) {
    return `[Ошибка загрузки ${url}: ${error.message}]`;
  }
}
