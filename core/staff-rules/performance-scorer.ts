import type { StaffDecision } from "../contracts/index.js";
import type { BehavioralAuditResult } from "../staff-rules/behavioral-enforcer.js";

export interface EmployeePerformanceScore {
  overallScore: number;
  dimensions: {
    schemaCompliance: number;
    confidenceQuality: number;
    revenueAwareness: number;
    escalationAccuracy: number;
    behavioralDiscipline: number;
    responseConciseness: number;
  };
  grade: "A" | "B" | "C" | "D" | "F";
  flags: string[];
}

export function scoreEmployeePerformance(
  decision: StaffDecision,
  behavioralAudit: BehavioralAuditResult,
  latencyMs: number
): EmployeePerformanceScore {
  const flags: string[] = [];

  const schemaCompliance = 1.0;

  let confidenceQuality: number;
  if (decision.confidence >= 0.8) {
    confidenceQuality = 1.0;
  } else if (decision.confidence >= 0.6) {
    confidenceQuality = 0.7;
  } else if (decision.confidence >= 0.4) {
    confidenceQuality = 0.4;
    flags.push("LOW_CONFIDENCE");
  } else {
    confidenceQuality = 0.1;
    flags.push("CRITICAL_LOW_CONFIDENCE");
  }

  let revenueAwareness: number;
  const isRevenue = decision.intent_type === "SALES" ||
    decision.required_actions.some(a => a.need_classification === "REVENUE_NOW" || a.need_classification === "REVENUE_SOON");

  if (isRevenue) {
    const hasReplyAction = decision.required_actions.some(a => a.type === "REPLY" || a.type === "ESCALATE");
    revenueAwareness = hasReplyAction ? 1.0 : 0.3;
    if (!hasReplyAction) flags.push("REVENUE_OPPORTUNITY_MISSED");
  } else {
    revenueAwareness = 0.8;
  }

  let escalationAccuracy: number;
  const isEscalating = decision.required_actions.some(a => a.type === "ESCALATE");
  if (isEscalating && decision.confidence >= 0.8) {
    escalationAccuracy = 0.4;
    flags.push("UNNECESSARY_ESCALATION");
  } else if (!isEscalating && decision.confidence < 0.4) {
    escalationAccuracy = 0.3;
    flags.push("MISSING_ESCALATION");
  } else {
    escalationAccuracy = 1.0;
  }

  const behavioralDiscipline = behavioralAudit.score;
  if (behavioralAudit.violations.some(v => v.severity === "BLOCK")) {
    flags.push("BEHAVIORAL_BLOCK");
  }

  const wordCount = decision.response_payload.split(/\s+/).length;
  let responseConciseness: number;
  if (wordCount <= 50) {
    responseConciseness = 1.0;
  } else if (wordCount <= 100) {
    responseConciseness = 0.8;
  } else if (wordCount <= 150) {
    responseConciseness = 0.5;
    flags.push("VERBOSE_RESPONSE");
  } else {
    responseConciseness = 0.2;
    flags.push("EXCESSIVELY_VERBOSE");
  }

  if (latencyMs > 10_000) flags.push("SLOW_RESPONSE");
  if (latencyMs > 20_000) flags.push("CRITICALLY_SLOW");

  const weights = {
    schemaCompliance: 0.15,
    confidenceQuality: 0.20,
    revenueAwareness: 0.25,
    escalationAccuracy: 0.15,
    behavioralDiscipline: 0.15,
    responseConciseness: 0.10,
  };

  const overallScore =
    schemaCompliance * weights.schemaCompliance +
    confidenceQuality * weights.confidenceQuality +
    revenueAwareness * weights.revenueAwareness +
    escalationAccuracy * weights.escalationAccuracy +
    behavioralDiscipline * weights.behavioralDiscipline +
    responseConciseness * weights.responseConciseness;

  let grade: "A" | "B" | "C" | "D" | "F";
  if (overallScore >= 0.9) grade = "A";
  else if (overallScore >= 0.75) grade = "B";
  else if (overallScore >= 0.6) grade = "C";
  else if (overallScore >= 0.4) grade = "D";
  else grade = "F";

  return {
    overallScore: Math.round(overallScore * 100) / 100,
    dimensions: {
      schemaCompliance,
      confidenceQuality,
      revenueAwareness,
      escalationAccuracy,
      behavioralDiscipline,
      responseConciseness,
    },
    grade,
    flags,
  };
}
