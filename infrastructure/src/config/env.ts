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
const EnvSchema = z.object({
  NODE_ENV: z.string().default("development"),
  CHIOMA_STORAGE_DIR: z.string().default("./.chioma-storage"),
  OPENAI_API_KEY: z.string().optional(),
  WHATSAPP_API_KEY: z.string().optional(),
  ANTHROPIC_API_KEY: z.string().optional(),
});

export function loadConfigFromEnv(env: NodeJS.ProcessEnv = process.env): ChiomaConfig {
  const config: ChiomaConfig = {
    nodeEnv: env.NODE_ENV ?? "development",
    storageDir: env.CHIOMA_STORAGE_DIR ?? "./.chioma-storage",
    providers: {
      openai: env.OPENAI_API_KEY,
      whatsapp: env.WHATSAPP_API_KEY,
      anthropic: env.ANTHROPIC_API_KEY,
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
