import type { Pool, PoolClient } from "pg";
import type { CreateCustomerInput, CustomerRow } from "./customers.types.js";

export type DbClient = Pool | PoolClient;

function escapeLikePattern(raw: string): string {
  return raw.replace(/[\\%_]/g, "\\$&");
}

export async function searchCustomers(
  client: DbClient,
  query: string,
  limit = 25
): Promise<CustomerRow[]> {
  const trimmed = query.trim();
  if (!trimmed) {
    const res = await client.query<CustomerRow>(
      `SELECT id, name, phone, location, notes, created_at
       FROM public.customers
       ORDER BY id DESC
       LIMIT $1`,
      [limit]
    );
    return res.rows;
  }

  const pattern = `%${escapeLikePattern(trimmed)}%`;
  const res = await client.query<CustomerRow>(
    `SELECT id, name, phone, location, notes, created_at
     FROM public.customers
     WHERE name ILIKE $1 ESCAPE '\\'
        OR phone ILIKE $1 ESCAPE '\\'
        OR location ILIKE $1 ESCAPE '\\'
     ORDER BY id DESC
     LIMIT $2`,
    [pattern, limit]
  );
  return res.rows;
}

export async function findCustomerById(
  client: DbClient,
  customerId: number
): Promise<CustomerRow | null> {
  const res = await client.query<CustomerRow>(
    `SELECT id, name, phone, location, notes, created_at
     FROM public.customers
     WHERE id = $1
     LIMIT 1`,
    [customerId]
  );
  return res.rows[0] ?? null;
}

export async function insertCustomer(
  client: DbClient,
  input: CreateCustomerInput
): Promise<CustomerRow> {
  const res = await client.query<CustomerRow>(
    `INSERT INTO public.customers (name, phone, location, notes)
     VALUES ($1, $2, $3, $4)
     RETURNING id, name, phone, location, notes, created_at`,
    [
      input.name.trim(),
      input.phone.trim(),
      input.location.trim(),
      input.notes?.trim() || null,
    ]
  );
  return res.rows[0];
}

