/**
 * Phase C — Manifest Validation.
 * Ensures deterministic startup behavior by validating the system manifest.
 */
export type ChiomaManifest = {
  version: string;
  tenantId: string;
  features: string[];
};

export function validateManifest(raw: unknown): ChiomaManifest {
  if (!raw || typeof raw !== "object") {
    throw new Error("MANIFEST_VALIDATION_FAILED: manifest must be an object");
  }
  const m = raw as Partial<ChiomaManifest>;
  if (typeof m.version !== "string") throw new Error("MANIFEST_VALIDATION_FAILED: version required");
  if (typeof m.tenantId !== "string") throw new Error("MANIFEST_VALIDATION_FAILED: tenantId required");
  if (!Array.isArray(m.features)) throw new Error("MANIFEST_VALIDATION_FAILED: features array required");

  return m as ChiomaManifest;
}
