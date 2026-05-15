import { BusinessDraft } from "../../core/contracts/index.js";

export async function processDailyBriefStep(
  sql: any,
  tenantId: string,
  messageText: string,
  config: { apiKey: string }
): Promise<{ handled: boolean; response?: string }> {
  const [session] = await sql`
    SELECT id, status, parsed_snapshot
    FROM public.daily_brief_sessions
    WHERE tenant_id = ${tenantId}
      AND status IN ('AWAITING_INPUT', 'AWAITING_CONFIRMATION')
    ORDER BY created_at DESC
    LIMIT 1
  `;

  if (!session) return { handled: false };

  if (session.status === "AWAITING_INPUT") {
    // 1. Parse messy input
    const parsed = await parseMessyBrief(messageText, config.apiKey);
    
    await sql`
      UPDATE public.daily_brief_sessions
      SET raw_input = ${messageText},
          parsed_snapshot = ${sql.json(parsed)},
          status = 'AWAITING_CONFIRMATION'
      WHERE id = ${session.id}
    `;

    return {
      handled: true,
      response: formatBriefConfirmation(parsed)
    };
  }

  if (session.status === "AWAITING_CONFIRMATION") {
    const isAffirmative = /^(yes|correct|good|perfect|yep|ok|confirm)/i.test(messageText);
    
    if (isAffirmative) {
      // 2. Commit to memory (LOCKED snapshot)
      await sql.begin(async (tx: any) => {
        await tx`
          UPDATE public.daily_brief_sessions
          SET status = 'CONFIRMED',
              confirmed_at = NOW()
          WHERE id = ${session.id}
        `;

        // Archive old locked snapshots
        await tx`
          UPDATE public.business_snapshots
          SET status = 'HISTORICAL'
          WHERE tenant_id = ${tenantId} AND status = 'LOCKED'
        `;

        // Insert new locked snapshot
        await tx`
          INSERT INTO public.business_snapshots (tenant_id, snapshot_data, status, locked_at)
          VALUES (${tenantId}, ${sql.json(session.parsed_snapshot)}, 'LOCKED', NOW())
        `;
      });

      return {
        handled: true,
        response: "Excellent. I've locked in these updates for today. I'm ready to assist your customers with this new information."
      };
    } else {
      // User rejected or provided corrections
      await sql`
        UPDATE public.daily_brief_sessions
        SET status = 'AWAITING_INPUT'
        WHERE id = ${session.id}
      `;
      return {
        handled: true,
        response: "I've reset the brief. Please provide the correct updates for today."
      };
    }
  }

  return { handled: false };
}

async function parseMessyBrief(input: string, apiKey: string): Promise<any> {
  const instructions = `You are CHIOMA's ABM engine. 
The business owner has provided a messy update about today's business state.
Extract and structure this into a clean business snapshot.

EXTRACT:
1. Operational Entities (Rooms available, products in stock, etc.)
2. Pricing changes
3. Workflow adjustments

Return ONLY JSON.`;

  const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "llama-3.3-70b-versatile",
      messages: [
        { role: "system", content: instructions },
        { role: "user", content: `OWNER INPUT: ${input}` },
      ],
      temperature: 0,
      response_format: { type: "json_object" },
    }),
  });

  if (!response.ok) throw new Error(`ABM_PARSE_ERROR: ${response.status}`);
  const data = await response.json() as any;
  return JSON.parse(data.choices[0].message.content);
}

function formatBriefConfirmation(parsed: any): string {
  const entities = parsed.entities || [];
  const entitySummary = entities.map((e: any) => `• ${e.label || e.name}: ${e.status || e.value}`).join("\n");
  
  return `I've processed your update. Here is what I'll use as my operational truth for today:

${entitySummary}

Confirm this is correct?`;
}
