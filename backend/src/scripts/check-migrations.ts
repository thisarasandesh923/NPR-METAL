import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.resolve(__dirname, "../../../database/migrations");

async function checkMigrations(): Promise<void> {
  const entries = await readdir(migrationsDir, { withFileTypes: true });
  const sqlFiles = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".sql"))
    .map((entry) => entry.name)
    .sort();

  if (sqlFiles.length === 0) {
    throw new Error(`No .sql migration files found in ${migrationsDir}`);
  }

  const seenPrefixes = new Set<number>();
  const seenTables = new Set<string>();
  const seenIndexes = new Set<string>();
  const seenViews = new Set<string>();
  const seenTriggers = new Set<string>();

  for (const [idx, filename] of sqlFiles.entries()) {
    const match = /^(\d+)_([a-z0-9_]+)\.sql$/.exec(filename);
    if (!match) {
      throw new Error(
        `Invalid migration filename "${filename}". Expected NNN_snake_case.sql.`
      );
    }

    const prefix = Number(match[1]);
    if (seenPrefixes.has(prefix)) {
      throw new Error(`Duplicate numeric prefix ${prefix} on file "${filename}".`);
    }
    if (prefix !== idx + 1) {
      throw new Error(
        `Non-sequential migration prefix on "${filename}": expected ${String(idx + 1).padStart(3, "0")}.`
      );
    }
    seenPrefixes.add(prefix);

    const content = await readFile(path.join(migrationsDir, filename), "utf8");
    if (!/^\s*--\s*Up\s+Migration/im.test(content)) {
      throw new Error(`Migration "${filename}" is missing "-- Up Migration" header.`);
    }
    if (/^\s*--\s*Down\s+Migration/im.test(content)) {
      throw new Error(
        `Migration "${filename}" contains "-- Down Migration"; forward-only policy prohibits down scripts.`
      );
    }

    for (const tableMatch of content.matchAll(/CREATE\s+TABLE\s+([a-z0-9_]+)/gi)) {
      const tableName = tableMatch[1].toLowerCase();
      if (seenTables.has(tableName)) {
        throw new Error(`Duplicate table definition "${tableName}" in "${filename}".`);
      }
      seenTables.add(tableName);
    }

    for (const indexMatch of content.matchAll(
      /CREATE\s+(?:UNIQUE\s+)?INDEX\s+([a-z0-9_]+)/gi
    )) {
      const indexName = indexMatch[1].toLowerCase();
      if (seenIndexes.has(indexName)) {
        throw new Error(`Duplicate index definition "${indexName}" in "${filename}".`);
      }
      seenIndexes.add(indexName);
    }

    for (const viewMatch of content.matchAll(
      /CREATE\s+(?:OR\s+REPLACE\s+)?VIEW\s+([a-z0-9_]+)/gi
    )) {
      const viewName = viewMatch[1].toLowerCase();
      seenViews.add(viewName);
    }

    for (const triggerMatch of content.matchAll(
      /CREATE\s+(?:CONSTRAINT\s+)?TRIGGER\s+([a-z0-9_]+)/gi
    )) {
      const triggerName = triggerMatch[1].toLowerCase();
      if (seenTriggers.has(triggerName)) {
        throw new Error(`Duplicate trigger definition "${triggerName}" in "${filename}".`);
      }
      seenTriggers.add(triggerName);
    }
  }

  console.log(`Offline migration check passed (${sqlFiles.length} SQL files):`);
  for (const file of sqlFiles) {
    console.log(`  - ${file}`);
  }
  console.log(
    `Discovered: ${seenTables.size} tables, ${seenIndexes.size} explicit indexes, ${seenViews.size} views, ${seenTriggers.size} triggers.`
  );
}

checkMigrations().catch((error: unknown) => {
  console.error(
    "Migration check failed:",
    error instanceof Error ? error.message : "Unknown error"
  );
  process.exitCode = 1;
});
