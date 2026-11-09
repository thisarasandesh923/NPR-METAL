import type { StatCardData } from "../../types/invoice";

/**
 * Illustrative daily dashboard statistics.
 * NOTE: In production, these metrics are aggregated by the backend from invoices and payment ledgers.
 */
export const DEMO_DASHBOARD_STATS: StatCardData[] = [
  {
    label: "Today's Sales",
    value: "Rs. 284,500",
    note: "12% more than yesterday",
    icon: "sales",
    tone: "blue",
  },
  {
    label: "Cash Collected",
    value: "Rs. 198,000",
    note: "From 8 transactions",
    icon: "cash",
    tone: "green",
  },
  {
    label: "Outstanding Balance",
    value: "Rs. 86,500",
    note: "From 3 invoices",
    icon: "balance",
    tone: "orange",
  },
  {
    label: "Total Invoices",
    value: "12",
    note: "Issued today",
    icon: "documents",
    tone: "navy",
  },
];
