/**
 * Neuro Copilot Bot v8.3
 * - Supabase PostgreSQL storage (1M+ tokens)
 * - Smart auto-compression (summarizes old messages)
 * - Extended output (65536 tokens max)
 * - Voice/Video/Audio transcription (Gemini native)
 * - Web search with /sources command
 * - YouTube metadata parsing
 * - URL parsing
 * - Image/file/video/audio analysis
 * - Text documents (.txt, .md, .docx)
 * - Export/Import memory
 * - Long-term memory (facts, preferences, goals)
 * - Auto-extraction of user info
 * - Reply keyboard with commands
 * - Confirmation before clear
 * - Token usage statistics
 * - Better error handling
 * - Emoji support
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';

// ============ CONFIG ============
const TELEGRAM_TOKEN = process.env.TELEGRAM_BOT_TOKEN!;
const ADMIN_USER_ID = process.env.ADMIN_USER_ID ? parseInt(process.env.ADMIN_USER_ID) : null;
const SUPABASE_URL = process.env.SUPABASE_URL!;
const SUPABASE_KEY = process.env.SUPABASE_KEY!;

// Antigravity OAuth (set via environment variables)
const CLIENT_ID = process.env.GOOGLE_CLIENT_ID!;
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET!;

// Antigravity API
const ANTIGRAVITY_ENDPOINT = 'https://cloudcode-pa.googleapis.com/v1internal:generateContent';
const GEMINI_MODEL = 'gemini-3-pro-preview';

// Account (set via environment variables)
const ACCOUNT = {
  email: process.env.GOOGLE_EMAIL || '',
  refreshToken: process.env.GOOGLE_REFRESH_TOKEN!,
  projectId: process.env.GOOGLE_PROJECT_ID!
};

// ElevenLabs TTS (optional)
const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY || '';
const ELEVENLABS_VOICE_ID = process.env.ELEVENLABS_VOICE_ID || 'iP95p4xoKVk53GoZ742B';

// Memory limits - now much higher with Supabase!
const MAX_HISTORY_MESSAGES = 10000; // Practically unlimited
const MAX_CONTEXT_TOKENS = 900000; // 900K tokens (Gemini has 1M+)
const COMPRESS_THRESHOLD = 800000; // Start compressing at 800K

// ============ TYPES ============
interface GeminiMessage {
  role: 'user' | 'model';
  parts: Part[];
}

interface Part {
  text?: string;
  inlineData?: { mimeType: string; data: string };
}

interface ChatMessage {
  role: 'user' | 'model';
  content: string;
  timestamp: number;
}

interface TelegramUpdate {
  message?: {
    message_id: number;
    from: { id: number; first_name: string };
    chat: { id: number; type: string };
    text?: string;
    caption?: string;
    photo?: { file_id: string }[];
    voice?: { file_id: string; duration: number };
    audio?: { file_id: string; duration: number; mime_type?: string };
    video?: { file_id: string; duration: number; mime_type?: string };
    video_note?: { file_id: string };
    document?: { file_id: string; file_name?: string; mime_type?: string };
    date: number;
  };
  callback_query?: {
    id: string;
    from: { id: number };
    message?: { chat: { id: number }; message_id: number };
    data?: string;
  };
}

interface GeminiResponse {
  response?: {
    candidates?: Array<{
      content?: {
        parts?: Array<{
          text?: string;
          thoughtSignature?: boolean;
        }>;
      };
      groundingMetadata?: {
        groundingChunks?: Array<{
          web?: {
            uri?: string;
            title?: string;
          };
        }>;
        webSearchQueries?: string[];
      };
    }>;
  };
}

// ============ ERROR MESSAGES ============
const ERROR_MESSAGES: Record<string, string> = {
  'RATE_LIMIT': '⏳ Квота API исчерпана. Попробуй через несколько минут.',
  'TOKEN_EXPIRED': '🔑 Токен авторизации истёк. Требуется обновление.',
  'NETWORK_ERROR': '🌐 Проблема с сетью. Проверь подключение.',
  'FILE_TOO_LARGE': '📁 Файл слишком большой (макс. 20 МБ).',
  'UNSUPPORTED_FORMAT': '📄 Формат файла не поддерживается.',
  'TIMEOUT': '⏱️ Запрос занял слишком много времени.',
  'UNKNOWN': '❌ Произошла ошибка. Попробуй ещё раз.',
};

function formatError(error: any): string {
  const message = error.message || '';
  
  if (message.includes('RATE_LIMIT') || message.includes('429')) {
    return ERROR_MESSAGES['RATE_LIMIT'];
  }
  if (message.includes('token') || message.includes('401')) {
    return ERROR_MESSAGES['TOKEN_EXPIRED'];
  }
  if (message.includes('fetch') || message.includes('network')) {
    return ERROR_MESSAGES['NETWORK_ERROR'];
  }
  if (message.includes('timeout') || message.includes('TIMEOUT')) {
    return ERROR_MESSAGES['TIMEOUT'];
  }
  if (message.includes('too large') || message.includes('size')) {
    return ERROR_MESSAGES['FILE_TOO_LARGE'];
  }
  
  // For development - show actual error
  return `❌ Ошибка: ${message.substring(0, 200)}`;
}

// ============ SUPABASE ============
async function supabaseQuery(table: string, method: string, body?: any, query?: string): Promise<any> {
  const url = `${SUPABASE_URL}/rest/v1/${table}${query || ''}`;
  const headers: Record<string, string> = {
    'apikey': SUPABASE_KEY,
    'Authorization': `Bearer ${SUPABASE_KEY}`,
    'Content-Type': 'application/json',
    'Prefer': method === 'POST' ? 'return=representation' : 'return=minimal',
  };
  
  const response = await fetch(url, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  
  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Supabase error: ${error}`);
  }
  
  const text = await response.text();
  return text ? JSON.parse(text) : null;
}

// Chat history functions
async function getHistory(userId: number): Promise<ChatMessage[]> {
  const data = await supabaseQuery('chat_history', 'GET', null, 
    `?user_id=eq.${userId}&order=timestamp.asc&limit=${MAX_HISTORY_MESSAGES}`);
  return (data || []).map((row: any) => ({
    role: row.role as 'user' | 'model',
    content: row.content,
    timestamp: row.timestamp,
  }));
}

async function addToHistory(userId: number, msg: ChatMessage): Promise<void> {
  await supabaseQuery('chat_history', 'POST', {
    user_id: userId,
    role: msg.role,
    content: msg.content,
    timestamp: msg.timestamp,
  });
}

async function clearHistory(userId: number): Promise<void> {
  await supabaseQuery('chat_history', 'DELETE', null, `?user_id=eq.${userId}`);
}

// User settings functions
async function getUserSettings(userId: number): Promise<{ insights: string }> {
  const data = await supabaseQuery('user_settings', 'GET', null, `?user_id=eq.${userId}`);
  if (data && data.length > 0) {
    return { insights: data[0].insights || '' };
  }
  return { insights: '' };
}

async function saveUserSettings(userId: number, insights: string): Promise<void> {
  // Upsert
  await supabaseQuery('user_settings', 'POST', {
    user_id: userId,
    insights,
    updated_at: new Date().toISOString(),
  }, '?on_conflict=user_id');
}

// Long-term memory functions
async function getLongTermMemory(userId: number): Promise<LongTermMemory> {
  const data = await supabaseQuery('long_term_memory', 'GET', null, 
    `?user_id=eq.${userId}&order=created_at.asc`);
  
  const memory: LongTermMemory = {
    facts: [],
    preferences: [],
    goals: [],
    updatedAt: Date.now(),
  };
  
  for (const row of (data || [])) {
    if (row.type === 'fact') memory.facts.push(row.content);
    else if (row.type === 'preference') memory.preferences.push(row.content);
    else if (row.type === 'goal') memory.goals.push(row.content);
  }
  
  return memory;
}

async function addMemoryItem(userId: number, type: 'fact' | 'preference' | 'goal', content: string): Promise<void> {
  // Check for duplicates
  const existing = await supabaseQuery('long_term_memory', 'GET', null,
    `?user_id=eq.${userId}&type=eq.${type}&content=eq.${encodeURIComponent(content)}`);
  
  if (existing && existing.length > 0) return; // Already exists
  
  await supabaseQuery('long_term_memory', 'POST', {
    user_id: userId,
    type,
    content,
  });
}

async function clearLongTermMemory(userId: number): Promise<void> {
  await supabaseQuery('long_term_memory', 'DELETE', null, `?user_id=eq.${userId}`);
}

// Last sources functions
async function saveLastSources(userId: number, sources: Array<{ title: string; url: string }>): Promise<void> {
  await supabaseQuery('last_sources', 'POST', {
    user_id: userId,
    sources: JSON.stringify(sources),
    updated_at: new Date().toISOString(),
  }, '?on_conflict=user_id');
}

async function getLastSources(userId: number): Promise<Array<{ title: string; url: string }>> {
  const data = await supabaseQuery('last_sources', 'GET', null, `?user_id=eq.${userId}`);
  if (data && data.length > 0) {
    try {
      return JSON.parse(data[0].sources) || [];
    } catch {
      return [];
    }
  }
  return [];
}

// ============ OAUTH ============
async function getAccessToken(): Promise<string> {
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      refresh_token: ACCOUNT.refreshToken,
      grant_type: 'refresh_token',
    }),
  });

  if (!response.ok) {
    throw new Error(`TOKEN_EXPIRED: ${await response.text()}`);
  }

  const data = await response.json();
  return data.access_token;
}

// ============ URL & YOUTUBE PARSING ============
function extractUrls(text: string): string[] {
  const urlRegex = /https?:\/\/[^\s<>"{}|\\^`\[\]]+/gi;
  return text.match(urlRegex) || [];
}

function isYouTubeUrl(url: string): boolean {
  return url.includes('youtube.com/watch') || 
         url.includes('youtu.be/') || 
         url.includes('youtube.com/shorts/');
}

function extractYouTubeVideoId(url: string): string | null {
  const patterns = [
    /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/shorts\/)([a-zA-Z0-9_-]{11})/,
  ];
  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match) return match[1];
  }
  return null;
}

async function fetchYouTubeMetadata(url: string): Promise<string> {
  const videoId = extractYouTubeVideoId(url);
  if (!videoId) {
    return `[YouTube: не удалось извлечь ID видео из ${url}]`;
  }
  
  try {
    // Use oEmbed API (no API key needed)
    const oembedUrl = `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`;
    const response = await fetch(oembedUrl);
    
    if (!response.ok) {
      return `[YouTube видео: ${url}]`;
    }
    
    const data = await response.json();
    return `[YouTube видео: "${data.title}" от ${data.author_name}]\nСсылка: ${url}`;
  } catch {
    return `[YouTube видео: ${url}]`;
  }
}

async function fetchUrlContent(url: string): Promise<string> {
  // Handle YouTube separately
  if (isYouTubeUrl(url)) {
    return fetchYouTubeMetadata(url);
  }
  
  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; NeuroCopilotBot/1.0)',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
      redirect: 'follow',
    });
    
    if (!response.ok) {
      return `[Не удалось загрузить ${url}: ${response.status}]`;
    }
    
    const contentType = response.headers.get('content-type') || '';
    if (!contentType.includes('text/html') && !contentType.includes('text/plain')) {
      return `[${url} — не текстовый контент: ${contentType}]`;
    }
    
    const html = await response.text();
    
    // Simple HTML to text conversion
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
    
    // Limit content length
    if (text.length > 15000) {
      text = text.substring(0, 15000) + '... [обрезано]';
    }
    
    return `[Содержимое ${url}]:\n${text}`;
  } catch (error: any) {
    return `[Ошибка загрузки ${url}: ${error.message}]`;
  }
}

// ============ TEXT DOCUMENT PARSING ============
async function parseTextDocument(buffer: ArrayBuffer, mimeType: string, fileName: string): Promise<string> {
  const decoder = new TextDecoder('utf-8');
  
  // Plain text files
  if (mimeType === 'text/plain' || 
      mimeType === 'text/markdown' || 
      fileName.endsWith('.txt') || 
      fileName.endsWith('.md')) {
    return decoder.decode(buffer);
  }
  
  // DOCX files - extract text from XML
  if (mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
      fileName.endsWith('.docx')) {
    try {
      const content = decoder.decode(buffer);
      const textMatches = content.match(/<w:t[^>]*>([^<]+)<\/w:t>/g) || [];
      const extractedText = textMatches
        .map(match => match.replace(/<[^>]+>/g, ''))
        .join(' ');
      
      if (extractedText.length > 100) {
        return extractedText;
      }
      
      return content.replace(/[^\x20-\x7E\u0400-\u04FF\n]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .substring(0, 10000);
    } catch {
      return '[Не удалось распарсить DOCX файл]';
    }
  }
  
  return '[Неподдерживаемый формат документа]';
}

// ============ GEMINI 3 PRO ============
interface CallGeminiOptions {
  messages: GeminiMessage[];
  systemPrompt?: string;
  forceSearch?: boolean;
}

interface GeminiResult {
  text: string;
  sources?: Array<{ title: string; url: string }>;
}

async function callGemini(options: CallGeminiOptions): Promise<GeminiResult> {
  const { messages, systemPrompt, forceSearch } = options;
  
  const maxRetries = 3;
  let lastError: Error | null = null;
  
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const accessToken = await getAccessToken();

      const requestPayload: any = {
        contents: messages,
        generationConfig: {
          temperature: 0.9,
          maxOutputTokens: 65536,
        },
        tools: [{
          googleSearch: {}
        }],
      };

      let finalSystemPrompt = systemPrompt || '';
      if (forceSearch) {
        finalSystemPrompt += '\n\nВАЖНО: Обязательно используй Google Search для ответа на этот запрос.';
      }

      if (finalSystemPrompt) {
        requestPayload.systemInstruction = {
          role: 'user',
          parts: [{ text: finalSystemPrompt }]
        };
      }

      const response = await fetch(ANTIGRAVITY_ENDPOINT, {
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
      });

      if (!response.ok) {
        const error = await response.text();
        if (response.status === 429) {
          // Rate limit - wait and retry
          const waitTime = Math.pow(2, attempt) * 5000; // 5s, 10s, 20s
          console.log(`Rate limit hit, waiting ${waitTime/1000}s before retry ${attempt + 1}/${maxRetries}`);
          await new Promise(resolve => setTimeout(resolve, waitTime));
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
          if (!sources.some(s => s.url === chunk.web!.uri)) {
            sources.push({
              title: chunk.web.title,
              url: chunk.web.uri
            });
          }
        }
      }
      
      return {
        text: textPart?.text || 'Нет ответа',
        sources: sources.length > 0 ? sources.slice(0, 5) : undefined
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


// ============ MEMORY HELPERS ============
// Legacy interface for compatibility
interface LongTermMemory {
  facts: string[];
  preferences: string[];
  goals: string[];
  updatedAt: number;
}

async function addFact(userId: number, fact: string): Promise<void> {
  await addMemoryItem(userId, 'fact', fact);
}

async function addPreference(userId: number, pref: string): Promise<void> {
  await addMemoryItem(userId, 'preference', pref);
}

async function addGoal(userId: number, goal: string): Promise<void> {
  await addMemoryItem(userId, 'goal', goal);
}

async function exportMemory(userId: number): Promise<{ history: ChatMessage[]; insights: string; memory: LongTermMemory }> {
  const history = await getHistory(userId);
  const settings = await getUserSettings(userId);
  const memory = await getLongTermMemory(userId);
  return { history, insights: settings.insights, memory };
}

async function importMemory(userId: number, data: { history?: ChatMessage[]; insights?: string; memory?: LongTermMemory }): Promise<void> {
  if (data.history) {
    await clearHistory(userId);
    for (const msg of data.history.slice(-MAX_HISTORY_MESSAGES)) {
      await addToHistory(userId, msg);
    }
  }
  if (data.insights) {
    await saveUserSettings(userId, data.insights);
  }
  if (data.memory) {
    await clearLongTermMemory(userId);
    for (const fact of data.memory.facts) await addFact(userId, fact);
    for (const pref of data.memory.preferences) await addPreference(userId, pref);
    for (const goal of data.memory.goals) await addGoal(userId, goal);
  }
}

// Approximate token count (rough estimation: 1 token ≈ 4 chars for Russian)
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 3.5);
}

// ============ SMART CONTEXT COMPRESSION ============
// Saves chat summary to database
async function saveChatSummary(userId: number, summary: string, messagesCompressed: number): Promise<void> {
  await supabaseQuery('chat_summaries', 'POST', {
    user_id: userId,
    summary,
    messages_compressed: messagesCompressed,
    created_at: new Date().toISOString(),
  });
}

// Gets all chat summaries for user
async function getChatSummaries(userId: number): Promise<string[]> {
  const data = await supabaseQuery('chat_summaries', 'GET', null,
    `?user_id=eq.${userId}&order=created_at.asc`);
  return (data || []).map((row: any) => row.summary);
}

// Clears chat summaries for user
async function clearChatSummaries(userId: number): Promise<void> {
  await supabaseQuery('chat_summaries', 'DELETE', null, `?user_id=eq.${userId}`);
}

// Compresses old messages into a summary using Gemini + extracts facts
interface CompressionResult {
  summary: string;
  facts: string[];
  preferences: string[];
  goals: string[];
}

async function compressOldMessages(userId: number, messages: ChatMessage[]): Promise<CompressionResult> {
  const compressCount = Math.floor(messages.length * 0.7);
  const toCompress = messages.slice(0, compressCount);
  
  const conversationText = toCompress.map(m => 
    `${m.role === 'user' ? 'Пользователь' : 'Нейро'}: ${m.content}`
  ).join('\n\n');
  
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
    
    const response = await fetch(ANTIGRAVITY_ENDPOINT, {
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
    });
    
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
    const fallback = toCompress.slice(0, 5).map(m => 
      `${m.role === 'user' ? 'U' : 'N'}: ${m.content.substring(0, 200)}`
    ).join('\n');
    return { 
      summary: `[Сжатый контекст - ${compressCount} сообщений]\n${fallback}`,
      facts: [],
      preferences: [],
      goals: []
    };
  }
}

// Main compression function - called when context exceeds threshold
async function maybeCompressContext(userId: number): Promise<{ compressed: boolean; tokensFreed: number; factsExtracted: number }> {
  const history = await getHistory(userId);
  const historyText = history.map(m => m.content).join(' ');
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
  for (const msg of oldMessages) {
    await supabaseQuery('chat_history', 'DELETE', null,
      `?user_id=eq.${userId}&timestamp=eq.${msg.timestamp}`);
  }
  
  await supabaseQuery('chat_history', 'POST', {
    user_id: userId,
    role: 'model',
    content: `[📚 Сжатый контекст предыдущих ${compressCount} сообщений]\n\n${result.summary}`,
    timestamp: Date.now() - 1000000000,
  });
  
  const newHistoryText = history.slice(compressCount).map(m => m.content).join(' ') + result.summary;
  const newTokens = estimateTokens(newHistoryText);
  const tokensFreed = currentTokens - newTokens;
  
  console.log(`Compression done: freed ${tokensFreed} tokens, extracted ${factsExtracted} memory items`);
  
  return { compressed: true, tokensFreed, factsExtracted };
}

async function getContextStats(userId: number): Promise<{ tokens: number; percent: number; historyTokens: number; insightsTokens: number; systemTokens: number; messageCount: number }> {
  const history = await getHistory(userId);
  const settings = await getUserSettings(userId);
  const systemPrompt = await buildSystemPrompt(userId);
  
  const historyText = history.map(m => m.content).join(' ');
  const historyTokens = estimateTokens(historyText);
  const insightsTokens = estimateTokens(settings.insights);
  const systemTokens = estimateTokens(systemPrompt);
  
  const totalTokens = historyTokens + systemTokens;
  const percent = Math.min(100, Math.round((totalTokens / MAX_CONTEXT_TOKENS) * 100));
  
  return { tokens: totalTokens, percent, historyTokens, insightsTokens, systemTokens, messageCount: history.length };
}

async function buildSystemPrompt(userId: number): Promise<string> {
  const settings = await getUserSettings(userId);
  const longTermMemory = await getLongTermMemory(userId);
  
  const base = `Ты — персональный AI-помощник и второй пилот по имени Нейро.
Ты помогаешь с рефлексией, жизненными вопросами, принятием решений и личностным развитием.

Твой стиль:
- Эмпатичный, но честный — если идея плохая, скажи прямо, но конструктивно
- Задаёшь уточняющие вопросы когда нужно
- Помнишь контекст предыдущих разговоров
- Даёшь конкретные, применимые советы
- Общаешься на русском языке
- Используй эмодзи где уместно

ФОРМАТИРОВАНИЕ (HTML для Telegram):
- <b>жирный</b> для важных терминов
- <i>курсив</i> для выделения
- <code>код</code> для технических терминов
- НЕ используй markdown (**, *, _, __, #, \`\`\`)
- Нумерованные списки: 1. 2. 3.
- Маркированные списки: • или -

ГОЛОСОВЫЕ И ВИДЕО СООБЩЕНИЯ:
- Когда получаешь голосовое/видео сообщение, НИКОГДА не пиши заголовки: "Расшифровка видеосообщения:", "Ответ:", "Анализ:" и т.п.
- НИКОГДА не цитируй речь пользователя перед ответом
- Сразу отвечай на содержимое, как будто человек сказал тебе это лично вживую
- Веди себя максимально естественно, как в живом разговоре

ПОИСК В ИНТЕРНЕТЕ:
- У тебя есть доступ к Google Search
- Используй его автоматически когда нужна актуальная информация
- Используй для новостей, цен, курсов, погоды, событий
- НЕ добавляй сноски или ссылки в текст ответа
- Источники сохраняются автоматически, пользователь может их посмотреть командой /sources

Ты умеешь анализировать:
- Голосовые и видео сообщения (расшифровка)
- Изображения и PDF
- Текстовые файлы (txt, md, docx)
- Аудиофайлы (mp3, wav, flac, m4a)
- Ссылки на YouTube (название и автор)
- Любые URL (содержимое страниц)

ИЗВЛЕЧЕНИЕ ПАМЯТИ:
Когда пользователь сообщает важную информацию о себе, в конце ответа добавь блок:
<memory>
FACT: краткий факт о пользователе
PREF: предпочтение пользователя  
GOAL: цель пользователя
</memory>
Добавляй только если есть реально важная новая информация. Не добавляй блок если нечего запомнить.`;

  let contextParts: string[] = [];
  
  // Add insights
  if (settings.insights) {
    contextParts.push(`Контекст от пользователя:\n${settings.insights}`);
  }
  
  // Add long-term memory
  if (longTermMemory.facts.length > 0) {
    contextParts.push(`Известные факты:\n• ${longTermMemory.facts.join('\n• ')}`);
  }
  if (longTermMemory.preferences.length > 0) {
    contextParts.push(`Предпочтения:\n• ${longTermMemory.preferences.join('\n• ')}`);
  }
  if (longTermMemory.goals.length > 0) {
    contextParts.push(`Цели:\n• ${longTermMemory.goals.join('\n• ')}`);
  }
  
  if (contextParts.length > 0) {
    return `${base}\n\n=== ПАМЯТЬ О ПОЛЬЗОВАТЕЛЕ ===\n${contextParts.join('\n\n')}\n=== КОНЕЦ ПАМЯТИ ===`;
  }
  
  return base;
}

// ============ TELEGRAM ============
function convertToTelegramHtml(text: string): string {
  let result = text;
  
  result = result.replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>');
  result = result.replace(/\*([^*]+)\*/g, '<b>$1</b>');
  result = result.replace(/__([^_]+)__/g, '<i>$1</i>');
  result = result.replace(/_([^_]+)_/g, '<i>$1</i>');
  result = result.replace(/`([^`]+)`/g, '<code>$1</code>');
  result = result.replace(/```(\w*)\n?([\s\S]*?)```/g, '<pre>$2</pre>');
  result = result.replace(/^#{1,6}\s+/gm, '');
  result = result.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1 ($2)');
  
  return result;
}

function getReplyKeyboard() {
  return {
    keyboard: [
      [{ text: '🔍 Поиск' }, { text: '📊 Статистика' }],
      [{ text: '💾 Экспорт' }, { text: '🗑️ Очистить' }],
    ],
    resize_keyboard: true,
    is_persistent: false,
  };
}

function getConfirmClearKeyboard() {
  return {
    inline_keyboard: [
      [
        { text: '✅ Да, очистить', callback_data: 'clear_confirm' },
        { text: '❌ Отмена', callback_data: 'clear_cancel' },
      ],
    ],
  };
}

async function sendTelegram(chatId: number, text: string, replyTo?: number, showKeyboard: boolean = false, inlineKeyboard?: any): Promise<void> {
  const formattedText = convertToTelegramHtml(text);
  const maxLen = 4000;
  
  for (let i = 0; i < formattedText.length; i += maxLen) {
    const chunk = formattedText.substring(i, i + maxLen);
    const isLastChunk = i + maxLen >= formattedText.length;
    
    const body: any = {
      chat_id: chatId,
      text: chunk,
      parse_mode: 'HTML',
      reply_to_message_id: i === 0 ? replyTo : undefined,
    };
    
    if (isLastChunk) {
      if (inlineKeyboard) {
        body.reply_markup = inlineKeyboard;
      } else if (showKeyboard) {
        body.reply_markup = getReplyKeyboard();
      }
    }
    
    const response = await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    
    if (!response.ok) {
      const plainText = chunk.replace(/<[^>]+>/g, '');
      const fallbackBody: any = {
        chat_id: chatId,
        text: plainText,
        reply_to_message_id: i === 0 ? replyTo : undefined,
      };
      if (isLastChunk) {
        if (inlineKeyboard) {
          fallbackBody.reply_markup = inlineKeyboard;
        } else if (showKeyboard) {
          fallbackBody.reply_markup = getReplyKeyboard();
        }
      }
      await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(fallbackBody),
      });
    }
  }
}

async function answerCallback(callbackId: string, text?: string): Promise<void> {
  await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/answerCallbackQuery`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ callback_query_id: callbackId, text }),
  });
}

async function editMessage(chatId: number, messageId: number, text: string): Promise<void> {
  await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/editMessageText`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      message_id: messageId,
      text,
      parse_mode: 'HTML',
    }),
  });
}

async function textToSpeech(text: string): Promise<Buffer | null> {
  try {
    const cleanText = text.replace(/<[^>]*>/g, '').slice(0, 5000);
    
    const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${ELEVENLABS_VOICE_ID}`, {
      method: 'POST',
      headers: {
        'xi-api-key': ELEVENLABS_API_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        text: cleanText,
        model_id: 'eleven_multilingual_v2',
        voice_settings: {
          stability: 0.6,
          similarity_boost: 0.8,
          style: 0.15,
          use_speaker_boost: true
        }
      }),
    });

    if (!response.ok) {
      console.error('ElevenLabs error:', response.status);
      return null;
    }

    const arrayBuffer = await response.arrayBuffer();
    return Buffer.from(arrayBuffer);
  } catch (e) {
    console.error('TTS error:', e);
    return null;
  }
}

async function sendVoice(chatId: number, audioBuffer: Buffer, replyToMessageId?: number): Promise<void> {
  const formData = new FormData();
  formData.append('chat_id', chatId.toString());
  formData.append('voice', new Blob([new Uint8Array(audioBuffer)], { type: 'audio/mpeg' }), 'voice.mp3');
  if (replyToMessageId) {
    formData.append('reply_to_message_id', replyToMessageId.toString());
  }

  await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendVoice`, {
    method: 'POST',
    body: formData,
  });
}


async function sendDocument(chatId: number, content: string, fileName: string, caption?: string): Promise<void> {
  const blob = new Blob([content], { type: 'application/json' });
  const formData = new FormData();
  formData.append('chat_id', chatId.toString());
  formData.append('document', blob, fileName);
  if (caption) {
    formData.append('caption', caption);
  }
  
  await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendDocument`, {
    method: 'POST',
    body: formData,
  });
}

async function sendTyping(chatId: number): Promise<void> {
  await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendChatAction`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, action: 'typing' }),
  });
}

function startTypingLoop(chatId: number): NodeJS.Timeout {
  sendTyping(chatId);
  return setInterval(() => sendTyping(chatId), 4000);
}

async function downloadFile(fileId: string, suggestedMimeType?: string): Promise<{ data: string; mimeType: string; buffer: ArrayBuffer; fileName?: string }> {
  const fileRes = await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/getFile?file_id=${fileId}`);
  const fileData = await fileRes.json();
  const filePath = fileData.result.file_path;
  const fileUrl = `https://api.telegram.org/file/bot${TELEGRAM_TOKEN}/${filePath}`;
  const response = await fetch(fileUrl);
  const buffer = await response.arrayBuffer();
  
  let mimeType = suggestedMimeType || 'application/octet-stream';
  
  if (!suggestedMimeType || suggestedMimeType === 'application/octet-stream') {
    const ext = filePath.split('.').pop()?.toLowerCase();
    const mimeMap: Record<string, string> = {
      'ogg': 'audio/ogg', 'oga': 'audio/ogg',
      'mp3': 'audio/mpeg',
      'wav': 'audio/wav',
      'flac': 'audio/flac',
      'm4a': 'audio/mp4',
      'aac': 'audio/aac',
      'png': 'image/png',
      'jpg': 'image/jpeg', 'jpeg': 'image/jpeg',
      'gif': 'image/gif',
      'webp': 'image/webp',
      'mp4': 'video/mp4',
      'webm': 'video/webm',
      'mov': 'video/quicktime',
      'pdf': 'application/pdf',
      'txt': 'text/plain',
      'md': 'text/markdown',
      'docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    };
    if (ext && mimeMap[ext]) {
      mimeType = mimeMap[ext];
    }
  }
  
  return {
    data: Buffer.from(buffer).toString('base64'),
    mimeType,
    buffer,
    fileName: filePath.split('/').pop(),
  };
}

// ============ MAIN HANDLER ============
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === 'GET') {
    return res.status(200).json({ 
      status: 'ok', 
      bot: 'neuro-copilot', 
      version: '8.3',
      model: GEMINI_MODEL,
      maxOutputTokens: 65536,
      features: ['voice', 'video', 'audio', 'search', 'youtube', 'sources', 'urls', 'images', 'documents', 'export', 'keyboard', 'emoji', 'long-term-memory', 'auto-extract', 'supabase', 'auto-compression']
    });
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const update: TelegramUpdate = req.body;
  
  // Handle callback queries (inline buttons)
  if (update.callback_query) {
    const cb = update.callback_query;
    const chatId = cb.message?.chat.id;
    const messageId = cb.message?.message_id;
    const cbUserId = cb.from.id;
    
    if (cb.data === 'clear_confirm' && chatId && messageId) {
      await clearHistory(cbUserId);
      await clearChatSummaries(cbUserId);
      await editMessage(chatId, messageId, '🗑️ История очищена!');
      await answerCallback(cb.id, 'Готово!');
    } else if (cb.data === 'clear_cancel' && chatId && messageId) {
      await editMessage(chatId, messageId, '❌ Очистка отменена.');
      await answerCallback(cb.id);
    } else if (cb.data?.startsWith('tts:') && chatId) {
      await answerCallback(cb.id, '🔊 Генерирую аудио...');
      const history = await getHistory(cbUserId);
      const lastModelMessage = [...history].reverse().find(m => m.role === 'model');
      if (lastModelMessage) {
        const audioBuffer = await textToSpeech(lastModelMessage.content);
        if (audioBuffer) {
          await sendVoice(chatId, audioBuffer);
        } else {
          await sendTelegram(chatId, '❌ Не удалось сгенерировать аудио. Попробуй позже.');
        }
      }
    } else {
      await answerCallback(cb.id);
    }
    return res.status(200).json({ ok: true });
  }
  
  if (!update.message) return res.status(200).json({ ok: true });

  const { message } = update;
  const chatId = message.chat.id;
  const userId = message.from.id;
  let text = message.text || message.caption || '';
  
  const hasPhoto = !!message.photo;
  const hasVoice = !!message.voice;
  const hasAudio = !!message.audio;
  const hasVideo = !!message.video;
  const hasVideoNote = !!message.video_note;
  const hasDocument = !!message.document;

  // Admin check
  if (ADMIN_USER_ID !== null && userId !== ADMIN_USER_ID) {
    await sendTelegram(chatId, 'Извини, этот бот приватный.');
    return res.status(200).json({ ok: true });
  }

  if (!text && !hasPhoto && !hasVoice && !hasAudio && !hasVideo && !hasVideoNote && !hasDocument) {
    return res.status(200).json({ ok: true });
  }

  let typingInterval: NodeJS.Timeout | null = null;

  try {
    // ===== KEYBOARD BUTTON HANDLERS =====
    if (text === '🔍 Поиск') {
      await sendTelegram(chatId, '🔍 Напиши запрос для поиска:\n<code>/search твой запрос</code>\n\nИли просто задай вопрос — я сам решу, нужен ли поиск.', undefined, true);
      return res.status(200).json({ ok: true });
    }
    
    if (text === '📊 Статистика') {
      text = '/stats';
    }
    
    if (text === '💾 Экспорт') {
      text = '/export';
    }
    
    if (text === '🗑️ Очистить') {
      text = '/clear';
    }

    // ===== COMMANDS =====
    if (text === '/start') {
      await sendTelegram(chatId, `<b>Команды:</b>
/stats — статистика и контекст
/memory — долгосрочная память
/sources — источники последнего ответа
/search — поиск в интернете
/export — экспорт данных
/insights — установить контекст о себе
/clear — очистить историю

<b>Память:</b>
/fact — добавить факт
/pref — добавить предпочтение
/goal — добавить цель`, undefined, true);
      return res.status(200).json({ ok: true });
    }

    if (text === '/stats') {
      const history = await getHistory(userId);
      const settings = await getUserSettings(userId);
      const longTermMemory = await getLongTermMemory(userId);
      const contextStats = await getContextStats(userId);
      const summaries = await getChatSummaries(userId);
      const userMsgs = history.filter(m => m.role === 'user').length;
      const botMsgs = history.filter(m => m.role === 'model').length;
      
      const historyJson = JSON.stringify(history);
      const historySizeKB = Math.round(historyJson.length / 1024);
      
      const progressBar = '█'.repeat(Math.round(contextStats.percent / 10)) + '░'.repeat(10 - Math.round(contextStats.percent / 10));
      
      await sendTelegram(chatId, `📊 Статистика:

• Сообщений: ${history.length} (👤 ${userMsgs} / 🤖 ${botMsgs})
• Объём истории: ~${historySizeKB} KB
• Сжатий: ${summaries.length}

🧠 Память:
• Факты: ${longTermMemory.facts.length}
• Предпочтения: ${longTermMemory.preferences.length}
• Цели: ${longTermMemory.goals.length}
• Контекст: ${settings.insights.length > 0 ? 'задан' : 'не задан'}

📈 Контекст:
${progressBar} ${contextStats.percent}%
~${contextStats.tokens.toLocaleString()} токенов из ~${(MAX_CONTEXT_TOKENS / 1000).toFixed(0)}K

• v8.2-image`, undefined, true);
      return res.status(200).json({ ok: true });
    }

    if (text === '/memory') {
      const memory = await getLongTermMemory(userId);
      let response = '<b>🧠 Долгосрочная память:</b>\n\n';
      
      if (memory.facts.length > 0) {
        response += '<b>Факты:</b>\n';
        memory.facts.forEach((f, i) => response += `${i + 1}. ${f}\n`);
        response += '\n';
      }
      
      if (memory.preferences.length > 0) {
        response += '<b>Предпочтения:</b>\n';
        memory.preferences.forEach((p, i) => response += `${i + 1}. ${p}\n`);
        response += '\n';
      }
      
      if (memory.goals.length > 0) {
        response += '<b>Цели:</b>\n';
        memory.goals.forEach((g, i) => response += `${i + 1}. ${g}\n`);
        response += '\n';
      }
      
      if (memory.facts.length === 0 && memory.preferences.length === 0 && memory.goals.length === 0) {
        response += 'Пока пусто. Память заполняется автоматически из наших разговоров.\n\nТы также можешь добавить вручную:\n<code>/fact твой факт</code>\n<code>/pref твоё предпочтение</code>\n<code>/goal твоя цель</code>';
      } else {
        response += '\nОчистить: /clearmemory';
      }
      
      await sendTelegram(chatId, response, undefined, true);
      return res.status(200).json({ ok: true });
    }
    
    if (text.startsWith('/fact ')) {
      await addFact(userId, text.replace('/fact ', ''));
      await sendTelegram(chatId, '✅ Факт сохранён в долгосрочную память!', undefined, true);
      return res.status(200).json({ ok: true });
    }
    
    if (text.startsWith('/pref ')) {
      await addPreference(userId, text.replace('/pref ', ''));
      await sendTelegram(chatId, '✅ Предпочтение сохранено!', undefined, true);
      return res.status(200).json({ ok: true });
    }
    
    if (text.startsWith('/goal ')) {
      await addGoal(userId, text.replace('/goal ', ''));
      await sendTelegram(chatId, '✅ Цель сохранена!', undefined, true);
      return res.status(200).json({ ok: true });
    }
    
    if (text === '/clearmemory') {
      await clearLongTermMemory(userId);
      await sendTelegram(chatId, '🗑️ Долгосрочная память очищена!', undefined, true);
      return res.status(200).json({ ok: true });
    }

    if (text === '/clear') {
      const history = await getHistory(userId);
      if (history.length === 0) {
        await sendTelegram(chatId, '📭 История уже пуста!', undefined, true);
        return res.status(200).json({ ok: true });
      }
      await sendTelegram(chatId, `⚠️ Ты уверен, что хочешь очистить историю?\n\nБудет удалено <b>${history.length}</b> сообщений.`, undefined, false, getConfirmClearKeyboard());
      return res.status(200).json({ ok: true });
    }
    
    if (text === '/export') {
      const memory = await exportMemory(userId);
      const json = JSON.stringify(memory, null, 2);
      const date = new Date().toISOString().split('T')[0];
      await sendDocument(chatId, json, `neuro-memory-${date}.json`, '💾 Экспорт памяти. Отправь этот файл боту для восстановления.');
      return res.status(200).json({ ok: true });
    }
    
    if (text === '/import') {
      await sendTelegram(chatId, '📥 Просто отправь JSON файл экспорта — я автоматически его импортирую.', undefined, true);
      return res.status(200).json({ ok: true });
    }

    if (text.startsWith('/insights ')) {
      const insightText = text.replace('/insights ', '');
      await saveUserSettings(userId, insightText);
      await sendTelegram(chatId, `✅ Контекст сохранён!\n\n<i>"${insightText.substring(0, 100)}${insightText.length > 100 ? '...' : ''}"</i>`, undefined, true);
      return res.status(200).json({ ok: true });
    }
    
    if (text === '/insights') {
      const settings = await getUserSettings(userId);
      if (settings.insights) {
        await sendTelegram(chatId, `📝 <b>Текущий контекст:</b>\n\n<i>"${settings.insights}"</i>\n\nЧтобы изменить: <code>/insights новый текст</code>`, undefined, true);
      } else {
        await sendTelegram(chatId, '📝 Контекст не задан.\n\nИспользуй: <code>/insights расскажи о себе</code>', undefined, true);
      }
      return res.status(200).json({ ok: true });
    }
    
    // Handle /sources command
    if (text === '/sources') {
      const sources = await getLastSources(userId);
      if (sources.length === 0) {
        await sendTelegram(chatId, '📚 Источников нет.\n\nИсточники сохраняются когда я использую поиск для ответа.', undefined, true);
      } else {
        let response = '<b>📚 Источники последнего ответа:</b>\n\n';
        sources.forEach((s, i) => {
          response += `${i + 1}. <a href="${s.url}">${s.title}</a>\n`;
        });
        await sendTelegram(chatId, response, undefined, true);
      }
      return res.status(200).json({ ok: true });
    }
    
    // Handle /voice command
    let voiceReply = false;
    if (text.startsWith('/voice ')) {
      text = text.replace('/voice ', '');
      voiceReply = true;
    }
    if (text === '/voice') {
      await sendTelegram(chatId, 'Использование: /voice <вопрос>\n\nИли просто попроси голосовой ответ в сообщении.', undefined, true);
      return res.status(200).json({ ok: true });
    }

    // Handle /search command
    let forceSearch = false;
    if (text.startsWith('/search ')) {
      text = text.replace('/search ', '');
      forceSearch = true;
    }

    // Handle import via document
    if (hasDocument && message.document) {
      const doc = message.document;
      const fileName = doc.file_name || '';
      
      if (fileName.startsWith('neuro-memory-') && fileName.endsWith('.json')) {
        const docData = await downloadFile(doc.file_id, doc.mime_type);
        try {
          const content = Buffer.from(docData.data, 'base64').toString('utf-8');
          const memoryData = JSON.parse(content);
          await importMemory(userId, memoryData);
          await sendTelegram(chatId, `✅ Память импортирована!\n• Сообщений: ${memoryData.history?.length || 0}\n• Контекст: ${memoryData.insights?.length || 0} символов\n• Факты: ${memoryData.memory?.facts?.length || 0}`, undefined, true);
          return res.status(200).json({ ok: true });
        } catch (e) {
          await sendTelegram(chatId, '❌ Ошибка при импорте. Проверь формат файла.', undefined, true);
          return res.status(200).json({ ok: true });
        }
      }
    }

    // Start typing
    typingInterval = startTypingLoop(chatId);

    // ===== BUILD MESSAGE PARTS =====
    const parts: Part[] = [];
    let userTextForHistory = text;

    // Handle voice/audio messages and audio files
    if (hasVoice || hasAudio || hasVideoNote) {
      const fileId = message.voice?.file_id || message.audio?.file_id || message.video_note?.file_id;
      const mimeHint = message.audio?.mime_type;
      if (fileId) {
        const audioData = await downloadFile(fileId, mimeHint);
        parts.push({ 
          inlineData: { 
            mimeType: audioData.mimeType, 
            data: audioData.data 
          } 
        });
        parts.push({ 
          text: text || '[Пользователь отправил голосовое сообщение. Просто ответь на то, что он сказал, без заголовков типа "Расшифровка:" и т.п.]' 
        });
        userTextForHistory = '[Аудио сообщение]' + (text ? `: ${text}` : '');
      }
    }
    // Handle video messages
    else if (hasVideo && message.video) {
      const videoMime = message.video.mime_type || 'video/mp4';
      const videoData = await downloadFile(message.video.file_id, videoMime);
      parts.push({ 
        inlineData: { 
          mimeType: videoData.mimeType, 
          data: videoData.data 
        } 
      });
      parts.push({ text: text || '[Пользователь отправил видео. Просто ответь на содержимое, без заголовков типа "Анализ видео:" и т.п.]' });
      userTextForHistory = '[Видео]' + (text ? `: ${text}` : '');
    }
    // Handle photos
    else if (hasPhoto && message.photo) {
      const photo = message.photo[message.photo.length - 1];
      const imageData = await downloadFile(photo.file_id);
      parts.push({ 
        inlineData: { 
          mimeType: imageData.mimeType, 
          data: imageData.data 
        } 
      });
      parts.push({ text: text || '[Пользователь отправил изображение. Ответь на него естественно.]' });
      userTextForHistory = '[Изображение]' + (text ? `: ${text}` : '');
    }
    // Handle documents
    else if (hasDocument && message.document) {
      const doc = message.document;
      const mimeType = doc.mime_type || '';
      const fileName = doc.file_name || 'document';
      
      // Images and PDFs
      if (mimeType.startsWith('image/') || mimeType === 'application/pdf') {
        const docData = await downloadFile(doc.file_id);
        parts.push({ 
          inlineData: { 
            mimeType: docData.mimeType, 
            data: docData.data 
          } 
        });
        parts.push({ text: text || `Проанализируй этот файл: ${fileName}` });
        userTextForHistory = `[Файл: ${fileName}]` + (text ? `: ${text}` : '');
      }
      // Audio files
      else if (mimeType.startsWith('audio/') || 
               fileName.endsWith('.mp3') || 
               fileName.endsWith('.wav') || 
               fileName.endsWith('.flac') ||
               fileName.endsWith('.m4a') ||
               fileName.endsWith('.ogg')) {
        const audioData = await downloadFile(doc.file_id, mimeType);
        parts.push({ 
          inlineData: { 
            mimeType: audioData.mimeType, 
            data: audioData.data 
          } 
        });
        parts.push({ text: text || `Проанализируй этот аудиофайл: ${fileName}. Расшифруй речь если есть.` });
        userTextForHistory = `[Аудио: ${fileName}]` + (text ? `: ${text}` : '');
      }
      // Text documents
      else if (
        mimeType === 'text/plain' || 
        mimeType === 'text/markdown' ||
        mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
        fileName.endsWith('.txt') || 
        fileName.endsWith('.md') || 
        fileName.endsWith('.docx')
      ) {
        const docData = await downloadFile(doc.file_id, mimeType);
        const textContent = await parseTextDocument(docData.buffer, docData.mimeType, fileName);
        
        const truncatedContent = textContent.length > 20000 
          ? textContent.substring(0, 20000) + '\n\n[...документ обрезан...]' 
          : textContent;
        
        parts.push({ 
          text: `[Содержимое документа "${fileName}"]:\n${truncatedContent}\n\n${text || 'Проанализируй этот документ.'}` 
        });
        userTextForHistory = `[Документ: ${fileName}]` + (text ? `: ${text}` : '');
      }
      else {
        parts.push({ text: text || 'Привет' });
        userTextForHistory = text || 'Привет';
      }
    }
    // Handle text with URLs
    else if (text) {
      const urls = extractUrls(text);
      
      if (urls.length > 0) {
        const urlContents = await Promise.all(urls.slice(0, 3).map(fetchUrlContent));
        const enrichedText = `${text}\n\n${urlContents.join('\n\n')}`;
        parts.push({ text: enrichedText });
      } else {
        parts.push({ text });
      }
    }

    if (parts.length === 0) {
      parts.push({ text: 'Привет' });
    }

    await addToHistory(userId, { role: 'user', content: userTextForHistory, timestamp: Date.now() });

    const history = await getHistory(userId);
    const messages: GeminiMessage[] = history.slice(0, -1).map(m => ({
      role: m.role,
      parts: [{ text: m.content }],
    }));
    messages.push({ role: 'user', parts });

    const systemPrompt = await buildSystemPrompt(userId);
    const result = await callGemini({ 
      messages, 
      systemPrompt,
      forceSearch
    });

    // Extract and save memory from response
    let cleanText = result.text;
    const memoryMatch = result.text.match(/<memory>([\s\S]*?)<\/memory>/i);
    if (memoryMatch) {
      const memoryBlock = memoryMatch[1];
      cleanText = result.text.replace(/<memory>[\s\S]*?<\/memory>/gi, '').trim();
      
      const factMatch = memoryBlock.match(/FACT:\s*(.+)/gi);
      const prefMatch = memoryBlock.match(/PREF:\s*(.+)/gi);
      const goalMatch = memoryBlock.match(/GOAL:\s*(.+)/gi);
      
      if (factMatch) {
        for (const f of factMatch) {
          await addFact(userId, f.replace(/FACT:\s*/i, '').trim());
        }
      }
      if (prefMatch) {
        for (const p of prefMatch) {
          await addPreference(userId, p.replace(/PREF:\s*/i, '').trim());
        }
      }
      if (goalMatch) {
        for (const g of goalMatch) {
          await addGoal(userId, g.replace(/GOAL:\s*/i, '').trim());
        }
      }
    }


    // Save sources to database (instead of inline footnotes)
    if (result.sources && result.sources.length > 0) {
      await saveLastSources(userId, result.sources);
    }

    await addToHistory(userId, { role: 'model', content: cleanText, timestamp: Date.now() });

    // Check if context needs compression
    const compressionResult = await maybeCompressContext(userId);
    
    if (typingInterval) clearInterval(typingInterval);
    
    const ttsButton = {
      inline_keyboard: [[{ text: '🔊 Озвучить', callback_data: 'tts:1' }]]
    };
    
    if (compressionResult.compressed) {
      const memoryNote = compressionResult.factsExtracted > 0 
        ? `, ${compressionResult.factsExtracted} фактов сохранено в память` 
        : '';
      await sendTelegram(chatId, cleanText + `\n\n<i>📚 Контекст сжат (~${Math.round(compressionResult.tokensFreed / 1000)}K токенов освобождено${memoryNote})</i>`, message.message_id, true, ttsButton);
    } else {
      await sendTelegram(chatId, cleanText, message.message_id, true, ttsButton);
    }
    

  } catch (error: any) {
    if (typingInterval) clearInterval(typingInterval);
    console.error('Error:', error);
    await sendTelegram(chatId, formatError(error), undefined, true);
  }

  return res.status(200).json({ ok: true });
}
