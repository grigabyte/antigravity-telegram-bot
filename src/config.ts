export const TELEGRAM_TOKEN = process.env.TELEGRAM_BOT_TOKEN!;
export const ADMIN_USER_ID = process.env.ADMIN_USER_ID ? parseInt(process.env.ADMIN_USER_ID) : null;
export const SUPABASE_URL = process.env.SUPABASE_URL!;
export const SUPABASE_KEY = process.env.SUPABASE_KEY!;

export const TELEGRAM_API_BASE = `https://api.telegram.org/bot${TELEGRAM_TOKEN}`;

export const CLIENT_ID = process.env.ANTIGRAVITY_CLIENT_ID!;
export const CLIENT_SECRET = process.env.ANTIGRAVITY_CLIENT_SECRET!;
export const ANTIGRAVITY_ENDPOINT = 'https://cloudcode-pa.googleapis.com/v1internal:generateContent';
export const GEMINI_MODEL = 'gemini-3-pro-preview';

export const ACCOUNT = {
  email: process.env.ANTIGRAVITY_EMAIL || '',
  refreshToken: process.env.ANTIGRAVITY_REFRESH_TOKEN!,
  projectId: process.env.ANTIGRAVITY_PROJECT_ID!,
};

export const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY || '';
export const ELEVENLABS_VOICE_ID = process.env.ELEVENLABS_VOICE_ID || 'iP95p4xoKVk53GoZ742B';

export const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || '';
export const OPENROUTER_EMBEDDING_MODEL_PRIMARY =
  process.env.OPENROUTER_EMBEDDING_MODEL_PRIMARY || 'qwen/qwen3-embedding-8b';
export const OPENROUTER_EMBEDDING_MODEL_FALLBACK =
  process.env.OPENROUTER_EMBEDDING_MODEL_FALLBACK || 'openai/text-embedding-3-small';
export const OPENROUTER_EMBEDDING_DIM = process.env.OPENROUTER_EMBEDDING_DIM
  ? Number.parseInt(process.env.OPENROUTER_EMBEDDING_DIM, 10)
  : 1024;

export const MEMORY_RETRIEVAL_MODE = (process.env.MEMORY_RETRIEVAL_MODE || 'rag').toLowerCase();
export const SIGNAL_CLASSIFIER_MODE = (process.env.SIGNAL_CLASSIFIER_MODE || 'hybrid').toLowerCase();
export const OUTBOUND_SIGNAL_POLICY_MODE = (process.env.OUTBOUND_SIGNAL_POLICY_MODE || 'llm').toLowerCase();

export const TELEGRAM_REACTION_MIN_INTERVAL_MS = process.env.TELEGRAM_REACTION_MIN_INTERVAL_MS
  ? Number.parseInt(process.env.TELEGRAM_REACTION_MIN_INTERVAL_MS, 10)
  : 30000;
export const TELEGRAM_STICKER_MIN_INTERVAL_MS = process.env.TELEGRAM_STICKER_MIN_INTERVAL_MS
  ? Number.parseInt(process.env.TELEGRAM_STICKER_MIN_INTERVAL_MS, 10)
  : 180000;
export const TELEGRAM_GIF_MIN_INTERVAL_MS = process.env.TELEGRAM_GIF_MIN_INTERVAL_MS
  ? Number.parseInt(process.env.TELEGRAM_GIF_MIN_INTERVAL_MS, 10)
  : 180000;

export const MAX_HISTORY_MESSAGES = 10000;
export const MAX_CONTEXT_MESSAGES = 500;
export const MAX_CONTEXT_TOKENS = 900000;
export const COMPRESS_THRESHOLD = 800000;

export const REQUEST_TIMEOUTS = {
  telegram: 15000,
  supabase: 15000,
  oauth: 15000,
  gemini: 180000,
  embeddings: 25000,
  signalPolicy: 40000,
  urlFetch: 15000,
  fileDownload: 30000,
  tts: 20000,
  youtube: 15000,
};

export const BATCHING = {
  debounceMs: 6000,
  maxBatchWindowMs: 45000,
  pendingLimit: 50,
};
