import postgres from "postgres";
import { ChiomaError } from "@chioma/core";
import { createConsoleLogger } from "../observability/logger.js";

const logger = createConsoleLogger("db-client");

export type DbClientConfig = {
  max?: number;
  idle_timeout?: number;
  connect_timeout?: number;
};

/** contract: DatabaseClientFactory */
export async function createDatabaseClient(
  connectionString: string,
  opts: DbClientConfig = {}
): Promise<postgres.Sql> {
  const { max = 10, idle_timeout = 30, connect_timeout = 10 } = opts;

  if (!connectionString) {
    throw new ChiomaError("CONFIG_INVALID", "DATABASE_URL required");
  }

  const sql = postgres(connectionString, {
    ssl: { rejectUnauthorized: false },
    max,
    idle_timeout,
    connect_timeout,
    onnotice: (notice) => logger.debug("DB_NOTICE", { notice }),
    onparameter: (name, value) => logger.debug("DB_PARAM", { name, value }),
  });

  try {
    await sql`SELECT 1`;
    logger.info("DB_CONNECTED", { url: connectionString.split("@")[1] || "unknown" });
    return sql;
  } catch (err: any) {
    await sql.end();
    
    const message = err.message || String(err);
    const code = err.code || "UNKNOWN";
    
    logger.error("DB_CONNECTIVITY_FAILED", { 
      error: message, 
      code,
      host: connectionString.split("@")[1] || "unknown"
    });

    throw new ChiomaError(
      "DB_CONNECTIVITY_FAILED", 
      `Database unreachable (${code}): ${message}`
    );
  }
}
