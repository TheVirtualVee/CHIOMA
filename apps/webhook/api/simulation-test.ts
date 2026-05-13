import { config } from "dotenv";
config({ path: "../../.env" });

import { createHmac } from "node:crypto";
import handler from "./webhook.js";

console.log("DEBUG: DATABASE_URL present?", !!process.env.DATABASE_URL);
console.log("DEBUG: APP_SECRET present?", !!process.env.WHATSAPP_APP_SECRET);

async function runSimulation() {
  const secret = process.env.WHATSAPP_APP_SECRET || "chioma_secret_456";
  
  const payload = JSON.stringify({
    object: "whatsapp_business_account",
    entry: [
      {
        id: "WABA_ID",
        changes: [
          {
            value: {
              messaging_product: "whatsapp",
              metadata: {
                display_phone_number: "123456789",
                phone_number_id: "PHONE_ID_123"
              },
              contacts: [{ wa_id: "CONTACT_WA_ID", profile: { name: "Tester" } }],
              messages: [
                {
                  from: "447700900000",
                  id: "wamid.HBgLNDQ3NzAwOTAwMDAwFQIAERgSREU0M0M3Mzg5MUYyRjhFOUVCAA==",
                  timestamp: Math.floor(Date.now() / 1000).toString(),
                  text: { body: "Simulated message for Vercel boundary check." },
                  type: "text"
                }
              ]
            },
            field: "messages"
          }
        ]
      }
    ]
  });

  const signature = "sha256=" + createHmac("sha256", secret).update(payload).digest("hex");

  console.log("--- SIMULATING WHATSAPP WEBHOOK POST ---");
  
  // Create mock Request
  const req = new Request("http://localhost/webhook", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Hub-Signature-256": signature
    },
    body: payload
  });

  try {
    const res = await handler(req);
    console.log(`Status: ${res.status}`);
    const text = await res.text();
    console.log(`Body: ${text}`);

    if (res.status === 200) {
      console.log("SUCCESS: Webhook boundary accepted the message.");
      console.log("Waiting 2 seconds for async commit...");
      await new Promise(r => setTimeout(r, 2000));
      console.log("Simulation complete. Check Supabase for MESSAGE_RECEIVED event.");
    } else {
      console.error(`FAILURE: Unexpected status ${res.status}`);
    }
  } catch (err) {
    console.error("CRASH: Handler threw exception:", err);
  }
}

runSimulation();
