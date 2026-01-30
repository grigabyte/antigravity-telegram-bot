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
- **Gemini 3 Pro** — Google's most capable model via Antigravity API
- **1M+ token context** — remembers entire conversation history
- **Smart compression** — automatically summarizes old messages at 800K tokens
- **Long-term memory** — extracts and stores facts, preferences, goals
- **Google Search** — real-time information from the web

### Media Processing
- **Voice messages** — transcription via native Gemini
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

### Prerequisites

- Node.js 18+
- [Vercel](https://vercel.com) account (free tier works)
- [Supabase](https://supabase.com) account (free tier works)
- Telegram Bot Token from [@BotFather](https://t.me/BotFather)
- [Antigravity](https://antigravity.ai) account with OAuth credentials
- [ElevenLabs](https://elevenlabs.io) account (optional, for TTS)

---

### Step 1: Clone the Repository

```bash
git clone https://github.com/grigabyte/neuro-copilot-bot.git
cd neuro-copilot-bot
npm install
```

---

### Step 2: Create Telegram Bot

1. Open [@BotFather](https://t.me/BotFather) in Telegram
2. Send `/newbot` and follow instructions
3. Copy the bot token (looks like `123456789:ABCdefGHIjklMNOpqrsTUVwxyz`)
4. (Optional) Get your Telegram User ID from [@userinfobot](https://t.me/userinfobot) to restrict bot access

---

### Step 3: Set Up Supabase Database

1. Create a new project at [supabase.com](https://supabase.com)
2. Go to **SQL Editor**
3. Run the contents of `scripts/setup-supabase.sql`
4. Go to **Settings > API** and copy:
   - **Project URL** (e.g., `https://xxxxx.supabase.co`)
   - **Service Role Key** (secret, starts with `eyJ...`)

---

### Step 4: Get Antigravity OAuth Credentials

> **Important:** This bot uses Antigravity API with OAuth authentication, NOT Google Cloud API keys.

#### What you need from Antigravity:

| Credential | Description |
|------------|-------------|
| `CLIENT_ID` | OAuth Client ID (ends with `.apps.googleusercontent.com`) |
| `CLIENT_SECRET` | OAuth Client Secret (starts with `GOCSPX-`) |
| `REFRESH_TOKEN` | OAuth Refresh Token for your account |
| `EMAIL` | Your Google account email |
| `PROJECT_ID` | Your Antigravity project ID |

#### How to get these credentials:

1. Sign up at [antigravity.ai](https://antigravity.ai)
2. Create a new project
3. Follow the OAuth setup flow to authorize your Google account
4. The platform will provide you with:
   - Client ID and Client Secret (shared OAuth app credentials)
   - Refresh Token (generated during authorization)
   - Project ID (visible in your dashboard)

> **Note:** The refresh token is long-lived and allows the bot to make API calls on your behalf. Keep it secret!

---

### Step 5: (Optional) Get ElevenLabs API Key

For text-to-speech voice responses:

1. Sign up at [elevenlabs.io](https://elevenlabs.io)
2. Go to **Profile > API Keys**
3. Create and copy your API key
4. Choose a voice ID (default: `iP95p4xoKVk53GoZ742B` — Chris)

---

### Step 6: Deploy to Vercel

#### Option A: Deploy via CLI

```bash
# Install Vercel CLI
npm i -g vercel

# Login and link project
vercel login
vercel link

# Add environment variables
vercel env add TELEGRAM_BOT_TOKEN production
vercel env add ADMIN_USER_ID production          # Optional
vercel env add SUPABASE_URL production
vercel env add SUPABASE_KEY production
vercel env add ANTIGRAVITY_CLIENT_ID production
vercel env add ANTIGRAVITY_CLIENT_SECRET production
vercel env add ANTIGRAVITY_EMAIL production
vercel env add ANTIGRAVITY_REFRESH_TOKEN production
vercel env add ANTIGRAVITY_PROJECT_ID production
vercel env add ELEVENLABS_API_KEY production     # Optional
vercel env add ELEVENLABS_VOICE_ID production    # Optional

# Deploy
vercel --prod
```

#### Option B: Deploy via Vercel Dashboard

1. Import the repository at [vercel.com/new](https://vercel.com/new)
2. Add environment variables in **Settings > Environment Variables**
3. Deploy

---

### Step 7: Configure Webhook

After deployment, set up the Telegram webhook:

```bash
# Using npm script
VERCEL_URL=your-app.vercel.app npm run set-webhook

# Or manually via curl
curl "https://api.telegram.org/bot<YOUR_TOKEN>/setWebhook?url=https://your-app.vercel.app/api/webhook"
```

---

### Step 8: Test Your Bot

1. Open your bot in Telegram
2. Send `/start`
3. Send a message and wait for response

#### Verify deployment:

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
| `ADMIN_USER_ID` | No | Your Telegram ID (restricts access to you only) |
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
neuro-copilot-bot/
├── api/
│   └── webhook.ts           # All bot logic (~1600 lines)
├── scripts/
│   ├── set-webhook.js       # Telegram webhook setup
│   ├── setup-supabase.sql   # Database schema
│   └── import-ai-studio.ts  # Import from AI Studio
├── .env.example             # Environment template
├── vercel.json              # Vercel config (300s timeout)
├── tsconfig.json            # TypeScript config
├── package.json
├── README.md
├── AGENTS.md                # Technical docs for AI agents
└── LICENSE
```

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

1. Bot uses your `refresh_token` to get a short-lived `access_token`
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

| Problem | Solution |
|---------|----------|
| Bot doesn't respond | Check webhook: `curl https://api.telegram.org/bot<TOKEN>/getWebhookInfo` |
| "Unauthorized" errors | Verify `ANTIGRAVITY_*` env vars are correct (no trailing spaces/newlines!) |
| Rate limit (429) | Wait 1-5 minutes, Antigravity has quotas |
| Timeout errors | Vercel has 300s limit, try shorter messages |
| TTS not working | Check `ELEVENLABS_API_KEY` is set |

### Verify Environment Variables

Make sure env vars have no trailing newlines:
```bash
# Pull and check
vercel env pull .env.check --environment=production
cat .env.check | grep ANTIGRAVITY
```

Values should NOT end with `\n`.

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

- [Antigravity](https://antigravity.ai) — Gemini API access
- [Google Gemini](https://deepmind.google/technologies/gemini/) — AI model
- [Vercel](https://vercel.com) — Serverless hosting
- [Supabase](https://supabase.com) — PostgreSQL database
- [ElevenLabs](https://elevenlabs.io) — Text-to-speech
- [Telegram Bot API](https://core.telegram.org/bots/api) — Messaging platform

---

<p align="center">
  Made with AI
</p>
