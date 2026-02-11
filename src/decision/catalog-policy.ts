import type {
  CatalogGif,
  CatalogReaction,
  CatalogSticker,
  SignalPolicyDecision,
  SignalClassification,
} from '../types.js';
import {
  TELEGRAM_GIF_MIN_INTERVAL_MS,
  TELEGRAM_REACTION_MIN_INTERVAL_MS,
  TELEGRAM_STICKER_MIN_INTERVAL_MS,
} from '../config.js';

function weightedPick<T extends { weight: number }>(items: T[]): T | null {
  if (items.length === 0) return null;
  const positive = items.map((item) => ({ ...item, weight: Math.max(0.01, item.weight) }));
  const total = positive.reduce((sum, item) => sum + item.weight, 0);
  let point = Math.random() * total;
  for (const item of positive) {
    point -= item.weight;
    if (point <= 0) {
      return item;
    }
  }
  return positive[positive.length - 1];
}

function intentCandidates<T extends { intents: string[] }>(catalog: T[], intent: string): T[] {
  const normalizedIntent = intent.toLowerCase();
  const exact = catalog.filter((item) => item.intents.map((v) => v.toLowerCase()).includes(normalizedIntent));
  if (exact.length > 0) return exact;
  return catalog;
}

function nowTs(): number {
  return Date.now();
}

export function pickReactionFromCatalog(
  signal: SignalClassification | SignalPolicyDecision,
  catalog: CatalogReaction[],
  lastReaction: { emoji: string | null; customEmojiId: string | null; createdAtTs: number } | null
): CatalogReaction | null {
  if (signal.confidence < 0.45) return null;

  const candidates = intentCandidates(catalog.filter((item) => item.enabled), signal.intent);
  const filtered = candidates.filter((item) => {
    const cooldownMs = item.cooldownSec * 1000;
    if (!lastReaction) return true;
    const sameEmoji = item.emoji && item.emoji === lastReaction.emoji;
    const sameCustom = item.customEmojiId && item.customEmojiId === lastReaction.customEmojiId;
    if (!(sameEmoji || sameCustom)) return true;
    return nowTs() - lastReaction.createdAtTs >= Math.max(cooldownMs, TELEGRAM_REACTION_MIN_INTERVAL_MS);
  });

  return weightedPick(filtered);
}

export function pickStickerFromCatalog(
  signal: SignalClassification | SignalPolicyDecision,
  catalog: CatalogSticker[],
  lastSticker: { fileId: string; createdAtTs: number } | null
): CatalogSticker | null {
  if (signal.confidence < 0.5) return null;

  const candidates = intentCandidates(catalog.filter((item) => item.enabled), signal.intent);
  const filtered = candidates.filter((item) => {
    if (!lastSticker) return true;
    const sameFile = item.fileId === lastSticker.fileId;
    if (!sameFile) return true;
    return nowTs() - lastSticker.createdAtTs >= Math.max(item.cooldownSec * 1000, TELEGRAM_STICKER_MIN_INTERVAL_MS);
  });

  return weightedPick(filtered);
}

export function pickGifFromCatalog(
  signal: SignalClassification | SignalPolicyDecision,
  catalog: CatalogGif[],
  lastGif: { fileId: string; createdAtTs: number } | null
): CatalogGif | null {
  if (signal.confidence < 0.55) return null;

  const candidates = intentCandidates(catalog.filter((item) => item.enabled), signal.intent);
  const filtered = candidates.filter((item) => {
    if (!lastGif) return true;
    const sameFile = item.fileId === lastGif.fileId;
    if (!sameFile) return true;
    return nowTs() - lastGif.createdAtTs >= Math.max(item.cooldownSec * 1000, TELEGRAM_GIF_MIN_INTERVAL_MS);
  });

  return weightedPick(filtered);
}
