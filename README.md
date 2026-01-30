<p align="center">
  <h1 align="center">Neuro Copilot Bot</h1>
  <p align="center">
    <strong>Personal AI assistant in Telegram powered by Gemini 3 Pro</strong>
  </p>
  <p align="center">
    1M+ token context | Long-term memory | Voice & Video | Web Search | TTS
  </p>
</p>

---

## Features

### AI & Context
- **Gemini 3 Pro** — Google's most capable model
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

## Tech Stack

| Component | Technology |
|-----------|------------|
| Runtime | Vercel Serverless (Fluid Compute) |
| AI Model | Gemini 3 Pro |
| Database | Supabase PostgreSQL |
| TTS | ElevenLabs API |
| Language | TypeScript |

## Quick Start

### Prerequisites

- Node.js 18+
- Vercel account
- Supabase account
- Telegram Bot Token (from [@BotFather](https://t.me/BotFather))
- Google Cloud account with Gemini API access
- ElevenLabs account (optional, for TTS)

### 1. Clone the repository

```bash
git clone https://github.com/grigabyte/neuro-copilot-bot.git
cd neuro-copilot-bot
npm install
```

### 2. Set up Supabase

1. Create a new Supabase project
2. Go to SQL Editor
3. Run the contents of `scripts/setup-supabase.sql`

### 3. Configure environment variables

Create a `.env` file based on `.env.example`:

```env
# Telegram
TELEGRAM_BOT_TOKEN=your_bot_token_from_botfather
ADMIN_USER_ID=your_telegram_user_id

# Supabase
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_KEY=your_supabase_service_role_key
```

### 4. Configure API access

Edit `api/webhook.ts` and update:

```typescript
// Google OAuth credentials
const CLIENT_ID = 'your_google_client_id';
const CLIENT_SECRET = 'your_google_client_secret';

// Your Google account
const ACCOUNT = {
  email: 'your_email@gmail.com',
  refreshToken: 'your_refresh_token',
  projectId: 'your_gcp_project_id'
};

// ElevenLabs (optional)
const ELEVENLABS_API_KEY = 'your_elevenlabs_api_key';
const ELEVENLABS_VOICE_ID = 'voice_id'; // e.g., 'iP95p4xoKVk53GoZ742B'
```

### 5. Deploy to Vercel

```bash
# Install Vercel CLI
npm i -g vercel

# Deploy
vercel --prod
```

### 6. Set up webhook

```bash
VERCEL_URL=your-app.vercel.app npm run set-webhook
```

### 7. Test

Send a message to your bot in Telegram!

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
├── vercel.json              # Vercel config
├── tsconfig.json            # TypeScript config
├── package.json
├── README.md
├── AGENTS.md                # Technical docs for AI agents
└── LICENSE
```

## Database Schema

| Table | Purpose |
|-------|---------|
| `chat_history` | Message history with timestamps |
| `long_term_memory` | Facts, preferences, goals |
| `user_settings` | User insights and preferences |
| `last_sources` | Web search sources |
| `chat_summaries` | Compressed old conversations |

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

## How It Works

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

### File Processing

All media files are processed natively by Gemini:
- Voice/Audio: Transcription
- Video: Analysis + transcription
- Images: Vision analysis
- Documents: Content extraction

## API Endpoints

### Health Check

```bash
curl https://your-app.vercel.app/api/webhook
```

Response:
```json
{
  "status": "ok",
  "bot": "neuro-copilot",
  "version": "8.3",
  "model": "gemini-3-pro-preview",
  "features": ["voice", "video", "audio", "search", "youtube", ...]
}
```

## Limitations

- **Image generation**: Not available via current API
- **File size**: Max 20MB (Telegram limit)
- **Timeout**: 300 seconds (Vercel limit)
- **TTS**: Requires ElevenLabs API key (free tier: 10K chars/month)

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## Acknowledgments

- [Google Gemini](https://deepmind.google/technologies/gemini/) — AI model
- [Vercel](https://vercel.com) — Serverless hosting
- [Supabase](https://supabase.com) — PostgreSQL database
- [ElevenLabs](https://elevenlabs.io) — Text-to-speech
- [Telegram Bot API](https://core.telegram.org/bots/api) — Messaging platform

---

<p align="center">
  Made with AI
</p>
