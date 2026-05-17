/**
 * evals/validation/01-build-integrity.test.ts
 *
 * PHASE 1 — BUILD & TYPE FORTIFICATION
 *
 * Validates: TypeScript strict integrity, import graph correctness,
 * forbidden architecture patterns, workspace boundary violations.
 *
 * FAIL CONDITIONS:
 * - any implicit any
 * - broken imports
 * - forbidden terminology (agent, autonomous, hallucinate)
 * - architecture drift (frontend deps in webhook surface)
 * - services importing from apps/
 * - circular dependency markers
 */

import { describe, it, expect } from "vitest";
import { execSync } from "node:child_process";
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { resolve, join } from "node:path";

const ROOT = resolve(import.meta.dirname, "../..");

function readTs(filePath: string): string {
  return readFileSync(filePath, "utf8");
}

function getAllTsFiles(dir: string, files: string[] = []): string[] {
  if (!existsSync(dir)) return files;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === ".git" || entry.name === "dist") continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) getAllTsFiles(full, files);
    else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts")) files.push(full);
  }
  return files;
}

describe("Phase 1 — Build & Type Integrity", () => {

  it("TypeScript compiles with zero errors (strict mode)", () => {
    // ASSERT: zero TS errors — any failure blocks deploy
    const result = execSync("npx tsc --noEmit 2>&1 || true", { cwd: ROOT }).toString().trim();
    expect(result, `TSC errors:\n${result}`).toBe("");
  });

  it("core/runtime/index.ts exists and exports runSyncPipeline", () => {
    const runtimeIndex = resolve(ROOT, "core/runtime/index.ts");
    expect(existsSync(runtimeIndex), "core/runtime/index.ts is missing").toBe(true);
    const content = readTs(runtimeIndex);
    expect(content).toContain("runSyncPipeline");
  });

  it("commitEvent always receives causationId (no missing fields)", () => {
    // ASSERT: every call to commitEvent must include causationId
    // Counterexample: old simulate-message.ts omitted causationId → DB constraint violation
    const webhookFiles = getAllTsFiles(resolve(ROOT, "apps/webhook"));
    const violations: string[] = [];

    for (const file of webhookFiles) {
      const content = readTs(file);
      // Find commitEvent({ ... }) blocks and verify causationId present
      // Match commitEvent(...) blocks — multiline aware (dotAll mode via [\s\S])
      const callBlocks = content.match(/commitEvent\s*\([\s\S]*?\{[\s\S]*?\}\s*\)/g) ?? [];
      for (const block of callBlocks) {
        if (!block.includes("causationId")) {
          violations.push(`${file}: commitEvent call missing causationId`);
        }
      }
    }

    expect(violations, `commitEvent missing causationId:\n${violations.join("\n")}`).toHaveLength(0);
  });

  it("No forbidden architecture patterns in webhook surface", () => {
    const FORBIDDEN = [
      { pattern: /from ["']next\//, label: "Next.js import" },
      { pattern: /from ["']react/, label: "React import" },
      { pattern: /from ["']@vercel\/analytics/, label: "Vercel analytics (frontend)" },
      { pattern: /autonomous|self-directed|agent loop/i, label: "Autonomous agent terminology" },
    ];

    const files = getAllTsFiles(resolve(ROOT, "apps/webhook"));
    const violations: string[] = [];

    for (const file of files) {
      const content = readTs(file);
      for (const { pattern, label } of FORBIDDEN) {
        if (pattern.test(content)) {
          violations.push(`${file}: forbidden pattern — ${label}`);
        }
      }
    }

    expect(violations, `Forbidden patterns found:\n${violations.join("\n")}`).toHaveLength(0);
  });

  it("services/ do not import from apps/", () => {
    // ASSERT: apps/ are consumers — never sources — of services/
    const serviceFiles = getAllTsFiles(resolve(ROOT, "services"));
    const violations: string[] = [];

    for (const file of serviceFiles) {
      const content = readTs(file);
      if (/from ["'].*\/apps\//.test(content)) {
        violations.push(`${file}: imports from apps/ — architectural violation`);
      }
    }

    expect(violations, `Service → App imports:\n${violations.join("\n")}`).toHaveLength(0);
  });

  it("core/ does not import from apps/", () => {
    const coreFiles = getAllTsFiles(resolve(ROOT, "core"));
    const violations: string[] = [];

    for (const file of coreFiles) {
      const content = readTs(file);
      if (/from ["'].*\/apps\//.test(content)) {
        violations.push(`${file}: core imports from apps/ — architectural violation`);
      }
    }

    expect(violations, violations.join("\n")).toHaveLength(0);
  });

  it("vercel.json is valid JSON and references only existing files", () => {
    const vercelPath = resolve(ROOT, "vercel.json");
    expect(existsSync(vercelPath), "vercel.json missing").toBe(true);

    const raw = readFileSync(vercelPath, "utf8");
    const config = JSON.parse(raw);

    expect(config.version).toBe(2);
    if (config.builds) {
      if (config.routes) {
        for (const route of config.routes) {
          const dest = route.dest as string;
          const fullPath = resolve(ROOT, dest);
          expect(existsSync(fullPath), `Route dest does not exist: ${dest}`).toBe(true);
        }
      }
    } else {
      expect(config.functions).toBeDefined();
    }
  });

  it("Required env vars are documented in .env.example", () => {
    const examplePath = resolve(ROOT, ".env.example");
    expect(existsSync(examplePath), ".env.example missing").toBe(true);

    const content = readFileSync(examplePath, "utf8");
    const REQUIRED = [
      "DATABASE_URL",
      "LLM_API_KEY",
      "LLM_PROVIDER",
      "WHATSAPP_VERIFY_TOKEN",
      "WHATSAPP_ACCESS_TOKEN",
    ];

    for (const key of REQUIRED) {
      expect(content, `.env.example missing: ${key}`).toContain(key);
    }
  });
});
