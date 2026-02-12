export interface GeminiMessage {
  role: 'user' | 'model';
  parts: Part[];
}

export interface Part {
  text?: string;
  inlineData?: { mimeType: string; data: string };
}

export interface GeminiRequestPayload {
  contents: GeminiMessage[];
  generationConfig: {
    temperature: number;
    maxOutputTokens: number;
  };
  tools?: Array<Record<string, unknown>>;
  systemInstruction?: {
    role: 'user';
    parts: Array<{ text: string }>;
  };
}

export interface ChatMessage {
  role: 'user' | 'model';
  content: string;
  timestamp: number;
}

export interface TelegramUpdate {
  update_id?: number;
  message?: {
    message_id: number;
    from: { id: number; first_name: string };
    chat: { id: number; type: string };
    text?: string;
    caption?: string;
    photo?: { file_id: string }[];
    voice?: { file_id: string; duration: number };
    audio?: { file_id: string; duration: number; mime_type?: string };
    video?: { file_id: string; duration: number; mime_type?: string };
    video_note?: { file_id: string };
    document?: { file_id: string; file_name?: string; mime_type?: string };
    animation?: { file_id: string; file_name?: string; mime_type?: string; duration?: number };
    sticker?: { file_id: string; emoji?: string; set_name?: string };
    media_group_id?: string;
    date: number;
  };
  message_reaction?: {
    chat: { id: number; type: string };
    user?: { id: number; first_name?: string };
    actor_chat?: { id: number };
    message_id: number;
    old_reaction?: Array<{ type: string; emoji?: string }>;
    new_reaction?: Array<{ type: string; emoji?: string }>;
    date: number;
  };
  callback_query?: {
    id: string;
    from: { id: number };
    message?: { chat: { id: number }; message_id: number };
    data?: string;
  };
}

export interface GeminiResponse {
  response?: {
    candidates?: Array<{
      content?: {
        parts?: Array<{
          text?: string;
          thoughtSignature?: boolean;
        }>;
      };
      groundingMetadata?: {
        groundingChunks?: Array<{
          web?: {
            uri?: string;
            title?: string;
          };
        }>;
        webSearchQueries?: string[];
      };
    }>;
  };
}

export interface LongTermMemory {
  facts: string[];
  preferences: string[];
  goals: string[];
  updatedAt: number;
}

export type InboundAttachmentKind =
  | 'photo'
  | 'voice'
  | 'audio'
  | 'video'
  | 'video_note'
  | 'document'
  | 'animation';

export interface InboundAttachment {
  kind: InboundAttachmentKind;
  fileId: string;
  mimeType?: string;
  fileName?: string;
}

export interface InboundEventPayload {
  messageId: number;
  date: number;
  text: string;
  options?: {
    voiceReply?: boolean;
    forceSearch?: boolean;
  };
  mediaGroupId?: string;
  attachments: InboundAttachment[];
  sticker?: {
    fileId: string;
    emoji?: string;
    setName?: string;
  };
  signal?: {
    kind: 'sticker' | 'gif' | 'reaction' | 'none';
    emotion: string;
    intent: string;
    confidence: number;
    note?: string;
  };
}

export interface InboundEventRecord {
  id: number;
  user_id: number;
  chat_id: number;
  event_ts: number;
  payload: InboundEventPayload;
  processed: boolean;
}

export interface SignalClassification {
  kind: 'sticker' | 'gif' | 'reaction' | 'none';
  emotion: 'joy' | 'sadness' | 'support' | 'irony' | 'neutral' | 'unknown';
  intent: 'celebrate' | 'support' | 'ack' | 'joke' | 'none' | 'unknown';
  confidence: number;
  note?: string;
}

export interface SignalPolicyDecision {
  kind: 'reaction' | 'sticker' | 'gif' | 'none';
  emotion: 'joy' | 'sadness' | 'support' | 'irony' | 'neutral' | 'unknown';
  intent: 'celebrate' | 'support' | 'ack' | 'joke' | 'none' | 'unknown';
  confidence: number;
  reason: string;
}

export interface CatalogReaction {
  id: number;
  emoji: string | null;
  customEmojiId: string | null;
  intents: string[];
  weight: number;
  enabled: boolean;
  cooldownSec: number;
}

export interface CatalogSticker {
  id: number;
  fileId: string;
  setName: string | null;
  intents: string[];
  weight: number;
  enabled: boolean;
  cooldownSec: number;
}

export interface CatalogGif {
  id: number;
  fileId: string;
  intents: string[];
  weight: number;
  enabled: boolean;
  cooldownSec: number;
}

export interface TelegramInlineKeyboardButton {
  text: string;
  callback_data?: string;
  url?: string;
}

export interface TelegramInlineKeyboardMarkup {
  inline_keyboard: TelegramInlineKeyboardButton[][];
}

export interface MemoryVectorHit {
  chunkId: number;
  memoryItemId: number;
  chunkText: string;
  similarity: number;
  importance: number;
  createdAt: string;
}
