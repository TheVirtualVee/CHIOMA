/**
 * CHIOMA OVERSEER ENGINE — CLI RUNNER (v1.2 Risk-Aware Evaluator)
 */

import { execSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { resolve, relative } from "node:path";
import { enforce } from "./engine.js";
import type { Changeset, FileChange, OverseerDecision, Violation } from "./types.js";

// ---------------------------------------------------------------------------
// CONSTANTS
// ---------------------------------------------------------------------------
const REPO_ROOT = resolve(process.cwd());
const SUPPORTED_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".json"]);

// ---------------------------------------------------------------------------
// HELPERS
// ---------------------------------------------------------------------------

function log(severity: "INFO" | "WARN" | "ERROR", message: string, ctx?: Record<string, unknown>): void {
  const entry = {
    timestamp: new Date().toISOString(),
    severity,
    service: "overseer-engine",
    message,
    ...ctx,
  };
  process.stderr.write(JSON.stringify(entry) + "\n");
}

function buildCorrelationId(): string {
  try {
    const sha = execSync("git rev-parse --short HEAD", { encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] }).trim();
    return `overseer_${sha}_${Date.now().toString(36)}`;
  } catch {
    return `overseer_nostage_${Date.now().toString(36)}`;
  }
}

function getStagedFiles(): Array<{ filePath: string; status: string }> {
  try {
    const output = execSync("git diff --cached --name-status", { encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] }).trim();
    if (!output) return [];
    return output.split("\n").filter(l => l.trim()).map(line => {
      const parts = line.split("\t");
      return { status: parts[0]?.trim() ?? "M", filePath: parts[parts.length - 1]?.trim() ?? "" };
    }).filter(({ filePath }) => SUPPORTED_EXTENSIONS.has("." + (filePath.split(".").pop() ?? "")));
  } catch (err) {
    log("ERROR", "Failed to read staged files from git", { error: String(err) });
    throw new Error(`GIT_STAGED_READ_FAILURE: ${String(err)}`);
  }
}

function readStagedContent(filePath: string): string {
  try {
    return execSync(`git show :${filePath}`, { encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] });
  } catch {
    const fullPath = resolve(REPO_ROOT, filePath);
    if (existsSync(fullPath)) return readFileSync(fullPath, "utf8");
    throw new Error(`CONTENT_READ_FAILURE: "${filePath}"`);
  }
}

function mapGitStatus(statusCode: string): FileChange["changeType"] {
  if (statusCode.startsWith("A")) return "added";
  if (statusCode.startsWith("D")) return "deleted";
  return "modified";
}

// ---------------------------------------------------------------------------
// CHANGESET BUILDERS
// ---------------------------------------------------------------------------

async function buildChangesetFromStaged(submittedBy: string): Promise<Changeset> {
  const staged = getStagedFiles();
  return {
    changesetId: buildCorrelationId(),
    submittedAt: new Date().toISOString(),
    submittedBy,
    files: staged.map(({ filePath, status }) => ({
      filePath,
      changeType: mapGitStatus(status),
      content: status.startsWith("D") ? "" : readStagedContent(filePath)
    }))
  };
}

async function buildChangesetFromFilePaths(paths: string[], submittedBy: string): Promise<Changeset> {
  return {
    changesetId: buildCorrelationId(),
    submittedAt: new Date().toISOString(),
    submittedBy,
    files: paths.map(p => ({
      filePath: relative(REPO_ROOT, resolve(p)),
      content: readFileSync(resolve(p), "utf8"),
      changeType: "modified"
    }))
  };
}

async function buildChangesetFromStdin(): Promise<Changeset> {
  return new Promise((resolve, reject) => {
    let raw = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", c => raw += c);
    process.stdin.on("end", () => {
      try {
        const parsed = JSON.parse(raw);
        if (!parsed.files) throw new Error("Invalid Changeset");
        resolve(parsed);
      } catch (err) { reject(err); }
    });
  });
}

// ---------------------------------------------------------------------------
// OUTPUT FORMATTERS
// ---------------------------------------------------------------------------

function emitHumanSummary(decision: OverseerDecision): void {
  const divider = "═".repeat(60);
  const lines: string[] = ["", divider, "  CHIOMA OVERSEER ENGINE — RISK EVALUATION", divider];
  
  lines.push(`  Status     : ${decision.status}`);
  lines.push(`  Risk Score : ${decision.riskScore} / 100`);
  lines.push(`  Criticals  : ${decision.criticalViolations}`);
  lines.push(`  Correlation: ${decision.correlationId}`);

  if (decision.status !== "APPROVED") {
    lines.push("");
    lines.push(`  VIOLATIONS (${decision.violations.length}):`);
    for (const v of decision.violations) {
      const sevColor = v.severity === "CRITICAL" ? "🔴" : v.severity === "HIGH" ? "🟠" : v.severity === "MEDIUM" ? "🟡" : "⚪";
      lines.push(`  ────────────────────────────────────────────────────`);
      lines.push(`  ${sevColor} [${v.severity}] ${v.rule}`);
      lines.push(`  File    : ${v.filePath}${v.line ? `:${v.line}` : ""}`);
      lines.push(`  Message : ${v.message}`);
      lines.push(`  Evidence: ${v.evidence}`);
      if (v.suggestion) lines.push(`  💡 SUGGESTION: ${v.suggestion}`);
    }
  } else {
    lines.push("", "  ✅ All validation rules passed. Changeset is APPROVED.");
  }

  lines.push(divider, "");
  process.stderr.write(lines.join("\n") + "\n");
}

// ---------------------------------------------------------------------------
// MAIN
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const submittedBy = process.env["GIT_AUTHOR_NAME"] ?? "unknown-agent";
  const correlationId = buildCorrelationId();

  let changeset: Changeset;
  try {
    if (args.includes("--stdin")) changeset = await buildChangesetFromStdin();
    else if (args.includes("--files")) {
      const idx = args.indexOf("--files");
      changeset = await buildChangesetFromFilePaths(args.slice(idx + 1).filter(a => !a.startsWith("-")), submittedBy);
    } else changeset = await buildChangesetFromStaged(submittedBy);
  } catch (err) {
    process.stderr.write(`FATAL: Changeset construction failed: ${String(err)}\n`);
    process.exit(1);
  }

  if (changeset.files.length === 0) {
    log("INFO", "No files to check.");
    process.exit(0);
  }

  const decision = enforce(changeset, correlationId);
  process.stdout.write(JSON.stringify(decision, null, 2) + "\n");
  emitHumanSummary(decision);

  process.exit(decision.status === "REJECTED" ? 1 : 0);
}

main().catch(err => {
  process.stderr.write(JSON.stringify({ severity: "FATAL", message: String(err) }) + "\n");
  process.exit(1);
});
