import { MAX_CONTEXT_MESSAGES } from '../config.js';
import { getChatSummaries, getRecentHistory } from '../db/supabase.js';
import type { ChatMessage } from '../types.js';
import { estimateTokens } from '../utils/text.js';

export interface MemoryContextBundle {
  summaryMessages: ChatMessage[];
  recentMessages: ChatMessage[];
  totalTokens: number;
}

export async function buildMemoryContextBundle(userId: number): Promise<MemoryContextBundle> {
  const [summaries, recentMessages] = await Promise.all([
    getChatSummaries(userId),
    getRecentHistory(userId, MAX_CONTEXT_MESSAGES),
  ]);

  const summaryMessages: ChatMessage[] = summaries.map((summary, index) => ({
    role: 'model',
    content: `[Эпизод ${index + 1}]\n${summary}`,
    timestamp: 0,
  }));

  const totalTokens = estimateTokens(
    summaryMessages.map((m) => m.content).join(' ') + ' ' + recentMessages.map((m) => m.content).join(' ')
  );

  return {
    summaryMessages,
    recentMessages,
    totalTokens,
  };
}
