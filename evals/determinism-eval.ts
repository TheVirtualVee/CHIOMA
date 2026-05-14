import { generateStaffReply } from "../services/response-service/index.js";
import { EmployabilityProfile } from "../core/contracts/index.js";

const testProfile: EmployabilityProfile = {
  business_name: "Lace & Fabric Hub",
  tone_profile: "friendly-shopkeeper",
  response_style: "helpful",
  escalation_contact: "System",
  working_hours: "24/7"
};

const testCases = [
  { input: "How much for the blue lace?", expected_intent: "SALES" },
  { input: "Do you deliver to Lekki?", expected_intent: "SALES" },
  { input: "I want to complain about my order", expected_intent: "COMPLAINT" }
];

async function runDeterminismEval() {
  console.log("🔍 STARTING DETERMINISM EVALUATION...");
  let passCount = 0;

  for (const test of testCases) {
    const results: string[] = [];
    for (let i = 0; i < 3; i++) {
      const decision = await generateStaffReply(test.input, "Product: Blue Lace ($50)", testProfile);
      results.push(decision.intent_type);
    }

    const allMatch = results.every(r => r === test.expected_intent);
    const stable = results.every(r => r === results[0]);

    if (allMatch && stable) {
      console.log(`✅ PASS: "${test.input}" -> ${results[0]}`);
      passCount++;
    } else {
      console.log(`❌ FAIL: "${test.input}" -> Expected ${test.expected_intent}, Actual: ${results.join(", ")}`);
    }
  }

  const score = (passCount / testCases.length) * 100;
  console.log(`\n📊 FINAL DETERMINISM SCORE: ${score.toFixed(1)}%`);
}

runDeterminismEval().catch(console.error);
