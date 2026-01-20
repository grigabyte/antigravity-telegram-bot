/**
 * Telegram webhook handler for Vercel
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { sendMessage, type GeminiMessage } from '../lib/gemini';
import { getNextAccount, markRateLimited } from '../lib/accounts';
import { 
  addToHistory, 
  getMessagesForGemini, 
  buildSystemPrompt,
  getMemoryStats,
  clearHistory,
  saveCoreInsights
} from '../lib/memory';

const TELEGRAM_TOKEN = process.env.TELEGRAM_BOT_TOKEN!;
const ADMIN_USER_ID = process.env.ADMIN_USER_ID ? parseInt(process.env.ADMIN_USER_ID) : null;

interface TelegramUpdate {
  message?: {
    message_id: number;
    from: {
      id: number;
      first_name: string;
      username?: string;
    };
    chat: {
      id: number;
      type: string;
    };
    text?: string;
    date: number;
  };
}

/**
 * Send message to Telegram
 */
async function sendTelegramMessage(chatId: number, text: string, replyToMessageId?: number): Promise<void> {
  const url = `https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`;
  
  await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      reply_to_message_id: replyToMessageId,
      parse_mode: 'Markdown',
    }),
  });
}

/**
 * Send "typing" action
 */
async function sendTypingAction(chatId: number): Promise<void> {
  const url = `https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendChatAction`;
  
  await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      action: 'typing',
    }),
  });
}

/**
 * Handle special commands
 */
async function handleCommand(command: string, chatId: number, userId: number): Promise<string | null> {
  // Check admin for sensitive commands
  const isAdmin = ADMIN_USER_ID === null || userId === ADMIN_USER_ID;

  switch (command) {
    case '/start':
      return `Привет! Я твой персональный AI-помощник.

Я здесь чтобы помочь с:
• Рефлексией и самоанализом
• Жизненными вопросами
• Принятием решений
• Просто поговорить

Просто напиши мне что угодно, и я отвечу.

Команды:
/stats — статистика памяти
/clear — очистить историю
/help — эта справка`;

    case '/help':
      return `Доступные команды:
/stats — показать статистику памяти
/clear — очистить историю диалога
/help — показать эту справку

Просто пиши мне любые сообщения — я здесь чтобы помочь!`;

    case '/stats':
      const stats = await getMemoryStats();
      return `📊 *Статистика памяти*

Сообщений в истории: ${stats.historyCount}
Размер core insights: ${stats.insightsLength} символов`;

    case '/clear':
      if (!isAdmin) {
        return 'У тебя нет прав для этой команды.';
      }
      await clearHistory();
      return '🗑 История очищена. Начинаем с чистого листа!';

    default:
      return null;
  }
}

/**
 * Main webhook handler
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const update: TelegramUpdate = req.body;
  
  // Ignore non-message updates
  if (!update.message?.text) {
    return res.status(200).json({ ok: true });
  }

  const { message } = update;
  const chatId = message.chat.id;
  const userId = message.from.id;
  const text = message.text;

  // Check if admin (if configured)
  if (ADMIN_USER_ID !== null && userId !== ADMIN_USER_ID) {
    await sendTelegramMessage(chatId, 'Извини, этот бот приватный.');
    return res.status(200).json({ ok: true });
  }

  try {
    // Handle commands
    if (text.startsWith('/')) {
      const command = text.split(' ')[0].toLowerCase();
      const response = await handleCommand(command, chatId, userId);
      if (response) {
        await sendTelegramMessage(chatId, response);
        return res.status(200).json({ ok: true });
      }
    }

    // Handle special command to set insights
    if (text.startsWith('/setinsights ')) {
      const insights = text.replace('/setinsights ', '');
      await saveCoreInsights(insights);
      await sendTelegramMessage(chatId, '✅ Core insights обновлены!');
      return res.status(200).json({ ok: true });
    }

    // Send typing indicator
    await sendTypingAction(chatId);

    // Add user message to history
    await addToHistory({
      role: 'user',
      content: text,
      timestamp: Date.now(),
    });

    // Get account for API call
    const account = await getNextAccount();
    if (!account) {
      await sendTelegramMessage(
        chatId, 
        '⚠️ Нет доступных аккаунтов. Попробуй позже.',
        message.message_id
      );
      return res.status(200).json({ ok: true });
    }

    // Build context
    const systemPrompt = await buildSystemPrompt();
    const messages = await getMessagesForGemini();

    // Call Gemini
    let response;
    let retries = 3;
    
    while (retries > 0) {
      try {
        response = await sendMessage(account.refreshToken, messages, systemPrompt);
        break;
      } catch (error: any) {
        if (error.message === 'RATE_LIMIT') {
          await markRateLimited(account.email, 60000);
          const nextAccount = await getNextAccount();
          if (nextAccount && nextAccount.email !== account.email) {
            retries--;
            continue;
          }
        }
        throw error;
      }
    }

    if (!response) {
      await sendTelegramMessage(
        chatId,
        '⚠️ Все аккаунты временно недоступны. Попробуй через минуту.',
        message.message_id
      );
      return res.status(200).json({ ok: true });
    }

    // Save assistant response to history
    await addToHistory({
      role: 'model',
      content: response.text,
      timestamp: Date.now(),
    });

    // Send response to user
    await sendTelegramMessage(chatId, response.text, message.message_id);

  } catch (error: any) {
    console.error('Error handling message:', error);
    await sendTelegramMessage(
      chatId,
      `❌ Произошла ошибка: ${error.message}`,
      message.message_id
    );
  }

  return res.status(200).json({ ok: true });
}
