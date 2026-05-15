import { randomUUID } from "node:crypto";

/**
 * CHIOMA Identity Canonicalization Layer
 * Phase 3.3 — Ensuring "One User -> One Identity Graph"
 */

export async function getCanonicalIdentity(sql: any, tenantId: string, senderPhone: string): Promise<string> {
  // Try to find existing identity
  const [existing] = await sql`
    SELECT identity_id FROM public.canonical_identities
    WHERE tenant_id = ${tenantId} AND sender_phone = ${senderPhone}
  `;

  if (existing) {
    // Update last seen
    await sql`
      UPDATE public.canonical_identities
      SET last_seen_at = NOW()
      WHERE identity_id = ${existing.identity_id}
    `;
    return existing.identity_id;
  }

  // Create new identity
  const identityId = randomUUID();
  await sql`
    INSERT INTO public.canonical_identities (identity_id, tenant_id, sender_phone)
    VALUES (${identityId}, ${tenantId}, ${senderPhone})
    ON CONFLICT (tenant_id, sender_phone) 
    DO UPDATE SET last_seen_at = NOW()
    RETURNING identity_id
  `;

  return identityId;
}
