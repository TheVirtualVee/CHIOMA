/**
 * v1.1 — detects hosting/runtime from environment (no secrets; no writes to repo).
 */
export type RuntimePlatform =
  | "vercel"
  | "railway"
  | "render"
  | "docker"
  | "supabase-edge"
  | "local"
  | "unknown";

export function detectRuntimePlatform(env: NodeJS.ProcessEnv = process.env): RuntimePlatform {
  if (env.VERCEL === "1") return "vercel";
  if (env.RAILWAY_ENVIRONMENT || env.RAILWAY_PROJECT_ID) return "railway";
  if (env.RENDER) return "render";
  if (env.SUPABASE_EDGE === "1") return "supabase-edge";
  if (env.DOCKER_CONTAINER === "1" || env.CHIOMA_IN_DOCKER === "1") return "docker";
  if (env.NODE_ENV === "development" || env.NODE_ENV === "test") return "local";
  return "unknown";
}

export function platformEnvHints(platform: RuntimePlatform): string[] {
  switch (platform) {
    case "vercel":
      return ["VERCEL_URL is set automatically on Vercel"];
    case "railway":
      return ["RAILWAY_STATIC_URL / RAILWAY_PUBLIC_DOMAIN may be present"];
    case "render":
      return ["RENDER_EXTERNAL_URL may be present"];
    case "supabase-edge":
      return ["Use Supabase secrets for keys; never commit .env"];
    case "docker":
      return ["Mount env file at runtime; keep secrets out of images"];
    case "local":
      return ["Use .env.local (gitignored) for developer keys"];
    default:
      return ["Set required keys from manifest; see chioma-init output"];
  }
}
