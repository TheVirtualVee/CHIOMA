/**
 * scratch/register_webhook.ts
 */
import dotenv from "dotenv";
dotenv.config();

const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const URL = "https://chioma-git-main-thevirtualvees-projects.vercel.app/api/telegram-webhook";

async function run() {
  console.log(`[HANDSHAKE] Using Token: ${TOKEN?.slice(0, 10)}...`);
  console.log(`[HANDSHAKE] Target URL: ${URL}`);

  try {
    const response = await fetch(`https://api.telegram.org/bot${TOKEN}/setWebhook?url=${URL}`);
    const data = await response.json();
    console.log("[HANDSHAKE] RESULT:", data);
  } catch (err) {
    console.error("[HANDSHAKE] FAILED:", err);
  }
}

run();
