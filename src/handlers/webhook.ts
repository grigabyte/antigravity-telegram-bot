import type { VercelRequest, VercelResponse } from '@vercel/node';
import {
  ADMIN_USER_ID,
  BATCHING,
  GEMINI_MODEL,
  MEMORY_RETRIEVAL_MODE,
  OUTBOUND_SIGNAL_POLICY_MODE,
  MAX_CONTEXT_TOKENS,
  MAX_HISTORY_MESSAGES,
} from '../config.js';
import type { TelegramUpdate } from '../types.js';
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
  saveMessageSignal,
  setMemoryPinned,
  setUserQuietHours,
  setUserTimezone,
  saveLastSources,
  saveMetric,
  saveUserSettings,
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
  shouldWaitForBatch,
} from '../telegram/inbound-events.js';
import { applyDynamicReaction } from '../telegram/reactions.js';
import { applyDynamicStickerOrGif } from '../telegram/stickers.js';
import { hasPendingProactiveJob, scheduleProactiveMessage } from '../proactive/scheduler.js';
import { buildTimeContext, normalizeTimezone, parseQuietHours } from '../time/clock.js';
import { classifyReactionSignal, inferOutboundSignal } from '../semantics/signal-classifier.js';
import { inferOutboundSignalWithLlm } from '../semantics/signal-policy.js';
import type { SignalPolicyDecision } from '../types.js';
import { buildMemoryRagContext, ingestMemoryFromText } from '../memory/rag-memory.js';
import { buildSupabaseMemoryContext } from '../memory/supabase-memory.js';

const ERROR_MESSAGES: Record<string, string> = {
  RATE_LIMIT: '⏳ Квота API исчерпана. Попробуй через несколько минут.',
  TOKEN_EXPIRED: '🔑 Токен авторизации истёк. Требуется обновление.',
  NETWORK_ERROR: '🌐 Проблема с сетью. Проверь подключение.',
  FILE_TOO_LARGE: '📁 Файл слишком большой (макс. 20 МБ).',
  UNSUPPORTED_FORMAT: '📄 Формат файла не поддерживается.',
  TIMEOUT: '⏱️ Запрос занял слишком много времени.',
  UNKNOWN: '❌ Произошла ошибка. Попробуй ещё раз.',
};

function formatError(error: unknown): string {
  const maybeError = error as { message?: string };
  const message = maybeError?.message || '';

  if (message.includes('RATE_LIMIT') || message.includes('429')) {
    return ERROR_MESSAGES.RATE_LIMIT;
  }
  if (message.includes('token') || message.includes('401')) {
    return ERROR_MESSAGES.TOKEN_EXPIRED;
  }
  if (message.includes('fetch') || message.includes('network')) {
    return ERROR_MESSAGES.NETWORK_ERROR;
  }
  if (message.includes('timeout') || message.includes('TIMEOUT')) {
    return ERROR_MESSAGES.TIMEOUT;
  }
  if (message.includes('too large') || message.includes('size')) {
    return ERROR_MESSAGES.FILE_TOO_LARGE;
  }

  return `❌ Ошибка: ${message.substring(0, 200)}`;
}

export async function webhookHandler(req: VercelRequest, res: VercelResponse) {
  if (req.method === 'GET') {
    return res.status(200).json({
      status: 'ok',
      bot: 'neuro-copilot',
      version: '8.3',
      model: GEMINI_MODEL,
      maxOutputTokens: 65536,
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

  const update: TelegramUpdate = req.body;

  if (update.message_reaction) {
    const reactionUserId = update.message_reaction.user?.id;
    const reactionChatId = update.message_reaction.chat.id;
    const reactionMessageId = update.message_reaction.message_id;
    if (reactionUserId) {
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
        await saveMessageSignal(
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
    return res.status(200).json({ ok: true });
  }

  if (update.callback_query) {
    const cb = update.callback_query;
    const chatId = cb.message?.chat.id;
    const messageId = cb.message?.message_id;
    const cbUserId = cb.from.id;

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

  if (ADMIN_USER_ID !== null && userId !== ADMIN_USER_ID) {
    await sendTelegram(chatId, 'Извини, этот бот приватный.');
    return res.status(200).json({ ok: true });
  }

  if (!text && !hasPhoto && !hasVoice && !hasAudio && !hasVideo && !hasVideoNote && !hasDocument && !hasSticker) {
    return res.status(200).json({ ok: true });
  }

  let typingInterval: NodeJS.Timeout | null = null;
  let pendingBatchIds: number[] = [];

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
      await setMemoryPinned(memoryItemId, true);
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
      await setMemoryPinned(memoryItemId, false);
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
          const memoryData = JSON.parse(content);
          if (memoryData.history) {
            await clearHistory(userId);
            for (const msg of memoryData.history.slice(-MAX_HISTORY_MESSAGES)) {
              await addToHistory(userId, msg);
            }
          }
          if (memoryData.insights) {
            await saveUserSettings(userId, memoryData.insights);
          }
          if (memoryData.memory) {
            await clearLongTermMemory(userId);
            for (const fact of memoryData.memory.facts) await addMemoryItem(userId, 'fact', fact);
            for (const pref of memoryData.memory.preferences) await addMemoryItem(userId, 'preference', pref);
            for (const goal of memoryData.memory.goals) await addMemoryItem(userId, 'goal', goal);
          }
          await sendTelegram(
            chatId,
            `✅ Память импортирована!\n• Сообщений: ${memoryData.history?.length || 0}\n• Контекст: ${memoryData.insights?.length || 0} символов\n• Факты: ${memoryData.memory?.facts?.length || 0}`,
            undefined,
            true
          );
          return res.status(200).json({ ok: true });
        } catch (e) {
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
    if (await shouldWaitForBatch(userId, chatId, enqueued.eventTs)) {
      return res.status(200).json({ ok: true });
    }

    typingInterval = startTypingLoop(chatId);

    const batch = await buildInboundBatch(userId, chatId, enqueued.eventTs, BATCHING.pendingLimit);
    pendingBatchIds = batch.eventIds;
    if (batch.eventIds.length === 0) {
      if (typingInterval) clearInterval(typingInterval);
      return res.status(200).json({ ok: true });
    }

    const batchHistoryText = batch.historyText || (text || 'Привет');

    const signalCandidates = batch.parts
      .filter((part) => typeof part.text === 'string' && part.text.includes('[Сигнал '))
      .map((part) => part.text as string)
      .slice(0, 5);

    for (const signalText of signalCandidates) {
      await ingestMemoryFromText(userId, 'signal', signalText, {
        importance: 0.55,
        confidence: 0.6,
        sourceMessageId: batch.replyToMessageId,
        chunkMeta: { source: 'inbound-batch-signal' },
      });
    }

    const retrievalStart = Date.now();
    const memoryContext =
      MEMORY_RETRIEVAL_MODE === 'supabase'
        ? await buildSupabaseMemoryContext(userId, batchHistoryText)
        : await buildMemoryRagContext(userId, batchHistoryText);
    const retrievalLatency = Date.now() - retrievalStart;
    await saveMetric(userId, 'memory_retrieval_latency_ms', retrievalLatency, {
      mode: MEMORY_RETRIEVAL_MODE,
      hasContext: Boolean(memoryContext),
    });

    if (memoryContext) {
      await saveMetric(userId, 'memory_retrieval_hit', 1, {
        mode: MEMORY_RETRIEVAL_MODE,
      });
    }

    const partsForModel = memoryContext
      ? [...batch.parts, { text: `[Релевантная память:${MEMORY_RETRIEVAL_MODE}]\n${memoryContext}` }]
      : batch.parts;

    await addToHistory(userId, {
      role: 'user',
      content: batchHistoryText,
      timestamp: Date.now(),
    });

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
    await saveMetric(userId, 'model_latency_ms', modelLatency, {
      model: GEMINI_MODEL,
      mode: MEMORY_RETRIEVAL_MODE,
    });

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

    if (result.sources && result.sources.length > 0) {
      await saveLastSources(userId, result.sources);
    }

    await addToHistory(userId, { role: 'model', content: cleanText, timestamp: Date.now() });

    await ingestMemoryFromText(userId, 'episode', `${batchHistoryText}\n\nОтвет бота:\n${cleanText}`, {
      importance: 0.58,
      confidence: 0.7,
      sourceMessageId: batch.replyToMessageId,
      chunkMeta: { source: 'episode' },
    });

    const shouldScheduleGoalFollowup = /цель|план|начну|сделаю|задач/i.test(batchHistoryText);
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

    const fallbackSignal = inferOutboundSignal(cleanText, batchHistoryText);
    const outboundSignal: SignalPolicyDecision =
      OUTBOUND_SIGNAL_POLICY_MODE === 'llm'
        ? await inferOutboundSignalWithLlm(cleanText, batchHistoryText, fallbackSignal)
        : {
            kind: (fallbackSignal.intent === 'none' ? 'none' : 'reaction') as 'none' | 'reaction',
            emotion: fallbackSignal.emotion,
            intent: fallbackSignal.intent,
            confidence: fallbackSignal.confidence,
            reason: 'heuristic_policy_mode',
          };

    await saveMetric(userId, 'signal_policy_decision', outboundSignal.confidence, {
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

    await finalizeInboundBatch(batch.eventIds);
    pendingBatchIds = [];

  } catch (error) {
    if (typingInterval) clearInterval(typingInterval);
    if (pendingBatchIds.length > 0) {
      console.error('Inbound batch failed, kept pending for retry:', pendingBatchIds.join(','));
    }
    console.error('Error:', error);
    await sendTelegram(chatId, formatError(error), undefined, true);
  }

  return res.status(200).json({ ok: true });
}
