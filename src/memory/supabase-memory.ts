import { getRecentSignals, getRecentHistory } from '../db/supabase.js';

function tokenizeRu(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length > 2);
}

function scoreLexical(queryTokens: string[], text: string): number {
  const lower = text.toLowerCase();
  let score = 0;
  for (const token of queryTokens) {
    if (lower.includes(token)) score += 1;
  }
  return score;
}

function scoreRecency(timestamp: number, nowTs: number): number {
  const ageMs = Math.max(1, nowTs - timestamp);
  const ageHours = ageMs / (1000 * 60 * 60);
  return 1 / (1 + ageHours / 24);
}

export async function buildSupabaseMemoryContext(
  userId: number,
  queryText: string,
  options: {
    historyLimit?: number;
    topK?: number;
  } = {}
): Promise<string> {
  const topK = options.topK ?? 8;
  const historyLimit = options.historyLimit ?? 300;
  const queryTokens = tokenizeRu(queryText);

  if (queryTokens.length === 0) {
    return '';
  }

  const [history, recentSignals] = await Promise.all([
    getRecentHistory(userId, historyLimit).catch(() => []),
    getRecentSignals(userId, 8).catch(() => []),
  ]);

  const nowTs = Date.now();
  const scored = history
    .map((item) => {
      const lexical = scoreLexical(queryTokens, item.content);
      const recency = scoreRecency(item.timestamp, nowTs);
      const roleBoost = item.role === 'user' ? 1.05 : 1.0;
      const score = lexical * 1.6 + recency * 0.7 * roleBoost;
      return {
        content: item.content,
        timestamp: item.timestamp,
        score,
      };
    })
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);

  if (scored.length === 0 && recentSignals.length === 0) {
    return '';
  }

  const lines: string[] = [];
  if (scored.length > 0) {
    lines.push('Память Supabase (лексический retrieval):');
    for (const row of scored) {
      lines.push(`• [score=${row.score.toFixed(2)}] ${row.content}`);
    }
  }

  if (recentSignals.length > 0) {
    lines.push('Недавние сигналы:');
    for (const signal of recentSignals) {
      lines.push(`• intent=${signal.intent}, emotion=${signal.emotion}${signal.note ? `, note=${signal.note}` : ''}`);
    }
  }

  return lines.join('\n');
}
