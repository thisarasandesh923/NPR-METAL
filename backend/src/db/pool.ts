import "dotenv/config";
import { Pool } from "pg";
import { getRuntimeDatabaseUrl } from "./config.js";

const databaseUrl = getRuntimeDatabaseUrl();

export const pool = new Pool({
  connectionString: databaseUrl,
  max: 5,
  idleTimeoutMillis: 10000,
  connectionTimeoutMillis: 10000,
});

pool.on("error", () => {
  console.error("Unexpected PostgreSQL pool error");
});