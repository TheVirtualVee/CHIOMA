/**
 * scratch/final_handshake.ts
 */
const TOKEN = "8912953397:AAEw2UaiirUEN2lNNOnqdQsrAt-cdMV7-Ag";
const URL = "https://chioma-git-main-thevirtualvees-projects.vercel.app/api/telegram-webhook";

async function run() {
  console.log(`[FINAL_HANDSHAKE] Registering Bot A...`);
  const response = await fetch(`https://api.telegram.org/bot${TOKEN}/setWebhook?url=${URL}`);
  const data = await response.json();
  console.log("[FINAL_HANDSHAKE] RESULT:", data);
}

run();
