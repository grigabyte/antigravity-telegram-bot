/**
 * Memory management for the copilot
 * Stores conversation history and core insights in Redis
 */

import { Redis } from '@upstash/redis';
import type { GeminiMessage } from './gemini';

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL!,
  token: process.env.UPSTASH_REDIS_REST_TOKEN!,
});

const HISTORY_KEY = 'chat_history';
const INSIGHTS_KEY = 'core_insights';
const MAX_HISTORY_MESSAGES = 50; // Keep last 50 messages in active context

export interface ChatMessage {
  role: 'user' | 'model';
  content: string;
  timestamp: number;
}

/**
 * Get core insights (long-term memory / personality)
 */
export async function getCoreInsights(): Promise<string> {
  const insights = await redis.get<string>(INSIGHTS_KEY);
  return insights || '';
}

/**
 * Save core insights
 */
export async function saveCoreInsights(insights: string): Promise<void> {
  await redis.set(INSIGHTS_KEY, insights);
}

/**
 * Get conversation history
 */
export async function getHistory(): Promise<ChatMessage[]> {
  const history = await redis.get<ChatMessage[]>(HISTORY_KEY);
  return history || [];
}

/**
 * Add message to history
 */
export async function addToHistory(message: ChatMessage): Promise<void> {
  const history = await getHistory();
  history.push(message);
  
  // Trim to max messages
  const trimmed = history.slice(-MAX_HISTORY_MESSAGES);
  await redis.set(HISTORY_KEY, trimmed);
}

/**
 * Convert history to Gemini message format
 */
export async function getMessagesForGemini(): Promise<GeminiMessage[]> {
  const history = await getHistory();
  
  return history.map(msg => ({
    role: msg.role,
    parts: [{ text: msg.content }],
  }));
}

/**
 * Build system prompt with core insights
 */
export async function buildSystemPrompt(): Promise<string> {
  const coreInsights = await getCoreInsights();
  
  const basePrompt = `Ты — персональный AI-помощник и второй пилот для своего пользователя. 
Ты помогаешь с рефлексией, жизненными вопросами, принятием решений и личностным развитием.

Твой стиль:
- Эмпатичный, но честный
- Задаёшь уточняющие вопросы когда нужно
- Помнишь контекст предыдущих разговоров
- Даёшь конкретные, применимые советы
- Поддерживаешь в трудные моменты, но не льстишь

Ты общаешься на русском языке.`;

  if (coreInsights) {
    return `${basePrompt}

=== ВАЖНЫЙ КОНТЕКСТ О ПОЛЬЗОВАТЕЛЕ ===
${coreInsights}
=== КОНЕЦ КОНТЕКСТА ===

Используй этот контекст чтобы давать более релевантные и персонализированные ответы.`;
  }

  return basePrompt;
}

/**
 * Clear all history (for reset)
 */
export async function clearHistory(): Promise<void> {
  await redis.del(HISTORY_KEY);
}

/**
 * Get stats about memory usage
 */
export async function getMemoryStats(): Promise<{
  historyCount: number;
  insightsLength: number;
}> {
  const history = await getHistory();
  const insights = await getCoreInsights();
  
  return {
    historyCount: history.length,
    insightsLength: insights.length,
  };
}
