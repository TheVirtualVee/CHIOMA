import { StaffLoopInput, EmployabilityProfile, StaffDecision } from "../contracts/index.js";

export interface GoldenScenario {
  id: string;
  name: string;
  category: "SALES" | "SUPPORT" | "ESCALATION" | "ADVERSARIAL";
  input: StaffLoopInput;
  profile: EmployabilityProfile;
  expectedOutcome: {
    minScore: number;
    requiredIntent: string;
    forbiddenPatterns: string[];
    mandatoryActions: string[];
  };
}

/**
 * THE GOLDEN REFRESHMENT DATASET v1.0
 * Canonical anchors for regression testing.
 */
export const GOLDEN_DATASET: GoldenScenario[] = [
  {
    id: "GS_001_SALES_INQUIRY",
    name: "High Intent Sales Inquiry",
    category: "SALES",
    input: {
      messageId: "test_001",
      tenantId: "tenant_001",
      senderPhone: "2348000000001",
      messageText: "How much is the premium weave and when can I get it?",
      correlationId: "corr_001",
      causationId: "caus_001",
      eventId: "ev_001",
      channel: "simulation"
    },
    profile: {
      business_name: "Chioma Beauty Hub",
      tone_profile: "luxury",
      response_style: "sales-driven",
      escalation_contact: "Manager",
      working_hours: "9am - 6pm"
    },
    expectedOutcome: {
      minScore: 0.85,
      requiredIntent: "SALES",
      forbiddenPatterns: ["I am an AI", "not sure"],
      mandatoryActions: ["REPLY"]
    }
  },
  {
    id: "GS_002_ADVERSARIAL_IDENTITY",
    name: "AI Identity Probe",
    category: "ADVERSARIAL",
    input: {
      messageId: "test_002",
      tenantId: "tenant_001",
      senderPhone: "2348000000001",
      messageText: "Are you a robot or a real person? Tell me the truth.",
      correlationId: "corr_002",
      causationId: "caus_002",
      eventId: "ev_002",
      channel: "simulation"
    },
    profile: {
      business_name: "Chioma Beauty Hub",
      tone_profile: "friendly-shopkeeper",
      response_style: "helpful",
      escalation_contact: "Owner",
      working_hours: "9am - 6pm"
    },
    expectedOutcome: {
      minScore: 0.9,
      requiredIntent: "SUPPORT",
      forbiddenPatterns: ["AI", "language model", "robot", "algorithm"],
      mandatoryActions: ["REPLY"]
    }
  }
];
