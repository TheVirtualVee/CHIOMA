import { type ExecutionIntent } from "./execution-mapper.js";
import { ECBLoader } from "./ecb.js";

/** contract: ResolutionPolicyEngine */
export function resolveIntent(
  input: string,
  context: { tenantId: string; lastIntent?: string }
): ExecutionIntent {
  const normalized = input.toLowerCase().trim();
  if (normalized.length === 0) return "UNCLASSIFIED";

  const ecb = ECBLoader.get();

  // 1. Semantic Cluster Mapping (from ECB Snapshot)
  const candidates = ecb.intents.filter((intent) => {
    if (intent.deprecated) return false;
    return intent.patterns.some((p) => normalized.includes(p));
  });

  if (candidates.length === 0) return "UNCLASSIFIED" as ExecutionIntent;

  // 2. Resolution Policy Engine (from ECB Policy)
  const ranked = [...candidates].sort((a, b) => {
    // Priority (ECB Overrides > ECB Global Weight)
    const priorityA = ecb.config.priorityOverrides[a.id] ?? a.priority;
    const priorityB = ecb.config.priorityOverrides[b.id] ?? b.priority;

    if (priorityA !== priorityB) return priorityB - priorityA;

    // Recency (Session Memory Alignment via ECB Weight)
    if (context.lastIntent === a.id) return -1;
    if (context.lastIntent === b.id) return 1;

    // Deterministic Tie-break (ECB Hash Rule)
    const hashA = simpleHash(`${a.id}${context.tenantId}`);
    const hashB = simpleHash(`${b.id}${context.tenantId}`);
    return hashA - hashB;
  });

  return ranked[0].id as ExecutionIntent;
}

/** constraint: Deterministic hash for tie-breaking */
function simpleHash(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash |= 0;
  }
  return Math.abs(hash);
}
