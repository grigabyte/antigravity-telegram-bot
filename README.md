# Neuro Copilot Bot

Персональный AI-помощник в Telegram на базе Gemini 3 Pro.

## Возможности

- Бесплатный доступ к Gemini через OAuth (как в AI Studio)
- Ротация аккаунтов (round-robin) для обхода rate limits
- Персистентная память (Redis)
- Core insights — долгосрочный контекст о пользователе

## Деплой

### 1. Настройка Upstash Redis

1. Зарегистрируйся на [upstash.com](https://upstash.com)
2. Создай Redis database (регион Frankfurt)
3. Скопируй `UPSTASH_REDIS_REST_URL` и `UPSTASH_REDIS_REST_TOKEN`

### 2. Деплой на Vercel

```bash
cd neuro-copilot-bot
npm install
vercel
```

При деплое добавь environment variables:
- `TELEGRAM_BOT_TOKEN` — токен от @BotFather
- `ADMIN_USER_ID` — твой Telegram ID (узнать: @userinfobot)
- `UPSTASH_REDIS_REST_URL` — URL Redis
- `UPSTASH_REDIS_REST_TOKEN` — токен Redis

### 3. Загрузка аккаунтов

```bash
# Установи переменные окружения
export UPSTASH_REDIS_REST_URL="..."
export UPSTASH_REDIS_REST_TOKEN="..."

# Загрузи аккаунты из antigravity-accounts.json
node scripts/init-accounts.mjs
```

### 4. Настройка webhook

```bash
export TELEGRAM_BOT_TOKEN="..."
export VERCEL_URL="your-app.vercel.app"

node scripts/set-webhook.js
```

## Команды бота

- `/start` — приветствие
- `/stats` — статистика памяти
- `/clear` — очистить историю
- `/setinsights <текст>` — установить core insights

## Структура

```
neuro-copilot-bot/
├── api/
│   └── webhook.ts      # Telegram webhook handler
├── lib/
│   ├── gemini.ts       # Gemini API client
│   ├── accounts.ts     # Account rotation
│   └── memory.ts       # Redis memory
├── scripts/
│   ├── set-webhook.js  # Setup Telegram webhook
│   └── init-accounts.mjs # Upload accounts to Redis
└── vercel.json         # Vercel config
```
