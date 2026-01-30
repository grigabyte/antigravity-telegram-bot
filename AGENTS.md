# AGENTS.md

Technical documentation for AI coding agents working with this repository.

## Project Overview

**Neuro Copilot Bot** — Personal AI assistant in Telegram powered by Gemini 3 Pro with 1M+ token context, long-term memory, voice/video transcription, web search, and TTS.

| Property | Value |
|----------|-------|
| Main file | `api/webhook.ts` (~1600 lines) |
| Runtime | Vercel Serverless (Fluid Compute) |
| Timeout | 300 seconds |
| Language | TypeScript |
| AI Model | Gemini 3 Pro via Antigravity API |
| Database | Supabase PostgreSQL |
| TTS | ElevenLabs API |

## Quick Commands

```bash
npm install              # Install dependencies
npx tsc --noEmit         # Type check
npx vercel --prod        # Deploy to production
npm run set-webhook      # Configure Telegram webhook

# Verify deployment
curl https://your-app.vercel.app/api/webhook
```

## Project Structure

```
neuro-copilot-bot/
├── api/
│   └── webhook.ts           # ALL bot logic (single-file architecture)
├── scripts/
│   ├── set-webhook.js       # Telegram webhook configuration
│   ├── setup-supabase.sql   # Database schema
│   ├── import-ai-studio.ts  # Import history from Google AI Studio
│   └── reimport-clean.ts    # Clean reimport without thinking blocks
├── .env.example             # Environment variables template
├── vercel.json              # Vercel configuration
├── tsconfig.json            # TypeScript configuration
├── package.json
├── README.md                # User documentation
├── AGENTS.md                # This file
└── LICENSE                  # MIT License
```

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `TELEGRAM_BOT_TOKEN` | Yes | Bot token from @BotFather |
| `ADMIN_USER_ID` | No | Telegram user ID for private access |
| `SUPABASE_URL` | Yes | Supabase project URL |
| `SUPABASE_KEY` | Yes | Supabase service role key |

## Code Architecture

The bot uses a **single-file architecture** for simplicity. All logic is in `api/webhook.ts`.

### Code Sections (with line numbers)

```
Line 1-50:      CONFIG (tokens, API endpoints, constants)
Line 54-115:    TYPES (TypeScript interfaces)
Line 116-148:   ERROR MESSAGES (user-friendly error handling)
Line 150-275:   SUPABASE (database operations)
Line 277-296:   OAUTH (Google token refresh)
Line 298-395:   URL & YOUTUBE PARSING
Line 397-433:   TEXT DOCUMENT PARSING
Line 435-544:   GEMINI 3 PRO (API calls with retry)
Line 546-591:   MEMORY HELPERS (export/import)
Line 593-803:   SMART CONTEXT COMPRESSION
Line 805-881:   SYSTEM PROMPT BUILDER
Line 883-1070:  TELEGRAM HELPERS
Line 1072-1114: FILE DOWNLOAD
Line 1116-1622: MAIN HANDLER
```

### Key Constants

```typescript
const MAX_HISTORY_MESSAGES = 10000;
const MAX_CONTEXT_TOKENS = 900000;   // 900K tokens
const COMPRESS_THRESHOLD = 800000;   // Compress at 800K

// Generation config
{
  temperature: 0.9,
  maxOutputTokens: 65536,
}
```

## Database Schema (Supabase)

### Tables

| Table | Purpose | Key Columns |
|-------|---------|-------------|
| `chat_history` | Message history | user_id, role, content, timestamp |
| `long_term_memory` | Facts/preferences/goals | user_id, type, content |
| `user_settings` | User preferences | user_id, insights |
| `last_sources` | Search sources | user_id, sources (JSON) |
| `chat_summaries` | Compressed context | user_id, summary, messages_compressed |

### Schema SQL

Run `scripts/setup-supabase.sql` in Supabase SQL Editor:

```sql
CREATE TABLE chat_history (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('user', 'model')),
  content TEXT NOT NULL,
  timestamp BIGINT NOT NULL,
  is_compressed BOOLEAN DEFAULT FALSE
);

CREATE TABLE long_term_memory (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('fact', 'preference', 'goal')),
  content TEXT NOT NULL,
  confidence REAL DEFAULT 1.0
);

CREATE TABLE user_settings (
  user_id BIGINT PRIMARY KEY,
  insights TEXT DEFAULT ''
);

CREATE TABLE last_sources (
  user_id BIGINT PRIMARY KEY,
  sources JSONB NOT NULL DEFAULT '[]'
);

CREATE TABLE chat_summaries (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL,
  summary TEXT NOT NULL,
  messages_compressed INT NOT NULL
);
```

## API Integration

### Gemini 3 Pro (Antigravity)

```typescript
const ANTIGRAVITY_ENDPOINT = 'https://cloudcode-pa.googleapis.com/v1internal:generateContent';
const GEMINI_MODEL = 'gemini-3-pro-preview';

// Request structure
{
  project: 'your-project-id',
  model: GEMINI_MODEL,
  request: {
    contents: messages,
    generationConfig: { temperature: 0.9, maxOutputTokens: 65536 },
    tools: [{ googleSearch: {} }],
    systemInstruction: { role: 'user', parts: [{ text: systemPrompt }] }
  },
  requestType: 'agent',
  userAgent: 'antigravity'
}
```

### ElevenLabs TTS

```typescript
const ELEVENLABS_VOICE_ID = 'iP95p4xoKVk53GoZ742B'; // Chris voice

// Voice settings (balanced, natural)
{
  stability: 0.6,
  similarity_boost: 0.8,
  style: 0.15,
  use_speaker_boost: true
}
```

### Telegram Bot API Methods Used

- `sendMessage` — Text with HTML formatting
- `sendVoice` — Voice messages (TTS output)
- `sendDocument` — Export memory as JSON
- `sendChatAction` — Typing indicator
- `getFile` — Download user files
- `answerCallbackQuery` — Inline button handlers
- `editMessageText` — Update messages

## Bot Commands

| Command | Description | Handler Line |
|---------|-------------|--------------|
| `/start` | Show help | ~1214 |
| `/stats` | Usage statistics | ~1231 |
| `/memory` | View long-term memory | ~1265 |
| `/sources` | Last search sources | ~1362 |
| `/search <query>` | Force web search | ~1388 |
| `/export` | Export all data as JSON | ~1331 |
| `/import` | Import from file | ~1339 |
| `/insights <text>` | Set user context | ~1344 |
| `/clear` | Clear history (with confirmation) | ~1321 |
| `/fact <text>` | Add fact to memory | ~1297 |
| `/pref <text>` | Add preference | ~1303 |
| `/goal <text>` | Add goal | ~1309 |
| `/clearmemory` | Clear long-term memory | ~1315 |
| `/voice <text>` | Get voice reply | ~1376 |

## Key Features Implementation

### 1. Context Compression (Line ~598-787)

When context exceeds 800K tokens:
1. Takes 70% of oldest messages
2. Sends to Gemini for summarization
3. Extracts facts/preferences/goals
4. Replaces messages with summary
5. Saves extracted info to long-term memory

### 2. Automatic Memory Extraction (Line ~1559-1585)

Bot extracts user info from responses using special tags:
```
<memory>
FACT: User lives in Moscow
PREF: Prefers concise answers
GOAL: Learning Python
</memory>
```

### 3. URL Parsing (Line ~298-395)

- **YouTube**: Extracts title and author via oEmbed API
- **Other URLs**: Fetches and parses HTML content
- Limits content to 15,000 characters

### 4. File Processing

| Type | Handler Line | Processing |
|------|--------------|------------|
| Images | ~1453 | Native Gemini vision |
| Voice/Audio | ~1422 | Native transcription |
| Video | ~1440 | Native analysis |
| PDF | ~1472 | Native Gemini |
| TXT/MD/DOCX | ~1501 | Text extraction |

### 5. Rate Limit Handling (Line ~500-507)

Exponential backoff on 429 errors:
```typescript
const waitTime = Math.pow(2, attempt) * 5000; // 5s, 10s, 20s
```

## Common Issues & Solutions

| Issue | Cause | Solution |
|-------|-------|----------|
| Rate limit (429) | API quota exceeded | Wait 1-5 minutes |
| Token expired | OAuth refresh failed | Check refresh token |
| HTML parse error | Invalid Telegram markup | Auto-fallback to plain text |
| File too large | >20MB file | Telegram limitation |
| Timeout | >300s processing | Vercel limitation |

## Known Limitations

- **Image generation**: Not available via Antigravity API
- **Native Google TTS**: Not available (using ElevenLabs)
- **Message deletion**: Telegram doesn't notify bots
- **File size**: Max 20MB (Telegram limit)
- **ElevenLabs free tier**: 10,000 chars/month

## Deployment Checklist

1. Create Supabase project and run `setup-supabase.sql`
2. Set environment variables in Vercel
3. Run `npx tsc --noEmit` — Verify types
4. Run `npx vercel --prod` — Deploy
5. Run `npm run set-webhook` — Configure webhook
6. Test in Telegram

## Testing Deployment

```bash
# Check deployment status
curl https://your-app.vercel.app/api/webhook

# Expected response
{
  "status": "ok",
  "bot": "neuro-copilot",
  "version": "8.3",
  "model": "gemini-3-pro-preview",
  "features": ["voice", "video", "audio", "search", ...]
}
```

## Code Style Guidelines

1. **Single file**: Keep all logic in `api/webhook.ts`
2. **Sections**: Use `// ============ SECTION ============` markers
3. **Error handling**: Always return user-friendly messages in Russian
4. **Logging**: Use `console.log/error` for debugging
5. **Types**: Define interfaces for all data structures
6. **No external dependencies for core logic**: Only Vercel types needed

## Security Notes

- Never commit `.env` files
- Use environment variables for all secrets
- `ADMIN_USER_ID` restricts bot to single user
- Supabase RLS can be enabled for multi-user setup
- Tokens in code are for development reference only

## Version History

| Version | Changes |
|---------|---------|
| 8.3 | ElevenLabs TTS integration, voice button under responses |
| 8.2 | Image analysis improvements |
| 8.1 | Auto-compression, automatic memory extraction |
| 8.0 | Supabase migration, 1M+ token context support |
| 7.x | Upstash Redis storage |
| 6.x | Basic Gemini integration |
