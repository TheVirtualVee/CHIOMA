/**
 * scratch/check_webhook_error.ts
 */
import dotenv from "dotenv";
dotenv.config();

const TOKEN = process.env.TELEGRAM_BOT_TOKEN;

async function run() {
  const response = await fetch(`https://api.telegram.org/bot${TOKEN}/getWebhookInfo`);
  const data = await response.json();
  console.log("[DIAGNOSTIC] FULL STATUS:", JSON.stringify(data, null, 2));
}

run();
