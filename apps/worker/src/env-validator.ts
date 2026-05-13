/**
 * apps/worker/src/env-validator.ts
 *
 * INTENT: Validate all required environment variables are set before boot.
 * Return structured result so caller can log exactly what is missing.
 */

export type EnvValidationResult = {
  valid: boolean;
  missing: string[];
};

export function validateRequiredEnv(required: string[], env = process.env): EnvValidationResult {
  const missing = required.filter((key) => !env[key] || env[key]!.trim() === "");
  return { valid: missing.length === 0, missing };
}
