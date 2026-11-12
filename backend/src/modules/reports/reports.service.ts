import type { Pool } from "pg";
import {
  fetchOwnerOverviewReport,
  type OwnerOverviewReport,
} from "./reports.repository.js";

export class ReportsService {
  constructor(private readonly pool: Pool) {}

  async getOverview(): Promise<OwnerOverviewReport> {
    return fetchOwnerOverviewReport(this.pool);
  }
}
