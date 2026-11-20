import "dotenv/config";
import { Pool } from "pg";
import { getRuntimeDatabaseUrl, resolvePoolDatabaseUrl } from "./config.js";

const rawDatabaseUrl = getRuntimeDatabaseUrl();
const poolConnectionString = resolvePoolDatabaseUrl(rawDatabaseUrl);

export const pool = new Pool({
  connectionString: poolConnectionString,
  max: 5,
  idleTimeoutMillis: 10000,
  connectionTimeoutMillis: 10000,
});

pool.on("error", (err: unknown) => {
  const errObj = err instanceof Object ? (err as Record<string, unknown>) : {};
  const code = typeof errObj.code === "string" || typeof errObj.code === "number" ? String(errObj.code) : "UNKNOWN";
  const name = err instanceof Error ? err.name : "Error";
  let message = err instanceof Error ? err.message : String(err);
  message = message.replace(/:\/\/([^:]+):([^@]+)@/g, "://$1:***@");
  console.error(`[POSTGRES_POOL_ERROR] code=${code} name=${name} message=${message}`);
});