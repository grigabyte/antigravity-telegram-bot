import { DEFAULT_STICKERS, REQUEST_TIMEOUTS, TELEGRAM_API_BASE } from '../config.js';
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

export async function sendSticker(
  chatId: number,
  stickerId: string,
  replyToMessageId?: number
): Promise<void> {
  if (!stickerId) return;

  const response = await fetchWithTimeout(
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

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`SEND_STICKER_FAILED:${response.status}:${errorText.slice(0, 220)}`);
  }
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
    try {
      await sendSticker(chatId, selectedSticker.fileId, messageId);
      await saveStickerEvent(userId, chatId, messageId, selectedSticker.fileId, signal.intent);
      await saveMetric(userId, 'sticker_sent', 1, {
        intent: signal.intent,
        confidence: signal.confidence,
        fileId: selectedSticker.fileId,
      });
    } catch (error) {
      await saveMetric(userId, 'sticker_gif_skipped', 1, {
        reason: 'sticker_send_failed',
        intent: signal.intent,
        confidence: signal.confidence,
        error: error instanceof Error ? error.message.slice(0, 180) : String(error).slice(0, 180),
      });
    }
    return;
  }

  const selectedGif = pickGifFromCatalog(signal, gifCatalog, lastGifEvent);
  if (selectedGif) {
    try {
      await sendAnimation(chatId, selectedGif.fileId, messageId);
      await saveGifEvent(userId, chatId, messageId, selectedGif.fileId, signal.intent);
      await saveMetric(userId, 'gif_sent', 1, {
        intent: signal.intent,
        confidence: signal.confidence,
        fileId: selectedGif.fileId,
      });
    } catch (error) {
      await saveMetric(userId, 'sticker_gif_skipped', 1, {
        reason: 'gif_send_failed',
        intent: signal.intent,
        confidence: signal.confidence,
        error: error instanceof Error ? error.message.slice(0, 180) : String(error).slice(0, 180),
      });
    }
    return;
  }

  if (signal.intent === 'celebrate' && DEFAULT_STICKERS.celebrate) {
    try {
      await sendSticker(chatId, DEFAULT_STICKERS.celebrate, messageId);
      await saveMetric(userId, 'sticker_sent_fallback', 1, {
        intent: signal.intent,
        confidence: signal.confidence,
        fileId: DEFAULT_STICKERS.celebrate,
      });
    } catch (error) {
      await saveMetric(userId, 'sticker_gif_skipped', 1, {
        reason: 'fallback_celebrate_send_failed',
        intent: signal.intent,
        confidence: signal.confidence,
        error: error instanceof Error ? error.message.slice(0, 180) : String(error).slice(0, 180),
      });
    }
    return;
  }

  if (signal.intent === 'support' && DEFAULT_STICKERS.support) {
    try {
      await sendSticker(chatId, DEFAULT_STICKERS.support, messageId);
      await saveMetric(userId, 'sticker_sent_fallback', 1, {
        intent: signal.intent,
        confidence: signal.confidence,
        fileId: DEFAULT_STICKERS.support,
      });
    } catch (error) {
      await saveMetric(userId, 'sticker_gif_skipped', 1, {
        reason: 'fallback_support_send_failed',
        intent: signal.intent,
        confidence: signal.confidence,
        error: error instanceof Error ? error.message.slice(0, 180) : String(error).slice(0, 180),
      });
    }
    return;
  }

  await saveMetric(userId, 'sticker_gif_skipped', 1, {
    reason: 'no_catalog_match_or_cooldown',
    intent: signal.intent,
    confidence: signal.confidence,
  });
}
