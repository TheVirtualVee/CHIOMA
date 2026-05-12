import { readFileSync } from "node:fs";
import { join } from "node:path";

export type ChiomaManifest = {
  required: string[];
  optional: string[];
  platform_specific?: Record<string, string[]>;
};

export function loadManifestFromPath(path: string): ChiomaManifest {
  const raw = readFileSync(path, "utf8");
  return JSON.parse(raw) as ChiomaManifest;
}

export function defaultManifestPath(): string {
  return join(process.cwd(), "config", "manifests", "chioma.manifest.json");
}

export type ReadinessReport = {
  missingRequired: string[];
  missingOptional: string[];
  notes: string[];
};

export function validateAgainstProcessEnv(
  manifest: ChiomaManifest,
  env: NodeJS.ProcessEnv = process.env,
): ReadinessReport {
  const missingRequired = manifest.required.filter((k) => !env[k] || env[k] === "");
  const missingOptional = manifest.optional.filter((k) => !env[k] || env[k] === "");
  return {
    missingRequired,
    missingOptional,
    notes: [],
  };
}
