/**
 * Gemini API client with OAuth authentication
 * Uses refresh tokens from Antigravity accounts
 */

// Google OAuth2 token endpoint
const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';

// Gemini API endpoint (AI Studio / MakerSuite)
const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta';

// Client ID for AI Studio (public, same for everyone)
const CLIENT_ID = '764086051850-6qr4p6gpi6hn506pt8ejuq83di341hur.apps.googleusercontent.com';
const CLIENT_SECRET = 'd-FL95Q19q7MQmFpd7hHD0Ty';

export interface GeminiMessage {
  role: 'user' | 'model';
  parts: { text: string }[];
}

export interface GeminiResponse {
  text: string;
  tokensUsed: {
    prompt: number;
    completion: number;
  };
}

/**
 * Exchange refresh token for access token
 */
export async function getAccessToken(refreshToken: string): Promise<string> {
  const response = await fetch(TOKEN_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to get access token: ${error}`);
  }

  const data = await response.json();
  return data.access_token;
}

/**
 * Call Gemini API with messages
 */
export async function chat(
  accessToken: string,
  messages: GeminiMessage[],
  systemPrompt?: string
): Promise<GeminiResponse> {
  const model = 'gemini-2.5-pro-preview-06-05'; // Latest available via API
  
  const requestBody: any = {
    contents: messages,
    generationConfig: {
      temperature: 0.9,
      topP: 0.95,
      topK: 40,
      maxOutputTokens: 8192,
    },
  };

  if (systemPrompt) {
    requestBody.systemInstruction = {
      parts: [{ text: systemPrompt }],
    };
  }

  const response = await fetch(
    `${GEMINI_API_BASE}/models/${model}:generateContent`,
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody),
    }
  );

  if (!response.ok) {
    const error = await response.text();
    
    // Check for rate limit
    if (response.status === 429) {
      throw new Error('RATE_LIMIT');
    }
    
    throw new Error(`Gemini API error: ${error}`);
  }

  const data = await response.json();
  
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
  const tokensUsed = {
    prompt: data.usageMetadata?.promptTokenCount || 0,
    completion: data.usageMetadata?.candidatesTokenCount || 0,
  };

  return { text, tokensUsed };
}

/**
 * High-level chat function with automatic token refresh
 */
export async function sendMessage(
  refreshToken: string,
  messages: GeminiMessage[],
  systemPrompt?: string
): Promise<GeminiResponse> {
  const accessToken = await getAccessToken(refreshToken);
  return chat(accessToken, messages, systemPrompt);
}
