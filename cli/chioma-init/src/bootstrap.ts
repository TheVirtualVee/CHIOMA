import postgres from "postgres";
import { loadConfigFromEnv } from "@chioma/infrastructure";
import * as fs from "fs";
import * as path from "path";

/**
 * Phase D — Smart Bootstrap System.
 * Enforces Priority 2: System self-configuration and readiness verification.
 */
async function bootstrap() {
  console.log("CHIOMA_BOOTSTRAP: Starting system initialization...");
  const report: any = {
    timestamp: new Date().toISOString(),
    steps: [],
  };

  try {
    // 1. Validate Environment
    const config = loadConfigFromEnv();
    report.steps.push({ name: "env_validation", status: "success" });

    // 2. Database Connectivity & Schema
    const dbUrl = process.env.DATABASE_URL;
    if (!dbUrl) throw new Error("BOOTSTRAP_FAILED: DATABASE_URL missing");

    const sql = postgres(dbUrl);
    
    // Read schema file
    const schemaPath = path.join(process.cwd(), "infrastructure", "src", "database", "supabase-schema.sql");
    const schema = fs.readFileSync(schemaPath, "utf-8");

    console.log("CHIOMA_BOOTSTRAP: Applying database schema...");
    await sql.unsafe(schema);
    report.steps.push({ name: "database_schema", status: "success" });

    // 3. Verify Vector Extension
    try {
      await sql`CREATE EXTENSION IF NOT EXISTS vector`;
      report.steps.push({ name: "vector_extension", status: "success" });
    } catch (e) {
      console.warn("CHIOMA_BOOTSTRAP: pgvector extension could not be enabled. Vector search may be limited.");
      report.steps.push({ name: "vector_extension", status: "warning", error: String(e) });
    }

    // 4. Generate Readiness Report
    report.ready = true;
    const reportPath = path.join(process.cwd(), "readiness_report.json");
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));

    console.log(`CHIOMA_BOOTSTRAP: Success. Readiness report generated at ${reportPath}`);
    process.exit(0);
  } catch (error) {
    console.error("CHIOMA_BOOTSTRAP: Critical failure during initialization.");
    console.error(error);
    report.ready = false;
    report.error = String(error);
    fs.writeFileSync("readiness_report.json", JSON.stringify(report, null, 2));
    process.exit(1);
  }
}

bootstrap();
