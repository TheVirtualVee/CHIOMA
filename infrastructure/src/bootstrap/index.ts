import type { ChiomaManifest, ReadinessReport } from "./readiness.js";
import { defaultManifestPath, loadManifestFromPath, validateAgainstProcessEnv } from "./readiness.js";
import { detectRuntimePlatform, platformEnvHints } from "../config/smart-env-loader.js";

export { detectRuntimePlatform, platformEnvHints };
export type BootstrapResult = {
  platform: ReturnType<typeof detectRuntimePlatform>;
  manifest: ChiomaManifest;
  readiness: ReadinessReport;
};

export function runBootstrapReadiness(env: NodeJS.ProcessEnv = process.env): BootstrapResult {
  const platform = detectRuntimePlatform(env);
  const manifest = loadManifestFromPath(defaultManifestPath());
  const readiness = validateAgainstProcessEnv(manifest, env);
  readiness.notes.push(`platform=${platform}`);
  return { platform, manifest, readiness };
}
