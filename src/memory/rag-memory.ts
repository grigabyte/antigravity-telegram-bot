import {
  addMemoryChunk,
  addMemoryItemV2,
  getRecentSignals,
  searchMemoryVectors,
} from '../db/supabase.js';
import { chunkText } from './chunker.js';
import { embedText } from './embeddings.js';

export async function ingestMemoryFromText(
  userId: number,
  kind: 'fact' | 'pref' | 'goal' | 'episode' | 'signal',
  text: string,
  options: {
    importance?: number;
    confidence?: number;
    sourceMessageId?: number;
    pinned?: boolean;
    chunkMeta?: Record<string, unknown>;
  } = {}
): Promise<void> {
  const trimmed = text.trim();
  if (!trimmed) return;

  try {
    const memoryItemId = await addMemoryItemV2(
      userId,
      kind,
      trimmed,
      options.importance ?? 0.6,
      options.confidence ?? 0.7,
      options.sourceMessageId,
      options.pinned ?? false
    );

    const chunks = chunkText(trimmed, { chunkSize: 600, overlap: 100 });
    for (const chunk of chunks) {
      const embedding = await embedText(chunk);
      await addMemoryChunk(userId, memoryItemId, chunk, embedding, options.chunkMeta || {});
    }
  } catch (error) {
    console.warn('RAG ingest skipped:', error instanceof Error ? error.message : String(error));
  }
}

export async function buildMemoryRagContext(userId: number, queryText: string): Promise<string> {
  if (!queryText.trim()) {
    return '';
  }

  let queryEmbedding: number[];
  try {
    queryEmbedding = await embedText(queryText);
  } catch (error) {
    console.warn('RAG retrieval skipped (embeddings unavailable):', error instanceof Error ? error.message : String(error));
    return '';
  }

  const [vectorResult, recentSignals] = await Promise.all([
    searchMemoryVectors(userId, queryEmbedding, 8).catch(() => []),
    getRecentSignals(userId, 8).catch(() => []),
  ]);

  const hits = vectorResult || [];

  const lines: string[] = [];

  if (hits.length > 0) {
    lines.push('RAG-память (релевантные фрагменты):');
    for (const hit of hits) {
      lines.push(`• [sim=${hit.similarity.toFixed(3)}|imp=${hit.importance.toFixed(2)}] ${hit.chunkText}`);
    }
  }

  if (recentSignals.length > 0) {
    lines.push('Недавние эмоциональные сигналы:');
    for (const signal of recentSignals) {
      lines.push(`• intent=${signal.intent}, emotion=${signal.emotion}${signal.note ? `, note=${signal.note}` : ''}`);
    }
  }

  return lines.join('\n');
}
