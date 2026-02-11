import { createHash } from 'crypto';
import {
  OPENROUTER_EMBEDDING_DIM,
  OPENROUTER_API_KEY,
  OPENROUTER_EMBEDDING_MODEL_FALLBACK,
  OPENROUTER_EMBEDDING_MODEL_PRIMARY,
  MEMORY_RETRIEVAL_MODE,
  NODE_ENV,
  REQUEST_TIMEOUTS,
} from '../config.js';
import { fetchWithTimeout } from '../network/fetch.js';

function normalizeVector(vector: number[]): number[] {
  const norm = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
  if (norm === 0) return vector;
  return vector.map((value) => value / norm);
}

function resizeVector(vector: number[], targetDim: number): number[] {
  if (targetDim <= 0) return vector;
  if (vector.length === targetDim) return normalizeVector(vector);

  if (vector.length > targetDim) {
    return normalizeVector(vector.slice(0, targetDim));
  }

  const padded = [...vector];
  while (padded.length < targetDim) {
    padded.push(0);
  }
  return normalizeVector(padded);
}

export function fakeEmbedText(text: string, dims: number = 64): number[] {
  const hash = createHash('sha256').update(text).digest();
  const vector: number[] = [];
  for (let i = 0; i < dims; i++) {
    const a = hash[i % hash.length];
    const b = hash[(i + 7) % hash.length];
    const value = ((a + b) / 510) * 2 - 1;
    vector.push(value);
  }

  return normalizeVector(vector);
}

async function requestOpenRouterEmbedding(model: string, text: string): Promise<number[] | null> {
  if (!OPENROUTER_API_KEY) return null;

  const response = await fetchWithTimeout(
    'https://openrouter.ai/api/v1/embeddings',
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${OPENROUTER_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        input: text,
      }),
    },
    REQUEST_TIMEOUTS.embeddings
  );

  if (!response.ok) {
    const errorText = await response.text();
    console.warn(`OpenRouter embedding failed (${model}):`, errorText.slice(0, 220));
    return null;
  }

  const data = await response.json();
  const embedding = data?.data?.[0]?.embedding;
  if (!Array.isArray(embedding) || embedding.length === 0) {
    return null;
  }

  const asNumbers = embedding
    .map((value: unknown) => Number(value))
    .filter((value: number) => Number.isFinite(value));
  if (asNumbers.length === 0) return null;

  return resizeVector(asNumbers, OPENROUTER_EMBEDDING_DIM);
}

export async function embedText(text: string): Promise<number[]> {
  const trimmed = text.trim();
  if (!trimmed) return fakeEmbedText('empty');

  const primary = await requestOpenRouterEmbedding(OPENROUTER_EMBEDDING_MODEL_PRIMARY, trimmed).catch(() => null);
  if (primary) return primary;

  const fallback = await requestOpenRouterEmbedding(OPENROUTER_EMBEDDING_MODEL_FALLBACK, trimmed).catch(() => null);
  if (fallback) return fallback;

  if (MEMORY_RETRIEVAL_MODE === 'rag' && NODE_ENV === 'production') {
    throw new Error('EMBEDDINGS_UNAVAILABLE');
  }

  return resizeVector(fakeEmbedText(trimmed, OPENROUTER_EMBEDDING_DIM), OPENROUTER_EMBEDDING_DIM);
}
