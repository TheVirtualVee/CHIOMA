import { z } from "zod";

const ConfigSchema = z.object({
  DATABASE_URL: z.string().startsWith("postgres"),
  LLM_API_KEY: z.string().min(1),
  LLM_PROVIDER: z.enum(["openai", "groq", "openrouter"]).default("openai"),
  WHATSAPP_VERIFY_TOKEN: z.string().min(1),
  WHATSAPP_ACCESS_TOKEN: z.string().min(1),
  WHATSAPP_APP_SECRET: z.string().min(1),
  WHATSAPP_PHONE_NUMBER_ID: z.string().min(1, "Required for WhatsApp delivery").optional(),
});

export type Config = z.infer<typeof ConfigSchema>;

export function validateConfig(): Config {
  console.log("[CONFIG] START_VALIDATION");
  const result = ConfigSchema.safeParse(process.env);
  console.log(`[CONFIG] VALIDATION_RESULT: ${result.success}`);

  if (!result.success) {
    console.error("CONFIG_INVALID", result.error.format());
    throw new Error("CONFIGURATION_ERROR: Check environment variables.");
  }

  if (!result.data.WHATSAPP_PHONE_NUMBER_ID) {
    console.warn("[CONFIG] WARNING: WHATSAPP_PHONE_NUMBER_ID not set — outbound delivery will use metadata fallback only");
  }
  return result.data;
}
