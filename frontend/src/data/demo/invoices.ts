import type { DemoInvoice } from "../../types/invoice";

/**
 * Illustrative demo invoices for the Cashier dashboard overview.
 * NOTE: These are static UI mock items, not persistent PostgreSQL records.
 */
export const DEMO_RECENT_INVOICES: DemoInvoice[] = [
  {
    id: "INV-1048",
    customer: "Saman Construction",
    initials: "SC",
    material: '3/4"',
    quantity: "8.5 m³",
    total: "Rs. 102,000",
    status: "Paid",
    time: "10:42 AM",
  },
  {
    id: "INV-1047",
    customer: "Nimal Perera",
    initials: "NP",
    material: "ABC",
    quantity: "5.0 m³",
    total: "Rs. 57,500",
    status: "Partial",
    time: "09:58 AM",
  },
  {
    id: "INV-1046",
    customer: "Sigiri Builders",
    initials: "SB",
    material: "Dust",
    quantity: "6.0 m³",
    total: "Rs. 48,000",
    status: "Unpaid",
    time: "09:15 AM",
  },
  {
    id: "INV-1045",
    customer: "Lakmal Hardware",
    initials: "LH",
    material: "6×9",
    quantity: "7.5 m³",
    total: "Rs. 77,000",
    status: "Paid",
    time: "08:37 AM",
  },
];
