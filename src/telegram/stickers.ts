import { REQUEST_TIMEOUTS, TELEGRAM_API_BASE } from '../config.js';
import { fetchWithTimeout } from '../network/fetch.js';
import {
  getGifCatalog,
  getLastGifEvent,
  getLastStickerEvent,
  getStickerCatalog,
  saveGifEvent,
  saveMetric,
  saveStickerEvent,
} from '../db/supabase.js';
import { pickGifFromCatalog, pickStickerFromCatalog } from '../decision/catalog-policy.js';
import type { SignalClassification, SignalPolicyDecision } from '../types.js';
import { sendAnimation } from './client.js';

const DEFAULT_STICKERS = {
  celebrate: process.env.TELEGRAM_STICKER_CELEBRATE || '',
  support: process.env.TELEGRAM_STICKER_SUPPORT || '',
};

export async function sendSticker(
  chatId: number,
  stickerId: string,
  replyToMessageId?: number
): Promise<void> {
  if (!stickerId) return;

  await fetchWithTimeout(
    `${TELEGRAM_API_BASE}/sendSticker`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        sticker: stickerId,
        reply_to_message_id: replyToMessageId,
      }),
    },
    REQUEST_TIMEOUTS.telegram
  );
}

export async function applyDynamicStickerOrGif(
  userId: number,
  chatId: number,
  messageId: number,
  signal: SignalClassification | SignalPolicyDecision
): Promise<void> {
  const [stickerCatalog, gifCatalog, lastStickerEvent, lastGifEvent] = await Promise.all([
    getStickerCatalog(),
    getGifCatalog(),
    getLastStickerEvent(userId),
    getLastGifEvent(userId),
  ]);

  const selectedSticker = pickStickerFromCatalog(signal, stickerCatalog, lastStickerEvent);
  if (selectedSticker) {
    await sendSticker(chatId, selectedSticker.fileId, messageId);
    await saveStickerEvent(userId, chatId, messageId, selectedSticker.fileId, signal.intent);
    await saveMetric(userId, 'sticker_sent', 1, {
      intent: signal.intent,
      confidence: signal.confidence,
      fileId: selectedSticker.fileId,
    });
    return;
  }

  const selectedGif = pickGifFromCatalog(signal, gifCatalog, lastGifEvent);
  if (selectedGif) {
    await sendAnimation(chatId, selectedGif.fileId, messageId);
    await saveGifEvent(userId, chatId, messageId, selectedGif.fileId, signal.intent);
    await saveMetric(userId, 'gif_sent', 1, {
      intent: signal.intent,
      confidence: signal.confidence,
      fileId: selectedGif.fileId,
    });
    return;
  }

  if (signal.intent === 'celebrate' && DEFAULT_STICKERS.celebrate) {
    await sendSticker(chatId, DEFAULT_STICKERS.celebrate, messageId);
    await saveMetric(userId, 'sticker_sent_fallback', 1, {
      intent: signal.intent,
      confidence: signal.confidence,
      fileId: DEFAULT_STICKERS.celebrate,
    });
    return;
  }

  await saveMetric(userId, 'sticker_gif_skipped', 1, {
    reason: 'no_catalog_match_or_cooldown',
    intent: signal.intent,
    confidence: signal.confidence,
  });
}
