# AGENTS.md

Technical documentation and installation instructions for AI coding agents working with this repository.

---

## AI Agent Installation Instructions

> **For AI Agents**: Follow these steps exactly to deploy this bot for a user.

### Prerequisites Check

Before starting, ensure the user has:
- [ ] Node.js 18+ installed
- [ ] A Telegram account
- [ ] Access to Antigravity (antigravity.ai) with OAuth credentials
- [ ] A Supabase account (free tier works)
- [ ] A Vercel account (free tier works)
- [ ] (Optional) An ElevenLabs account for TTS

### Step-by-Step Automated Installation

#### 1. Clone and Install Dependencies

```bash
git clone https://github.com/grigabyte/antigravity-telegram-bot.git
cd antigravity-telegram-bot
npm install
```

#### 2. Create Telegram Bot

Instruct the user to:
1. Open Telegram and message [@BotFather](https://t.me/BotFather)
2. Send `/newbot` and follow prompts
3. Copy the bot token (format: `123456789:ABCdefGHIjklMNOpqrsTUVwxyz`)
4. (Optional) Get user ID from [@userinfobot](https://t.me/userinfobot) for private bot

#### 3. Set Up Supabase Database

1. User creates project at [supabase.com](https://supabase.com)
2. Run the SQL schema in Supabase SQL Editor:

```sql
-- Run this in Supabase SQL Editor
CREATE TABLE chat_history (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('user', 'model')),
  content TEXT NOT NULL,
  timestamp BIGINT NOT NULL,
  is_compressed BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE long_term_memory (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('fact', 'preference', 'goal')),
  content TEXT NOT NULL,
  confidence REAL DEFAULT 1.0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE user_settings (
  user_id BIGINT PRIMARY KEY,
  insights TEXT DEFAULT '',
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE last_sources (
  user_id BIGINT PRIMARY KEY,
  sources JSONB NOT NULL DEFAULT '[]',
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE chat_summaries (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL,
  summary TEXT NOT NULL,
  messages_compressed INT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for performance
CREATE INDEX idx_chat_history_user_id ON chat_history(user_id);
CREATE INDEX idx_chat_history_timestamp ON chat_history(timestamp);
CREATE INDEX idx_long_term_memory_user_id ON long_term_memory(user_id);
CREATE INDEX idx_chat_summaries_user_id ON chat_summaries(user_id);
```

3. Get credentials from **Settings > API**:
   - `SUPABASE_URL`: Project URL (e.g., `https://xxxxx.supabase.co`)
   - `SUPABASE_KEY`: Service role key (secret, starts with `eyJ...`)

#### 4. Get Antigravity OAuth Credentials

**IMPORTANT**: This bot uses Antigravity OAuth, NOT Google Cloud API keys.

User needs to obtain from [antigravity.ai](https://antigravity.ai):

| Variable | Format | Description |
|----------|--------|-------------|
| `ANTIGRAVITY_CLIENT_ID` | `*.apps.googleusercontent.com` | OAuth Client ID |
| `ANTIGRAVITY_CLIENT_SECRET` | `GOCSPX-*` | OAuth Client Secret |
| `ANTIGRAVITY_EMAIL` | `user@gmail.com` | Google account email |
| `ANTIGRAVITY_REFRESH_TOKEN` | `1//*` | OAuth Refresh Token |
| `ANTIGRAVITY_PROJECT_ID` | `project-name-xxxxx` | Antigravity Project ID |

#### 5. (Optional) Get ElevenLabs API Key

For text-to-speech voice responses:
1. Sign up at [elevenlabs.io](https://elevenlabs.io)
2. Go to **Profile > API Keys**
3. Create and copy API key
4. Default voice ID: `iP95p4xoKVk53GoZ742B` (Chris)

#### 6. Deploy to Vercel

```bash
# Install Vercel CLI if not installed
npm i -g vercel

# Login and link project
vercel login
vercel link

# Add environment variables (use echo -n to avoid trailing newlines!)
echo -n 'BOT_TOKEN_HERE' | vercel env add TELEGRAM_BOT_TOKEN production
echo -n 'USER_ID_HERE' | vercel env add ADMIN_USER_ID production
echo -n 'https://xxx.supabase.co' | vercel env add SUPABASE_URL production
echo -n 'eyJ...' | vercel env add SUPABASE_KEY production
echo -n 'xxx.apps.googleusercontent.com' | vercel env add ANTIGRAVITY_CLIENT_ID production
echo -n 'GOCSPX-xxx' | vercel env add ANTIGRAVITY_CLIENT_SECRET production
echo -n 'user@gmail.com' | vercel env add ANTIGRAVITY_EMAIL production
echo -n '1//xxx' | vercel env add ANTIGRAVITY_REFRESH_TOKEN production
echo -n 'project-id' | vercel env add ANTIGRAVITY_PROJECT_ID production
echo -n 'sk_xxx' | vercel env add ELEVENLABS_API_KEY production
echo -n 'iP95p4xoKVk53GoZ742B' | vercel env add ELEVENLABS_VOICE_ID production

# Deploy to production
vercel --prod
```

**CRITICAL**: Always use `echo -n` to prevent trailing newlines in env values!

#### 7. Configure Telegram Webhook

```bash
# Get your Vercel URL from the deployment output, then:
curl "https://api.telegram.org/bot<BOT_TOKEN>/setWebhook?url=https://<VERCEL_URL>/api/webhook"

# Or use the npm script:
VERCEL_URL=your-app.vercel.app TELEGRAM_BOT_TOKEN=your-token npm run set-webhook
```

#### 8. Verify Installation

```bash
# Check health endpoint
curl https://your-app.vercel.app/api/webhook

# Expected response:
{
  "status": "ok",
  "bot": "neuro-copilot",
  "version": "8.3",
  "model": "gemini-3-pro-preview"
}
```

Then test in Telegram by sending `/start` to the bot.

---

## Project Overview

**Neuro Copilot Bot** — Personal AI assistant in Telegram powered by Gemini 3 Pro with 1M+ token context, long-term memory, voice/video transcription, web search, and TTS.

| Property | Value |
|----------|-------|
| Main file | `api/webhook.ts` (~1600 lines) |
| Runtime | Vercel Serverless (Fluid Compute) |
| Timeout | 300 seconds |
| Language | TypeScript |
| AI Model | Gemini 3 Pro via Antigravity OAuth |
| Database | Supabase PostgreSQL |
| TTS | ElevenLabs API |

## Project Structure

```
antigravity-telegram-bot/
├── api/
│   └── webhook.ts           # ALL bot logic (single-file architecture)
├── scripts/
│   ├── set-webhook.js       # Telegram webhook configuration
│   └── setup-supabase.sql   # Database schema
├── .env.example             # Environment variables template
├── vercel.json              # Vercel configuration (300s timeout)
├── tsconfig.json            # TypeScript configuration
├── package.json
├── README.md                # User documentation
├── AGENTS.md                # This file (AI agent instructions)
└── LICENSE                  # MIT License
```

## Environment Variables Reference

| Variable | Required | Description |
|----------|----------|-------------|
| `TELEGRAM_BOT_TOKEN` | Yes | Bot token from @BotFather |
| `ADMIN_USER_ID` | No | Telegram user ID (restricts to single user) |
| `SUPABASE_URL` | Yes | Supabase project URL |
| `SUPABASE_KEY` | Yes | Supabase service role key |
| `ANTIGRAVITY_CLIENT_ID` | Yes | Antigravity OAuth Client ID |
| `ANTIGRAVITY_CLIENT_SECRET` | Yes | Antigravity OAuth Client Secret |
| `ANTIGRAVITY_EMAIL` | Yes | Google account email |
| `ANTIGRAVITY_REFRESH_TOKEN` | Yes | OAuth Refresh Token |
| `ANTIGRAVITY_PROJECT_ID` | Yes | Antigravity Project ID |
| `ELEVENLABS_API_KEY` | No | ElevenLabs API key for TTS |
| `ELEVENLABS_VOICE_ID` | No | Voice ID (default: Chris) |

## Code Architecture

The bot uses a **single-file architecture** for simplicity. All logic is in `api/webhook.ts`.

### Code Sections (with line numbers)

```
Line 1-50:      CONFIG (environment variables, API endpoints, constants)
Line 54-115:    TYPES (TypeScript interfaces)
Line 116-148:   ERROR MESSAGES (user-friendly error handling)
Line 150-275:   SUPABASE (database operations)
Line 277-296:   OAUTH (Google token refresh via Antigravity)
Line 298-395:   URL & YOUTUBE PARSING
Line 397-433:   TEXT DOCUMENT PARSING
Line 435-544:   GEMINI 3 PRO (API calls with retry logic)
Line 546-591:   MEMORY HELPERS (export/import)
Line 593-803:   SMART CONTEXT COMPRESSION
Line 805-881:   SYSTEM PROMPT BUILDER
Line 883-1070:  TELEGRAM HELPERS (sendMessage, sendVoice, etc.)
Line 1072-1114: FILE DOWNLOAD
Line 1116-1622: MAIN HANDLER (command routing, message processing)
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

## API Integration

### Antigravity OAuth Flow

```
┌─────────────┐      ┌──────────────┐      ┌─────────────┐
│  Your Bot   │ ──── │  Antigravity │ ──── │  Gemini 3   │
│  (Vercel)   │      │    OAuth     │      │    Pro      │
└─────────────┘      └──────────────┘      └─────────────┘
      │                     │
      │  refresh_token      │  access_token
      │  ─────────────►     │  ─────────────►
      │                     │
```

### Gemini 3 Pro Request Structure

```typescript
const ANTIGRAVITY_ENDPOINT = 'https://cloudcode-pa.googleapis.com/v1internal:generateContent';
const GEMINI_MODEL = 'gemini-3-pro-preview';

// Request payload
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

// Voice settings
{
  stability: 0.6,
  similarity_boost: 0.8,
  style: 0.15,
  use_speaker_boost: true
}
```

## Database Schema

| Table | Purpose | Key Columns |
|-------|---------|-------------|
| `chat_history` | Message history | user_id, role, content, timestamp |
| `long_term_memory` | Facts/preferences/goals | user_id, type, content |
| `user_settings` | User preferences | user_id, insights |
| `last_sources` | Search sources | user_id, sources (JSON) |
| `chat_summaries` | Compressed context | user_id, summary, messages_compressed |

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

## Troubleshooting

| Issue | Cause | Solution |
|-------|-------|----------|
| Rate limit (429) | API quota exceeded | Wait 1-5 minutes |
| Token expired | OAuth refresh failed | Check refresh token validity |
| "Unauthorized" error | Env vars have trailing newlines | Re-add with `echo -n` |
| HTML parse error | Invalid Telegram markup | Auto-fallback to plain text |
| File too large | >20MB file | Telegram limitation |
| Timeout | >300s processing | Vercel limitation |

### Common Env Var Issue

**Problem**: Environment variables with trailing `\n` break OAuth.

**Solution**: Always use `echo -n` when adding env vars:
```bash
# CORRECT
echo -n 'value' | vercel env add VAR_NAME production

# WRONG (adds trailing newline)
echo 'value' | vercel env add VAR_NAME production
```

## Code Style Guidelines

1. **Single file**: Keep all logic in `api/webhook.ts`
2. **Sections**: Use `// ============ SECTION ============` markers
3. **Comments**: All comments in English
4. **User messages**: Bot responses in Russian (target audience)
5. **Error handling**: Always return user-friendly messages
6. **Logging**: Use `console.log/error` for debugging
7. **Types**: Define interfaces for all data structures
8. **No external dependencies**: Only Vercel types needed for core logic

## Security Notes

- Never commit `.env` files
- Use environment variables for all secrets
- `ADMIN_USER_ID` restricts bot to single user
- Supabase RLS can be enabled for multi-user setup
- Never log tokens or API keys

## Version History

| Version | Changes |
|---------|---------|
| 8.3 | ElevenLabs TTS integration, voice button under responses |
| 8.2 | Image analysis improvements |
| 8.1 | Auto-compression, automatic memory extraction |
| 8.0 | Supabase migration, 1M+ token context support |
| 7.x | Upstash Redis storage |
| 6.x | Basic Gemini integration |
