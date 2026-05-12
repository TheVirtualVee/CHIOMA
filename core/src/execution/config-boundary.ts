import { z } from "zod";

/** contract: ExternalConfigSchema */
export const ExternalConfigSchema = z.object({
  version: z.string(),
  priorityOverrides: z.record(z.string(), z.number().min(0).max(1000)).default({}),
  tenantSettings: z.record(z.string(), z.any()).default({}),
});

export type ExternalConfig = z.infer<typeof ExternalConfigSchema>;

/** contract: ConfigurationBoundary */
export class ConfigurationBoundary {
  private static current: ExternalConfig | null = null;

  static validateAndSet(config: unknown): ExternalConfig {
    const validated = ExternalConfigSchema.parse(config);
    this.current = Object.freeze(validated); // immutability guarantee
    return this.current;
  }

  static get(): ExternalConfig {
    if (!this.current) {
      throw new Error("CONFIG_INVALID: Configuration not initialized");
    }
    return this.current;
  }

  static reset(): void {
    this.current = null;
  }
}
