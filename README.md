<p align="center">
  <h1 align="center">Neuro Copilot Bot</h1>
  <p align="center">
    <strong>Personal AI assistant in Telegram powered by Gemini 3 Pro via Antigravity</strong>
  </p>
  <p align="center">
    1M+ token context | Long-term memory | Voice & Video | Web Search | TTS
  </p>
</p>

---

## Features

### AI & Context
- **Gemini 3 Pro** — Google's most capable model via Antigravity OAuth
- **1M+ token context** — remembers entire conversation history
- **Smart compression** — automatically summarizes old messages at 800K tokens
- **Long-term memory** — extracts and stores facts, preferences, goals
- **Google Search** — real-time web search integration

### Media Processing
- **Voice messages** — native Gemini transcription
- **Video & video notes** — analysis and transcription
- **Audio files** — MP3, WAV, FLAC, M4A support
- **Images** — vision analysis
- **PDF documents** — content extraction
- **Text files** — TXT, MD, DOCX parsing

### Smart Features
- **URL parsing** — automatic webpage content extraction
- **YouTube links** — metadata extraction (title, author)
- **TTS responses** — text-to-speech via ElevenLabs
- **Export/Import** — full data backup and restore
- **Inline keyboard** — quick action buttons

---

## Commands

| Command | Description |
|---------|-------------|
| `/start` | Show available commands |
| `/stats` | Usage statistics and context info |
| `/memory` | View long-term memory |
| `/sources` | Sources from last web search |
| `/search <query>` | Force web search |
| `/export` | Export all data as JSON |
| `/insights <text>` | Set personal context |
| `/clear` | Clear history (with confirmation) |
| `/fact <text>` | Add fact to memory |
| `/pref <text>` | Add preference |
| `/goal <text>` | Add goal |
| `/clearmemory` | Clear long-term memory |
| `/voice <text>` | Get voice response (TTS) |

---

## Tech Stack

| Component | Technology |
|-----------|------------|
| Runtime | Vercel Serverless (Fluid Compute, 300s timeout) |
| AI Model | Gemini 3 Pro via Antigravity OAuth |
| Database | Supabase PostgreSQL |
| TTS | ElevenLabs API (optional) |
| Language | TypeScript |

---

## Deployment Guide

### What You'll Need

Before starting, make sure you have:

1. **Node.js 18+** installed on your machine
2. **Telegram account** to create a bot
3. **Antigravity account** with OAuth credentials (from [antigravity.ai](https://antigravity.ai))
4. **Supabase account** (free tier) for database
5. **Vercel account** (free tier) for hosting
6. **ElevenLabs account** (optional, free tier) for voice responses

---

### Step 1: Clone the Repository

```bash
git clone https://github.com/grigabyte/antigravity-telegram-bot.git
cd antigravity-telegram-bot
npm install
```

---

### Step 2: Create a Telegram Bot

1. Open Telegram and find [@BotFather](https://t.me/BotFather)
2. Send `/newbot`
3. Choose a name (e.g., "My Neuro Copilot")
4. Choose a username (must end with `bot`, e.g., `my_neuro_copilot_bot`)
5. **Save the token** - it looks like: `7123456789:AAHxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx`

**Optional**: Get your Telegram User ID to make the bot private:
1. Message [@userinfobot](https://t.me/userinfobot)
2. It will reply with your user ID (a number like `123456789`)

---

### Step 3: Set Up Supabase Database

1. Go to [supabase.com](https://supabase.com) and create a free account
2. Click **New Project** and fill in the details
3. Wait for the project to be created (1-2 minutes)
4. Go to **SQL Editor** in the left sidebar
5. Paste and run this SQL:

```sql
-- Create tables for the bot
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

-- Add indexes for better performance
CREATE INDEX idx_chat_history_user_id ON chat_history(user_id);
CREATE INDEX idx_chat_history_timestamp ON chat_history(timestamp);
CREATE INDEX idx_long_term_memory_user_id ON long_term_memory(user_id);
CREATE INDEX idx_chat_summaries_user_id ON chat_summaries(user_id);
```

6. Go to **Settings > API** and copy:
   - **Project URL** (looks like `https://abcdefg.supabase.co`)
   - **service_role key** (secret key, starts with `eyJ...`)

---

### Step 4: Get Antigravity OAuth Credentials

> **Important**: This bot uses Antigravity OAuth to access Gemini 3 Pro. This is NOT the same as Google Cloud API keys.

1. Go to [antigravity.ai](https://antigravity.ai) and sign up/login
2. Create or select a project
3. Complete the OAuth authorization flow
4. You will receive these credentials:

| Credential | Example Format | Description |
|------------|----------------|-------------|
| Client ID | `1234567890-abc.apps.googleusercontent.com` | OAuth app identifier |
| Client Secret | `GOCSPX-AbCdEfGhIjKlMnOpQrStUvWxYz` | OAuth app secret |
| Email | `your.email@gmail.com` | Your Google account |
| Refresh Token | `1//0abcdefghijklmnop...` | Long-lived auth token |
| Project ID | `my-project-abc123` | Your Antigravity project |

**Save all of these** - you'll need them in Step 6.

---

### Step 5: (Optional) Get ElevenLabs API Key

For text-to-speech voice responses:

1. Go to [elevenlabs.io](https://elevenlabs.io) and create a free account
2. Click your profile icon → **Profile + API key**
3. Click **Create API Key** and copy it
4. The default voice is "Chris" with ID `iP95p4xoKVk53GoZ742B`

Free tier includes 10,000 characters/month.

---

### Step 6: Deploy to Vercel

#### Option A: Using Vercel CLI (Recommended)

```bash
# Install Vercel CLI globally
npm install -g vercel

# Login to Vercel
vercel login

# Link project (follow prompts)
vercel link
```

Now add environment variables. **Important**: Use `echo -n` to avoid trailing newlines!

```bash
# Required variables
echo -n 'YOUR_TELEGRAM_BOT_TOKEN' | vercel env add TELEGRAM_BOT_TOKEN production
echo -n 'YOUR_TELEGRAM_USER_ID' | vercel env add ADMIN_USER_ID production
echo -n 'https://xxxxx.supabase.co' | vercel env add SUPABASE_URL production
echo -n 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...' | vercel env add SUPABASE_KEY production
echo -n 'xxxxx.apps.googleusercontent.com' | vercel env add ANTIGRAVITY_CLIENT_ID production
echo -n 'GOCSPX-xxxxx' | vercel env add ANTIGRAVITY_CLIENT_SECRET production
echo -n 'your.email@gmail.com' | vercel env add ANTIGRAVITY_EMAIL production
echo -n '1//xxxxx' | vercel env add ANTIGRAVITY_REFRESH_TOKEN production
echo -n 'your-project-id' | vercel env add ANTIGRAVITY_PROJECT_ID production

# Optional (for TTS)
echo -n 'sk_xxxxx' | vercel env add ELEVENLABS_API_KEY production
echo -n 'iP95p4xoKVk53GoZ742B' | vercel env add ELEVENLABS_VOICE_ID production
```

Deploy to production:

```bash
vercel --prod
```

Note your deployment URL (e.g., `https://your-bot.vercel.app`).

#### Option B: Using Vercel Dashboard

1. Go to [vercel.com/new](https://vercel.com/new)
2. Import the repository from GitHub
3. Go to **Settings > Environment Variables**
4. Add each variable from the table below
5. Deploy

---

### Step 7: Set Up Telegram Webhook

Tell Telegram where to send messages:

```bash
curl "https://api.telegram.org/bot<YOUR_BOT_TOKEN>/setWebhook?url=https://<YOUR_VERCEL_URL>/api/webhook"
```

Replace:
- `<YOUR_BOT_TOKEN>` with your Telegram bot token
- `<YOUR_VERCEL_URL>` with your Vercel deployment URL

You should see: `{"ok":true,"result":true,"description":"Webhook was set"}`

---

### Step 8: Test Your Bot

1. Open Telegram and find your bot by username
2. Send `/start`
3. If everything is set up correctly, you'll see the command list
4. Try sending a message!

#### Verify deployment health:

```bash
curl https://your-app.vercel.app/api/webhook
```

Expected response:
```json
{
  "status": "ok",
  "bot": "neuro-copilot",
  "version": "8.3",
  "model": "gemini-3-pro-preview"
}
```

---

## Environment Variables Reference

| Variable | Required | Description |
|----------|----------|-------------|
| `TELEGRAM_BOT_TOKEN` | Yes | Bot token from @BotFather |
| `ADMIN_USER_ID` | No | Your Telegram ID (makes bot private) |
| `SUPABASE_URL` | Yes | Supabase project URL |
| `SUPABASE_KEY` | Yes | Supabase service role key |
| `ANTIGRAVITY_CLIENT_ID` | Yes | Antigravity OAuth Client ID |
| `ANTIGRAVITY_CLIENT_SECRET` | Yes | Antigravity OAuth Client Secret |
| `ANTIGRAVITY_EMAIL` | Yes | Your Google account email |
| `ANTIGRAVITY_REFRESH_TOKEN` | Yes | OAuth Refresh Token |
| `ANTIGRAVITY_PROJECT_ID` | Yes | Antigravity Project ID |
| `ELEVENLABS_API_KEY` | No | ElevenLabs API key for TTS |
| `ELEVENLABS_VOICE_ID` | No | Voice ID (default: Chris) |

---

## Project Structure

```
antigravity-telegram-bot/
├── api/
│   └── webhook.ts           # All bot logic (~1600 lines)
├── scripts/
│   ├── set-webhook.js       # Telegram webhook setup
│   ├── setup-supabase.sql   # Database schema
│   └── import-ai-studio.ts  # Import history from AI Studio
├── .env.example             # Environment template
├── vercel.json              # Vercel config (300s timeout)
├── tsconfig.json            # TypeScript config
├── package.json
├── README.md                # This file
├── AGENTS.md                # Technical docs for AI agents
└── LICENSE                  # MIT License
```

### Import Chat History from AI Studio

If you have chat history from Google AI Studio, you can import it:

```bash
# Set your Supabase credentials
export SUPABASE_URL="https://xxx.supabase.co"
export SUPABASE_KEY="your-service-role-key"

# Run the import script (replace with your Telegram user ID and export path)
npx ts-node scripts/import-ai-studio.ts 123456789 ~/Downloads/ai-studio-export.json
```

The script extracts actual model responses (skips thinking blocks) and imports them into Supabase.

---

## How It Works

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

1. Bot uses your `refresh_token` to get a temporary `access_token`
2. Access token is used to call Gemini 3 Pro API
3. Tokens refresh automatically when expired

### Context Compression

When conversation exceeds 800K tokens:
1. Takes 70% of oldest messages
2. Generates summary via Gemini
3. Extracts important facts to long-term memory
4. Replaces old messages with summary

### Memory Extraction

Bot automatically extracts user information:
- **Facts**: Name, location, job, family
- **Preferences**: Communication style, interests
- **Goals**: Current objectives, plans

---

## Configuration

### Limits

| Parameter | Default | Description |
|-----------|---------|-------------|
| `MAX_CONTEXT_TOKENS` | 900,000 | Maximum context window |
| `COMPRESS_THRESHOLD` | 800,000 | When to start compression |
| `MAX_HISTORY_MESSAGES` | 10,000 | Max stored messages |
| `maxOutputTokens` | 65,536 | Max response length |

### Voice Settings (ElevenLabs)

```typescript
{
  stability: 0.6,
  similarity_boost: 0.8,
  style: 0.15,
  use_speaker_boost: true
}
```

---

## Troubleshooting

| Problem | Cause | Solution |
|---------|-------|----------|
| Bot doesn't respond | Webhook not set | Run Step 7 again |
| "Unauthorized" error | Env vars have newlines | Re-add with `echo -n` |
| Rate limit (429) | API quota exceeded | Wait 1-5 minutes |
| Timeout errors | Response takes >300s | Try shorter messages |
| TTS not working | Missing API key | Add `ELEVENLABS_API_KEY` |

### Check Webhook Status

```bash
curl "https://api.telegram.org/bot<TOKEN>/getWebhookInfo"
```

### Check Environment Variables

Make sure values don't have trailing newlines:

```bash
vercel env pull .env.check --environment=production
cat .env.check | grep ANTIGRAVITY_CLIENT_ID
# Should NOT end with \n
```

---

## Limitations

- **Image generation**: Not available via Antigravity API
- **File size**: Max 20MB (Telegram limit)
- **Timeout**: 300 seconds (Vercel limit)
- **TTS**: Requires ElevenLabs API key (free tier: 10K chars/month)

---

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

---

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

---

## Acknowledgments

- [Antigravity](https://antigravity.ai) — Gemini API access via OAuth
- [Google Gemini](https://deepmind.google/technologies/gemini/) — AI model
- [Vercel](https://vercel.com) — Serverless hosting
- [Supabase](https://supabase.com) — PostgreSQL database
- [ElevenLabs](https://elevenlabs.io) — Text-to-speech
- [Telegram Bot API](https://core.telegram.org/bots/api) — Messaging platform


