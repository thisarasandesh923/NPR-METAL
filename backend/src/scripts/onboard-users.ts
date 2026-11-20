import "dotenv/config";
import readline from "node:readline/promises";
import pg from "pg";
import { getMigrationDatabaseUrl } from "../db/config.js";
import { hashPassword } from "../modules/auth/password.js";

const { Client } = pg;

interface UserOnboardingInput {
  username: string;
  fullName: string;
  role: "OWNER" | "CASHIER";
  passwordPlain: string;
}

interface MaterialInitialPrice {
  code: string;
  name: string;
  unit: string;
  price: string;
}

const DEFAULT_MATERIALS: MaterialInitialPrice[] = [
  { code: "3/4", name: "3/4 Metal", unit: "m³", price: "12000.00" },
  { code: "DUST", name: "Dust", unit: "m³", price: "8500.00" },
  { code: "6X9", name: "6×9 (Aggregate)", unit: "m³", price: "10500.00" },
  { code: "ABC", name: "ABC", unit: "m³", price: "9500.00" },
];

async function promptMasked(rl: readline.Interface, promptText: string): Promise<string> {
  const answer = await rl.question(promptText);
  return answer.trim();
}

async function main(): Promise<void> {
  const dbUrl = getMigrationDatabaseUrl();

  const client = new Client({
    connectionString: dbUrl,
  });

  await client.connect();
  console.log("Connected to PostgreSQL for initial onboarding.");

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  try {
    console.log("\n=======================================================");
    console.log(" NPR Metal Crusher — Production User Onboarding CLI");
    console.log(" (1 Owner + 2 Cashiers + Initial Material Prices)");
    console.log("=======================================================\n");

    // 1. Owner Details
    const ownerUsername =
      process.env.OWNER_USERNAME || (await promptMasked(rl, "Owner Username [admin_owner]: ")) || "admin_owner";
    const ownerFullName =
      process.env.OWNER_FULLNAME || (await promptMasked(rl, "Owner Full Name: "));
    if (!ownerFullName) throw new Error("Owner Full Name is mandatory.");
    const ownerPassword =
      process.env.OWNER_PASSWORD || (await promptMasked(rl, "Owner Password (min 12 chars): "));
    if (ownerPassword.length < 12) {
      throw new Error("Owner password must be at least 12 characters.");
    }

    // 2. Cashier 1 Details
    const c1Username =
      process.env.CASHIER1_USERNAME || (await promptMasked(rl, "Cashier 1 Username [cashier1]: ")) || "cashier1";
    const c1FullName =
      process.env.CASHIER1_FULLNAME || (await promptMasked(rl, "Cashier 1 Full Name: "));
    if (!c1FullName) throw new Error("Cashier 1 Full Name is mandatory.");
    const c1Password =
      process.env.CASHIER1_PASSWORD || (await promptMasked(rl, "Cashier 1 Password (min 12 chars): "));
    if (c1Password.length < 12) {
      throw new Error("Cashier 1 password must be at least 12 characters.");
    }

    // 3. Cashier 2 Details
    const c2Username =
      process.env.CASHIER2_USERNAME || (await promptMasked(rl, "Cashier 2 Username [cashier2]: ")) || "cashier2";
    const c2FullName =
      process.env.CASHIER2_FULLNAME || (await promptMasked(rl, "Cashier 2 Full Name: "));
    if (!c2FullName) throw new Error("Cashier 2 Full Name is mandatory.");
    const c2Password =
      process.env.CASHIER2_PASSWORD || (await promptMasked(rl, "Cashier 2 Password (min 12 chars): "));
    if (c2Password.length < 12) {
      throw new Error("Cashier 2 password must be at least 12 characters.");
    }

    console.log("\nComputing secure cryptographic scrypt hashes...");
    const [ownerHash, c1Hash, c2Hash] = await Promise.all([
      hashPassword(ownerPassword),
      hashPassword(c1Password),
      hashPassword(c2Password),
    ]);

    await client.query("BEGIN;");

    // Insert Owner
    const ownerRes = await client.query<{ id: string }>(
      `INSERT INTO users (username, full_name, password_hash, role, is_active)
       VALUES ($1, $2, $3, 'OWNER', true)
       ON CONFLICT (username) DO UPDATE
       SET full_name = EXCLUDED.full_name,
           password_hash = EXCLUDED.password_hash,
           role = 'OWNER',
           is_active = true
       RETURNING id;`,
      [ownerUsername.toLowerCase(), ownerFullName, ownerHash]
    );
    const ownerId = ownerRes.rows[0].id;
    console.log(`✓ Owner provisioned: ${ownerUsername} (${ownerId})`);

    // Insert Cashier 1
    const c1Res = await client.query<{ id: string }>(
      `INSERT INTO users (username, full_name, password_hash, role, is_active)
       VALUES ($1, $2, $3, 'CASHIER', true)
       ON CONFLICT (username) DO UPDATE
       SET full_name = EXCLUDED.full_name,
           password_hash = EXCLUDED.password_hash,
           role = 'CASHIER',
           is_active = true
       RETURNING id;`,
      [c1Username.toLowerCase(), c1FullName, c1Hash]
    );
    console.log(`✓ Cashier 1 provisioned: ${c1Username} (${c1Res.rows[0].id})`);

    // Insert Cashier 2
    const c2Res = await client.query<{ id: string }>(
      `INSERT INTO users (username, full_name, password_hash, role, is_active)
       VALUES ($1, $2, $3, 'CASHIER', true)
       ON CONFLICT (username) DO UPDATE
       SET full_name = EXCLUDED.full_name,
           password_hash = EXCLUDED.password_hash,
           role = 'CASHIER',
           is_active = true
       RETURNING id;`,
      [c2Username.toLowerCase(), c2FullName, c2Hash]
    );
    console.log(`✓ Cashier 2 provisioned: ${c2Username} (${c2Res.rows[0].id})`);

    // Ensure material catalog has initial prices
    console.log("\nVerifying material catalog prices...");
    for (const mat of DEFAULT_MATERIALS) {
      const priceVal =
        process.env[`PRICE_${mat.code.replace("/", "_")}`] || mat.price;

      const matRes = await client.query<{ id: number }>(
        `INSERT INTO materials (code, name, unit, current_unit_price, is_active)
         VALUES ($1, $2, $3, $4, true)
         ON CONFLICT (code) DO UPDATE
         SET name = EXCLUDED.name,
             current_unit_price = EXCLUDED.current_unit_price,
             is_active = true
         RETURNING id;`,
        [mat.code, mat.name, mat.unit, priceVal]
      );
      const matId = matRes.rows[0].id;

      await client.query(
        `INSERT INTO material_price_history (material_id, unit_price, effective_from, changed_by_user_id)
         VALUES ($1, $2, CURRENT_TIMESTAMP, $3);`,
        [matId, priceVal, ownerId]
      );
      console.log(`✓ Material ${mat.code} (${mat.name}) active price: Rs. ${priceVal} / ${mat.unit}`);
    }

    await client.query("COMMIT;");
    console.log("\n=======================================================");
    console.log(" Onboarding completed successfully! Database is ready.");
    console.log("=======================================================\n");
  } catch (err) {
    await client.query("ROLLBACK;");
    console.error("Onboarding failed, rolled back changes:", err);
    process.exit(1);
  } finally {
    rl.close();
    await client.end();
  }
}

void main();

