
import { pool } from "../db/pool.js";

async function checkDatabase(): Promise<void> {
  try {
    const result = await pool.query(
      "SELECT 1 AS connected"
    );

    if (result.rows[0]?.connected !== 1) {
      throw new Error("Unexpected database response");
    }

    console.log("PostgreSQL connection successful!");
  } catch (error) {
    console.error(
      "Database connection failed:",
      error instanceof Error ? error.message : "Unknown error"
    );

    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

void checkDatabase();
