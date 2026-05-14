import { createGovernedMemory, enforceMemoryGovernance } from "../core/memory/governance.js";

function testMemoryGovernance() {
  console.log("🧠 TESTING CHIOMA MEMORY GOVERNANCE");
  console.log("------------------------------------");

  const memories = [
    createGovernedMemory("order_id", "ORD-123"),           // Transactional
    createGovernedMemory("hair_pref", "braided"),         // Preference
    createGovernedMemory("customer_mood", "hurried"),     // Emotional Context
    createGovernedMemory("attachment_level", "I love her"), // FORBIDDEN
    createGovernedMemory("current_session", "session_abc") // Ephemeral
  ];

  console.log("Created Memories:");
  memories.forEach(m => console.log(` - ${m.key}: [${m.category}] value="${m.value}" replaySafe=${m.replaySafe}`));

  const governed = enforceMemoryGovernance(memories);
  console.log("\nGoverned Memories (Scrubbed & TTL Checked):");
  governed.forEach(m => console.log(` - ${m.key}: [${m.category}]`));

  const forbiddenCount = memories.filter(m => m.category === "FORBIDDEN").length;
  const scrubbedCount = memories.length - governed.length;

  if (forbiddenCount > 0 && governed.every(m => m.category !== "FORBIDDEN")) {
    console.log("\n✅ SUCCESS: Forbidden emotional accumulation scrubbed.");
  } else {
    console.log("\n❌ FAILURE: Memory governance failed to scrub forbidden patterns.");
  }
}

testMemoryGovernance();
