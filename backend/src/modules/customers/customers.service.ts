import type { Pool } from "pg";
import { insertAuthAuditLog } from "../auth/auth.repository.js";
import {
  insertCustomer,
  searchCustomers,
} from "./customers.repository.js";
import type {
  CreateCustomerInput,
  CustomerDto,
  CustomerRow,
} from "./customers.types.js";

function mapCustomerRow(row: CustomerRow): CustomerDto {
  return {
    id: Number(row.id),
    name: row.name,
    phone: row.phone,
    location: row.location,
    notes: row.notes,
    createdAt: row.created_at.toISOString(),
  };
}

export class CustomersService {
  constructor(private readonly pool: Pool) {}

  async listOrSearch(query: string): Promise<CustomerDto[]> {
    const rows = await searchCustomers(this.pool, query, 25);
    return rows.map(mapCustomerRow);
  }

  async create(
    input: CreateCustomerInput,
    actor: { userId: string; ipAddress: string }
  ): Promise<CustomerDto> {
    const client = await this.pool.connect();
    let inTx = false;
    try {
      await client.query("BEGIN");
      inTx = true;

      const created = await insertCustomer(client, input);
      await insertAuthAuditLog(client, {
        userId: actor.userId,
        action: "CREATE_CUSTOMER",
        entityType: "CUSTOMER",
        entityId: String(created.id),
        details: {
          customerName: created.name,
        },
        ipAddress: actor.ipAddress,
      });

      await client.query("COMMIT");
      inTx = false;
      return mapCustomerRow(created);
    } catch (err) {
      if (inTx) {
        await client.query("ROLLBACK").catch(() => {});
      }
      throw err;
    } finally {
      client.release();
    }
  }
}
