/**
 * api/admin/events.ts — Internal operator surface: event inspection
 *
 * INTENT: Allow operator to inspect the event log for a tenant.
 * Protected by ADMIN_SECRET header. Internal only — never customer-facing.
 *
 * SIDE EFFECT: Supabase read. Why necessary: operational visibility.
 */
export default function handler(req: Request): Promise<Response>;
//# sourceMappingURL=events.d.ts.map