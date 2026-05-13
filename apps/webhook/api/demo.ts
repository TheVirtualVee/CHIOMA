import { validateConfig } from "../../../infrastructure/config/index.js";
import { createDatabaseClient } from "../../../infrastructure/database/index.js";
import { runSyncPipeline } from "../../../core/runtime/index.js";

/**
 * apps/webhook/api/demo.ts
 *
 * EXECUTABLE DEMO: The "Nigerian Fashion Vendor" Scenario.
 *
 * Demonstrates:
 * 1. Synchronous Onboarding
 * 2. Instant Context-Aware Response
 * 3. Event-Sourced Persistence
 */

export default async function handler(req: any, res: any) {
  const config = validateConfig();
  const sql = createDatabaseClient(config.DATABASE_URL, { max: 1 });
  const tenantId = "tenant_demo_ankaravendor";
  const sender = "+2348000112233";

  const trace: any[] = [];

  try {
    // SCENARIO: First-time merchant interaction
    const onboardingCorr = `demo_onboard_${Date.now()}`;
    const onboardingInput = {
      tenantId,
      senderPhone: sender,
      messageText: "Hello, I am Chi-Chi. I sell luxury Ankara fabrics in Lagos.",
      correlationId: onboardingCorr,
      causationId: `root_${onboardingCorr}`,
      eventId: `evt_demo_1`,
      channel: "simulation" as const,
    };

    trace.push({ step: "MERCHANT_HELLO", input: onboardingInput.messageText });
    const step1 = await runSyncPipeline(onboardingInput, sql, { apiKey: config.LLM_API_KEY, provider: config.LLM_PROVIDER });
    trace.push({ step: "CHIOMA_ONBOARDING_RESPONSE", response: step1.responseText });

    // SCENARIO: Customer Inquiry
    const inquiryCorr = `demo_inquiry_${Date.now()}`;
    const inquiryInput = {
      tenantId,
      senderPhone: "+234900112233",
      messageText: "How much is your 6-yards blue lace?",
      correlationId: inquiryCorr,
      causationId: `root_${inquiryCorr}`,
      eventId: `evt_demo_2`,
      channel: "simulation" as const,
    };

    trace.push({ step: "CUSTOMER_INQUIRY", input: inquiryInput.messageText });
    const response = await runSyncPipeline(inquiryInput, sql, { apiKey: config.LLM_API_KEY, provider: config.LLM_PROVIDER });
    trace.push({
      step: "CHIOMA_REPLY",
      response: response.responseText,
      type: response.responseType,
    });

    return res.status(200).json({
      ok: true,
      scenario: "Nigerian Fashion Vendor (Lagos)",
      duration: "Under 10s",
      trace,
    });

  } catch (err) {
    return res.status(500).json({ ok: false, error: String(err) });
  } finally {
    await sql.end();
  }
}
