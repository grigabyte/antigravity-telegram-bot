import {
  ACCOUNT,
  ANTIGRAVITY_ENDPOINT,
  GEMINI_MODEL,
  REQUEST_TIMEOUTS,
  SIGNAL_CLASSIFIER_MODE,
} from '../config.js';
import { getAccessToken } from '../ai/gemini.js';
import { fetchWithTimeout } from '../network/fetch.js';
import { downloadFile } from '../telegram/files.js';
import type { SignalClassification } from '../types.js';

interface CandidatePart {
  text?: string;
  thoughtSignature?: boolean;
}

interface CandidateContainer {
  response?: {
    candidates?: Array<{
      content?: {
        parts?: CandidatePart[];
      };
    }>;
  };
}

function normalize(text: string): string {
  return text.trim().toLowerCase();
}

export function classifyStickerSignal(emoji?: string, setName?: string): SignalClassification {
  const normalizedEmoji = normalize(emoji || '');
  const normalizedSet = normalize(setName || '');
  const joined = `${normalizedEmoji} ${normalizedSet}`.trim();

  if (/🎉|🥳|🔥|👏|🚀|💯/.test(joined)) {
    return {
      kind: 'sticker',
      emotion: 'joy',
      intent: 'celebrate',
      confidence: 0.8,
      note: 'Позитивный/праздничный стикер',
    };
  }

  if (/😢|😭|💙|🫂|😔|sad|cry/.test(joined)) {
    return {
      kind: 'sticker',
      emotion: 'sadness',
      intent: 'support',
      confidence: 0.75,
      note: 'Поддерживающий или грустный стикер',
    };
  }

  if (/😂|🤣|fun|lol|meme/.test(joined)) {
    return {
      kind: 'sticker',
      emotion: 'joy',
      intent: 'joke',
      confidence: 0.7,
      note: 'Юмористический стикер',
    };
  }

  return {
    kind: 'sticker',
    emotion: 'neutral',
    intent: 'ack',
    confidence: 0.55,
    note: 'Нейтральный стикер',
  };
}

export function classifyGifSignal(fileName?: string, mimeType?: string): SignalClassification {
  const joined = normalize(`${fileName || ''} ${mimeType || ''}`);
  if (/party|celebrat|win|success|yay/.test(joined)) {
    return {
      kind: 'gif',
      emotion: 'joy',
      intent: 'celebrate',
      confidence: 0.72,
      note: 'GIF с позитивной/праздничной семантикой',
    };
  }

  if (/sad|cry|support|hug/.test(joined)) {
    return {
      kind: 'gif',
      emotion: 'support',
      intent: 'support',
      confidence: 0.68,
      note: 'GIF с поддерживающей семантикой',
    };
  }

  return {
    kind: 'gif',
    emotion: 'neutral',
    intent: 'ack',
    confidence: 0.5,
    note: 'Нейтральный GIF',
  };
}

function normalizeSignalForOutput(raw: Partial<SignalClassification>, fallback: SignalClassification): SignalClassification {
  const emotion = ['joy', 'sadness', 'support', 'irony', 'neutral', 'unknown'].includes(raw.emotion || '')
    ? (raw.emotion as SignalClassification['emotion'])
    : fallback.emotion;
  const intent = ['celebrate', 'support', 'ack', 'joke', 'none', 'unknown'].includes(raw.intent || '')
    ? (raw.intent as SignalClassification['intent'])
    : fallback.intent;
  const confidence = Number.isFinite(Number(raw.confidence))
    ? Math.max(0, Math.min(1, Number(raw.confidence)))
    : fallback.confidence;
  const kind = ['sticker', 'gif', 'reaction', 'none'].includes(raw.kind || '')
    ? (raw.kind as SignalClassification['kind'])
    : fallback.kind;

  return {
    kind,
    emotion,
    intent,
    confidence,
    note: typeof raw.note === 'string' ? raw.note : fallback.note,
  };
}

function extractTextFromCandidateContainer(data: CandidateContainer): string {
  const parts = data?.response?.candidates?.[0]?.content?.parts || [];
  const direct = parts.find((part) => typeof part.text === 'string' && !part.thoughtSignature)?.text;
  if (direct) return direct;
  return parts.find((part) => typeof part.text === 'string')?.text || '';
}

async function classifyVisualSignalWithLlm(
  kind: 'sticker' | 'gif',
  fileId: string,
  mimeHint: string,
  fallback: SignalClassification,
  contextNote: string
): Promise<SignalClassification> {
  try {
    const file = await downloadFile(fileId, mimeHint);
    if (!file.data) return fallback;

    const accessToken = await getAccessToken();
    const prompt = `Ты классификатор телеграм-сигналов. Верни только JSON:
{
  "kind":"${kind}",
  "emotion":"joy|sadness|support|irony|neutral|unknown",
  "intent":"celebrate|support|ack|joke|none|unknown",
  "confidence":0.0,
  "note":"кратко"
}

Контекст: ${contextNote}`;

    const response = await fetchWithTimeout(
      ANTIGRAVITY_ENDPOINT,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
          'User-Agent': 'google-api-nodejs-client/9.15.1',
          'X-Goog-Api-Client': 'gl-node/22.17.0',
        },
        body: JSON.stringify({
          project: ACCOUNT.projectId,
          model: GEMINI_MODEL,
          request: {
            contents: [
              {
                role: 'user',
                parts: [
                  {
                    inlineData: {
                      mimeType: file.mimeType,
                      data: file.data,
                    },
                  },
                  { text: prompt },
                ],
              },
            ],
            generationConfig: {
              temperature: 0.1,
              maxOutputTokens: 1024,
            },
          },
          requestType: 'agent',
          userAgent: 'antigravity',
          requestId: `signal-vision-${kind}-${Date.now()}`,
        }),
      },
      REQUEST_TIMEOUTS.signalPolicy
    );

    if (!response.ok) {
      return fallback;
    }

    const data = await response.json() as CandidateContainer;
    const text = extractTextFromCandidateContainer(data);

    const parsed = JSON.parse(text.replace(/```json|```/gi, '').trim());
    return normalizeSignalForOutput(parsed, fallback);
  } catch {
    return fallback;
  }
}

export async function classifyStickerSignalAdvanced(params: {
  emoji?: string;
  setName?: string;
  fileId?: string;
}): Promise<SignalClassification> {
  const fallback = classifyStickerSignal(params.emoji, params.setName);
  if (SIGNAL_CLASSIFIER_MODE === 'metadata') return fallback;
  if (!params.fileId) return fallback;

  return classifyVisualSignalWithLlm(
    'sticker',
    params.fileId,
    'image/webp',
    fallback,
    `emoji=${params.emoji || ''}, set=${params.setName || ''}`
  );
}

export async function classifyGifSignalAdvanced(params: {
  fileId?: string;
  fileName?: string;
  mimeType?: string;
}): Promise<SignalClassification> {
  const fallback = classifyGifSignal(params.fileName, params.mimeType);
  if (SIGNAL_CLASSIFIER_MODE === 'metadata') return fallback;
  if (!params.fileId) return fallback;

  return classifyVisualSignalWithLlm(
    'gif',
    params.fileId,
    params.mimeType || 'video/mp4',
    fallback,
    `file=${params.fileName || ''}, mime=${params.mimeType || ''}`
  );
}

export function classifyReactionSignal(reactions: string[]): SignalClassification {
  const joined = normalize(reactions.join(' '));

  if (/🔥|❤️|😍|👏|👍|🎉/.test(joined)) {
    return {
      kind: 'reaction',
      emotion: 'joy',
      intent: 'ack',
      confidence: 0.8,
      note: 'Позитивная реакция',
    };
  }

  if (/💔|😢|😭|👎/.test(joined)) {
    return {
      kind: 'reaction',
      emotion: 'sadness',
      intent: 'support',
      confidence: 0.72,
      note: 'Негативная реакция',
    };
  }

  return {
    kind: 'reaction',
    emotion: 'neutral',
    intent: 'ack',
    confidence: 0.5,
    note: 'Нейтральная реакция',
  };
}

export function inferOutboundSignal(modelText: string, userBatchText: string): SignalClassification {
  const combined = normalize(`${modelText} ${userBatchText}`);

  if (/молодец|круто|отлично|побед|получилось|супер/.test(combined)) {
    return {
      kind: 'reaction',
      emotion: 'joy',
      intent: 'celebrate',
      confidence: 0.75,
      note: 'Позитивный тон ответа',
    };
  }

  if (/тяжело|груст|поддерж|не сдавайся|я рядом|сочувств/.test(combined)) {
    return {
      kind: 'reaction',
      emotion: 'support',
      intent: 'support',
      confidence: 0.74,
      note: 'Поддерживающий тон ответа',
    };
  }

  if (/спасибо|понял|принял|окей|договорились/.test(combined)) {
    return {
      kind: 'reaction',
      emotion: 'neutral',
      intent: 'ack',
      confidence: 0.6,
      note: 'Нейтральное подтверждение',
    };
  }

  return {
    kind: 'reaction',
    emotion: 'neutral',
    intent: 'none',
    confidence: 0.35,
    note: 'Сигнал не выражен явно',
  };
}
