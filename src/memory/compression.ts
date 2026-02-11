import {
  ACCOUNT,
  ANTIGRAVITY_ENDPOINT,
  COMPRESS_THRESHOLD,
  GEMINI_MODEL,
  MAX_CONTEXT_MESSAGES,
  MAX_CONTEXT_TOKENS,
  MAX_HISTORY_MESSAGES,
  REQUEST_TIMEOUTS,
} from '../config.js';
import { fetchWithTimeout } from '../network/fetch.js';
import { estimateTokens } from '../utils/text.js';
import type { ChatMessage } from '../types.js';
import {
  addMemoryItem,
  getActiveHistory,
  getChatSummaries,
  getRecentHistory,
  getUserSettings,
  getHistory,
  markHistoryRangeCompressed,
  saveChatSummary,
} from '../db/supabase.js';
import { buildSystemPrompt } from './context.js';
import { getAccessToken } from '../ai/gemini.js';

export interface CompressionResult {
  summary: string;
  facts: string[];
  preferences: string[];
  goals: string[];
}

export async function compressOldMessages(
  userId: number,
  messages: ChatMessage[]
): Promise<CompressionResult> {
  const compressCount = Math.floor(messages.length * 0.7);
  const toCompress = messages.slice(0, compressCount);

  const conversationText = toCompress
    .map((m) => `${m.role === 'user' ? 'Пользователь' : 'Нейро'}: ${m.content}`)
    .join('\n\n');

  const summaryPrompt = `Ты — система анализа и сжатия контекста. Твоя задача:
1. Создать краткое резюме разговора
2. Извлечь ключевую информацию о пользователе для долгосрочной памяти

=== РАЗГОВОР ДЛЯ АНАЛИЗА ===
${conversationText}
=== КОНЕЦ РАЗГОВОРА ===

Ответь СТРОГО в следующем формате:

=== РЕЗЮМЕ ===
[Краткое резюме разговора: ключевые темы, решения, договорённости. Максимум 1500 слов]

=== ДОЛГОСРОЧНАЯ ПАМЯТЬ ===
[Извлеки ТОЛЬКО новую важную информацию о пользователе. Каждый пункт с новой строки]
FACT: [биографический факт: имя, возраст, город, работа, семья, образование]
PREF: [предпочтение: как любит общаться, интересы, что нравится/не нравится]
GOAL: [цель: над чем работает, к чему стремится, планы]

Правила:
- Добавляй только конкретные, проверяемые факты
- Не добавляй очевидные или временные вещи
- Если нет фактов какого-то типа — не добавляй пустые строки
- Пиши кратко: "Живёт в Москве", а не "Пользователь упомянул, что он живёт в Москве"`;

  try {
    const accessToken = await getAccessToken();

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
          request: {
            contents: [{ role: 'user', parts: [{ text: summaryPrompt }] }],
            generationConfig: {
              temperature: 0.3,
              maxOutputTokens: 8192,
            },
          },
          requestType: 'agent',
          userAgent: 'antigravity',
          requestId: `compress-${Date.now()}`,
        }),
      },
      REQUEST_TIMEOUTS.gemini
    );

    if (!response.ok) {
      throw new Error(`Compression failed: ${response.status}`);
    }

    const data = await response.json();
    const fullResponse = data.response?.candidates?.[0]?.content?.parts?.[0]?.text || '';

    const summaryMatch = fullResponse.match(/=== РЕЗЮМЕ ===\s*([\s\S]*?)(?:=== ДОЛГОСРОЧНАЯ ПАМЯТЬ ===|$)/);
    const summary = summaryMatch?.[1]?.trim() || fullResponse;

    const facts: string[] = [];
    const preferences: string[] = [];
    const goals: string[] = [];

    const memorySection = fullResponse.match(/=== ДОЛГОСРОЧНАЯ ПАМЯТЬ ===\s*([\s\S]*?)$/);
    if (memorySection) {
      const lines = memorySection[1].split('\n');
      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed.startsWith('FACT:')) {
          const fact = trimmed.replace('FACT:', '').trim();
          if (fact.length > 3) facts.push(fact);
        } else if (trimmed.startsWith('PREF:')) {
          const pref = trimmed.replace('PREF:', '').trim();
          if (pref.length > 3) preferences.push(pref);
        } else if (trimmed.startsWith('GOAL:')) {
          const goal = trimmed.replace('GOAL:', '').trim();
          if (goal.length > 3) goals.push(goal);
        }
      }
    }

    return { summary, facts, preferences, goals };
  } catch (error) {
    console.error('Compression error:', error);
    const fallback = toCompress
      .slice(0, 5)
      .map((m) => `${m.role === 'user' ? 'U' : 'N'}: ${m.content.substring(0, 200)}`)
      .join('\n');
    return {
      summary: `[Сжатый контекст - ${compressCount} сообщений]\n${fallback}`,
      facts: [],
      preferences: [],
      goals: [],
    };
  }
}

export async function maybeCompressContext(
  userId: number
): Promise<{ compressed: boolean; tokensFreed: number; factsExtracted: number }> {
  const history = await getActiveHistory(userId, MAX_HISTORY_MESSAGES);
  const historyText = history.map((m) => m.content).join(' ');
  const currentTokens = estimateTokens(historyText);

  if (currentTokens < COMPRESS_THRESHOLD) {
    return { compressed: false, tokensFreed: 0, factsExtracted: 0 };
  }

  console.log(`Compressing context for user ${userId}: ${currentTokens} tokens`);

  const compressCount = Math.floor(history.length * 0.7);
  const result = await compressOldMessages(userId, history);

  await saveChatSummary(userId, result.summary, compressCount);

  let factsExtracted = 0;
  for (const fact of result.facts) {
    await addMemoryItem(userId, 'fact', fact);
    factsExtracted++;
  }
  for (const pref of result.preferences) {
    await addMemoryItem(userId, 'preference', pref);
    factsExtracted++;
  }
  for (const goal of result.goals) {
    await addMemoryItem(userId, 'goal', goal);
    factsExtracted++;
  }

  const oldMessages = history.slice(0, compressCount);
  const firstTimestamp = oldMessages[0]?.timestamp;
  const lastTimestamp = oldMessages[oldMessages.length - 1]?.timestamp;
  if (firstTimestamp !== undefined && lastTimestamp !== undefined) {
    await markHistoryRangeCompressed(userId, firstTimestamp, lastTimestamp);
  }

  const newHistoryText = history.slice(compressCount).map((m) => m.content).join(' ');
  const newTokens = estimateTokens(newHistoryText);
  const tokensFreed = currentTokens - newTokens;

  console.log(`Compression done: freed ${tokensFreed} tokens, extracted ${factsExtracted} memory items`);

  return { compressed: true, tokensFreed, factsExtracted };
}

export async function getContextStats(
  userId: number
): Promise<{ tokens: number; percent: number; historyTokens: number; insightsTokens: number; systemTokens: number; messageCount: number }> {
  const history = await getRecentHistory(userId, MAX_CONTEXT_MESSAGES);
  const settings = await getUserSettings(userId);
  const summaries = await getChatSummaries(userId);
  const systemPrompt = await buildSystemPrompt(userId);
  const historyText = history.map((m) => m.content).join(' ');
  const summariesText = summaries.join(' ');
  const historyTokens = estimateTokens(historyText) + estimateTokens(summariesText);
  const insightsTokens = estimateTokens(settings.insights);
  const systemTokens = estimateTokens(systemPrompt);

  const totalTokens = historyTokens + systemTokens;
  const percent = Math.min(100, Math.round((totalTokens / MAX_CONTEXT_TOKENS) * 100));

  return {
    tokens: totalTokens,
    percent,
    historyTokens,
    insightsTokens,
    systemTokens,
    messageCount: history.length,
  };
}

export async function buildContextMessages(
  userId: number,
  newMessageParts: { role: 'user'; parts: Array<{ text?: string; inlineData?: { mimeType: string; data: string } }> },
  latestUserContent?: string
): Promise<{ messages: { role: 'user' | 'model'; parts: Array<{ text?: string; inlineData?: { mimeType: string; data: string } }> }[]; summariesText: string }> {
  const summaries = await getChatSummaries(userId);
  let recentHistory = await getRecentHistory(userId, MAX_CONTEXT_MESSAGES);
  const summaryText = summaries.length > 0 ? summaries.join('\n\n') : '';

  if (latestUserContent && recentHistory.length > 0) {
    const last = recentHistory[recentHistory.length - 1];
    if (last.role === 'user' && last.content === latestUserContent) {
      recentHistory = recentHistory.slice(0, -1);
    }
  }

  const messages: { role: 'user' | 'model'; parts: Array<{ text?: string; inlineData?: { mimeType: string; data: string } }> }[] = [];
  if (summaryText) {
    messages.push({ role: 'model', parts: [{ text: `[Сжатый контекст]\n${summaryText}` }] });
  }

  for (const msg of recentHistory) {
    messages.push({ role: msg.role, parts: [{ text: msg.content }] });
  }

  messages.push(newMessageParts);

  return { messages, summariesText: summaryText };
}
