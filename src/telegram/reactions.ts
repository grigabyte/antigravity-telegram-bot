import { REQUEST_TIMEOUTS, TELEGRAM_API_BASE } from '../config.js';
import { fetchWithTimeout } from '../network/fetch.js';
import {
  getLastReactionEvent,
  getReactionCatalog,
  saveMetric,
  saveReactionEvent,
} from '../db/supabase.js';
import { pickReactionFromCatalog } from '../decision/catalog-policy.js';
import type { SignalClassification, SignalPolicyDecision } from '../types.js';

export async function setMessageReaction(
  chatId: number,
  messageId: number,
  emoji: string,
  customEmojiId?: string
): Promise<void> {
  const reaction = customEmojiId
    ? [{ type: 'custom_emoji', custom_emoji_id: customEmojiId }]
    : [{ type: 'emoji', emoji }];

  const response = await fetchWithTimeout(
    `${TELEGRAM_API_BASE}/setMessageReaction`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        message_id: messageId,
        reaction,
      }),
    },
    REQUEST_TIMEOUTS.telegram
  );

  if (!response.ok) {
    const text = await response.text();
    console.warn('Failed to set reaction:', text.slice(0, 200));
  }
}

export async function applyDynamicReaction(
  userId: number,
  chatId: number,
  messageId: number,
  signal: SignalClassification | SignalPolicyDecision
): Promise<void> {
  const [catalog, lastEvent] = await Promise.all([
    getReactionCatalog(),
    getLastReactionEvent(userId),
  ]);

  const selected = pickReactionFromCatalog(signal, catalog, lastEvent);
  if (!selected) {
    await saveMetric(userId, 'reaction_skipped', 1, {
      reason: 'no_catalog_match_or_cooldown',
      intent: signal.intent,
      confidence: signal.confidence,
    });
    return;
  }

  await setMessageReaction(chatId, messageId, selected.emoji || '👍', selected.customEmojiId || undefined);
  await saveReactionEvent(
    userId,
    chatId,
    messageId,
    selected.emoji,
    selected.customEmojiId,
    signal.intent
  );

  await saveMetric(userId, 'reaction_sent', 1, {
    intent: signal.intent,
    confidence: signal.confidence,
    emoji: selected.emoji,
    customEmojiId: selected.customEmojiId,
  });
}
