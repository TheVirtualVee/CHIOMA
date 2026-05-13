/**
 * apps/worker/src/schema-validator.ts
 *
 * INTENT: Validate that the Supabase schema contains all required tables,
 * functions, and constraints before the worker accepts any events.
 * Boot MUST fail hard if schema drift is detected.
 *
 * This is NOT a migration runner. It is a read-only integrity check.
 */

import postgres from "postgres";

export type SchemaValidationResult = {
  valid: boolean;
  tables: string[];
  functions: string[];
  issues: string[];
};

const REQUIRED_TABLES = [
  "core.events",
  "core.projections",
  "core.ecb_registry",
  "core.consumer_offsets",
  "core.side_effect_execution",
];

const REQUIRED_FUNCTIONS = [
  "core.prevent_event_mutation",
  "core.apply_event_projection",
  "core.try_claim_tenant_lease",
  "core.try_claim_tenant_lease_v2",
  "core.update_offset_fenced",
  "core.release_tenant_lease",
];

/**
 * Validates schema integrity against Supabase.
 * SIDE EFFECT: Supabase read (pg_tables, pg_proc). Why necessary and unavoidable:
 * boot gate must verify DB state before accepting production traffic.
 */
export async function validateSchemaIntegrity(connectionString: string): Promise<SchemaValidationResult> {
  const sql = postgres(connectionString, { ssl: "require", max: 2, connect_timeout: 10 });
  const issues: string[] = [];
  const foundTables: string[] = [];
  const foundFunctions: string[] = [];

  try {
    // 1. Verify required tables
    const tableRows = await sql<Array<{ schemaname: string; tablename: string }>>`
      SELECT schemaname, tablename
      FROM pg_tables
      WHERE schemaname = 'core'
    `;
    const existingTables = tableRows.map(r => `${r.schemaname}.${r.tablename}`);

    for (const required of REQUIRED_TABLES) {
      if (existingTables.includes(required)) {
        foundTables.push(required);
      } else {
        issues.push(`MISSING_TABLE: ${required}`);
      }
    }

    // 2. Verify required functions
    const fnRows = await sql<Array<{ nspname: string; proname: string }>>`
      SELECT n.nspname, p.proname
      FROM pg_proc p
      JOIN pg_namespace n ON p.pronamespace = n.oid
      WHERE n.nspname = 'core'
    `;
    const existingFunctions = fnRows.map(r => `${r.nspname}.${r.proname}`);

    for (const required of REQUIRED_FUNCTIONS) {
      if (existingFunctions.includes(required)) {
        foundFunctions.push(required);
      } else {
        issues.push(`MISSING_FUNCTION: ${required}`);
      }
    }

    // 3. Verify append-only trigger exists on events table
    const triggerRows = await sql<Array<{ tgname: string }>>`
      SELECT t.tgname
      FROM pg_trigger t
      JOIN pg_class c ON t.tgrelid = c.oid
      JOIN pg_namespace n ON c.relnamespace = n.oid
      WHERE n.nspname = 'core' AND c.relname = 'events' AND t.tgname = 'enforce_event_immutability'
    `;
    if (triggerRows.length === 0) {
      issues.push("MISSING_TRIGGER: core.enforce_event_immutability on core.events");
    }

    // 4. Verify global_position column exists (required by getSince)
    const colRows = await sql<Array<{ column_name: string }>>`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = 'core' AND table_name = 'events' AND column_name = 'global_position'
    `;
    if (colRows.length === 0) {
      issues.push("MISSING_COLUMN: core.events.global_position (required by consumer workers)");
    }

    // 5. Verify RLS is enabled on events table
    const rlsRows = await sql<Array<{ relrowsecurity: boolean }>>`
      SELECT c.relrowsecurity
      FROM pg_class c
      JOIN pg_namespace n ON c.relnamespace = n.oid
      WHERE n.nspname = 'core' AND c.relname = 'events'
    `;
    if (rlsRows.length > 0 && !rlsRows[0].relrowsecurity) {
      issues.push("RLS_DISABLED: core.events — tenant isolation not enforced");
    }

  } catch (err) {
    issues.push(`SCHEMA_CHECK_FAILED: ${String(err)}`);
  } finally {
    await sql.end();
  }

  return {
    valid: issues.length === 0,
    tables: foundTables,
    functions: foundFunctions,
    issues,
  };
}
