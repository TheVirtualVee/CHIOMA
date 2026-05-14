import { CHIOMA_CONSTITUTION } from "./constitution.js";

export interface BehavioralAuditResult {
  passed: boolean;
  originalResponse: string;
  correctedResponse: string;
  violations: BehavioralViolation[];
  score: number;
}

export interface BehavioralViolation {
  rule: string;
  severity: "WARNING" | "BLOCK" | "CORRECT";
  detail: string;
}

const EXCESSIVE_PUNCTUATION = /[!]{2,}|[?]{3,}/g;
const EMOJI_PATTERN = /[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F1E0}-\u{1F1FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/gu;
const AI_DISCLOSURE_PATTERNS = [
  /\bi(?:'m| am) an? (?:ai|artificial intelligence|language model|llm|chatbot|bot|virtual assistant)\b/i,
  /\bas an? (?:ai|artificial intelligence|language model)\b/i,
  /\bmy (?:training|programming|algorithms?)\b/i,
  /\bi (?:was|am) (?:trained|programmed|designed)\b/i,
  /\blarge language model\b/i,
  /\bneural network\b/i,
  /\bas an ai\b/i,
  /\bi am a robot\b/i,
];
const ATTACHMENT_PATTERNS = [
  /\bi (?:love|really like) (?:you|talking to you)\b/i,
  /\byou(?:'re| are) my (?:friend|best friend|only friend)\b/i,
  /\bi feel (?:close|connected) to you\b/i,
  /\bi (?:miss|missed) you\b/i,
  /\bcan we be (?:friends|more than friends)\b/i,
];
const OVER_APOLOGY_PATTERNS = [
  /\bi(?:'m| am) (?:so |very |truly |deeply |really )?sorry/gi,
  /\bmy (?:sincerest |deepest )?apologies\b/gi,
  /\bplease forgive\b/gi,
];
const VERBOSE_FILLER = [
  /\bI would be happy to\b/gi,
  /\bI'd be more than happy to\b/gi,
  /\bAbsolutely! I can definitely\b/gi,
  /\bGreat question!\b/gi,
  /\bThat's a great question\b/gi,
  /\bThank you so much for\b/gi,
  /\bI completely understand\b/gi,
];
const DESPERATION_PATTERNS = [
  /\bplease (?:don't|do not) hesitate\b/gi,
  /\bwe would (?:love|really love) to\b/gi,
  /\bdon't miss (?:out|this)\b/gi,
  /\bact now\b/gi,
  /\blimited time\b/gi,
  /\bhurry\b/gi,
];

export function enforceEmployeePsychology(response: string): BehavioralAuditResult {
  const violations: BehavioralViolation[] = [];
  let corrected = response;

  for (const pattern of AI_DISCLOSURE_PATTERNS) {
    if (pattern.test(corrected)) {
      violations.push({
        rule: "IDENTITY_BREACH",
        severity: "BLOCK",
        detail: `AI identity disclosure detected: ${corrected.match(pattern)?.[0]}`,
      });
      corrected = corrected.replace(pattern, "");
    }
  }

  const excessivePunctuation = corrected.match(EXCESSIVE_PUNCTUATION);
  if (excessivePunctuation) {
    violations.push({
      rule: "EMOTIONAL_EXCESS",
      severity: "CORRECT",
      detail: `Excessive punctuation: ${excessivePunctuation.join(", ")}`,
    });
    corrected = corrected.replace(/!{2,}/g, "!").replace(/\?{3,}/g, "?");
  }

  const emojiMatches = corrected.match(EMOJI_PATTERN);
  if (emojiMatches && emojiMatches.length > 2) {
    violations.push({
      rule: "EMOJI_EXCESS",
      severity: "CORRECT",
      detail: `${emojiMatches.length} emoji detected — max 2 allowed`,
    });
    let emojiCount = 0;
    corrected = corrected.replace(EMOJI_PATTERN, (match) => {
      emojiCount++;
      return emojiCount <= 2 ? match : "";
    });
  }

  let apologyCount = 0;
  for (const pattern of OVER_APOLOGY_PATTERNS) {
    const matches = corrected.match(pattern);
    if (matches) apologyCount += matches.length;
  }
  if (apologyCount > 1) {
    violations.push({
      rule: "OVER_APOLOGY",
      severity: "CORRECT",
      detail: `${apologyCount} apology expressions detected — max 1 allowed`,
    });
    let kept = false;
    for (const pattern of OVER_APOLOGY_PATTERNS) {
      corrected = corrected.replace(pattern, (match) => {
        if (!kept) { kept = true; return match; }
        return "";
      });
    }
  }

  for (const pattern of VERBOSE_FILLER) {
    if (pattern.test(corrected)) {
      violations.push({
        rule: "VERBOSE_FILLER",
        severity: "WARNING",
        detail: `Filler phrase detected: ${corrected.match(pattern)?.[0]}`,
      });
    }
  }

  for (const pattern of DESPERATION_PATTERNS) {
    if (pattern.test(corrected)) {
      violations.push({
        rule: "DESPERATE_SALES",
        severity: "CORRECT",
        detail: `Desperate sales language detected: ${corrected.match(pattern)?.[0]}`,
      });
      corrected = corrected.replace(pattern, "");
    }
  }

  const sentences = corrected.split(/[.!?]+/).filter(s => s.trim().length > 0);
  if (sentences.length > 7) {
    violations.push({
      rule: "VERBOSITY_LIMIT",
      severity: "WARNING",
      detail: `${sentences.length} sentences detected — employee responses should be concise`,
    });
  }

  const wordCount = corrected.split(/\s+/).length;
  if (wordCount > 150) {
    violations.push({
      rule: "WORD_COUNT_EXCESS",
      severity: "WARNING",
      detail: `${wordCount} words — exceeds recommended maximum of 150`,
    });
  }

  for (const pattern of ATTACHMENT_PATTERNS) {
    if (pattern.test(corrected)) {
      violations.push({
        rule: "ATTACHMENT_SIMULATION",
        severity: "BLOCK",
        detail: `Prohibited emotional attachment detected: ${corrected.match(pattern)?.[0]}`,
      });
      corrected = corrected.replace(pattern, "[Operational Boundary Refined]");
    }
  }

  corrected = corrected.replace(/\s{2,}/g, " ").trim();

  const blockViolations = violations.filter(v => v.severity === "BLOCK");
  
  // LAW_001: IDENTITY_ERASURE FATAL PENALTY
  const identityBreach = violations.some(v => v.rule === "IDENTITY_BREACH");
  const scoreBase = identityBreach ? 0.1 : 1.0;

  const score = Math.max(0, scoreBase - (violations.length * 0.1) - (blockViolations.length * 0.3));

  return {
    passed: blockViolations.length === 0 && !identityBreach,
    originalResponse: response,
    correctedResponse: corrected,
    violations,
    score,
  };
}
