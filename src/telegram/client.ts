import { ELEVENLABS_API_KEY, ELEVENLABS_VOICE_ID, REQUEST_TIMEOUTS, TELEGRAM_API_BASE } from '../config.js';
import { fetchWithTimeout } from '../network/fetch.js';
import { convertToTelegramHtml, splitTelegramHtml } from './formatting.js';
import { getReplyKeyboard } from './keyboards.js';

export async function sendTelegram(
  chatId: number,
  text: string,
  replyTo?: number,
  showKeyboard: boolean = false,
  inlineKeyboard?: any
): Promise<void> {
  const formattedText = convertToTelegramHtml(text);
  const chunks = splitTelegramHtml(formattedText, 3900);

  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    const isLastChunk = i === chunks.length - 1;

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

    const response = await fetchWithTimeout(
      `${TELEGRAM_API_BASE}/sendMessage`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      },
      REQUEST_TIMEOUTS.telegram
    );

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
      await fetchWithTimeout(
        `${TELEGRAM_API_BASE}/sendMessage`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(fallbackBody),
        },
        REQUEST_TIMEOUTS.telegram
      );
    }
  }
}

export async function answerCallback(callbackId: string, text?: string): Promise<void> {
  await fetchWithTimeout(
    `${TELEGRAM_API_BASE}/answerCallbackQuery`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ callback_query_id: callbackId, text }),
    },
    REQUEST_TIMEOUTS.telegram
  );
}

export async function editMessage(chatId: number, messageId: number, text: string): Promise<void> {
  await fetchWithTimeout(
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
}

export async function sendVoice(chatId: number, audioBuffer: Buffer, replyToMessageId?: number): Promise<void> {
  const formData = new FormData();
  formData.append('chat_id', chatId.toString());
  formData.append('voice', new Blob([new Uint8Array(audioBuffer)], { type: 'audio/mpeg' }), 'voice.mp3');
  if (replyToMessageId) {
    formData.append('reply_to_message_id', replyToMessageId.toString());
  }

  await fetchWithTimeout(
    `${TELEGRAM_API_BASE}/sendVoice`,
    {
      method: 'POST',
      body: formData,
    },
    REQUEST_TIMEOUTS.telegram
  );
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

  await fetchWithTimeout(
    `${TELEGRAM_API_BASE}/sendDocument`,
    {
      method: 'POST',
      body: formData,
    },
    REQUEST_TIMEOUTS.telegram
  );
}

export async function sendAnimation(chatId: number, animationFileId: string, replyToMessageId?: number): Promise<void> {
  await fetchWithTimeout(
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
}

export async function sendTyping(chatId: number): Promise<void> {
  await fetchWithTimeout(
    `${TELEGRAM_API_BASE}/sendChatAction`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, action: 'typing' }),
    },
    REQUEST_TIMEOUTS.telegram
  );
}

export function startTypingLoop(chatId: number): NodeJS.Timeout {
  sendTyping(chatId);
  return setInterval(() => sendTyping(chatId), 4000);
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
