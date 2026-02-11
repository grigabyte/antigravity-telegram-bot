import { ELEVENLABS_API_KEY, ELEVENLABS_VOICE_ID, REQUEST_TIMEOUTS, TELEGRAM_API_BASE } from '../config.js';
import { fetchWithTimeout } from '../network/fetch.js';
import type { TelegramInlineKeyboardMarkup } from '../types.js';
import { convertToTelegramHtml, splitTelegramHtml } from './formatting.js';
import { getReplyKeyboard } from './keyboards.js';

interface TelegramSendMessageBody {
  chat_id: number;
  text: string;
  parse_mode?: 'HTML';
  reply_to_message_id?: number;
  reply_markup?: TelegramInlineKeyboardMarkup | ReturnType<typeof getReplyKeyboard>;
}

interface TelegramApiResult {
  ok: boolean;
  description: string;
}

async function parseTelegramResponse(response: Response): Promise<TelegramApiResult> {
  const text = await response.text();

  let description = text.slice(0, 220);
  try {
    const payload = text ? JSON.parse(text) as Record<string, unknown> : null;
    if (payload && typeof payload === 'object') {
      const okValue = payload.ok;
      const payloadDescription = typeof payload.description === 'string' ? payload.description : '';
      if (okValue === true) {
        return { ok: true, description: payloadDescription };
      }
      if (okValue === false) {
        return { ok: false, description: payloadDescription || description };
      }
    }
  } catch {
    // ignore non-json bodies
  }

  if (!response.ok) {
    description = `${response.status}: ${description}`;
    return { ok: false, description };
  }

  return { ok: true, description };
}

async function ensureTelegramOk(response: Response, operation: string): Promise<void> {
  const parsed = await parseTelegramResponse(response);
  if (parsed.ok) return;
  throw new Error(`${operation}_FAILED:${parsed.description}`);
}

export async function sendTelegram(
  chatId: number,
  text: string,
  replyTo?: number,
  showKeyboard: boolean = false,
  inlineKeyboard?: TelegramInlineKeyboardMarkup
): Promise<void> {
  const formattedText = convertToTelegramHtml(text);
  const chunks = splitTelegramHtml(formattedText, 3900);

  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    const isLastChunk = i === chunks.length - 1;

    const body: TelegramSendMessageBody = {
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

    const response = await fetchWithTimeout(
      `${TELEGRAM_API_BASE}/sendMessage`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      },
      REQUEST_TIMEOUTS.telegram
    );

    const primary = await parseTelegramResponse(response);
    if (!primary.ok) {
      const plainText = chunk.replace(/<[^>]+>/g, '');
      const fallbackBody: TelegramSendMessageBody = {
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
      const fallbackResponse = await fetchWithTimeout(
        `${TELEGRAM_API_BASE}/sendMessage`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(fallbackBody),
        },
        REQUEST_TIMEOUTS.telegram
      );
      await ensureTelegramOk(fallbackResponse, 'SEND_MESSAGE_FALLBACK');
    }
  }
}

export async function answerCallback(callbackId: string, text?: string): Promise<void> {
  const response = await fetchWithTimeout(
    `${TELEGRAM_API_BASE}/answerCallbackQuery`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ callback_query_id: callbackId, text }),
    },
    REQUEST_TIMEOUTS.telegram
  );
  await ensureTelegramOk(response, 'ANSWER_CALLBACK');
}

export async function editMessage(chatId: number, messageId: number, text: string): Promise<void> {
  const response = await fetchWithTimeout(
    `${TELEGRAM_API_BASE}/editMessageText`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        message_id: messageId,
        text,
        parse_mode: 'HTML',
      }),
    },
    REQUEST_TIMEOUTS.telegram
  );
  await ensureTelegramOk(response, 'EDIT_MESSAGE');
}

export async function sendVoice(chatId: number, audioBuffer: Buffer, replyToMessageId?: number): Promise<void> {
  const formData = new FormData();
  formData.append('chat_id', chatId.toString());
  formData.append('voice', new Blob([new Uint8Array(audioBuffer)], { type: 'audio/mpeg' }), 'voice.mp3');
  if (replyToMessageId) {
    formData.append('reply_to_message_id', replyToMessageId.toString());
  }

  const response = await fetchWithTimeout(
    `${TELEGRAM_API_BASE}/sendVoice`,
    {
      method: 'POST',
      body: formData,
    },
    REQUEST_TIMEOUTS.telegram
  );
  await ensureTelegramOk(response, 'SEND_VOICE');
}

export async function sendDocument(
  chatId: number,
  content: string,
  fileName: string,
  caption?: string
): Promise<void> {
  const blob = new Blob([content], { type: 'application/json' });
  const formData = new FormData();
  formData.append('chat_id', chatId.toString());
  formData.append('document', blob, fileName);
  if (caption) {
    formData.append('caption', caption);
  }

  const response = await fetchWithTimeout(
    `${TELEGRAM_API_BASE}/sendDocument`,
    {
      method: 'POST',
      body: formData,
    },
    REQUEST_TIMEOUTS.telegram
  );
  await ensureTelegramOk(response, 'SEND_DOCUMENT');
}

export async function sendAnimation(chatId: number, animationFileId: string, replyToMessageId?: number): Promise<void> {
  const response = await fetchWithTimeout(
    `${TELEGRAM_API_BASE}/sendAnimation`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        animation: animationFileId,
        reply_to_message_id: replyToMessageId,
      }),
    },
    REQUEST_TIMEOUTS.telegram
  );
  await ensureTelegramOk(response, 'SEND_ANIMATION');
}

export async function sendTyping(chatId: number): Promise<void> {
  const response = await fetchWithTimeout(
    `${TELEGRAM_API_BASE}/sendChatAction`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, action: 'typing' }),
    },
    REQUEST_TIMEOUTS.telegram
  );
  await ensureTelegramOk(response, 'SEND_TYPING');
}

export function startTypingLoop(chatId: number): NodeJS.Timeout {
  void sendTyping(chatId).catch((error) => {
    console.warn('Failed to send typing action:', String(error).slice(0, 180));
  });
  return setInterval(() => {
    void sendTyping(chatId).catch((error) => {
      console.warn('Failed to send typing action:', String(error).slice(0, 180));
    });
  }, 4000);
}

export async function textToSpeech(text: string): Promise<Buffer | null> {
  try {
    const cleanText = text.replace(/<[^>]*>/g, '').slice(0, 5000);

    const response = await fetchWithTimeout(
      `https://api.elevenlabs.io/v1/text-to-speech/${ELEVENLABS_VOICE_ID}`,
      {
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
            use_speaker_boost: true,
          },
        }),
      },
      REQUEST_TIMEOUTS.tts
    );

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
