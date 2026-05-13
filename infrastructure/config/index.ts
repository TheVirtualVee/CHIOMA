/**
 * infrastructure/config/index.ts
 *
 * Environment validation and access.
 * CHIOMA fails fast if critical configuration is missing.
 */

import { z } from "zod";

const ConfigSchema = z.object({
  DATABASE_URL: z.string().startsWith("postgres"),
  LLM_API_KEY: z.string().min(1),
  LLM_PROVIDER: z.enum(["openai", "groq", "openrouter"]).default("openai"),
  WHATSAPP_VERIFY_TOKEN: z.string().optional(),
  WHATSAPP_APP_SECRET: z.string().optional(),
  WHATSAPP_ACCESS_TOKEN: z.string().optional(),
  WHATSAPP_PHONE_NUMBER_ID: z.string().optional(),
});

export type Config = z.infer<typeof ConfigSchema>;

export function validateConfig(): Config {
  const result = ConfigSchema.safeParse(process.env);

  if (!result.success) {
    console.error("CONFIG_INVALID", result.error.format());
    throw new Error("CONFIGURATION_ERROR: Check environment variables.");
  }

  return result.data;
}
