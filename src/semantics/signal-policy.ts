import { ACCOUNT, ANTIGRAVITY_ENDPOINT, GEMINI_MODEL, REQUEST_TIMEOUTS } from '../config.js';
import { getAccessToken } from '../ai/gemini.js';
import { fetchWithTimeout } from '../network/fetch.js';
import type { SignalClassification, SignalPolicyDecision } from '../types.js';

const DEFAULT_DECISION: SignalPolicyDecision = {
  kind: 'none',
  emotion: 'neutral',
  intent: 'none',
  confidence: 0.25,
  reason: 'Недостаточно данных для сигнала',
};

function clampConfidence(value: number): number {
  if (!Number.isFinite(value)) return 0.25;
  return Math.max(0, Math.min(1, value));
}

function parseDecision(text: string): SignalPolicyDecision {
  const cleaned = text.replace(/```json|```/gi, '').trim();
  try {
    const parsed = JSON.parse(cleaned);
    const kind = ['reaction', 'sticker', 'gif', 'none'].includes(parsed.kind) ? parsed.kind : 'none';
    const emotion = ['joy', 'sadness', 'support', 'irony', 'neutral', 'unknown'].includes(parsed.emotion)
      ? parsed.emotion
      : 'neutral';
    const intent = ['celebrate', 'support', 'ack', 'joke', 'none', 'unknown'].includes(parsed.intent)
      ? parsed.intent
      : 'none';

    return {
      kind,
      emotion,
      intent,
      confidence: clampConfidence(Number(parsed.confidence)),
      reason: typeof parsed.reason === 'string' ? parsed.reason : 'LLM policy decision',
    };
  } catch {
    return DEFAULT_DECISION;
  }
}

export async function inferOutboundSignalWithLlm(
  modelText: string,
  userBatchText: string,
  fallbackSignal: SignalClassification
): Promise<SignalPolicyDecision> {
  const accessToken = await getAccessToken();
  const prompt = `Ты policy-движок Telegram ассистента. Верни СТРОГО JSON без markdown:
{
  "kind": "reaction|sticker|gif|none",
  "emotion": "joy|sadness|support|irony|neutral|unknown",
  "intent": "celebrate|support|ack|joke|none|unknown",
  "confidence": 0.0,
  "reason": "краткая причина"
}

Контекст пользователя:
${userBatchText}

Ответ ассистента:
${modelText}

Fallback signal:
${JSON.stringify(fallbackSignal)}

Правила:
- Не спамить медиа.
- Если нет сильного сигнала, выбирай kind=none.
- Для поддержки чаще reaction, чем sticker/gif.
- confidence в диапазоне [0,1].`;

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
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: 0.1,
            maxOutputTokens: 2048,
          },
        },
        requestType: 'agent',
        userAgent: 'antigravity',
        requestId: `signal-policy-${Date.now()}`,
      }),
    },
    REQUEST_TIMEOUTS.signalPolicy
  );

  if (!response.ok) {
    const text = await response.text();
    console.warn('Signal policy request failed:', text.slice(0, 240));
    return {
      kind: fallbackSignal.intent === 'none' ? 'none' : 'reaction',
      emotion: fallbackSignal.emotion,
      intent: fallbackSignal.intent,
      confidence: fallbackSignal.confidence,
      reason: 'fallback_on_policy_error',
    };
  }

  const data = await response.json();
  const rawText =
    data?.response?.candidates?.[0]?.content?.parts?.find((part: any) => part.text && !part.thoughtSignature)?.text ||
    data?.response?.candidates?.[0]?.content?.parts?.find((part: any) => part.text)?.text ||
    '';

  const decision = parseDecision(rawText);
  if (decision.kind === 'none' && fallbackSignal.intent !== 'none' && fallbackSignal.confidence >= 0.7) {
    return {
      kind: 'reaction',
      emotion: fallbackSignal.emotion,
      intent: fallbackSignal.intent,
      confidence: fallbackSignal.confidence,
      reason: 'policy_none_but_strong_fallback',
    };
  }

  return decision;
}
