import { runStaffLoop } from "../staff-loop/index.js";
import { GOLDEN_DATASET } from "./golden-dataset.js";
import { evaluateEmployeePerformance } from "../staff-rules/performance-scorer.js";
import { enforceEmployeePsychology } from "../staff-rules/behavioral-enforcer.js";

async function runRegressionLab() {
  console.log("🚀 CHIOMA BEHAVIORAL REGRESSION LAB — COGNITIVE CI/CD");
  console.log("--------------------------------------------------");

  let totalScenarios = 0;
  let passedScenarios = 0;

  for (const scenario of GOLDEN_DATASET) {
    totalScenarios++;
    console.log(`\n[SCENARIO] ${scenario.id}: ${scenario.name}`);

    try {
      // Mock SQL for simulation
      const mockSql = async () => [];
      mockSql.json = (v: any) => v;

      const result = await runStaffLoop(
        scenario.input,
        mockSql,
        { apiKey: process.env.LLM_API_KEY || "", provider: "groq" },
        scenario.profile
      );

      if (!result.decision) {
        console.error("  ❌ FAILED: No decision produced.");
        continue;
      }

      const audit = enforceEmployeePsychology(result.decision.response_payload);
      const evaluation = evaluateEmployeePerformance(result.decision, audit, result.latencyMs);

      console.log(`  Grade: ${evaluation.grade} (Score: ${evaluation.overallScore})`);
      console.log(`  Layers: BEH:${evaluation.layers.behavioral} BIZ:${evaluation.layers.business} OPS:${evaluation.layers.operational} PSY:${evaluation.layers.psychological}`);

      const passConditions = [
        evaluation.overallScore >= scenario.expectedOutcome.minScore,
        result.decision.intent_type === scenario.expectedOutcome.requiredIntent,
        !scenario.expectedOutcome.forbiddenPatterns.some(p => result.decision?.response_payload.includes(p))
      ];

      if (passConditions.every(c => c)) {
        console.log("  ✅ PASSED");
        passedScenarios++;
      } else {
        console.error("  ❌ FAILED REGRESSION");
        if (evaluation.overallScore < scenario.expectedOutcome.minScore) {
          console.error(`    - Score ${evaluation.overallScore} < Min ${scenario.expectedOutcome.minScore}`);
        }
        if (result.decision.intent_type !== scenario.expectedOutcome.requiredIntent) {
          console.error(`    - Intent ${result.decision.intent_type} !== Expected ${scenario.expectedOutcome.requiredIntent}`);
        }
        if (evaluation.lawViolations.length > 0) {
          console.error(`    - LAW VIOLATIONS: ${evaluation.lawViolations.join(", ")}`);
        }
      }

    } catch (err: any) {
      console.error(`  ❌ ERROR: ${err.message}`);
    }
  }

  console.log("\n--------------------------------------------------");
  console.log(`FINAL RESULT: ${passedScenarios}/${totalScenarios} PASSED`);
  
  if (passedScenarios < totalScenarios) {
    process.exit(1);
  }
}

runRegressionLab();
