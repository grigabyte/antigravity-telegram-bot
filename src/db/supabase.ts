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

interface PostgrestErrorShape {
  code?: string;
  message?: string;
  details?: string;
  hint?: string;
}

export interface UserSettings {
  insights: string;
  timezone: string;
  locale: string;
  quietHoursStart: number;
  quietHoursEnd: number;
}

function parseErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  return '';
}

function parsePostgrestError(raw: string): PostgrestErrorShape | null {
  try {
    const parsed = JSON.parse(raw) as PostgrestErrorShape;
    if (parsed && typeof parsed === 'object') {
      return parsed;
    }
    return null;
  } catch {
    return null;
  }
}

function isDuplicateKeyError(error: unknown): boolean {
  const message = parseErrorMessage(error).toLowerCase();
  return message.includes('duplicate key') || message.includes('23505');
}

function isMissingRelationError(error: unknown, relationName?: string): boolean {
  const message = parseErrorMessage(error).toLowerCase();
  if (!(message.includes('42p01') || message.includes('relation') && message.includes('does not exist'))) {
    return false;
  }

  if (!relationName) return true;
  return message.includes(`"${relationName.toLowerCase()}"`) || message.includes(relationName.toLowerCase());
}

function isUndefinedFunctionError(error: unknown, functionName?: string): boolean {
  const message = parseErrorMessage(error).toLowerCase();
  if (!(message.includes('42883') || message.includes('function') && message.includes('does not exist'))) {
    return false;
  }

  if (!functionName) return true;
  return message.includes(functionName.toLowerCase());
}

function shouldIgnoreMissingRelation(error: unknown, relationName: string): boolean {
  const missing = isMissingRelationError(error, relationName);
  if (missing) {
    console.warn(`Optional table/relation is missing: ${relationName}`);
  }
  return missing;
}

function shouldIgnoreMissingFunction(error: unknown, functionName: string): boolean {
  const missing = isUndefinedFunctionError(error, functionName);
  if (missing) {
    console.warn(`Optional database function is missing: ${functionName}`);
  }
  return missing;
}

export function isSupabaseMissingRelationError(error: unknown, relationName?: string): boolean {
  return isMissingRelationError(error, relationName);
}

export async function supabaseQuery(
  table: string,
  method: string,
  body?: unknown,
  query?: string,
  preferHeader?: string
): Promise<any> {
  const url = `${SUPABASE_URL}/rest/v1/${table}${query || ''}`;
  const headers: Record<string, string> = {
    'apikey': SUPABASE_KEY,
    'Authorization': `Bearer ${SUPABASE_KEY}`,
    'Content-Type': 'application/json',
    'Prefer':
      preferHeader ||
      (method === 'POST'
        ? 'return=representation,resolution=merge-duplicates'
        : 'return=minimal'),
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
    const errorText = await response.text();
    const parsed = parsePostgrestError(errorText);
    const code = parsed?.code ? `${parsed.code} ` : '';
    const message = parsed?.message || errorText;
    const details = parsed?.details ? ` | ${parsed.details}` : '';
    throw new Error(`Supabase error: ${code}${message}${details}`.trim());
  }

  const text = await response.text();
  return text ? JSON.parse(text) : null;
}

export async function getHistory(userId: number, limit: number = MAX_HISTORY_MESSAGES): Promise<ChatMessage[]> {
  let data: any[] | null = null;

  if (Number.isFinite(limit) && limit > 0) {
    data = await supabaseQuery(
      'chat_history',
      'GET',
      null,
      `?user_id=eq.${userId}&order=timestamp.desc&limit=${limit}`
    );
    data = (data || []).sort((a: any, b: any) => Number(a.timestamp) - Number(b.timestamp));
  } else {
    data = await supabaseQuery(
      'chat_history',
      'GET',
      null,
      `?user_id=eq.${userId}&order=timestamp.asc`
    );
  }

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

function mapHistoryRows(userId: number, history: ChatMessage[]): Array<{
  user_id: number;
  role: 'user' | 'model';
  content: string;
  timestamp: number;
}> {
  return history.map((msg) => ({
    user_id: userId,
    role: msg.role,
    content: msg.content,
    timestamp: msg.timestamp,
  }));
}

export async function replaceHistorySafely(userId: number, history: ChatMessage[]): Promise<void> {
  const normalized = history.slice(-MAX_HISTORY_MESSAGES);
  const backup = await getHistory(userId);

  await clearHistory(userId);

  try {
    if (normalized.length > 0) {
      await supabaseQuery('chat_history', 'POST', mapHistoryRows(userId, normalized));
    }
  } catch (error) {
    try {
      await clearHistory(userId);
      if (backup.length > 0) {
        await supabaseQuery('chat_history', 'POST', mapHistoryRows(userId, backup));
      }
    } catch (restoreError) {
      console.error('Failed to restore chat history after import failure:', parseErrorMessage(restoreError));
    }
    throw error;
  }
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
  const payload = {
    user_id: userId,
    insights,
    updated_at: new Date().toISOString(),
  };

  try {
    await supabaseQuery('user_settings', 'POST', payload, '?on_conflict=user_id');
  } catch (error) {
    if (!isDuplicateKeyError(error)) {
      throw error;
    }

    await supabaseQuery('user_settings', 'PATCH', { insights, updated_at: payload.updated_at }, `?user_id=eq.${userId}`);
  }
}

export async function setUserTimezone(userId: number, timezone: string): Promise<void> {
  const payload = {
    user_id: userId,
    timezone,
    updated_at: new Date().toISOString(),
  };

  try {
    await supabaseQuery('user_settings', 'POST', payload, '?on_conflict=user_id');
  } catch (error) {
    if (!isDuplicateKeyError(error)) {
      throw error;
    }

    await supabaseQuery(
      'user_settings',
      'PATCH',
      { timezone: payload.timezone, updated_at: payload.updated_at },
      `?user_id=eq.${userId}`
    );
  }
}

export async function setUserQuietHours(userId: number, startHour: number, endHour: number): Promise<void> {
  const payload = {
    user_id: userId,
    quiet_hours_start: startHour,
    quiet_hours_end: endHour,
    updated_at: new Date().toISOString(),
  };

  try {
    await supabaseQuery('user_settings', 'POST', payload, '?on_conflict=user_id');
  } catch (error) {
    if (!isDuplicateKeyError(error)) {
      throw error;
    }

    await supabaseQuery(
      'user_settings',
      'PATCH',
      {
        quiet_hours_start: payload.quiet_hours_start,
        quiet_hours_end: payload.quiet_hours_end,
        updated_at: payload.updated_at,
      },
      `?user_id=eq.${userId}`
    );
  }
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

function dedupeMemoryValues(values: string[]): string[] {
  const seen = new Set<string>();
  const deduped: string[] = [];

  for (const value of values) {
    const trimmed = value.trim();
    if (!trimmed) continue;
    if (seen.has(trimmed)) continue;
    seen.add(trimmed);
    deduped.push(trimmed);
  }

  return deduped;
}

function assertNoDuplicateLongTermMemory(memory: { facts: string[]; preferences: string[]; goals: string[] }): void {
  const facts = dedupeMemoryValues(memory.facts);
  const preferences = dedupeMemoryValues(memory.preferences);
  const goals = dedupeMemoryValues(memory.goals);

  if (facts.length !== memory.facts.length || preferences.length !== memory.preferences.length || goals.length !== memory.goals.length) {
    throw new Error('LONG_TERM_MEMORY_DUPLICATES_DETECTED');
  }
}

export async function clearLongTermMemory(userId: number): Promise<void> {
  await supabaseQuery('long_term_memory', 'DELETE', null, `?user_id=eq.${userId}`);
}

export async function replaceLongTermMemorySafely(
  userId: number,
  memory: { facts: string[]; preferences: string[]; goals: string[] }
): Promise<void> {
  assertNoDuplicateLongTermMemory(memory);

  const backup = await getLongTermMemory(userId);

  await clearLongTermMemory(userId);

  try {
    for (const fact of memory.facts) {
      await addMemoryItem(userId, 'fact', fact);
    }
    for (const pref of memory.preferences) {
      await addMemoryItem(userId, 'preference', pref);
    }
    for (const goal of memory.goals) {
      await addMemoryItem(userId, 'goal', goal);
    }
  } catch (error) {
    try {
      await clearLongTermMemory(userId);
      for (const fact of backup.facts) {
        await addMemoryItem(userId, 'fact', fact);
      }
      for (const pref of backup.preferences) {
        await addMemoryItem(userId, 'preference', pref);
      }
      for (const goal of backup.goals) {
        await addMemoryItem(userId, 'goal', goal);
      }
    } catch (restoreError) {
      console.error('Failed to restore long-term memory after import failure:', parseErrorMessage(restoreError));
    }
    throw error;
  }
}

export async function saveLastSources(
  userId: number,
  sources: Array<{ title: string; url: string }>
): Promise<void> {
  const payload = {
    user_id: userId,
    sources,
    updated_at: new Date().toISOString(),
  };

  try {
    await supabaseQuery('last_sources', 'POST', payload, '?on_conflict=user_id');
  } catch (error) {
    if (!isDuplicateKeyError(error)) {
      throw error;
    }

    await supabaseQuery(
      'last_sources',
      'PATCH',
      {
        sources: payload.sources,
        updated_at: payload.updated_at,
      },
      `?user_id=eq.${userId}`
    );
  }
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
  let rows: any[] | null = null;
  try {
    rows = await supabaseQuery('inbound_events', 'POST', {
      user_id: userId,
      chat_id: chatId,
      event_ts: eventTs,
      payload,
      processed: false,
    });
  } catch (error) {
    if (shouldIgnoreMissingRelation(error, 'inbound_events')) {
      throw new Error('SCHEMA_MISSING:inbound_events');
    }
    throw error;
  }

  const first = Array.isArray(rows) ? rows[0] : null;
  if (!first?.id) {
    throw new Error('Failed to append inbound event');
  }

  return { id: first.id, eventTs: first.event_ts };
}

export async function getPendingInboundEvents(
  userId: number,
  chatId: number,
  beforeId: number,
  limit: number = 50,
  afterId: number = 0
): Promise<InboundEventRecord[]> {
  let data: any[] | null = null;
  try {
    data = await supabaseQuery(
      'inbound_events',
      'GET',
      null,
      `?user_id=eq.${userId}&chat_id=eq.${chatId}&processed=eq.false&id=gt.${afterId}&id=lte.${beforeId}&order=id.desc&limit=${limit}`
    );
  } catch (error) {
    if (shouldIgnoreMissingRelation(error, 'inbound_events')) {
      return [];
    }
    throw error;
  }

  return (data || [])
    .map((row: any) => ({
      id: row.id,
      user_id: row.user_id,
      chat_id: row.chat_id,
      event_ts: row.event_ts,
      payload: row.payload,
      processed: row.processed,
    }))
    .sort((a, b) => a.id - b.id);
}

export async function markInboundEventsProcessed(ids: number[]): Promise<void> {
  if (ids.length === 0) return;
  try {
    await supabaseQuery('inbound_events', 'PATCH', { processed: true }, `?id=in.(${ids.join(',')})`);
  } catch (error) {
    if (shouldIgnoreMissingRelation(error, 'inbound_events')) {
      return;
    }
    throw error;
  }
}

export async function getLatestPendingInboundEvent(
  userId: number,
  chatId: number
): Promise<{ id: number; eventTs: number } | null> {
  let data: any[] | null = null;
  try {
    data = await supabaseQuery(
      'inbound_events',
      'GET',
      null,
      `?user_id=eq.${userId}&chat_id=eq.${chatId}&processed=eq.false&order=id.desc&limit=1`
    );
  } catch (error) {
    if (shouldIgnoreMissingRelation(error, 'inbound_events')) {
      return null;
    }
    throw error;
  }

  const first = data?.[0];
  if (!first) {
    return null;
  }

  return { id: first.id, eventTs: first.event_ts };
}

export async function getPendingInboundChatPairs(limit: number = 20): Promise<Array<{ userId: number; chatId: number }>> {
  let rows: Array<{ user_id: number; chat_id: number }> | null = null;
  try {
    rows = await supabaseQuery(
      'inbound_events',
      'GET',
      null,
      `?processed=eq.false&select=user_id,chat_id&order=id.desc&limit=${limit}`
    );
  } catch (error) {
    if (shouldIgnoreMissingRelation(error, 'inbound_events')) {
      return [];
    }
    throw error;
  }

  const unique = new Map<string, { userId: number; chatId: number }>();
  for (const row of rows || []) {
    const userId = Number(row.user_id);
    const chatId = Number(row.chat_id);
    if (!Number.isFinite(userId) || !Number.isFinite(chatId) || userId <= 0 || chatId <= 0) {
      continue;
    }
    const key = `${userId}:${chatId}`;
    if (!unique.has(key)) {
      unique.set(key, { userId, chatId });
    }
  }

  return Array.from(unique.values());
}

export async function clearInboundEvents(userId: number): Promise<void> {
  try {
    await supabaseQuery('inbound_events', 'DELETE', null, `?user_id=eq.${userId}`);
  } catch (error) {
    if (shouldIgnoreMissingRelation(error, 'inbound_events')) {
      return;
    }
    throw error;
  }
}

export async function clearProcessedInboundEventsBeforeOrEqual(
  userId: number,
  chatId: number,
  maxEventIdInclusive: number
): Promise<void> {
  if (!Number.isFinite(maxEventIdInclusive) || maxEventIdInclusive <= 0) {
    return;
  }

  try {
    await supabaseQuery(
      'inbound_events',
      'DELETE',
      null,
      `?user_id=eq.${userId}&chat_id=eq.${chatId}&processed=eq.true&id=lte.${maxEventIdInclusive}`
    );
  } catch (error) {
    if (shouldIgnoreMissingRelation(error, 'inbound_events')) {
      return;
    }
    throw error;
  }
}

export async function clearProactiveJobs(userId: number): Promise<void> {
  try {
    await supabaseQuery('proactive_jobs', 'DELETE', null, `?user_id=eq.${userId}`);
  } catch (error) {
    if (shouldIgnoreMissingRelation(error, 'proactive_jobs')) {
      return;
    }
    throw error;
  }
}

export async function countPendingProactiveJobs(userId: number): Promise<number> {
  let rows: any[] | null = null;
  try {
    rows = await supabaseQuery(
      'proactive_jobs',
      'GET',
      null,
      `?user_id=eq.${userId}&status=eq.pending&select=id`
    );
  } catch (error) {
    if (shouldIgnoreMissingRelation(error, 'proactive_jobs')) {
      return 0;
    }
    throw error;
  }
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
  try {
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
  } catch (error) {
    if (shouldIgnoreMissingRelation(error, 'message_signals')) {
      return;
    }
    throw error;
  }
}

export async function getRecentSignals(
  userId: number,
  limit: number = 15
): Promise<Array<{ intent: string; emotion: string; note: string; createdAt: string }>> {
  let rows: any[] | null = null;
  try {
    rows = await supabaseQuery(
      'message_signals',
      'GET',
      null,
      `?user_id=eq.${userId}&order=created_at.desc&limit=${limit}`
    );
  } catch (error) {
    if (shouldIgnoreMissingRelation(error, 'message_signals')) {
      return [];
    }
    throw error;
  }

  return (rows || []).map((row: any) => ({
    intent: row.intent || 'unknown',
    emotion: row.emotion || 'unknown',
    note: row.note || '',
    createdAt: row.created_at,
  }));
}

export async function getReactionCatalog(): Promise<CatalogReaction[]> {
  let rows: any[] | null = null;
  try {
    rows = await supabaseQuery('reaction_catalog', 'GET', null, '?enabled=eq.true&order=weight.desc');
  } catch (error) {
    if (shouldIgnoreMissingRelation(error, 'reaction_catalog')) {
      return [];
    }
    throw error;
  }
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
  let rows: any[] | null = null;
  try {
    rows = await supabaseQuery('sticker_catalog', 'GET', null, '?enabled=eq.true&order=weight.desc');
  } catch (error) {
    if (shouldIgnoreMissingRelation(error, 'sticker_catalog')) {
      return [];
    }
    throw error;
  }
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
  let rows: any[] | null = null;
  try {
    rows = await supabaseQuery('gif_catalog', 'GET', null, '?enabled=eq.true&order=weight.desc');
  } catch (error) {
    if (shouldIgnoreMissingRelation(error, 'gif_catalog')) {
      return [];
    }
    throw error;
  }
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
  let rows: any[] | null = null;
  try {
    rows = await supabaseQuery(
      'reaction_events',
      'GET',
      null,
      `?user_id=eq.${userId}&order=created_at.desc&limit=1`
    );
  } catch (error) {
    if (shouldIgnoreMissingRelation(error, 'reaction_events')) {
      return null;
    }
    throw error;
  }
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
  let rows: any[] | null = null;
  try {
    rows = await supabaseQuery(
      'sticker_events',
      'GET',
      null,
      `?user_id=eq.${userId}&order=created_at.desc&limit=1`
    );
  } catch (error) {
    if (shouldIgnoreMissingRelation(error, 'sticker_events')) {
      return null;
    }
    throw error;
  }
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
  let rows: any[] | null = null;
  try {
    rows = await supabaseQuery(
      'gif_events',
      'GET',
      null,
      `?user_id=eq.${userId}&order=created_at.desc&limit=1`
    );
  } catch (error) {
    if (shouldIgnoreMissingRelation(error, 'gif_events')) {
      return null;
    }
    throw error;
  }
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
  try {
    await supabaseQuery('reaction_events', 'POST', {
      user_id: userId,
      chat_id: chatId,
      message_id: messageId,
      emoji,
      custom_emoji_id: customEmojiId,
      intent,
    });
  } catch (error) {
    if (shouldIgnoreMissingRelation(error, 'reaction_events')) {
      return;
    }
    throw error;
  }
}

export async function saveStickerEvent(
  userId: number,
  chatId: number,
  messageId: number,
  fileId: string,
  intent: string
): Promise<void> {
  try {
    await supabaseQuery('sticker_events', 'POST', {
      user_id: userId,
      chat_id: chatId,
      message_id: messageId,
      file_id: fileId,
      intent,
    });
  } catch (error) {
    if (shouldIgnoreMissingRelation(error, 'sticker_events')) {
      return;
    }
    throw error;
  }
}

export async function saveGifEvent(
  userId: number,
  chatId: number,
  messageId: number,
  fileId: string,
  intent: string
): Promise<void> {
  try {
    await supabaseQuery('gif_events', 'POST', {
      user_id: userId,
      chat_id: chatId,
      message_id: messageId,
      file_id: fileId,
      intent,
    });
  } catch (error) {
    if (shouldIgnoreMissingRelation(error, 'gif_events')) {
      return;
    }
    throw error;
  }
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
  let rows: any[] | null = null;
  try {
    rows = await supabaseQuery('memory_items_v2', 'POST', {
      user_id: userId,
      kind,
      content,
      importance,
      confidence,
      source_message_id: sourceMessageId || null,
      pinned,
    });
  } catch (error) {
    if (shouldIgnoreMissingRelation(error, 'memory_items_v2')) {
      throw new Error('SCHEMA_MISSING:memory_items_v2');
    }
    throw error;
  }

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
  try {
    await supabaseQuery('memory_chunks', 'POST', {
      user_id: userId,
      memory_item_id: memoryItemId,
      chunk_text: chunkText,
      embedding,
      chunk_meta: chunkMeta,
    });
  } catch (error) {
    if (shouldIgnoreMissingRelation(error, 'memory_chunks')) {
      throw new Error('SCHEMA_MISSING:memory_chunks');
    }
    throw error;
  }
}

export async function searchMemoryVectors(
  userId: number,
  queryEmbedding: number[],
  topK: number = 8
): Promise<MemoryVectorHit[]> {
  let rows: any[] | null = null;
  try {
    rows = await supabaseQuery('rpc/match_memory_chunks', 'POST', {
      p_user_id: userId,
      p_query_embedding: queryEmbedding,
      p_top_k: topK,
    });
  } catch (error) {
    if (shouldIgnoreMissingFunction(error, 'match_memory_chunks')) {
      return [];
    }
    if (shouldIgnoreMissingRelation(error, 'memory_chunks') || shouldIgnoreMissingRelation(error, 'memory_items_v2')) {
      return [];
    }
    throw error;
  }

  return (rows || []).map((row: any) => ({
    chunkId: row.chunk_id,
    memoryItemId: row.memory_item_id,
    chunkText: row.chunk_text,
    similarity: Number(row.similarity || 0),
    importance: Number(row.importance || 0),
    createdAt: row.created_at,
  }));
}

export async function setMemoryPinned(userId: number, memoryItemId: number, pinned: boolean): Promise<boolean> {
  try {
    const rows = await supabaseQuery(
      'memory_items_v2',
      'PATCH',
      { pinned },
      `?id=eq.${memoryItemId}&user_id=eq.${userId}&select=id`,
      'return=representation'
    );
    return Array.isArray(rows) && rows.length > 0;
  } catch (error) {
    if (shouldIgnoreMissingRelation(error, 'memory_items_v2')) {
      return false;
    }
    throw error;
  }
}

export async function saveMetric(
  userId: number,
  metricName: string,
  metricValue: number,
  meta: Record<string, unknown> = {}
): Promise<void> {
  try {
    await supabaseQuery('metrics_events', 'POST', {
      user_id: userId,
      metric_name: metricName,
      metric_value: metricValue,
      meta,
    });
  } catch (error) {
    if (shouldIgnoreMissingRelation(error, 'metrics_events')) {
      return;
    }
    throw error;
  }
}

export async function markUpdateProcessed(
  updateId: number,
  userId: number,
  chatId: number,
  updateType: string
): Promise<boolean> {
  try {
    await supabaseQuery('processed_updates', 'POST', {
      update_id: updateId,
      user_id: userId,
      chat_id: chatId,
      update_type: updateType,
      processed_at: new Date().toISOString(),
    });
    return true;
  } catch (error) {
    if (isDuplicateKeyError(error)) {
      return false;
    }
    if (shouldIgnoreMissingRelation(error, 'processed_updates')) {
      throw new Error('DEDUPE_UNAVAILABLE');
    }
    throw error;
  }
}

const BATCH_LOCK_UPDATE_ID = 0;
const BATCH_LOCK_TYPE = 'batch_lock';
const BATCH_LOCK_TTL_MS = 2 * 60 * 1000;
const BATCH_CURSOR_TYPE = 'batch_cursor';

export async function getInboundBatchCursor(userId: number, chatId: number): Promise<number> {
  if (chatId <= 0 || userId <= 0) {
    return 0;
  }

  let rows: any[] | null = null;
  try {
    rows = await supabaseQuery(
      'processed_updates',
      'GET',
      null,
      `?user_id=eq.${userId}&chat_id=eq.${chatId}&update_type=eq.${BATCH_CURSOR_TYPE}&order=update_id.desc&limit=1&select=update_id`
    );
  } catch (error) {
    if (shouldIgnoreMissingRelation(error, 'processed_updates')) {
      throw new Error('DEDUPE_UNAVAILABLE');
    }
    throw error;
  }

  const first = Array.isArray(rows) ? rows[0] : null;
  const updateId = Number(first?.update_id);
  if (!Number.isFinite(updateId) || updateId <= 0) {
    return 0;
  }
  return updateId;
}

export async function setInboundBatchCursor(userId: number, chatId: number, lastProcessedEventId: number): Promise<void> {
  if (chatId <= 0 || userId <= 0 || !Number.isFinite(lastProcessedEventId) || lastProcessedEventId <= 0) {
    return;
  }

  await supabaseQuery(
    'processed_updates',
    'DELETE',
    null,
    `?user_id=eq.${userId}&chat_id=eq.${chatId}&update_type=eq.${BATCH_CURSOR_TYPE}`
  ).catch((error) => {
    if (shouldIgnoreMissingRelation(error, 'processed_updates')) {
      throw new Error('DEDUPE_UNAVAILABLE');
    }
    throw error;
  });

  try {
    await supabaseQuery('processed_updates', 'POST', {
      update_id: lastProcessedEventId,
      user_id: userId,
      chat_id: chatId,
      update_type: BATCH_CURSOR_TYPE,
      processed_at: new Date().toISOString(),
    });
  } catch (error) {
    if (shouldIgnoreMissingRelation(error, 'processed_updates')) {
      throw new Error('DEDUPE_UNAVAILABLE');
    }
    throw error;
  }
}

export async function resetInboundBatchCursor(userId: number, chatId: number): Promise<void> {
  if (chatId <= 0 || userId <= 0) {
    return;
  }

  try {
    await supabaseQuery(
      'processed_updates',
      'DELETE',
      null,
      `?user_id=eq.${userId}&chat_id=eq.${chatId}&update_type=eq.${BATCH_CURSOR_TYPE}`
    );
  } catch (error) {
    if (shouldIgnoreMissingRelation(error, 'processed_updates')) {
      throw new Error('DEDUPE_UNAVAILABLE');
    }
    throw error;
  }
}

export async function acquireInboundBatchLock(userId: number, chatId: number): Promise<boolean> {
  if (chatId <= 0 || userId <= 0) {
    return false;
  }

  const staleThresholdIso = new Date(Date.now() - BATCH_LOCK_TTL_MS).toISOString();

  await supabaseQuery(
    'processed_updates',
    'DELETE',
    null,
    `?update_id=eq.${BATCH_LOCK_UPDATE_ID}&user_id=eq.${userId}&chat_id=eq.${chatId}&update_type=eq.${BATCH_LOCK_TYPE}&processed_at=lt.${encodeURIComponent(staleThresholdIso)}`
  ).catch(() => {
    // best-effort stale lock cleanup
  });

  try {
    await supabaseQuery('processed_updates', 'POST', {
      update_id: BATCH_LOCK_UPDATE_ID,
      user_id: userId,
      chat_id: chatId,
      update_type: BATCH_LOCK_TYPE,
      processed_at: new Date().toISOString(),
    });
    return true;
  } catch (error) {
    if (isDuplicateKeyError(error)) {
      return false;
    }
    if (shouldIgnoreMissingRelation(error, 'processed_updates')) {
      throw new Error('DEDUPE_UNAVAILABLE');
    }
    throw error;
  }
}

export async function releaseInboundBatchLock(userId: number, chatId: number): Promise<void> {
  if (chatId <= 0 || userId <= 0) {
    return;
  }

  await supabaseQuery(
    'processed_updates',
    'DELETE',
    null,
    `?update_id=eq.${BATCH_LOCK_UPDATE_ID}&user_id=eq.${userId}&chat_id=eq.${chatId}&update_type=eq.${BATCH_LOCK_TYPE}`
  ).catch(() => {
    // best-effort unlock
  });
}

export async function isSchemaReady(): Promise<{ ok: boolean; missing: string[] }> {
  const requiredRelations = ['chat_history', 'long_term_memory', 'user_settings', 'chat_summaries'];
  const optionalRelations = [
    'inbound_events',
    'proactive_jobs',
    'message_signals',
    'reaction_catalog',
    'sticker_catalog',
    'gif_catalog',
    'memory_items_v2',
    'memory_chunks',
    'metrics_events',
    'processed_updates',
  ];

  const missing: string[] = [];

  for (const relation of requiredRelations) {
    try {
      await supabaseQuery(relation, 'GET', null, '?limit=1');
    } catch (error) {
      if (isMissingRelationError(error, relation)) {
        missing.push(relation);
        continue;
      }
      throw error;
    }
  }

  for (const relation of optionalRelations) {
    try {
      await supabaseQuery(relation, 'GET', null, '?limit=1');
    } catch (error) {
      if (isMissingRelationError(error, relation)) {
        missing.push(relation);
      }
    }
  }

  return {
    ok: missing.length === 0,
    missing,
  };
}
