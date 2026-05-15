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
// Normalize to E.164 — strip leading zeros, add + if missing
export const FOUNDER_PHONE = FOUNDER_NUMBER_RAW.startsWith("+")
  ? FOUNDER_NUMBER_RAW
  : `+${FOUNDER_NUMBER_RAW}`;

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
export function isFounderNumber(phone: string): boolean {
  // Normalize both for comparison
  const normalize = (p: string) => p.replace(/^\+/, "").replace(/\s/g, "");
  return normalize(phone) === normalize(FOUNDER_PHONE);
}

/**
 * Format a runtime digest for the founder's daily summary.
 */
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
