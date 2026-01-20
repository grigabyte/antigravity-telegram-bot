/**
 * Script to set Telegram webhook after deployment
 * Usage: VERCEL_URL=your-app.vercel.app node scripts/set-webhook.js
 */

const TELEGRAM_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const VERCEL_URL = process.env.VERCEL_URL;

if (!TELEGRAM_TOKEN) {
  console.error('Error: TELEGRAM_BOT_TOKEN is not set');
  process.exit(1);
}

if (!VERCEL_URL) {
  console.error('Error: VERCEL_URL is not set');
  console.error('Usage: VERCEL_URL=your-app.vercel.app node scripts/set-webhook.js');
  process.exit(1);
}

const webhookUrl = `https://${VERCEL_URL}/api/webhook`;

async function setWebhook() {
  const url = `https://api.telegram.org/bot${TELEGRAM_TOKEN}/setWebhook`;
  
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      url: webhookUrl,
      allowed_updates: ['message'],
    }),
  });

  const result = await response.json();
  
  if (result.ok) {
    console.log('✅ Webhook set successfully!');
    console.log(`   URL: ${webhookUrl}`);
  } else {
    console.error('❌ Failed to set webhook:', result.description);
  }
}

async function getWebhookInfo() {
  const url = `https://api.telegram.org/bot${TELEGRAM_TOKEN}/getWebhookInfo`;
  const response = await fetch(url);
  const result = await response.json();
  console.log('\n📊 Current webhook info:');
  console.log(JSON.stringify(result.result, null, 2));
}

setWebhook().then(getWebhookInfo);
