import type {
  InboundAttachment,
  InboundEventPayload,
  InboundEventRecord,
  Part,
  TelegramUpdate,
} from '../types.js';
import {
  appendInboundEvent,
  getLatestPendingInboundEvent,
  getPendingInboundEvents,
  markInboundEventsProcessed,
} from '../db/supabase.js';
import { downloadFile } from './files.js';
import { parseTextDocument } from '../parsers/documents.js';
import { extractUrls, fetchUrlContent } from '../parsers/urls.js';
import { classifyGifSignalAdvanced, classifyStickerSignalAdvanced } from '../semantics/signal-classifier.js';

const EMPTY_USER_EVENT_TEXT = '[Пользователь отправил сообщение без текста.]';
const UNKNOWN_ATTACHMENT_TEXT = '[Пользователь отправил вложение неподдерживаемого типа.]';

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function buildSignalFallback(): InboundEventPayload['signal'] {
  return {
    kind: 'none',
    emotion: 'unknown',
    intent: 'unknown',
    confidence: 0,
  };
}

async function classifyInboundSignal(update: TelegramUpdate): Promise<InboundEventPayload['signal']> {
  const message = update.message;
  if (!message) return buildSignalFallback();

  if (message.sticker) {
    return classifyStickerSignalAdvanced({
      emoji: message.sticker.emoji,
      setName: message.sticker.set_name,
      fileId: message.sticker.file_id,
    });
  }

  if (message.animation) {
    return classifyGifSignalAdvanced({
      fileId: message.animation.file_id,
      fileName: message.animation.file_name,
      mimeType: message.animation.mime_type,
    });
  }

  return buildSignalFallback();
}

async function enqueueInboundMessageInternal(
  update: TelegramUpdate,
  textValue: string,
  options?: {
    voiceReply?: boolean;
    forceSearch?: boolean;
  }
): Promise<{ eventTs: number; eventId: number } | null> {
  const message = update.message;
  if (!message) return null;

  const payload: InboundEventPayload = {
    messageId: message.message_id,
    date: message.date,
    text: textValue,
    options,
    mediaGroupId: message.media_group_id,
    attachments: extractAttachments(update),
    sticker: message.sticker
      ? {
          fileId: message.sticker.file_id,
          emoji: message.sticker.emoji,
          setName: message.sticker.set_name,
        }
      : undefined,
    signal: await classifyInboundSignal(update),
  };

  const appended = await appendInboundEvent(message.from.id, message.chat.id, Date.now(), payload);
  return { eventTs: appended.eventTs, eventId: appended.id };
}

function extractAttachments(update: TelegramUpdate): InboundAttachment[] {
  const message = update.message;
  if (!message) return [];

  const attachments: InboundAttachment[] = [];

  if (message.photo?.length) {
    const photo = message.photo[message.photo.length - 1];
    attachments.push({ kind: 'photo', fileId: photo.file_id, mimeType: 'image/jpeg' });
  }
  if (message.voice) {
    attachments.push({ kind: 'voice', fileId: message.voice.file_id, mimeType: 'audio/ogg' });
  }
  if (message.audio) {
    attachments.push({ kind: 'audio', fileId: message.audio.file_id, mimeType: message.audio.mime_type });
  }
  if (message.video) {
    attachments.push({ kind: 'video', fileId: message.video.file_id, mimeType: message.video.mime_type || 'video/mp4' });
  }
  if (message.video_note) {
    attachments.push({ kind: 'video_note', fileId: message.video_note.file_id, mimeType: 'video/mp4' });
  }
  if (message.document) {
    attachments.push({
      kind: 'document',
      fileId: message.document.file_id,
      mimeType: message.document.mime_type,
      fileName: message.document.file_name,
    });
  }
  if (message.animation) {
    attachments.push({
      kind: 'animation',
      fileId: message.animation.file_id,
      mimeType: message.animation.mime_type || 'video/mp4',
      fileName: message.animation.file_name,
    });
  }

  return attachments;
}

export async function enqueueInboundMessageWithText(
  update: TelegramUpdate,
  textOverride: string,
  options?: {
    voiceReply?: boolean;
    forceSearch?: boolean;
  }
): Promise<{ eventTs: number; eventId: number } | null> {
  return enqueueInboundMessageInternal(update, textOverride, options);
}

export async function collectBatchUpperEventId(
  userId: number,
  chatId: number,
  initialEventId: number,
  options: {
    debounceMs: number;
    maxWindowMs: number;
    pollMs?: number;
  }
): Promise<number> {
  const debounceMs = Math.max(200, options.debounceMs);
  const maxWindowMs = Math.max(debounceMs, options.maxWindowMs);
  const pollMs = Math.max(100, options.pollMs ?? Math.min(1000, Math.floor(debounceMs / 3)));

  let upperEventId = initialEventId;
  let lastEventSeenAt = Date.now();
  const startedAt = Date.now();

  while (Date.now() - startedAt < maxWindowMs) {
    await sleep(pollMs);
    const latest = await getLatestPendingInboundEvent(userId, chatId);

    if (latest && latest.id > upperEventId) {
      upperEventId = latest.id;
      lastEventSeenAt = Date.now();
      continue;
    }

    if (Date.now() - lastEventSeenAt >= debounceMs) {
      break;
    }
  }

  return upperEventId;
}

export async function resolveBatchUpperEventId(
  userId: number,
  chatId: number,
  fallbackEventId: number
): Promise<number> {
  const latest = await getLatestPendingInboundEvent(userId, chatId);
  if (!latest) return fallbackEventId;
  return Math.max(fallbackEventId, latest.id);
}

function normalizeStickerText(event: InboundEventRecord): string | null {
  if (!event.payload.sticker) return null;
  const emoji = event.payload.sticker.emoji || '🎟️';
  const setName = event.payload.sticker.setName ? ` (${event.payload.sticker.setName})` : '';
  return `[Стикер ${emoji}${setName}]`;
}

async function buildPartsForAttachment(attachment: InboundAttachment): Promise<Part[]> {
  if (attachment.kind === 'photo') {
    const imageData = await downloadFile(attachment.fileId, attachment.mimeType);
    return [
      { inlineData: { mimeType: imageData.mimeType, data: imageData.data } },
      { text: '[Пользователь отправил изображение. Ответь естественно.]' },
    ];
  }

  if (attachment.kind === 'voice' || attachment.kind === 'audio' || attachment.kind === 'video_note') {
    const audioData = await downloadFile(attachment.fileId, attachment.mimeType);
    return [
      { inlineData: { mimeType: audioData.mimeType, data: audioData.data } },
      {
        text: '[Пользователь отправил голосовое/аудио. Ответь на смысл, без заголовков типа "Расшифровка".]',
      },
    ];
  }

  if (attachment.kind === 'video') {
    const videoData = await downloadFile(attachment.fileId, attachment.mimeType || 'video/mp4');
    return [
      { inlineData: { mimeType: videoData.mimeType, data: videoData.data } },
      { text: '[Пользователь отправил видео. Ответь по содержанию естественно.]' },
    ];
  }

  if (attachment.kind === 'animation') {
    const gifData = await downloadFile(attachment.fileId, attachment.mimeType || 'video/mp4');
    return [
      { inlineData: { mimeType: gifData.mimeType, data: gifData.data } },
      { text: '[Пользователь отправил GIF/анимацию. Учитывай эмоциональный контекст.]' },
    ];
  }

  if (attachment.kind === 'document') {
    const fileName = attachment.fileName || 'document';
    const mimeType = attachment.mimeType || '';
    const docData = await downloadFile(attachment.fileId, mimeType);

    if (mimeType.startsWith('image/') || mimeType === 'application/pdf') {
      return [
        { inlineData: { mimeType: docData.mimeType, data: docData.data } },
        { text: `Проанализируй файл: ${fileName}` },
      ];
    }

    if (
      mimeType.startsWith('audio/') ||
      fileName.endsWith('.mp3') ||
      fileName.endsWith('.wav') ||
      fileName.endsWith('.flac') ||
      fileName.endsWith('.m4a') ||
      fileName.endsWith('.ogg')
    ) {
      return [
        { inlineData: { mimeType: docData.mimeType, data: docData.data } },
        { text: `Проанализируй аудиофайл: ${fileName}. Расшифруй речь, если есть.` },
      ];
    }

    if (
      mimeType === 'text/plain' ||
      mimeType === 'text/markdown' ||
      mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
      fileName.endsWith('.txt') ||
      fileName.endsWith('.md') ||
      fileName.endsWith('.docx')
    ) {
      const textContent = await parseTextDocument(docData.buffer, docData.mimeType, fileName);
      const truncatedContent =
        textContent.length > 20000 ? textContent.substring(0, 20000) + '\n\n[...документ обрезан...]' : textContent;
      return [
        {
          text: `[Содержимое документа "${fileName}"]:\n${truncatedContent}\n\nПроанализируй документ.`,
        },
      ];
    }
  }

  return [{ text: UNKNOWN_ATTACHMENT_TEXT }];
}

function buildHistoryText(events: InboundEventRecord[]): string {
  const lines: string[] = [];

  for (const event of events) {
    const text = event.payload.text?.trim();
    const stickerText = normalizeStickerText(event);
    const signal = event.payload.signal;

    if (text) {
      lines.push(text);
    }

    if (stickerText) {
      lines.push(stickerText);
    }

    if (signal && signal.kind !== 'none') {
      lines.push(
        `[Сигнал ${signal.kind}: emotion=${signal.emotion}, intent=${signal.intent}, confidence=${signal.confidence.toFixed(2)}]`
      );
    }

    if (!text && !stickerText && event.payload.attachments.length > 0) {
      const attachmentLabels = event.payload.attachments.map((a) => {
        if (a.kind === 'document' && a.fileName) return `[Документ: ${a.fileName}]`;
        return `[${a.kind}]`;
      });
      lines.push(attachmentLabels.join(' '));
    }
  }

  if (lines.length === 0) {
    return EMPTY_USER_EVENT_TEXT;
  }

  return lines.join('\n');
}

function mergeMediaGroups(events: InboundEventRecord[]): InboundEventRecord[] {
  const grouped = new Map<string, InboundEventRecord>();
  const result: InboundEventRecord[] = [];

  for (const event of events) {
    const mediaGroupId = event.payload.mediaGroupId;
    if (!mediaGroupId) {
      result.push(event);
      continue;
    }

    const existing = grouped.get(mediaGroupId);
    if (!existing) {
      grouped.set(mediaGroupId, {
        ...event,
        payload: {
          ...event.payload,
          attachments: [...event.payload.attachments],
        },
      });
      continue;
    }

    existing.payload.attachments.push(...event.payload.attachments);
    if (!existing.payload.text && event.payload.text) {
      existing.payload.text = event.payload.text;
    }
  }

  const mergedGroups = Array.from(grouped.values());
  const mergedAll = [...result, ...mergedGroups].sort((a, b) => a.event_ts - b.event_ts);
  return mergedAll;
}

export async function buildInboundBatch(
  userId: number,
  chatId: number,
  eventId: number,
  limit: number = 50,
  afterEventId: number = 0
): Promise<{
  parts: Part[];
  historyText: string;
  replyToMessageId?: number;
  eventIds: number[];
  voiceReply: boolean;
  forceSearch: boolean;
}> {
  const events = await getPendingInboundEvents(userId, chatId, eventId, limit, afterEventId);
  const mergedEvents = mergeMediaGroups(events);

  const parts: Part[] = [];

  for (const event of mergedEvents) {
    const baseText = event.payload.text?.trim();
    if (baseText && event.payload.attachments.length === 0 && !event.payload.sticker) {
      const urls = extractUrls(baseText);
      if (urls.length > 0) {
        const urlContents = await Promise.all(urls.slice(0, 3).map(fetchUrlContent));
        parts.push({ text: `${baseText}\n\n${urlContents.join('\n\n')}` });
      } else {
        parts.push({ text: baseText });
      }
    } else if (baseText && event.payload.attachments.length > 0) {
      parts.push({ text: baseText });
    }

    if (event.payload.sticker) {
      const stickerText = normalizeStickerText(event);
      if (stickerText) {
        parts.push({ text: stickerText });
      }
    }

    for (const attachment of event.payload.attachments) {
      const attachmentParts = await buildPartsForAttachment(attachment);
      parts.push(...attachmentParts);
    }
  }

  if (parts.length === 0) {
    parts.push({ text: EMPTY_USER_EVENT_TEXT });
  }

  return {
    parts,
    historyText: buildHistoryText(mergedEvents),
    replyToMessageId: mergedEvents[mergedEvents.length - 1]?.payload.messageId,
    eventIds: events.map((e) => e.id),
    voiceReply: mergedEvents.some((event) => event.payload.options?.voiceReply === true),
    forceSearch: mergedEvents.some((event) => event.payload.options?.forceSearch === true),
  };
}

export async function finalizeInboundBatch(eventIds: number[]): Promise<void> {
  await markInboundEventsProcessed(eventIds);
}
