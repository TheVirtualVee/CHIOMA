import "dotenv/config";
import { validateConfig } from "../../infrastructure/config/index.js";

/**
 * CHIOMA WhatsApp Provisioning Tool
 * Purpose: Fixes "Silent 200 OK" delivery failures by programmatically 
 * registering the phone number and subscribing the app to the WABA.
 */

async function provisionWhatsApp() {
  const config = validateConfig();
  const { WHATSAPP_ACCESS_TOKEN, WHATSAPP_PHONE_NUMBER_ID } = config;
  const PHONE_NUMBER_ID = WHATSAPP_PHONE_NUMBER_ID;
  
  // Note: WABA_ID might not be in the standard config yet, so we'll look for it in env
  const WABA_ID = process.env.WHATSAPP_WABA_ID;

  if (!WHATSAPP_ACCESS_TOKEN || !WHATSAPP_PHONE_NUMBER_ID) {
    console.error("❌ Missing WHATSAPP_ACCESS_TOKEN or WHATSAPP_PHONE_NUMBER_ID in environment.");
    process.exit(1);
  }

  console.log(`🚀 Starting WhatsApp Provisioning for Phone ID: ${PHONE_NUMBER_ID}`);

  // Step 1: Register Phone Number
  console.log("\n--- Step 1: Registering Phone Number ---");
  try {
    const regResponse = await fetch(`https://graph.facebook.com/v20.0/${PHONE_NUMBER_ID}/register`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${WHATSAPP_ACCESS_TOKEN}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        pin: "123456" // Default test PIN
      })
    });

    const regData = await regResponse.json();
    if (regResponse.ok) {
      console.log("✅ Phone number registered successfully:", regData);
    } else {
      console.error("❌ Registration failed:", regData);
    }
  } catch (err) {
    console.error("❌ Error during registration:", err);
  }

  // Step 2: Subscribe App to WABA
  if (WABA_ID) {
    console.log("\n--- Step 2: Subscribing App to WABA ---");
    try {
      const subResponse = await fetch(`https://graph.facebook.com/v20.0/${WABA_ID}/subscribed_apps`, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${WHATSAPP_ACCESS_TOKEN}`
        }
      });

      const subData = await subResponse.json();
      if (subResponse.ok) {
        console.log("✅ App subscribed to WABA successfully:", subData);
      } else {
        console.error("❌ Subscription failed:", subData);
      }
    } catch (err) {
      console.error("❌ Error during subscription:", err);
    }
  } else {
    console.warn("\n⚠️ Skipping Step 2: WHATSAPP_WABA_ID not found in environment.");
  }

  console.log("\n✨ Provisioning process complete.");
}

provisionWhatsApp().catch(console.error);
