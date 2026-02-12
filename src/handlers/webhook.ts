import type { VercelRequest, VercelResponse } from '@vercel/node';
import {
  ADMIN_USER_ID,
  BATCHING,
  GEMINI_MODEL,
  MEMORY_RETRIEVAL_MODE,
  NODE_ENV,
  OUTBOUND_SIGNAL_POLICY_MODE,
  TELEGRAM_WEBHOOK_SECRET,
  MAX_CONTEXT_TOKENS,
  MAX_HISTORY_MESSAGES,
} from '../config.js';
import type { SignalClassification, TelegramUpdate } from '../types.js';
import { callGemini } from '../ai/gemini.js';
import {
  addMemoryItem,
  addToHistory,
  clearInboundEvents,
  clearHistory,
  clearLongTermMemory,
  clearProactiveJobs,
  clearChatSummaries,
  countPendingProactiveJobs,
  getChatSummaries,
  getHistory,
  getLastSources,
  getLongTermMemory,
  getUserSettings,
  isSchemaReady,
  markUpdateProcessed,
  replaceHistorySafely,
  replaceLongTermMemorySafely,
  saveMessageSignal,
  setMemoryPinned,
  setUserQuietHours,
  setUserTimezone,
  saveLastSources,
  saveMetric,
  saveUserSettings,
  isSupabaseMissingRelationError,
} from '../db/supabase.js';
import {
  answerCallback,
  editMessage,
  sendDocument,
  sendTelegram,
  sendVoice,
  startTypingLoop,
  textToSpeech,
} from '../telegram/client.js';
import { downloadFile } from '../telegram/files.js';
import { getConfirmClearKeyboard } from '../telegram/keyboards.js';
import { buildSystemPrompt, getContextStatsFromHistory } from '../memory/context.js';
import { buildContextMessages, maybeCompressContext } from '../memory/compression.js';
import {
  buildInboundBatch,
  enqueueInboundMessageWithText,
  finalizeInboundBatch,
  resolveBatchUpperEventId,
  shouldWaitForBatch,
} from '../telegram/inbound-events.js';
import { applyDynamicReaction } from '../telegram/reactions.js';
import { applyDynamicStickerOrGif } from '../telegram/stickers.js';
import { hasPendingProactiveJob, scheduleProactiveMessage } from '../proactive/scheduler.js';
import { buildTimeContext, normalizeTimezone, parseQuietHours } from '../time/clock.js';
import { classifyReactionSignal, inferOutboundSignal, classifyGifSignal, classifyStickerSignal } from '../semantics/signal-classifier.js';
import { inferOutboundSignalWithLlm } from '../semantics/signal-policy.js';
import type { SignalPolicyDecision } from '../types.js';
import { buildMemoryRagContext, ingestMemoryFromText } from '../memory/rag-memory.js';
import { buildSupabaseMemoryContext } from '../memory/supabase-memory.js';

function getWebhookSecretHeader(req: VercelRequest): string {
  const rawHeader = req.headers['x-telegram-bot-api-secret-token'];
  if (typeof rawHeader === 'string') return rawHeader.trim();
  if (Array.isArray(rawHeader)) return (rawHeader[0] || '').trim();
  return '';
}

function isWebhookAuthorized(req: VercelRequest): boolean {
  const expected = TELEGRAM_WEBHOOK_SECRET.trim();
  if (!expected) {
    return NODE_ENV !== 'production';
  }

  const actual = getWebhookSecretHeader(req);
  return actual === expected;
}

function isAllowedUser(userId: number): boolean {
  if (!Number.isFinite(userId)) return false;
  if (ADMIN_USER_ID === null) return true;
  return userId === ADMIN_USER_ID;
}

function sanitizeForUserError(value: string): string {
  return value
    .replace(/[A-Za-z0-9_-]{20,}/g, '[скрыто]')
    .replace(/https?:\/\/\S+/gi, '[url]');
}

function sanitizeForLog(value: string): string {
  return sanitizeForUserError(value).slice(0, 400);
}

function isSchemaMissingError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  if (error.message.includes('SCHEMA_MISSING:')) return true;
  return isSupabaseMissingRelationError(error);
}

function isDuplicateUpdateError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const message = error.message.toLowerCase();
  return message.includes('duplicate key') || message.includes('23505');
}

function isTemporaryNetworkError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const message = error.message.toLowerCase();
  return message.includes('network') || message.includes('fetch failed') || message.includes('timeout');
}

function formatUserFacingError(error: unknown): string {
  if (!(error instanceof Error)) {
    return ERROR_MESSAGES.UNKNOWN;
  }

  const message = error.message || '';

  if (message.includes('RATE_LIMIT') || message.includes('429')) {
    return ERROR_MESSAGES.RATE_LIMIT;
  }
  if (message.includes('token') || message.includes('401')) {
    return ERROR_MESSAGES.TOKEN_EXPIRED;
  }
  if (isTemporaryNetworkError(error)) {
    return ERROR_MESSAGES.NETWORK_ERROR;
  }
  if (message.includes('timeout') || message.includes('TIMEOUT')) {
    return ERROR_MESSAGES.TIMEOUT;
  }
  if (message.includes('too large') || message.includes('size')) {
    return ERROR_MESSAGES.FILE_TOO_LARGE;
  }
  if (isSchemaMissingError(error)) {
    return '⚠️ База данных не полностью настроена. Запусти SQL-миграции и попробуй снова.';
  }

  return '❌ Произошла внутренняя ошибка. Попробуй ещё раз чуть позже.';
}

function notifyErrorSafely(chatId: number, error: unknown): Promise<void> {
  return sendTelegram(chatId, formatUserFacingError(error), undefined, true)
    .catch((sendError) => {
      console.error('Failed to send error message to user:', sanitizeForLog(String(sendError)));
    });
}

function parseImportPayload(rawContent: string): {
  history: Array<{ role: 'user' | 'model'; content: string; timestamp: number }>;
  insights: string;
  memory: { facts: string[]; preferences: string[]; goals: string[] };
} {
  const parsed = JSON.parse(rawContent) as unknown;
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('INVALID_IMPORT_PAYLOAD');
  }

  const payload = parsed as Record<string, unknown>;

  const insightsRaw = payload.insights;
  const insights = typeof insightsRaw === 'string' ? insightsRaw.slice(0, 4000) : '';

  const historyRaw = Array.isArray(payload.history) ? payload.history : [];
  const history = historyRaw
    .map((item) => {
      if (!item || typeof item !== 'object') return null;
      const row = item as Record<string, unknown>;
      const role = row.role;
      const content = row.content;
      const timestamp = row.timestamp;
      if ((role !== 'user' && role !== 'model') || typeof content !== 'string' || !Number.isFinite(Number(timestamp))) {
        return null;
      }
      const normalizedContent = content.trim();
      if (!normalizedContent) return null;
      return {
        role,
        content: normalizedContent.slice(0, 20000),
        timestamp: Number(timestamp),
      } as { role: 'user' | 'model'; content: string; timestamp: number };
    })
    .filter((item): item is { role: 'user' | 'model'; content: string; timestamp: number } => Boolean(item));

  const memoryRaw = payload.memory;
  const memoryRecord = memoryRaw && typeof memoryRaw === 'object'
    ? (memoryRaw as Record<string, unknown>)
    : {};

  function pickList(key: 'facts' | 'preferences' | 'goals'): string[] {
    const value = memoryRecord[key];
    if (!Array.isArray(value)) return [];
    return value
      .map((item) => (typeof item === 'string' ? item.trim() : ''))
      .filter((item) => item.length > 0)
      .slice(0, 1000);
  }

  return {
    history,
    insights,
    memory: {
      facts: pickList('facts'),
      preferences: pickList('preferences'),
      goals: pickList('goals'),
    },
  };
}

async function persistSignalSafely(
  userId: number,
  chatId: number,
  messageId: number,
  signalType: 'sticker' | 'gif' | 'reaction',
  signal: SignalClassification,
  rawMeta: Record<string, unknown>
): Promise<void> {
  await saveMessageSignal(userId, chatId, messageId, signalType, signal, rawMeta);
}

async function saveMetricSafe(
  userId: number,
  metricName: string,
  metricValue: number,
  meta: Record<string, unknown> = {}
): Promise<void> {
  try {
    await saveMetric(userId, metricName, metricValue, meta);
  } catch (error) {
    if (isDuplicateUpdateError(error)) {
      throw error;
    }
    console.warn(`Failed to save metric ${metricName}:`, sanitizeForLog(String(error)));
  }
}

const ERROR_MESSAGES: Record<string, string> = {
  RATE_LIMIT: '⏳ Квота API исчерпана. Попробуй через несколько минут.',
  TOKEN_EXPIRED: '🔑 Токен авторизации истёк. Требуется обновление.',
  NETWORK_ERROR: '🌐 Проблема с сетью. Проверь подключение.',
  FILE_TOO_LARGE: '📁 Файл слишком большой (макс. 20 МБ).',
  UNSUPPORTED_FORMAT: '📄 Формат файла не поддерживается.',
  TIMEOUT: '⏱️ Запрос занял слишком много времени.',
  UNKNOWN: '❌ Произошла ошибка. Попробуй ещё раз.',
};

export async function webhookHandler(req: VercelRequest, res: VercelResponse) {
  if (req.method === 'GET') {
    const schema = await isSchemaReady().catch(() => ({ ok: false, missing: ['schema_check_failed'] }));
    return res.status(200).json({
      status: 'ok',
      bot: 'neuro-copilot',
      version: '8.6',
      model: GEMINI_MODEL,
      maxOutputTokens: 65536,
      schema: schema.ok ? 'ready' : 'partial',
      missingTables: schema.missing,
      features: [
        'voice',
        'video',
        'audio',
        'search',
        'youtube',
        'sources',
        'urls',
        'images',
        'documents',
        'export',
        'keyboard',
        'emoji',
        'long-term-memory',
        'auto-extract',
        'supabase',
        'auto-compression',
      ],
    });
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (!isWebhookAuthorized(req)) {
    return res.status(401).json({ ok: false, error: 'unauthorized' });
  }

  const update: TelegramUpdate = req.body;

  const updateId = Number.isFinite(update.update_id) ? Number(update.update_id) : null;
  const updateScope = update.message?.chat.id
    ? {
        userId: update.message?.from.id ?? update.callback_query?.from.id ?? update.message_reaction?.user?.id ?? 0,
        chatId: update.message.chat.id,
        type: 'message',
      }
    : update.callback_query?.message?.chat.id
      ? {
          userId: update.callback_query.from.id,
          chatId: update.callback_query.message.chat.id,
          type: 'callback_query',
        }
      : update.message_reaction?.chat.id
        ? {
            userId: update.message_reaction.user?.id || 0,
            chatId: update.message_reaction.chat.id,
            type: 'message_reaction',
          }
        : null;

  if (updateId !== null && updateScope && Number.isFinite(updateScope.userId) && updateScope.userId > 0) {
    try {
      const accepted = await markUpdateProcessed(updateId, updateScope.userId, updateScope.chatId, updateScope.type);
      if (!accepted) {
        return res.status(200).json({ ok: true, duplicate: true });
      }
    } catch (error) {
      if (NODE_ENV === 'production') {
        return res.status(503).json({ ok: false, error: 'dedupe_unavailable' });
      }
      console.error('Failed to apply update dedupe:', sanitizeForLog(String(error)));
    }
  }

  if (update.message_reaction) {
    try {
      const reactionUserId = update.message_reaction.user?.id;
      const reactionChatId = update.message_reaction.chat.id;
      const reactionMessageId = update.message_reaction.message_id;
      if (reactionUserId && isAllowedUser(reactionUserId)) {
        const reactionEmojis = (update.message_reaction.new_reaction || [])
          .map((item) => item.emoji)
          .filter((emoji): emoji is string => Boolean(emoji));
        const reactions = reactionEmojis.join(' ');
        if (reactions) {
          await addToHistory(reactionUserId, {
            role: 'user',
            content: `[Реакция пользователя: ${reactions}]`,
            timestamp: Date.now(),
          });

          const reactionSignal = classifyReactionSignal(reactionEmojis);
          await persistSignalSafely(
            reactionUserId,
            reactionChatId,
            reactionMessageId,
            'reaction',
            reactionSignal,
            {
              oldReaction: update.message_reaction.old_reaction || [],
              newReaction: update.message_reaction.new_reaction || [],
            }
          );
        }
      }
    } catch (error) {
      if (isDuplicateUpdateError(error)) {
        return res.status(200).json({ ok: true, duplicate: true });
      }
      console.error('Reaction update handling failed:', sanitizeForLog(String(error)));
    }
    return res.status(200).json({ ok: true });
  }

  if (update.callback_query) {
    const cb = update.callback_query;
    const chatId = cb.message?.chat.id;
    const messageId = cb.message?.message_id;
    const cbUserId = cb.from.id;

    try {
      if (!isAllowedUser(cbUserId)) {
        await answerCallback(cb.id, 'Доступ запрещён');
        return res.status(200).json({ ok: true });
      }

      if (cb.data === 'clear_confirm' && chatId && messageId) {
        await clearHistory(cbUserId);
        await clearChatSummaries(cbUserId);
        await clearInboundEvents(cbUserId);
        await clearProactiveJobs(cbUserId);
        await editMessage(chatId, messageId, '🗑️ История очищена!');
        await answerCallback(cb.id, 'Готово!');
      } else if (cb.data === 'clear_cancel' && chatId && messageId) {
        await editMessage(chatId, messageId, '❌ Очистка отменена.');
        await answerCallback(cb.id);
      } else if (cb.data?.startsWith('tts:') && chatId) {
        await answerCallback(cb.id, '🔊 Генерирую аудио...');
        const history = await getHistory(cbUserId);
        const lastModelMessage = [...history].reverse().find((m) => m.role === 'model');
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
    } catch (error) {
      if (isDuplicateUpdateError(error)) {
        return res.status(200).json({ ok: true, duplicate: true });
      }
      console.error('Callback handling failed:', sanitizeForLog(String(error)));
      try {
        await answerCallback(cb.id, 'Ошибка обработки');
      } catch {
        // noop
      }
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
  const hasSticker = !!message.sticker;
  const hasAnimation = !!message.animation;

  if (!isAllowedUser(userId)) {
    await sendTelegram(chatId, 'Извини, этот бот приватный.');
    return res.status(200).json({ ok: true });
  }

  if (hasSticker && message.sticker) {
    try {
      const stickerSignal = classifyStickerSignal(message.sticker.emoji, message.sticker.set_name);
      await persistSignalSafely(userId, chatId, message.message_id, 'sticker', stickerSignal, {
        emoji: message.sticker.emoji,
        setName: message.sticker.set_name,
        fileId: message.sticker.file_id,
      });
    } catch (error) {
      if (isDuplicateUpdateError(error)) {
        return res.status(200).json({ ok: true, duplicate: true });
      }
      console.warn('Failed to persist sticker signal:', sanitizeForLog(String(error)));
    }
  }

  if (hasAnimation && message.animation) {
    try {
      const gifSignal = classifyGifSignal(message.animation.file_name, message.animation.mime_type);
      await persistSignalSafely(userId, chatId, message.message_id, 'gif', gifSignal, {
        fileId: message.animation.file_id,
        fileName: message.animation.file_name,
        mimeType: message.animation.mime_type,
      });
    } catch (error) {
      if (isDuplicateUpdateError(error)) {
        return res.status(200).json({ ok: true, duplicate: true });
      }
      console.warn('Failed to persist gif signal:', sanitizeForLog(String(error)));
    }
  }

  if (!text && !hasPhoto && !hasVoice && !hasAudio && !hasVideo && !hasVideoNote && !hasDocument && !hasSticker && !hasAnimation) {
    return res.status(200).json({ ok: true });
  }

  let typingInterval: NodeJS.Timeout | null = null;
  let pendingBatchIds: number[] = [];
  let batchFinalized = false;

  try {
    if (text === '🔍 Поиск') {
      await sendTelegram(
        chatId,
        '🔍 Напиши запрос для поиска:\n<code>/search твой запрос</code>\n\nИли просто задай вопрос — я сам решу, нужен ли поиск.',
        undefined,
        true
      );
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

    if (text === '/start') {
      await sendTelegram(
        chatId,
        `<b>Команды:</b>
/stats — статистика и контекст
/memory — долгосрочная память
/sources — источники последнего ответа
/search — поиск в интернете
/export — экспорт данных
/insights — установить контекст о себе
/tz — установить таймзону
/quiet — тихие часы (например 23-09)
/time — показать текущее время бота
/remind — напоминание на завтра
/pin — закрепить память
/unpin — открепить память
/memorysearch — поиск по памяти (RAG debug)
/clear — очистить историю

<b>Память:</b>
/fact — добавить факт
/pref — добавить предпочтение
/goal — добавить цель`,
        undefined,
        true
      );
      return res.status(200).json({ ok: true });
    }

    if (text === '/stats') {
      const [settings, longTermMemory, history, summaries] = await Promise.all([
        getUserSettings(userId),
        getLongTermMemory(userId),
        getHistory(userId),
        getChatSummaries(userId),
      ]);

      const systemPrompt = await buildSystemPrompt(userId);
      const contextStats = getContextStatsFromHistory(history, systemPrompt, settings.insights);
      const pendingProactive = await countPendingProactiveJobs(userId);
      const userMsgs = history.filter((m) => m.role === 'user').length;
      const botMsgs = history.filter((m) => m.role === 'model').length;

      const historyJson = JSON.stringify(history);
      const historySizeKB = Math.round(historyJson.length / 1024);

      const progressBar =
        '█'.repeat(Math.round(contextStats.percent / 10)) +
        '░'.repeat(10 - Math.round(contextStats.percent / 10));

      await sendTelegram(
        chatId,
        `📊 Статистика:

• Сообщений: ${history.length} (👤 ${userMsgs} / 🤖 ${botMsgs})
• Объём истории: ~${historySizeKB} KB
• Сжатий: ${summaries.length}
• Проактивных задач: ${pendingProactive}
• Режим памяти: ${MEMORY_RETRIEVAL_MODE}

🧠 Память:
• Факты: ${longTermMemory.facts.length}
• Предпочтения: ${longTermMemory.preferences.length}
• Цели: ${longTermMemory.goals.length}
• Контекст: ${settings.insights.length > 0 ? 'задан' : 'не задан'}

📈 Контекст:
${progressBar} ${contextStats.percent}%
~${contextStats.tokens.toLocaleString()} токенов из ~${(MAX_CONTEXT_TOKENS / 1000).toFixed(0)}K

• v8.5-memory-modes`,
        undefined,
        true
      );
      return res.status(200).json({ ok: true });
    }

    if (text === '/memory') {
      const memory = await getLongTermMemory(userId);
      let response = '<b>🧠 Долгосрочная память:</b>\n\n';

      if (memory.facts.length > 0) {
        response += '<b>Факты:</b>\n';
        memory.facts.forEach((f, i) => (response += `${i + 1}. ${f}\n`));
        response += '\n';
      }

      if (memory.preferences.length > 0) {
        response += '<b>Предпочтения:</b>\n';
        memory.preferences.forEach((p, i) => (response += `${i + 1}. ${p}\n`));
        response += '\n';
      }

      if (memory.goals.length > 0) {
        response += '<b>Цели:</b>\n';
        memory.goals.forEach((g, i) => (response += `${i + 1}. ${g}\n`));
        response += '\n';
      }

      if (memory.facts.length === 0 && memory.preferences.length === 0 && memory.goals.length === 0) {
        response +=
          'Пока пусто. Память заполняется автоматически из наших разговоров.\n\nТы также можешь добавить вручную:\n<code>/fact твой факт</code>\n<code>/pref твоё предпочтение</code>\n<code>/goal твоя цель</code>';
      } else {
        response += '\nОчистить: /clearmemory';
      }

      await sendTelegram(chatId, response, undefined, true);
      return res.status(200).json({ ok: true });
    }

    if (text.startsWith('/fact ')) {
      await addMemoryItem(userId, 'fact', text.replace('/fact ', ''));
      await sendTelegram(chatId, '✅ Факт сохранён в долгосрочную память!', undefined, true);
      return res.status(200).json({ ok: true });
    }

    if (text.startsWith('/pref ')) {
      await addMemoryItem(userId, 'preference', text.replace('/pref ', ''));
      await sendTelegram(chatId, '✅ Предпочтение сохранено!', undefined, true);
      return res.status(200).json({ ok: true });
    }

    if (text.startsWith('/goal ')) {
      await addMemoryItem(userId, 'goal', text.replace('/goal ', ''));
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
      await sendTelegram(
        chatId,
        `⚠️ Ты уверен, что хочешь очистить историю?\n\nБудет удалено <b>${history.length}</b> сообщений.`,
        undefined,
        false,
        getConfirmClearKeyboard()
      );
      return res.status(200).json({ ok: true });
    }

    if (text === '/export') {
      const history = await getHistory(userId);
      const settings = await getUserSettings(userId);
      const memory = await getLongTermMemory(userId);
      const json = JSON.stringify({ history, insights: settings.insights, memory }, null, 2);
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
      await sendTelegram(
        chatId,
        `✅ Контекст сохранён!\n\n<i>"${insightText.substring(0, 100)}${insightText.length > 100 ? '...' : ''}"</i>`,
        undefined,
        true
      );
      return res.status(200).json({ ok: true });
    }

    if (text === '/insights') {
      const settings = await getUserSettings(userId);
      if (settings.insights) {
        await sendTelegram(
          chatId,
          `📝 <b>Текущий контекст:</b>\n\n<i>"${settings.insights}"</i>\n\nЧтобы изменить: <code>/insights новый текст</code>`,
          undefined,
          true
        );
      } else {
        await sendTelegram(chatId, '📝 Контекст не задан.\n\nИспользуй: <code>/insights расскажи о себе</code>', undefined, true);
      }
      return res.status(200).json({ ok: true });
    }

    if (text.startsWith('/tz ')) {
      const rawTimezone = text.replace('/tz ', '').trim();
      const timezone = normalizeTimezone(rawTimezone);
      if (timezone !== rawTimezone) {
        await sendTelegram(
          chatId,
          '❌ Невалидная таймзона. Пример: <code>/tz Europe/Moscow</code>',
          undefined,
          true
        );
        return res.status(200).json({ ok: true });
      }

      await setUserTimezone(userId, timezone);
      await sendTelegram(chatId, `✅ Таймзона обновлена: <b>${timezone}</b>`, undefined, true);
      return res.status(200).json({ ok: true });
    }

    if (text.startsWith('/quiet ')) {
      const rawQuiet = text.replace('/quiet ', '').trim();
      const parsed = parseQuietHours(rawQuiet);
      if (!parsed) {
        await sendTelegram(
          chatId,
          '❌ Неверный формат. Используй <code>/quiet 23-09</code>',
          undefined,
          true
        );
        return res.status(200).json({ ok: true });
      }

      await setUserQuietHours(userId, parsed.start, parsed.end);
      await sendTelegram(
        chatId,
        `✅ Тихие часы обновлены: <b>${parsed.start.toString().padStart(2, '0')}:00-${parsed.end
          .toString()
          .padStart(2, '0')}:00</b>`,
        undefined,
        true
      );
      return res.status(200).json({ ok: true });
    }

    if (text === '/time') {
      const settings = await getUserSettings(userId);
      const now = buildTimeContext(settings.timezone, settings.locale);
      await sendTelegram(
        chatId,
        `🕒 <b>Время бота</b>\n\nUTC: <code>${now.nowIsoUtc}</code>\nЛокально (${now.timezone}): <b>${now.localDate} ${now.localTime}</b> (${now.weekday})\nТихие часы: <code>${settings.quietHoursStart
          .toString()
          .padStart(2, '0')}:00-${settings.quietHoursEnd.toString().padStart(2, '0')}:00</code>`,
        undefined,
        true
      );
      return res.status(200).json({ ok: true });
    }

    if (text.startsWith('/pin ')) {
      const rawId = text.replace('/pin ', '').trim();
      const memoryItemId = Number.parseInt(rawId, 10);
      if (!Number.isFinite(memoryItemId)) {
        await sendTelegram(chatId, '❌ Использование: <code>/pin 123</code>', undefined, true);
        return res.status(200).json({ ok: true });
      }
      const updated = await setMemoryPinned(userId, memoryItemId, true);
      if (!updated) {
        await sendTelegram(chatId, '❌ Не удалось закрепить память: элемент не найден или недоступен.', undefined, true);
        return res.status(200).json({ ok: true });
      }
      await sendTelegram(chatId, `📌 Память #${memoryItemId} закреплена.`, undefined, true);
      return res.status(200).json({ ok: true });
    }

    if (text.startsWith('/unpin ')) {
      const rawId = text.replace('/unpin ', '').trim();
      const memoryItemId = Number.parseInt(rawId, 10);
      if (!Number.isFinite(memoryItemId)) {
        await sendTelegram(chatId, '❌ Использование: <code>/unpin 123</code>', undefined, true);
        return res.status(200).json({ ok: true });
      }
      const updated = await setMemoryPinned(userId, memoryItemId, false);
      if (!updated) {
        await sendTelegram(chatId, '❌ Не удалось открепить память: элемент не найден или недоступен.', undefined, true);
        return res.status(200).json({ ok: true });
      }
      await sendTelegram(chatId, `📍 Память #${memoryItemId} откреплена.`, undefined, true);
      return res.status(200).json({ ok: true });
    }

    if (text.startsWith('/memorysearch ')) {
      const query = text.replace('/memorysearch ', '').trim();
      if (!query) {
        await sendTelegram(chatId, '❌ Использование: <code>/memorysearch твой запрос</code>', undefined, true);
        return res.status(200).json({ ok: true });
      }
      const ragContext = await buildMemoryRagContext(userId, query);
      await sendTelegram(chatId, ragContext || '🔍 Ничего релевантного не найдено.', undefined, true);
      return res.status(200).json({ ok: true });
    }

    if (text.startsWith('/remind ')) {
      const reminderText = text.replace('/remind ', '').trim();
      if (!reminderText) {
        await sendTelegram(chatId, 'Использование: <code>/remind текст напоминания</code>', undefined, true);
        return res.status(200).json({ ok: true });
      }

      const hasPending = await hasPendingProactiveJob(userId, 'manual_reminder');
      if (hasPending) {
        await sendTelegram(chatId, '⏳ У тебя уже есть активное напоминание. Дождись его выполнения.', undefined, true);
        return res.status(200).json({ ok: true });
      }

      const dueAt = Date.now() + 24 * 60 * 60 * 1000;
      const userSettings = await getUserSettings(userId);
      const timeContext = buildTimeContext(userSettings.timezone, userSettings.locale, new Date(dueAt));
      await scheduleProactiveMessage(
        userId,
        chatId,
        dueAt,
        `⏰ Напоминание (${timeContext.localDate} ${timeContext.localTime}): ${reminderText}`,
        'manual_reminder'
      );
      await sendTelegram(chatId, '✅ Напоминание поставлено на завтра.', undefined, true);
      return res.status(200).json({ ok: true });
    }

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

    let voiceReply = false;
    if (text.startsWith('/voice ')) {
      text = text.replace('/voice ', '');
      voiceReply = true;
    }
    if (text === '/voice') {
      await sendTelegram(chatId, 'Использование: /voice <вопрос>\n\nИли просто попроси голосовой ответ в сообщении.', undefined, true);
      return res.status(200).json({ ok: true });
    }

    let forceSearch = false;
    if (text.startsWith('/search ')) {
      text = text.replace('/search ', '');
      forceSearch = true;
    }

    if (hasDocument && message.document) {
      const doc = message.document;
      const fileName = doc.file_name || '';

      if (fileName.startsWith('neuro-memory-') && fileName.endsWith('.json')) {
        const docData = await downloadFile(doc.file_id, doc.mime_type);
        try {
          const content = Buffer.from(docData.data, 'base64').toString('utf-8');
          const memoryData = parseImportPayload(content);

          const historyForImport = memoryData.history.slice(-MAX_HISTORY_MESSAGES);
          if (historyForImport.length > 0) {
            await replaceHistorySafely(userId, historyForImport);
          } else {
            await clearHistory(userId);
          }
          if (memoryData.insights) {
            await saveUserSettings(userId, memoryData.insights);
          }
          if (memoryData.memory.facts.length > 0 || memoryData.memory.preferences.length > 0 || memoryData.memory.goals.length > 0) {
            await replaceLongTermMemorySafely(userId, memoryData.memory);
          }
          await sendTelegram(
            chatId,
            `✅ Память импортирована!\n• Сообщений: ${historyForImport.length}\n• Контекст: ${memoryData.insights.length} символов\n• Факты: ${memoryData.memory.facts.length}`,
            undefined,
            true
          );
          return res.status(200).json({ ok: true });
        } catch {
          await sendTelegram(chatId, '❌ Ошибка при импорте. Проверь формат файла.', undefined, true);
          return res.status(200).json({ ok: true });
        }
      }
    }

    const enqueued = await enqueueInboundMessageWithText(update, text);
    if (!enqueued) {
      return res.status(200).json({ ok: true });
    }

    await new Promise((resolve) => setTimeout(resolve, BATCHING.debounceMs));
    if (await shouldWaitForBatch(userId, chatId, enqueued.eventId)) {
      return res.status(200).json({ ok: true });
    }

    typingInterval = startTypingLoop(chatId);

    let upperEventId = await resolveBatchUpperEventId(userId, chatId, enqueued.eventId);
    let batch = await buildInboundBatch(userId, chatId, upperEventId, BATCHING.pendingLimit);
    pendingBatchIds = batch.eventIds;
    if (batch.eventIds.length === 0) {
      if (typingInterval) clearInterval(typingInterval);
      return res.status(200).json({ ok: true });
    }

    let finalResultText = '';
    let finalResultSources: Array<{ title: string; url: string }> = [];
    let finalBatchHistoryText = batch.historyText || (text || 'Привет');
    let finalSignalCandidates: string[] = [];
    let rebuildCount = 0;
    const MAX_BATCH_REBUILDS = 2;

    while (true) {
      const batchHistoryText = batch.historyText || (text || 'Привет');

      const signalCandidates = batch.parts
        .filter((part) => typeof part.text === 'string' && part.text.includes('[Сигнал '))
        .map((part) => part.text as string)
        .slice(0, 5);

      const retrievalStart = Date.now();
      const memoryContext =
        MEMORY_RETRIEVAL_MODE === 'supabase'
          ? await buildSupabaseMemoryContext(userId, batchHistoryText)
          : await buildMemoryRagContext(userId, batchHistoryText);
      const retrievalLatency = Date.now() - retrievalStart;
      await saveMetricSafe(userId, 'memory_retrieval_latency_ms', retrievalLatency, {
        mode: MEMORY_RETRIEVAL_MODE,
        hasContext: Boolean(memoryContext),
      });

      if (memoryContext) {
        await saveMetricSafe(userId, 'memory_retrieval_hit', 1, {
          mode: MEMORY_RETRIEVAL_MODE,
        });
      }

      const partsForModel = memoryContext
        ? [...batch.parts, { text: `[Релевантная память:${MEMORY_RETRIEVAL_MODE}]\n${memoryContext}` }]
        : batch.parts;

      const systemPrompt = await buildSystemPrompt(userId);
      const contextBundle = await buildContextMessages(
        userId,
        { role: 'user', parts: partsForModel },
        batchHistoryText
      );
      const modelStart = Date.now();
      const result = await callGemini({
        messages: contextBundle.messages,
        systemPrompt,
        forceSearch,
      });
      const modelLatency = Date.now() - modelStart;
      await saveMetricSafe(userId, 'model_latency_ms', modelLatency, {
        model: GEMINI_MODEL,
        mode: MEMORY_RETRIEVAL_MODE,
      });

      const refreshedUpperEventId = await resolveBatchUpperEventId(userId, chatId, upperEventId);
      const hasNewerEvents = refreshedUpperEventId > upperEventId;

      if (hasNewerEvents && rebuildCount < MAX_BATCH_REBUILDS) {
        upperEventId = refreshedUpperEventId;
        batch = await buildInboundBatch(userId, chatId, upperEventId, BATCHING.pendingLimit);
        pendingBatchIds = batch.eventIds;
        rebuildCount += 1;

        if (batch.eventIds.length === 0) {
          if (typingInterval) clearInterval(typingInterval);
          return res.status(200).json({ ok: true });
        }

        continue;
      }

      finalResultText = result.text;
      finalResultSources = result.sources || [];
      finalBatchHistoryText = batchHistoryText;
      finalSignalCandidates = signalCandidates;
      break;
    }

    let cleanText = finalResultText;
    const memoryMatch = finalResultText.match(/<memory>([\s\S]*?)<\/memory>/i);
    if (memoryMatch) {
      const memoryBlock = memoryMatch[1];
      cleanText = finalResultText.replace(/<memory>[\s\S]*?<\/memory>/gi, '').trim();

      const factMatch = memoryBlock.match(/FACT:\s*(.+)/gi);
      const prefMatch = memoryBlock.match(/PREF:\s*(.+)/gi);
      const goalMatch = memoryBlock.match(/GOAL:\s*(.+)/gi);

      if (factMatch) {
        for (const f of factMatch) {
          await addMemoryItem(userId, 'fact', f.replace(/FACT:\s*/i, '').trim());
        }
      }
      if (prefMatch) {
        for (const p of prefMatch) {
          await addMemoryItem(userId, 'preference', p.replace(/PREF:\s*/i, '').trim());
        }
      }
      if (goalMatch) {
        for (const g of goalMatch) {
          await addMemoryItem(userId, 'goal', g.replace(/GOAL:\s*/i, '').trim());
        }
      }
    }

    if (finalResultSources.length > 0) {
      await saveLastSources(userId, finalResultSources);
    }

    await finalizeInboundBatch(batch.eventIds);
    batchFinalized = true;
    pendingBatchIds = [];

    for (const signalText of finalSignalCandidates) {
      await ingestMemoryFromText(userId, 'signal', signalText, {
        importance: 0.55,
        confidence: 0.6,
        sourceMessageId: batch.replyToMessageId,
        chunkMeta: { source: 'inbound-batch-signal' },
      });
    }

    await addToHistory(userId, {
      role: 'user',
      content: finalBatchHistoryText,
      timestamp: Date.now(),
    });

    await addToHistory(userId, { role: 'model', content: cleanText, timestamp: Date.now() });

    await ingestMemoryFromText(userId, 'episode', `${finalBatchHistoryText}\n\nОтвет бота:\n${cleanText}`, {
      importance: 0.58,
      confidence: 0.7,
      sourceMessageId: batch.replyToMessageId,
      chunkMeta: { source: 'episode' },
    });

    const shouldScheduleGoalFollowup = /цель|план|начну|сделаю|задач/i.test(finalBatchHistoryText);
    if (shouldScheduleGoalFollowup) {
      const hasPendingGoalFollowup = await hasPendingProactiveJob(userId, 'goal_followup');
      if (!hasPendingGoalFollowup) {
        await scheduleProactiveMessage(
          userId,
          chatId,
          Date.now() + 24 * 60 * 60 * 1000,
          '👋 Как продвигается твоя цель? Если хочешь, помогу сделать следующий шаг сегодня.',
          'goal_followup'
        );
      }
    }

    const compressionResult = await maybeCompressContext(userId);

    if (typingInterval) clearInterval(typingInterval);

    const ttsButton = {
      inline_keyboard: [[{ text: '🔊 Озвучить', callback_data: 'tts:1' }]],
    };

    if (compressionResult.compressed) {
      const memoryNote =
        compressionResult.factsExtracted > 0
          ? `, ${compressionResult.factsExtracted} фактов сохранено в память`
          : '';
      await sendTelegram(
        chatId,
        cleanText + `\n\n<i>📚 Контекст сжат (~${Math.round(compressionResult.tokensFreed / 1000)}K токенов освобождено${memoryNote})</i>`,
        batch.replyToMessageId,
        true,
        ttsButton
      );
    } else {
      await sendTelegram(chatId, cleanText, batch.replyToMessageId, true, ttsButton);
    }

    const fallbackSignal = inferOutboundSignal(cleanText, finalBatchHistoryText);
    const outboundSignal: SignalPolicyDecision =
      OUTBOUND_SIGNAL_POLICY_MODE === 'llm'
        ? await inferOutboundSignalWithLlm(cleanText, finalBatchHistoryText, fallbackSignal)
        : {
            kind: (fallbackSignal.intent === 'none' ? 'none' : 'reaction') as 'none' | 'reaction',
            emotion: fallbackSignal.emotion,
            intent: fallbackSignal.intent,
            confidence: fallbackSignal.confidence,
            reason: 'heuristic_policy_mode',
          };

    await saveMetricSafe(userId, 'signal_policy_decision', outboundSignal.confidence, {
      mode: OUTBOUND_SIGNAL_POLICY_MODE,
      kind: outboundSignal.kind,
      intent: outboundSignal.intent,
      reason: outboundSignal.reason,
    });

    if (batch.replyToMessageId && outboundSignal.intent !== 'none') {
      await applyDynamicReaction(userId, chatId, batch.replyToMessageId, outboundSignal);
      if (outboundSignal.kind === 'sticker' || outboundSignal.kind === 'gif' || outboundSignal.kind === 'reaction') {
        await applyDynamicStickerOrGif(userId, chatId, batch.replyToMessageId, outboundSignal);
      }
    }

    if (voiceReply) {
      const audioBuffer = await textToSpeech(cleanText);
      if (audioBuffer) {
        await sendVoice(chatId, audioBuffer, batch.replyToMessageId);
      }
    }

  } catch (error) {
    if (typingInterval) clearInterval(typingInterval);
    if (pendingBatchIds.length > 0 && !batchFinalized) {
      console.error('Inbound batch failed, kept pending for retry:', pendingBatchIds.join(','));
    }
    if (isDuplicateUpdateError(error)) {
      return res.status(200).json({ ok: true, duplicate: true });
    }
    console.error('Webhook processing error:', sanitizeForLog(String(error)));
    await notifyErrorSafely(chatId, error);
  }

  return res.status(200).json({ ok: true });
}
