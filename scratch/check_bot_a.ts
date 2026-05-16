/**
 * scratch/check_bot_a.ts
 */
const TOKEN = "8912953397:AAEw2UaiirUEN2lNNOnqdQsrAt-cdMV7-Ag";

async function run() {
  const response = await fetch(`https://api.telegram.org/bot${TOKEN}/getWebhookInfo`);
  const data = await response.json();
  console.log("[DIAGNOSTIC] BOT A STATUS:", JSON.stringify(data, null, 2));
}

run();
