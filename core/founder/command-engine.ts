/**
 * core/founder/command-engine.ts
 *
 * CHIOMA FOUNDER COMMAND ENGINE
 *
 * Processes privileged commands from the founder's WhatsApp number.
 * All commands bypass the normal arbiter/kernel execution path entirely.
 *
 * DESIGN RULES:
 * - Commands are deterministic. No LLM inference.
 * - Every command returns a structured WhatsApp message reply.
 * - Command failure must never throw — always return an error message.
 * - The founder cannot be blocked by billing, safety, or tenant gates.
 */

// ── Command Registry ──────────────────────────────────────────────────────────

export type FounderCommand =
  | "/status"         // Runtime health snapshot
  | "/tenants"        // List all active tenants
  | "/blocks"         // Recent arbiter blocks (last 24h)
  | "/reset"          // Reset a customer's conversation memory
  | "/credits"        // Check a tenant's credit balance
  | "/help";          // List available commands

const COMMAND_HELP = `
🔧 *CHIOMA Founder Commands*

/status — Runtime health snapshot
/tenants — List active tenants
/blocks — Recent arbiter blocks (24h)
/credits [tenantId] — Check credit balance
/reset [phone] — Reset customer memory
/help — Show this menu
`.trim();

// ── Command Parser ────────────────────────────────────────────────────────────

interface ParsedCommand {
  command: FounderCommand | null;
  args: string[];
  raw: string;
}

export function parseFounderCommand(text: string): ParsedCommand {
  const trimmed = text.trim().toLowerCase();
  const parts = trimmed.split(/\s+/);
  const command = parts[0] as FounderCommand;
  const args = parts.slice(1);

  const validCommands: FounderCommand[] = [
    "/status", "/tenants", "/blocks", "/reset", "/credits", "/help"
  ];

  return {
    command: validCommands.includes(command) ? command : null,
    args,
    raw: text
  };
}

// ── Command Handlers ──────────────────────────────────────────────────────────

async function handleStatus(sql: any): Promise<string> {
  try {
    const [ledger] = await sql`
      SELECT 
        COUNT(*)::int as total,
        COUNT(*) FILTER (WHERE status = 'COMPLETED')::int as completed,
        COUNT(*) FILTER (WHERE status = 'FAILED')::int as failed,
        COUNT(*) FILTER (WHERE status = 'PENDING')::int as pending,
        ROUND(AVG(EXTRACT(EPOCH FROM (updated_at - created_at)) * 1000))::int as avg_latency_ms
      FROM public.message_ledger
      WHERE created_at > NOW() - INTERVAL '24 hours'
    `;
    const [commitments] = await sql`
      SELECT COUNT(*)::int as pending_count
      FROM public.commitments
      WHERE status = 'PENDING'
    `;
    const [tenants] = await sql`
      SELECT COUNT(DISTINCT tenant_id)::int as active_tenants
      FROM public.message_ledger
      WHERE created_at > NOW() - INTERVAL '24 hours'
    `;

    const successRate = ledger.total > 0
      ? ((ledger.completed / ledger.total) * 100).toFixed(1)
      : "N/A";

    return [
      "🟢 *CHIOMA Runtime Status* (last 24h)",
      "",
      `📨 Messages: ${ledger.total}`,
      `✅ Completed: ${ledger.completed} (${successRate}%)`,
      `❌ Failed: ${ledger.failed}`,
      `⏳ Pending: ${ledger.pending}`,
      `⚡ Avg latency: ${ledger.avg_latency_ms ?? "N/A"}ms`,
      `🏢 Active tenants: ${tenants.active_tenants}`,
      `📋 Open commitments: ${commitments.pending_count}`,
    ].join("\n");
  } catch (err) {
    return `❌ Status query failed: ${String(err).slice(0, 100)}`;
  }
}

async function handleTenants(sql: any): Promise<string> {
  try {
    const rows = await sql`
      SELECT 
        i.tenant_id,
        i.business_name,
        i.billing_state,
        i.credit_units,
        COUNT(ml.message_id)::int as messages_today
      FROM public.chioma_instances i
      LEFT JOIN public.message_ledger ml 
        ON ml.tenant_id = i.tenant_id 
        AND ml.created_at > NOW() - INTERVAL '24 hours'
      GROUP BY i.tenant_id, i.business_name, i.billing_state, i.credit_units
      ORDER BY messages_today DESC
      LIMIT 10
    `;

    if (rows.length === 0) return "📭 No active tenants found.";

    const lines = ["🏢 *Active Tenants*", ""];
    for (const r of rows) {
      const state = r.billing_state === "active" ? "✅" : "⚠️";
      lines.push(`${state} ${r.business_name ?? r.tenant_id}`);
      lines.push(`   Credits: ${r.credit_units} | Msgs today: ${r.messages_today}`);
    }
    return lines.join("\n");
  } catch (err) {
    return `❌ Tenants query failed: ${String(err).slice(0, 100)}`;
  }
}

async function handleBlocks(sql: any): Promise<string> {
  try {
    const rows = await sql`
      SELECT 
        controller_triggered, 
        COUNT(*)::int as count,
        MAX(created_at) as last_seen
      FROM public.cea_execution_logs
      WHERE outcome = 'BLOCK_RESPONSE'
        AND created_at > NOW() - INTERVAL '24 hours'
      GROUP BY controller_triggered
      ORDER BY count DESC
      LIMIT 8
    `;

    if (rows.length === 0) return "✅ No blocks in the last 24 hours.";

    const lines = ["🛑 *Arbiter Blocks (24h)*", ""];
    for (const r of rows) {
      lines.push(`• ${r.controller_triggered}: ${r.count}x`);
    }
    return lines.join("\n");
  } catch (err) {
    return `❌ Blocks query failed: ${String(err).slice(0, 100)}`;
  }
}

async function handleCredits(sql: any, args: string[]): Promise<string> {
  if (args.length === 0) {
    return "Usage: /credits [tenantId]\nExample: /credits tenant_abc123";
  }
  const tenantId = args[0];
  try {
    const [row] = await sql`
      SELECT business_name, credit_units, billing_state
      FROM public.chioma_instances
      WHERE tenant_id = ${tenantId}
      LIMIT 1
    `;
    if (!row) return `❌ Tenant "${tenantId}" not found.`;
    const state = row.billing_state === "active" ? "✅ Active" : `⚠️ ${row.billing_state}`;
    return [
      `💳 *Credits: ${row.business_name ?? tenantId}*`,
      `Status: ${state}`,
      `Credits remaining: ${row.credit_units}`,
    ].join("\n");
  } catch (err) {
    return `❌ Credits query failed: ${String(err).slice(0, 100)}`;
  }
}

async function handleReset(sql: any, args: string[]): Promise<string> {
  if (args.length === 0) {
    return "Usage: /reset [customerPhone]\nExample: /reset 2348012345678";
  }
  // Normalize phone — strip +, spaces
  const phone = args[0].replace(/^\+/, "").replace(/\s/g, "");
  try {
    const result = await sql`
      DELETE FROM public.customer_memory
      WHERE customer_phone = ${phone}
      RETURNING tenant_id, customer_phone
    `;
    if (result.length === 0) {
      return `ℹ️ No memory found for ${phone}. Nothing to reset.`;
    }
    return `✅ Memory cleared for ${phone} across ${result.length} tenant(s).\nNext message from this number starts fresh.`;
  } catch (err) {
    return `❌ Reset failed: ${String(err).slice(0, 100)}`;
  }
}

// ── Main Dispatcher ───────────────────────────────────────────────────────────

/**
 * Process a founder command from WhatsApp.
 * Returns the text to send back to the founder.
 * NEVER throws.
 */
export async function processFounderCommand(
  text: string,
  sql: any
): Promise<string> {
  try {
    const { command, args, raw } = parseFounderCommand(text);

    if (!command) {
      // Not a command — give founder a helpful nudge
      return `Hi 👋 Send /help to see available runtime commands.\n\n(Received: "${raw.slice(0, 40)}")`;
    }

    switch (command) {
      case "/help":     return COMMAND_HELP;
      case "/status":   return await handleStatus(sql);
      case "/tenants":  return await handleTenants(sql);
      case "/blocks":   return await handleBlocks(sql);
      case "/credits":  return await handleCredits(sql, args);
      case "/reset":    return await handleReset(sql, args);
      default:          return COMMAND_HELP;
    }
  } catch (err) {
    // Top-level fault boundary — founder command failure must never crash the webhook
    console.error("[FOUNDER_CMD] COMMAND_ENGINE_FAILURE:", err);
    return `⚠️ Command engine error. Check Vercel logs.\n${String(err).slice(0, 80)}`;
  }
}
