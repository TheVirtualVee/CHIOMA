/**
 * core/founder/control-plane.ts
 *
 * CHIOMA FOUNDER CONTROL PLANE
 *
 * The founder number is the root authority of the entire runtime.
 * This module:
 * - Notifies the founder of critical system events via WhatsApp
 * - Provides runtime telemetry summaries
 * - Enforces founder supremacy over all tenant governance
 *
 * FOUNDER NUMBER: +2347068516779 (E.164)
 * Stored in env as CHIOMA_FOUNDER_NUMBER (or falls back to hardcoded)
 *
 * SIDE EFFECT: WhatsApp send to founder number.
 * Why necessary and unavoidable: founder visibility into production runtime
 * is the governance contract of this system.
 */

import { createHmac } from "node:crypto";

// ── Constants ─────────────────────────────────────────────────────────────────

const FOUNDER_NUMBER_RAW = process.env.CHIOMA_FOUNDER_NUMBER ?? "2347068516779";
const TELEGRAM_FOUNDER_ID = process.env.TELEGRAM_FOUNDER_ID; // NO HARDCODED FALLBACK

// Normalize to E.164 — strip leading zeros, add + if missing
export const FOUNDER_PHONE = FOUNDER_NUMBER_RAW.startsWith("+")
  ? FOUNDER_NUMBER_RAW
  : `+${FOUNDER_NUMBER_RAW}`;

export const FOUNDER_TELEGRAM_ID = TELEGRAM_FOUNDER_ID;

export type FounderEventType =
  | "ONBOARDING_REQUEST"       // New business messaged the onboarding number
  | "TENANT_ACTIVATED"         // Business onboarding completed
  | "BILLING_EXHAUSTED"        // Tenant ran out of credits
  | "BILLING_LOW"              // Tenant credits < 20% of starting balance
  | "EXECUTION_ANOMALY"        // Spike in BLOCK_RESPONSE or FAILED outcomes
  | "RECOVERY_FAILURE"         // Commitment recovery exceeded max attempts
  | "ARBITER_BLOCKED"          // CEA blocked a message (billing/safety/tenant)
  | "ABUSE_DETECTED"           // Repeated invalid signatures or probe attempts
  | "SYSTEM_BOOT"              // Runtime started
  | "DAILY_DIGEST";            // Daily summary (optional, owner-configurable)

export interface FounderNotification {
  type: FounderEventType;
  tenantId?: string;
  instanceId?: string;
  summary: string;
  detail?: Record<string, unknown>;
}

// ── WhatsApp Send (re-used from infra, but founder-specific) ──────────────────

async function sendFounderMessage(
  phoneNumberId: string,
  accessToken: string,
  text: string
): Promise<void> {
  if (!phoneNumberId || !accessToken) {
    console.warn("[FOUNDER_CP] SEND_SKIPPED: missing phoneNumberId or accessToken");
    return;
  }

  // ASSERT: timeout enforced — founder notification must never stall execution
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 6000);

  try {
    const response = await fetch(
      `https://graph.facebook.com/v17.0/${phoneNumberId}/messages`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          to: FOUNDER_PHONE.replace("+", ""), // Meta API: no + prefix
          type: "text",
          text: { body: text, preview_url: false },
        }),
        signal: controller.signal,
      }
    );

    if (!response.ok) {
      const err = await response.text().catch(() => "");
      console.error(`[FOUNDER_CP] SEND_FAILED: HTTP ${response.status}: ${err.slice(0, 100)}`);
    }
  } catch (err: unknown) {
    const isTimeout = err instanceof Error && err.name === "AbortError";
    console.error(`[FOUNDER_CP] SEND_ERROR: ${isTimeout ? "TIMEOUT" : String(err).slice(0, 100)}`);
  } finally {
    clearTimeout(timer);
  }
}

// ── Format notification text ──────────────────────────────────────────────────

function formatNotification(n: FounderNotification): string {
  const emoji: Record<FounderEventType, string> = {
    ONBOARDING_REQUEST:  "🔔",
    TENANT_ACTIVATED:    "✅",
    BILLING_EXHAUSTED:   "🚨",
    BILLING_LOW:         "⚠️",
    EXECUTION_ANOMALY:   "🔥",
    RECOVERY_FAILURE:    "❌",
    ARBITER_BLOCKED:     "🛑",
    ABUSE_DETECTED:      "🚫",
    SYSTEM_BOOT:         "🟢",
    DAILY_DIGEST:        "📊",
  };

  const lines = [
    `${emoji[n.type]} *CHIOMA Runtime*`,
    `Event: ${n.type}`,
    n.tenantId ? `Tenant: ${n.tenantId}` : "",
    ``,
    n.summary,
  ];

  if (n.detail && Object.keys(n.detail).length > 0) {
    lines.push("", "Details:");
    for (const [k, v] of Object.entries(n.detail)) {
      lines.push(`• ${k}: ${String(v)}`);
    }
  }

  return lines.filter(l => l !== null && l !== undefined).join("\n");
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Notify the founder of a critical system event.
 * NEVER throws — founder notification failure must never block execution.
 *
 * @param notification - event to report
 * @param phoneNumberId - WhatsApp sender phone number ID
 * @param accessToken   - WhatsApp access token
 */
export async function notifyFounder(
  notification: FounderNotification,
  phoneNumberId: string,
  accessToken: string
): Promise<void> {
  try {
    const text = formatNotification(notification);
    await sendFounderMessage(phoneNumberId, accessToken, text);
    console.log(`[FOUNDER_CP] NOTIFICATION_SENT: ${notification.type}`);
  } catch (err: unknown) {
    // Non-fatal: founder notification must never crash execution
    console.error(`[FOUNDER_CP] NOTIFICATION_FAILED: ${String(err).slice(0, 100)}`);
  }
}

/**
 * Check if a phone number is the founder.
 * Used by webhook to route founder messages to the control plane
 * instead of treating them as customer messages.
 */
export function isFounderNumber(phoneOrId: string): boolean {
  // 1. Check Telegram ID (Direct Match)
  if (phoneOrId === FOUNDER_TELEGRAM_ID) return true;

  // 2. Check Phone (Normalized)
  const normalize = (p: string) => p.replace(/^\+/, "").replace(/\s/g, "");
  return normalize(phoneOrId) === normalize(FOUNDER_PHONE);
}

/**
 * Format a runtime digest for the founder's daily summary.
 */
/**
 * Handle a message sent by the founder via Telegram.
 * Bypasses standard customer routing to provide supreme operational access.
 */
export async function handleFounderTelegramMessage(
  chatId: string,
  text: string,
  botToken: string,
  sql?: any
): Promise<void> {
  const cmd = text.trim().toLowerCase();

  let reply: string;

  try {
    if (!sql) {
      throw new Error("Database client not initialized");
    }
    if (cmd === "/status" || cmd === "status") {
      const [counts] = await sql`
        SELECT 
          (SELECT COUNT(*)::int FROM public.chioma_instances WHERE billing_state = 'ACTIVE') AS active_tenants,
          (SELECT COUNT(*)::int FROM public.employer_profiles WHERE onboarding_completed = true) AS onboarded,
          (SELECT COUNT(*)::int FROM public.employer_profiles WHERE onboarding_completed = false) AS pending_onboard,
          (SELECT COUNT(*)::int FROM public.message_ledger) AS total_messages,
          (SELECT COUNT(*)::int FROM public.delivery_queue WHERE status = 'PENDING') AS pending_delivery,
          (SELECT COUNT(*)::int FROM public.recovery_queue) AS recovery_queue
      `;
      reply = `📊 *CHIOMA SYSTEM STATUS*\n\n` +
        `Active tenants: ${counts.active_tenants}\n` +
        `Fully onboarded: ${counts.onboarded}\n` +
        `Pending onboarding: ${counts.pending_onboard}\n` +
        `Total messages processed: ${counts.total_messages}\n` +
        `Pending delivery: ${counts.pending_delivery}\n` +
        `Recovery queue: ${counts.recovery_queue}`;

    } else if (cmd.startsWith("/tenants") || cmd === "tenants") {
      const rows = await sql`
        SELECT tenant_id, billing_state, credit_units, created_at
        FROM public.chioma_instances
        ORDER BY created_at DESC
        LIMIT 20
      `;
      if (rows.length === 0) {
        reply = "No tenants registered yet.";
      } else {
        reply = `🏢 *TENANTS (last 20)*\n\n` +
          rows.map((r: any) => 
            `• ${r.tenant_id} | ${r.billing_state} | ${r.credit_units} credits`
          ).join("\n");
      }

    } else if (cmd.startsWith("/topup ")) {
      // /topup tg-123456789 100
      const parts = cmd.split(" ");
      const targetTenant = parts[1];
      const amount = parseInt(parts[2] ?? "50", 10);
      if (!targetTenant || isNaN(amount)) {
        reply = "Usage: /topup <tenant_id> <credits>";
      } else {
        await sql`
          UPDATE public.chioma_instances 
          SET credit_units = credit_units + ${amount}
          WHERE tenant_id = ${targetTenant}
        `;
        reply = `✅ Added ${amount} credits to ${targetTenant}`;
      }

    } else if (cmd.startsWith("/suspend ")) {
      const targetTenant = cmd.split(" ")[1];
      if (!targetTenant) {
        reply = "Usage: /suspend <tenant_id>";
      } else {
        await sql`
          UPDATE public.chioma_instances 
          SET billing_state = 'PAUSED'
          WHERE tenant_id = ${targetTenant}
        `;
        reply = `⏸️ Suspended ${targetTenant}`;
      }

    } else if (cmd.startsWith("/activate ")) {
      const targetTenant = cmd.split(" ")[1];
      if (!targetTenant) {
        reply = "Usage: /activate <tenant_id>";
      } else {
        await sql`
          UPDATE public.chioma_instances 
          SET billing_state = 'ACTIVE'
          WHERE tenant_id = ${targetTenant}
        `;
        reply = `▶️ Activated ${targetTenant}`;
      }

    } else if (cmd === "/help" || cmd === "help") {
      reply = `👑 *CHIOMA FOUNDER COMMANDS*\n\n` +
        `/status — system overview\n` +
        `/tenants — list all tenants\n` +
        `/topup <tenant_id> <credits> — add credits\n` +
        `/suspend <tenant_id> — pause a tenant\n` +
        `/activate <tenant_id> — resume a tenant\n` +
        `/help — this menu`;

    } else {
      reply = `👑 Founder access confirmed.\nType /help for available commands.`;
    }
  } catch (err: unknown) {
    reply = `⚠️ Command failed: ${String(err).slice(0, 200)}`;
  }

  await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text: reply,
      parse_mode: "Markdown"
    })
  });
}

export function buildDailyDigest(stats: {
  totalMessages: number;
  successRate: number;
  activeTenants: number;
  blockedMessages: number;
  recoveryAttempts: number;
  p95LatencyMs: number;
}): string {
  const successPct = (stats.successRate * 100).toFixed(1);
  return [
    "📊 *CHIOMA Daily Digest*",
    "",
    `Messages processed: ${stats.totalMessages}`,
    `Success rate: ${successPct}%`,
    `Active tenants: ${stats.activeTenants}`,
    `Blocked (billing/safety): ${stats.blockedMessages}`,
    `Recovery attempts: ${stats.recoveryAttempts}`,
    `P95 latency: ${stats.p95LatencyMs}ms`,
  ].join("\n");
}
