import { z } from "zod";

export type ChiomaConfig = {
  nodeEnv: string;
  storageDir: string;
  providers: {
    openai?: string;
    whatsapp?: string;
    anthropic?: string;
  };
};

/** contract: EnvironmentSchema */
export const EnvSchema = z.object({
  NODE_ENV: z.string().default("development"),
  CHIOMA_STORAGE_DIR: z.string().default("./.chioma-storage"),
  OPENAI_API_KEY: z.string().optional(),
  WHATSAPP_API_KEY: z.string().optional(),
  ANTHROPIC_API_KEY: z.string().optional(),
});

export function loadConfigFromEnv(env: NodeJS.ProcessEnv = process.env): ChiomaConfig {
  // Parse and apply defaults via schema
  const parsed = EnvSchema.parse(env);

  const config: ChiomaConfig = {
    nodeEnv: parsed.NODE_ENV,
    storageDir: parsed.CHIOMA_STORAGE_DIR,
    providers: {
      openai: parsed.OPENAI_API_KEY,
      whatsapp: parsed.WHATSAPP_API_KEY,
      anthropic: parsed.ANTHROPIC_API_KEY,
    },
  };

  // Bootstrap Validation
  if (config.nodeEnv === "production") {
    const missing: string[] = [];
    if (!config.providers.openai && !config.providers.anthropic) {
      missing.push("OPENAI_API_KEY or ANTHROPIC_API_KEY");
    }
    if (missing.length > 0) {
      throw new Error(`BOOTSTRAP_VALIDATION_FAILED: Missing mandatory production keys: ${missing.join(", ")}`);
    }
  }

  return config;
}
