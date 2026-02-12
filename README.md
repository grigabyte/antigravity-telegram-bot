<p align="center">
  <h1 align="center">Neuro Copilot Bot</h1>
  <p align="center">
    <strong>Production-ready Telegram AI assistant with memory, media support, and proactive reminders</strong>
  </p>
  <p align="center">
    Gemini 3 Pro (Antigravity OAuth) · Supabase memory · Vercel deploy · TypeScript
  </p>
</p>

---

## Quick Install (10–15 minutes)

If you want the shortest path to a working bot, follow this section first.

### 0) Requirements

- Node.js 18+
- Telegram account
- Antigravity credentials from `antigravity.ai`
- Supabase project
- Vercel project

### 1) Clone + install

```bash
git clone https://github.com/grigabyte/antigravity-telegram-bot.git
cd antigravity-telegram-bot
npm install
```

### 2) Create bot in Telegram

1. Open [@BotFather](https://t.me/BotFather)
2. Run `/newbot`
3. Save token (`TELEGRAM_BOT_TOKEN`)
4. (Optional) get your user id from [@userinfobot](https://t.me/userinfobot) for private mode (`ADMIN_USER_ID`)

### 3) Setup Supabase

In Supabase SQL Editor run, in order:

1. `scripts/setup-supabase.sql`
2. `scripts/setup-batching-and-proactive.sql`
3. `scripts/setup-advanced-memory-and-signals.sql` (recommended)

Then copy from Supabase:
- `SUPABASE_URL`
- `SUPABASE_KEY` (service_role)

### 4) Configure environment in Vercel

Add these variables (production):

```bash
echo -n 'YOUR_TELEGRAM_BOT_TOKEN' | vercel env add TELEGRAM_BOT_TOKEN production
echo -n 'YOUR_TELEGRAM_USER_ID' | vercel env add ADMIN_USER_ID production
echo -n 'https://xxx.supabase.co' | vercel env add SUPABASE_URL production
echo -n 'YOUR_SUPABASE_SERVICE_ROLE' | vercel env add SUPABASE_KEY production

echo -n 'YOUR_CLIENT_ID.apps.googleusercontent.com' | vercel env add ANTIGRAVITY_CLIENT_ID production
echo -n 'YOUR_CLIENT_SECRET' | vercel env add ANTIGRAVITY_CLIENT_SECRET production
echo -n 'YOUR_EMAIL@gmail.com' | vercel env add ANTIGRAVITY_EMAIL production
echo -n 'YOUR_REFRESH_TOKEN' | vercel env add ANTIGRAVITY_REFRESH_TOKEN production
echo -n 'YOUR_PROJECT_ID' | vercel env add ANTIGRAVITY_PROJECT_ID production

echo -n 'YOUR_RANDOM_WEBHOOK_SECRET' | vercel env add TELEGRAM_WEBHOOK_SECRET production
echo -n 'YOUR_RANDOM_CRON_SECRET' | vercel env add PROACTIVE_CRON_SECRET production
```

Optional:

```bash
echo -n 'YOUR_OPENROUTER_KEY' | vercel env add OPENROUTER_API_KEY production
echo -n 'YOUR_ELEVENLABS_KEY' | vercel env add ELEVENLABS_API_KEY production
echo -n 'iP95p4xoKVk53GoZ742B' | vercel env add ELEVENLABS_VOICE_ID production
```

> Always use `echo -n` to avoid trailing newline bugs.

### 5) Deploy

```bash
vercel --prod
```

### 6) Set Telegram webhook

```bash
VERCEL_URL=your-app.vercel.app TELEGRAM_BOT_TOKEN=your-token TELEGRAM_WEBHOOK_SECRET=your-secret npm run set-webhook
```

### 7) Verify

```bash
curl https://your-app.vercel.app/api/webhook
```

Expected fields include:
- `status: "ok"`
- `version: "8.6"`
- `schema: "ready"`

---

## Proactive Scheduling (Important)

### Option A — Vercel Pro (native cron)

If you are on Vercel Pro, you can use native Vercel Cron and schedule `/api/proactive` directly.

Example (`vercel.json`):

```json
{
  "version": 2,
  "outputDirectory": ".",
  "crons": [
    {
      "path": "/api/proactive",
      "schedule": "*/15 * * * *"
    }
  ]
}
```

You can also copy ready template: `vercel.pro.cron.example.json`.

### Option B — Vercel Hobby (recommended free path)

Vercel Hobby limits native cron frequency, so use external scheduler.

This repo already includes free GitHub Actions scheduler:
- `.github/workflows/proactive-cron.yml`
- runs every 15 minutes
- calls `/api/proactive` with bearer secret

Set repo secrets in GitHub:
- `PROACTIVE_URL=https://your-app.vercel.app/api/proactive`
- `PROACTIVE_CRON_SECRET=<same as Vercel env>`

Optional (recommended for robust inbound batching on Hobby):
- `FLUSH_URL=https://your-app.vercel.app/api/flush`
- `FLUSH_TRIGGER_SECRET=<same as Vercel PROACTIVE_CRON_SECRET or dedicated secret>`

This repo includes a ready workflow for flush draining:
- `.github/workflows/flush-cron.yml`
- every 1 minute
- calls `/api/flush` with bearer secret

Manual ping example:

```bash
curl -X POST "https://your-app.vercel.app/api/proactive" \
  -H "Authorization: Bearer YOUR_PROACTIVE_CRON_SECRET"
```

---

## Project Overview

Neuro Copilot Bot is a Telegram assistant with:
- Gemini 3 Pro via Antigravity OAuth
- long-running conversational context with compression
- two memory retrieval modes (`rag` and `supabase`)
- media processing (voice/audio/video/images/documents)
- proactive reminders and signal-aware reactions/stickers/GIF behavior

---

## Architecture (important)

### Runtime flow (high-level)

1. Telegram sends update to `api/webhook`.
2. `src/handlers/webhook.ts` validates webhook/auth/user access.
3. Message updates are deduplicated and enqueued to `inbound_events`.
4. Webhook runs per-chat flush cycle (`processInboundQueueForChat`) with lock+cursor semantics.
5. Context is assembled from history + summaries + memory retrieval, then Gemini is called once per batch.
6. One final reply is sent to Telegram; optional memory ingestion/compression/signals run after send.

### Current production behavior (stability mode)

- Processing is currently tuned for stable one-by-one replies.
- Queue/cursor/flush primitives are in place and documented, but multi-message merge behavior is still being tuned.
- If your priority is uptime and predictable responses, keep this mode enabled.

### Memory modes

`MEMORY_RETRIEVAL_MODE` controls retrieval strategy:

| Mode | Module | How it works | Cost profile | Best for |
|---|---|---|---|---|
| `rag` | `src/memory/rag-memory.ts` | Embeds query + vector search over `memory_chunks` / `memory_items_v2` | Uses embeddings provider | Highest semantic recall |
| `supabase` | `src/memory/supabase-memory.ts` | Lexical + recency scoring over recent history + signals | No embeddings dependency | Low-cost/free fallback |

Notes:
- Bot can switch modes without destructive migration.
- RAG ingestion is best-effort and safe-fallback aware.

### Context/compression model

- Context assembly: `src/memory/context.ts` + `src/memory/compression.ts`
- When token usage grows, older history is summarized into `chat_summaries`.
- Useful facts/preferences/goals can be extracted into long-term memory.

### Core modules map

- `api/webhook.ts` / `src/handlers/webhook.ts` — main orchestration
- `src/ai/gemini.ts` — OAuth token flow + Gemini calls
- `src/db/supabase.ts` — persistence layer + schema readiness + dedupe helpers
- `src/memory/*` — memory retrieval, ingestion, compression
- `src/telegram/*` — Telegram API client, batching, files, formatting, reactions/stickers
- `api/proactive.ts` + `src/proactive/scheduler.ts` — proactive endpoint + scheduler logic

---

## Commands

| Command | Description |
|---|---|
| `/start` | Show help |
| `/stats` | Bot status and context stats |
| `/memory` | Show long-term memory |
| `/fact <text>` | Save fact |
| `/pref <text>` | Save preference |
| `/goal <text>` | Save goal |
| `/memorysearch <query>` | Search semantic memory |
| `/pin <id>` | Pin memory item |
| `/unpin <id>` | Unpin memory item |
| `/clear` | Clear chat history |
| `/export` | Export user data |
| `/remind <text>` | Add proactive reminder |
| `/tz <zone>` | Set timezone |
| `/quiet <HH-HH>` | Set quiet hours |
| `/time` | Show time context |

---

## Testing

```bash
npm test
```

Current test suite covers critical paths:
- webhook secret validation
- proactive endpoint authorization
- update deduplication
- ownership checks for pin/unpin
- import safety / rollback paths
- SSRF guard basics
- network timeout behavior

---

## Environment Variables Reference

### Required

- `TELEGRAM_BOT_TOKEN`
- `SUPABASE_URL`
- `SUPABASE_KEY`
- `ANTIGRAVITY_CLIENT_ID`
- `ANTIGRAVITY_CLIENT_SECRET`
- `ANTIGRAVITY_EMAIL`
- `ANTIGRAVITY_REFRESH_TOKEN`
- `ANTIGRAVITY_PROJECT_ID`
- `TELEGRAM_WEBHOOK_SECRET` (required in production)
- `PROACTIVE_CRON_SECRET` (required in production)

### Optional

- `ADMIN_USER_ID`
- `ELEVENLABS_API_KEY`
- `ELEVENLABS_VOICE_ID`
- `OPENROUTER_API_KEY`
- `OPENROUTER_EMBEDDING_MODEL_PRIMARY`
- `OPENROUTER_EMBEDDING_MODEL_FALLBACK`
- `OPENROUTER_EMBEDDING_DIM`
- `MEMORY_RETRIEVAL_MODE` (`rag` or `supabase`)
- `OUTBOUND_SIGNAL_POLICY_MODE` (`llm` or `heuristic`)
- `SIGNAL_CLASSIFIER_MODE` (`hybrid` or `metadata`)
- `FLUSH_TRIGGER_SECRET` (optional; defaults to `PROACTIVE_CRON_SECRET`)

---

## Architecture (brief)

- `api/webhook.ts` — HTTP entrypoint
- `src/handlers/webhook.ts` — main orchestration
- `src/db/supabase.ts` — DB layer
- `src/memory/*` — context, compression, RAG/supabase memory
- `src/telegram/*` — Telegram API + formatting + media
- `api/proactive.ts` + `src/proactive/scheduler.ts` — proactive pipeline

---

## Security Notes

- Never commit `.env`
- Keep `SUPABASE_KEY` and webhook/cron secrets private
- Rotate secrets immediately if exposed
- Keep `ADMIN_USER_ID` set for private-bot mode

---

## Troubleshooting

### `cron_secret_not_configured` on `/api/proactive`
Set `PROACTIVE_CRON_SECRET` in Vercel production env.

### Telegram webhook unauthorized
Ensure `TELEGRAM_WEBHOOK_SECRET` is set in Vercel and passed in `npm run set-webhook`.

### `schema: partial`
Run missing SQL scripts in Supabase.

### Build/deploy issues on Vercel
Ensure `vercel.json` is committed and env vars are configured for production.

---

## License

MIT — see [LICENSE](LICENSE).
