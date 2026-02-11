import { MAX_HISTORY_MESSAGES, REQUEST_TIMEOUTS, SUPABASE_KEY, SUPABASE_URL } from '../config.js';
import { fetchWithTimeout } from '../network/fetch.js';
import type {
  CatalogGif,
  CatalogReaction,
  CatalogSticker,
  ChatMessage,
  InboundEventPayload,
  InboundEventRecord,
  LongTermMemory,
  MemoryVectorHit,
  SignalClassification,
} from '../types.js';

export interface UserSettings {
  insights: string;
  timezone: string;
  locale: string;
  quietHoursStart: number;
  quietHoursEnd: number;
}

export async function supabaseQuery(
  table: string,
  method: string,
  body?: unknown,
  query?: string
): Promise<any> {
  const url = `${SUPABASE_URL}/rest/v1/${table}${query || ''}`;
  const headers: Record<string, string> = {
    'apikey': SUPABASE_KEY,
    'Authorization': `Bearer ${SUPABASE_KEY}`,
    'Content-Type': 'application/json',
    'Prefer': method === 'POST' ? 'return=representation' : 'return=minimal',
  };

  const response = await fetchWithTimeout(
    url,
    {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    },
    REQUEST_TIMEOUTS.supabase
  );

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Supabase error: ${error}`);
  }

  const text = await response.text();
  return text ? JSON.parse(text) : null;
}

export async function getHistory(userId: number, limit: number = MAX_HISTORY_MESSAGES): Promise<ChatMessage[]> {
  const data = await supabaseQuery(
    'chat_history',
    'GET',
    null,
    `?user_id=eq.${userId}&order=timestamp.asc&limit=${limit}`
  );
  return (data || []).map((row: any) => ({
    role: row.role as 'user' | 'model',
    content: row.content,
    timestamp: row.timestamp,
  }));
}

export async function getActiveHistory(
  userId: number,
  limit: number = MAX_HISTORY_MESSAGES
): Promise<ChatMessage[]> {
  const data = await supabaseQuery(
    'chat_history',
    'GET',
    null,
    `?user_id=eq.${userId}&is_compressed=eq.false&order=timestamp.asc&limit=${limit}`
  );
  return (data || []).map((row: any) => ({
    role: row.role as 'user' | 'model',
    content: row.content,
    timestamp: row.timestamp,
  }));
}

export async function getRecentHistory(userId: number, limit: number): Promise<ChatMessage[]> {
  const data = await supabaseQuery(
    'chat_history',
    'GET',
    null,
    `?user_id=eq.${userId}&is_compressed=eq.false&order=timestamp.desc&limit=${limit}`
  );
  return (data || [])
    .map((row: any) => ({
      role: row.role as 'user' | 'model',
      content: row.content,
      timestamp: row.timestamp,
    }))
    .reverse();
}

export async function addToHistory(userId: number, msg: ChatMessage): Promise<void> {
  await supabaseQuery('chat_history', 'POST', {
    user_id: userId,
    role: msg.role,
    content: msg.content,
    timestamp: msg.timestamp,
  });
}

export async function clearHistory(userId: number): Promise<void> {
  await supabaseQuery('chat_history', 'DELETE', null, `?user_id=eq.${userId}`);
}

export async function markHistoryRangeCompressed(
  userId: number,
  startTimestamp: number,
  endTimestamp: number
): Promise<void> {
  await supabaseQuery(
    'chat_history',
    'PATCH',
    { is_compressed: true },
    `?user_id=eq.${userId}&is_compressed=eq.false&timestamp=gte.${startTimestamp}&timestamp=lte.${endTimestamp}`
  );
}

export async function getUserSettings(userId: number): Promise<UserSettings> {
  const data = await supabaseQuery('user_settings', 'GET', null, `?user_id=eq.${userId}`);
  if (data && data.length > 0) {
    return {
      insights: data[0].insights || '',
      timezone: data[0].timezone || 'Europe/Moscow',
      locale: data[0].locale || 'ru-RU',
      quietHoursStart: Number.isFinite(data[0].quiet_hours_start) ? data[0].quiet_hours_start : 23,
      quietHoursEnd: Number.isFinite(data[0].quiet_hours_end) ? data[0].quiet_hours_end : 9,
    };
  }
  return {
    insights: '',
    timezone: 'Europe/Moscow',
    locale: 'ru-RU',
    quietHoursStart: 23,
    quietHoursEnd: 9,
  };
}

export async function saveUserSettings(userId: number, insights: string): Promise<void> {
  await supabaseQuery(
    'user_settings',
    'POST',
    {
      user_id: userId,
      insights,
      updated_at: new Date().toISOString(),
    },
    '?on_conflict=user_id'
  );
}

export async function setUserTimezone(userId: number, timezone: string): Promise<void> {
  await supabaseQuery(
    'user_settings',
    'POST',
    {
      user_id: userId,
      timezone,
      updated_at: new Date().toISOString(),
    },
    '?on_conflict=user_id'
  );
}

export async function setUserQuietHours(userId: number, startHour: number, endHour: number): Promise<void> {
  await supabaseQuery(
    'user_settings',
    'POST',
    {
      user_id: userId,
      quiet_hours_start: startHour,
      quiet_hours_end: endHour,
      updated_at: new Date().toISOString(),
    },
    '?on_conflict=user_id'
  );
}

export async function getLongTermMemory(userId: number): Promise<LongTermMemory> {
  const data = await supabaseQuery(
    'long_term_memory',
    'GET',
    null,
    `?user_id=eq.${userId}&order=created_at.asc`
  );

  const memory: LongTermMemory = {
    facts: [],
    preferences: [],
    goals: [],
    updatedAt: Date.now(),
  };

  for (const row of data || []) {
    if (row.type === 'fact') memory.facts.push(row.content);
    else if (row.type === 'preference') memory.preferences.push(row.content);
    else if (row.type === 'goal') memory.goals.push(row.content);
  }

  return memory;
}

export async function addMemoryItem(
  userId: number,
  type: 'fact' | 'preference' | 'goal',
  content: string
): Promise<void> {
  const existing = await supabaseQuery(
    'long_term_memory',
    'GET',
    null,
    `?user_id=eq.${userId}&type=eq.${type}&content=eq.${encodeURIComponent(content)}`
  );

  if (existing && existing.length > 0) return;

  await supabaseQuery('long_term_memory', 'POST', {
    user_id: userId,
    type,
    content,
  });
}

export async function clearLongTermMemory(userId: number): Promise<void> {
  await supabaseQuery('long_term_memory', 'DELETE', null, `?user_id=eq.${userId}`);
}

export async function saveLastSources(
  userId: number,
  sources: Array<{ title: string; url: string }>
): Promise<void> {
  await supabaseQuery(
    'last_sources',
    'POST',
    {
      user_id: userId,
      sources,
      updated_at: new Date().toISOString(),
    },
    '?on_conflict=user_id'
  );
}

export async function getLastSources(userId: number): Promise<Array<{ title: string; url: string }>> {
  const data = await supabaseQuery('last_sources', 'GET', null, `?user_id=eq.${userId}`);
  if (data && data.length > 0) {
    try {
      const raw = data[0].sources;
      if (Array.isArray(raw)) {
        return raw;
      }
      if (typeof raw === 'string') {
        return JSON.parse(raw) || [];
      }
      return [];
    } catch {
      return [];
    }
  }
  return [];
}

export async function saveChatSummary(
  userId: number,
  summary: string,
  messagesCompressed: number
): Promise<void> {
  await supabaseQuery('chat_summaries', 'POST', {
    user_id: userId,
    summary,
    messages_compressed: messagesCompressed,
    created_at: new Date().toISOString(),
  });
}

export async function getChatSummaries(userId: number): Promise<string[]> {
  const data = await supabaseQuery(
    'chat_summaries',
    'GET',
    null,
    `?user_id=eq.${userId}&order=created_at.asc`
  );
  return (data || []).map((row: any) => row.summary);
}

export async function clearChatSummaries(userId: number): Promise<void> {
  await supabaseQuery('chat_summaries', 'DELETE', null, `?user_id=eq.${userId}`);
}

export async function appendInboundEvent(
  userId: number,
  chatId: number,
  eventTs: number,
  payload: InboundEventPayload
): Promise<{ id: number; eventTs: number }> {
  const rows = await supabaseQuery('inbound_events', 'POST', {
    user_id: userId,
    chat_id: chatId,
    event_ts: eventTs,
    payload,
    processed: false,
  });

  const first = Array.isArray(rows) ? rows[0] : null;
  if (!first?.id) {
    throw new Error('Failed to append inbound event');
  }

  return { id: first.id, eventTs: first.event_ts };
}

export async function getPendingInboundEvents(
  userId: number,
  chatId: number,
  beforeTimestamp: number,
  limit: number = 50
): Promise<InboundEventRecord[]> {
  const data = await supabaseQuery(
    'inbound_events',
    'GET',
    null,
    `?user_id=eq.${userId}&chat_id=eq.${chatId}&processed=eq.false&event_ts=lte.${beforeTimestamp}&order=event_ts.asc&limit=${limit}`
  );

  return (data || []).map((row: any) => ({
    id: row.id,
    user_id: row.user_id,
    chat_id: row.chat_id,
    event_ts: row.event_ts,
    payload: row.payload,
    processed: row.processed,
  }));
}

export async function markInboundEventsProcessed(ids: number[]): Promise<void> {
  if (ids.length === 0) return;
  await supabaseQuery('inbound_events', 'PATCH', { processed: true }, `?id=in.(${ids.join(',')})`);
}

export async function getLatestPendingInboundEvent(
  userId: number,
  chatId: number
): Promise<{ id: number; eventTs: number } | null> {
  const data = await supabaseQuery(
    'inbound_events',
    'GET',
    null,
    `?user_id=eq.${userId}&chat_id=eq.${chatId}&processed=eq.false&order=event_ts.desc,id.desc&limit=1`
  );

  const first = data?.[0];
  if (!first) {
    return null;
  }

  return { id: first.id, eventTs: first.event_ts };
}

export async function clearInboundEvents(userId: number): Promise<void> {
  await supabaseQuery('inbound_events', 'DELETE', null, `?user_id=eq.${userId}`);
}

export async function clearProactiveJobs(userId: number): Promise<void> {
  await supabaseQuery('proactive_jobs', 'DELETE', null, `?user_id=eq.${userId}`);
}

export async function countPendingProactiveJobs(userId: number): Promise<number> {
  const rows = await supabaseQuery(
    'proactive_jobs',
    'GET',
    null,
    `?user_id=eq.${userId}&status=eq.pending&select=id`
  );
  return Array.isArray(rows) ? rows.length : 0;
}

export async function saveMessageSignal(
  userId: number,
  chatId: number,
  messageId: number,
  signalType: 'sticker' | 'gif' | 'reaction',
  signal: SignalClassification,
  rawMeta: Record<string, unknown> = {}
): Promise<void> {
  await supabaseQuery('message_signals', 'POST', {
    user_id: userId,
    chat_id: chatId,
    message_id: messageId,
    signal_type: signalType,
    emotion: signal.emotion,
    intent: signal.intent,
    confidence: signal.confidence,
    note: signal.note || '',
    raw_meta: rawMeta,
  });
}

export async function getRecentSignals(
  userId: number,
  limit: number = 15
): Promise<Array<{ intent: string; emotion: string; note: string; createdAt: string }>> {
  const rows = await supabaseQuery(
    'message_signals',
    'GET',
    null,
    `?user_id=eq.${userId}&order=created_at.desc&limit=${limit}`
  );

  return (rows || []).map((row: any) => ({
    intent: row.intent || 'unknown',
    emotion: row.emotion || 'unknown',
    note: row.note || '',
    createdAt: row.created_at,
  }));
}

export async function getReactionCatalog(): Promise<CatalogReaction[]> {
  const rows = await supabaseQuery('reaction_catalog', 'GET', null, '?enabled=eq.true&order=weight.desc');
  return (rows || []).map((row: any) => ({
    id: row.id,
    emoji: row.emoji || null,
    customEmojiId: row.custom_emoji_id || null,
    intents: Array.isArray(row.intents) ? row.intents : [],
    weight: Number(row.weight || 1),
    enabled: !!row.enabled,
    cooldownSec: Number(row.cooldown_sec || 60),
  }));
}

export async function getStickerCatalog(): Promise<CatalogSticker[]> {
  const rows = await supabaseQuery('sticker_catalog', 'GET', null, '?enabled=eq.true&order=weight.desc');
  return (rows || []).map((row: any) => ({
    id: row.id,
    fileId: row.file_id,
    setName: row.set_name || null,
    intents: Array.isArray(row.intents) ? row.intents : [],
    weight: Number(row.weight || 1),
    enabled: !!row.enabled,
    cooldownSec: Number(row.cooldown_sec || 180),
  }));
}

export async function getGifCatalog(): Promise<CatalogGif[]> {
  const rows = await supabaseQuery('gif_catalog', 'GET', null, '?enabled=eq.true&order=weight.desc');
  return (rows || []).map((row: any) => ({
    id: row.id,
    fileId: row.file_id,
    intents: Array.isArray(row.intents) ? row.intents : [],
    weight: Number(row.weight || 1),
    enabled: !!row.enabled,
    cooldownSec: Number(row.cooldown_sec || 180),
  }));
}

export async function getLastReactionEvent(
  userId: number
): Promise<{ emoji: string | null; customEmojiId: string | null; createdAtTs: number } | null> {
  const rows = await supabaseQuery(
    'reaction_events',
    'GET',
    null,
    `?user_id=eq.${userId}&order=created_at.desc&limit=1`
  );
  const row = rows?.[0];
  if (!row) return null;
  return {
    emoji: row.emoji || null,
    customEmojiId: row.custom_emoji_id || null,
    createdAtTs: new Date(row.created_at).getTime(),
  };
}

export async function getLastStickerEvent(
  userId: number
): Promise<{ fileId: string; createdAtTs: number } | null> {
  const rows = await supabaseQuery(
    'sticker_events',
    'GET',
    null,
    `?user_id=eq.${userId}&order=created_at.desc&limit=1`
  );
  const row = rows?.[0];
  if (!row) return null;
  return {
    fileId: row.file_id,
    createdAtTs: new Date(row.created_at).getTime(),
  };
}

export async function getLastGifEvent(
  userId: number
): Promise<{ fileId: string; createdAtTs: number } | null> {
  const rows = await supabaseQuery(
    'gif_events',
    'GET',
    null,
    `?user_id=eq.${userId}&order=created_at.desc&limit=1`
  );
  const row = rows?.[0];
  if (!row) return null;
  return {
    fileId: row.file_id,
    createdAtTs: new Date(row.created_at).getTime(),
  };
}

export async function saveReactionEvent(
  userId: number,
  chatId: number,
  messageId: number,
  emoji: string | null,
  customEmojiId: string | null,
  intent: string
): Promise<void> {
  await supabaseQuery('reaction_events', 'POST', {
    user_id: userId,
    chat_id: chatId,
    message_id: messageId,
    emoji,
    custom_emoji_id: customEmojiId,
    intent,
  });
}

export async function saveStickerEvent(
  userId: number,
  chatId: number,
  messageId: number,
  fileId: string,
  intent: string
): Promise<void> {
  await supabaseQuery('sticker_events', 'POST', {
    user_id: userId,
    chat_id: chatId,
    message_id: messageId,
    file_id: fileId,
    intent,
  });
}

export async function saveGifEvent(
  userId: number,
  chatId: number,
  messageId: number,
  fileId: string,
  intent: string
): Promise<void> {
  await supabaseQuery('gif_events', 'POST', {
    user_id: userId,
    chat_id: chatId,
    message_id: messageId,
    file_id: fileId,
    intent,
  });
}

export async function addMemoryItemV2(
  userId: number,
  kind: 'fact' | 'pref' | 'goal' | 'episode' | 'signal',
  content: string,
  importance: number,
  confidence: number,
  sourceMessageId?: number,
  pinned: boolean = false
): Promise<number> {
  const rows = await supabaseQuery('memory_items_v2', 'POST', {
    user_id: userId,
    kind,
    content,
    importance,
    confidence,
    source_message_id: sourceMessageId || null,
    pinned,
  });

  const row = rows?.[0];
  if (!row?.id) {
    throw new Error('Failed to add memory item v2');
  }

  return row.id;
}

export async function addMemoryChunk(
  userId: number,
  memoryItemId: number,
  chunkText: string,
  embedding: number[],
  chunkMeta: Record<string, unknown> = {}
): Promise<void> {
  await supabaseQuery('memory_chunks', 'POST', {
    user_id: userId,
    memory_item_id: memoryItemId,
    chunk_text: chunkText,
    embedding,
    chunk_meta: chunkMeta,
  });
}

export async function searchMemoryVectors(
  userId: number,
  queryEmbedding: number[],
  topK: number = 8
): Promise<MemoryVectorHit[]> {
  const rows = await supabaseQuery('rpc/match_memory_chunks', 'POST', {
    p_user_id: userId,
    p_query_embedding: queryEmbedding,
    p_top_k: topK,
  });

  return (rows || []).map((row: any) => ({
    chunkId: row.chunk_id,
    memoryItemId: row.memory_item_id,
    chunkText: row.chunk_text,
    similarity: Number(row.similarity || 0),
    importance: Number(row.importance || 0),
    createdAt: row.created_at,
  }));
}

export async function setMemoryPinned(memoryItemId: number, pinned: boolean): Promise<void> {
  await supabaseQuery('memory_items_v2', 'PATCH', { pinned }, `?id=eq.${memoryItemId}`);
}

export async function saveMetric(
  userId: number,
  metricName: string,
  metricValue: number,
  meta: Record<string, unknown> = {}
): Promise<void> {
  await supabaseQuery('metrics_events', 'POST', {
    user_id: userId,
    metric_name: metricName,
    metric_value: metricValue,
    meta,
  });
}
