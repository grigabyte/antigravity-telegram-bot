import {
  ACCOUNT,
  ANTIGRAVITY_ENDPOINT,
  CLIENT_ID,
  CLIENT_SECRET,
  GEMINI_MODEL,
  REQUEST_TIMEOUTS,
} from '../config.js';
import { fetchWithTimeout } from '../network/fetch.js';
import type { GeminiMessage, GeminiRequestPayload, GeminiResponse } from '../types.js';

interface CachedToken {
  accessToken: string;
  expiresAt: number;
}

let cachedToken: CachedToken | null = null;

export interface CallGeminiOptions {
  messages: GeminiMessage[];
  systemPrompt?: string;
  forceSearch?: boolean;
}

export interface GeminiResult {
  text: string;
  sources?: Array<{ title: string; url: string }>;
}

export async function getAccessToken(): Promise<string> {
  const now = Date.now();
  if (cachedToken && cachedToken.expiresAt - 30_000 > now) {
    return cachedToken.accessToken;
  }

  const response = await fetchWithTimeout(
    'https://oauth2.googleapis.com/token',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        refresh_token: ACCOUNT.refreshToken,
        grant_type: 'refresh_token',
      }),
    },
    REQUEST_TIMEOUTS.oauth
  );

  if (!response.ok) {
    throw new Error(`TOKEN_EXPIRED: ${await response.text()}`);
  }

  const data = await response.json();
  const expiresInSeconds = Number(data.expires_in || 3600);
  cachedToken = {
    accessToken: data.access_token,
    expiresAt: now + expiresInSeconds * 1000,
  };
  return data.access_token;
}

export async function callGemini(options: CallGeminiOptions): Promise<GeminiResult> {
  const { messages, systemPrompt, forceSearch } = options;

  const maxRetries = 3;
  let lastError: Error | null = null;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const accessToken = await getAccessToken();

      const requestPayload: GeminiRequestPayload = {
        contents: messages,
        generationConfig: {
          temperature: 0.9,
          maxOutputTokens: 65536,
        },
        tools: [{ googleSearch: {} }],
      };

      let finalSystemPrompt = systemPrompt || '';
      if (forceSearch) {
        finalSystemPrompt += '\n\nВАЖНО: Обязательно используй Google Search для ответа на этот запрос.';
      }

      if (finalSystemPrompt) {
        requestPayload.systemInstruction = {
          role: 'user',
          parts: [{ text: finalSystemPrompt }],
        };
      }

      const response = await fetchWithTimeout(
        ANTIGRAVITY_ENDPOINT,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
            'User-Agent': 'google-api-nodejs-client/9.15.1',
            'X-Goog-Api-Client': 'gl-node/22.17.0',
          },
          body: JSON.stringify({
            project: ACCOUNT.projectId,
            model: GEMINI_MODEL,
            request: requestPayload,
            requestType: 'agent',
            userAgent: 'antigravity',
            requestId: `bot-${Date.now()}`,
          }),
        },
        REQUEST_TIMEOUTS.gemini
      );

      if (!response.ok) {
        const error = await response.text();
        if (response.status === 429) {
          const waitTime = Math.pow(2, attempt) * 5000;
          console.log(`Rate limit hit, waiting ${waitTime / 1000}s before retry ${attempt + 1}/${maxRetries}`);
          await new Promise((resolve) => setTimeout(resolve, waitTime));
          lastError = new Error('RATE_LIMIT');
          continue;
        }
        throw new Error(`Gemini error (${response.status}): ${error.substring(0, 200)}`);
      }

      const data: GeminiResponse = await response.json();
      const candidate = data.response?.candidates?.[0];
      const parts = candidate?.content?.parts || [];
      const textPart = parts.find((p) => p.text && !p.thoughtSignature) || parts.find((p) => p.text);

      const sources: Array<{ title: string; url: string }> = [];
      const groundingChunks = candidate?.groundingMetadata?.groundingChunks || [];

      for (const chunk of groundingChunks) {
        if (chunk.web?.uri && chunk.web?.title) {
          if (!sources.some((s) => s.url === chunk.web!.uri)) {
            sources.push({
              title: chunk.web.title,
              url: chunk.web.uri,
            });
          }
        }
      }

      return {
        text: textPart?.text || 'Нет ответа',
        sources: sources.length > 0 ? sources.slice(0, 5) : undefined,
      };
    } catch (e) {
      lastError = e as Error;
      if (attempt < maxRetries - 1 && lastError.message !== 'RATE_LIMIT') {
        continue;
      }
    }
  }

  throw lastError || new Error('RATE_LIMIT');
}
