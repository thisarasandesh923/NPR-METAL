export type IconName =
  | "dashboard"
  | "invoice"
  | "history"
  | "customers"
  | "payments"
  | "logout"
  | "sales"
  | "cash"
  | "balance"
  | "documents"
  | "plus"
  | "menu"
  | "close"
  | "arrow"
  | "bell"
  | "trash"
  | "print"
  | "lock"
  | "check";

export type MaterialName = '3/4"' | "Dust" | "6×9" | "ABC";

export interface MaterialRow {
  id: number;
  material: MaterialName;
  quantity: number;
  price: number;
}

export type PaymentStatus = "Paid" | "Partial" | "Unpaid" | "Invalid (Overpaid)";

export interface PaymentCalculationResult {
  paidAmount: number;
  balance: number;
  isOverpayment: boolean;
  overpaymentAmount: number;
}

export interface InvoiceTotals {
  subtotal: number;
  grandTotal: number;
  paidAmount: number;
  balance: number;
  paymentStatus: PaymentStatus;
  isOverpayment: boolean;
  overpaymentAmount: number;
}

export interface DemoInvoice {
  id: string;
  customer: string;
  initials: string;
  material: MaterialName;
  quantity: string;
  total: string;
  status: PaymentStatus;
  time: string;
}

export interface StatCardData {
  label: string;
  value: string;
  note: string;
  icon: IconName;
  tone: "blue" | "green" | "orange" | "navy";
}

export interface NavItem {
  label: string;
  icon: IconName;
  screen?: "dashboard" | "invoice";
}
