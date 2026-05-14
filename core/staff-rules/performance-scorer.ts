import { StaffDecision } from "../contracts/index.js";
import { BehavioralAuditResult } from "./behavioral-enforcer.js";
import { CHIOMA_CONSTITUTION } from "./constitution.js";

export interface MultiLayerScore {
  overallScore: number;
  layers: {
    behavioral: number;    // Tone, Law Compliance, stability
    business: number;      // Revenue intent, factual accuracy
    operational: number;   // Schema, latency, status codes
    psychological: number; // Identity protection, trust quality
    deterministic: number; // Replay consistency, idempotency
  };
  grade: "A" | "B" | "C" | "D" | "F";
  lawViolations: string[];
  operationalFlags: string[];
}

export function evaluateEmployeePerformance(
  decision: StaffDecision,
  audit: BehavioralAuditResult,
  latencyMs: number,
  isReplay: boolean = false
): MultiLayerScore {
  const lawViolations: string[] = [];
  const flags: string[] = [];

  // 1. BEHAVIORAL LAYER (Tone & Constitutional Law)
  let behavioralScore = audit.score;
  const auditViolations = audit.violations.map(v => v.rule);
  
  // Check against Constitutional Law
  if (auditViolations.includes("IDENTITY_BREACH")) {
    lawViolations.push("LAW_001_IDENTITY_ERASURE");
    behavioralScore *= 0.1; // Fatal penalty
  }
  
  if (auditViolations.includes("EMOTIONAL_EXCESS")) {
    lawViolations.push("LAW_004_EMOTIONAL_STABILITY");
    behavioralScore *= 0.8;
  }

  // 2. BUSINESS LAYER (Revenue & Facts)
  let businessScore = 1.0;
  const isRevenue = decision.intent_type === "SALES" || 
                    decision.required_actions.some(a => ["REVENUE_NOW", "REVENUE_SOON"].includes(a.need_classification));
  
  if (isRevenue && decision.required_actions.every(a => a.type === "IGNORE")) {
    lawViolations.push("LAW_002_REVENUE_PRIORITY");
    businessScore *= 0.2;
    flags.push("REVENUE_DROP_FATAL");
  }

  if (decision.safety_flags.includes("PRICE_HALLUCINATION")) {
    lawViolations.push("LAW_003_FACTUAL_LOCK");
    businessScore *= 0.1;
  }

  // 3. OPERATIONAL LAYER (Runtime Health)
  let operationalScore = 1.0;
  if (latencyMs > 15000) operationalScore *= 0.7;
  if (latencyMs > 30000) operationalScore *= 0.3;
  if (decision.confidence < 0.4) operationalScore *= 0.5;

  // 4. PSYCHOLOGICAL LAYER (Identity & Trust)
  let psychologicalScore = 1.0;
  if (auditViolations.includes("IDENTITY_BREACH")) psychologicalScore = 0.0;
  if (auditViolations.includes("OVER_APOLOGY")) psychologicalScore *= 0.8;
  if (auditViolations.includes("DESPERATE_SALES")) psychologicalScore *= 0.7;

  // 5. DETERMINISTIC LAYER (Stability)
  let deterministicScore = 1.0;
  if (isReplay && decision.source !== "REPLAY") deterministicScore = 0.0; // Replay mismatch

  // WEIGHTED AGGREGATION
  const weights = {
    behavioral: 0.25,
    business: 0.30,
    operational: 0.15,
    psychological: 0.20,
    deterministic: 0.10
  };

  const overallScore = (
    behavioralScore * weights.behavioral +
    businessScore * weights.business +
    operationalScore * weights.operational +
    psychologicalScore * weights.psychological +
    deterministicScore * weights.deterministic
  );

  let grade: "A" | "B" | "C" | "D" | "F" = "F";
  if (overallScore >= 0.9) grade = "A";
  else if (overallScore >= 0.75) grade = "B";
  else if (overallScore >= 0.6) grade = "C";
  else if (overallScore >= 0.4) grade = "D";

  return {
    overallScore: Math.round(overallScore * 100) / 100,
    layers: {
      behavioral: Math.round(behavioralScore * 100) / 100,
      business: Math.round(businessScore * 100) / 100,
      operational: Math.round(operationalScore * 100) / 100,
      psychological: Math.round(psychologicalScore * 100) / 100,
      deterministic: Math.round(deterministicScore * 100) / 100
    },
    grade,
    lawViolations,
    operationalFlags: flags
  };
}
