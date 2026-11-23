import type { VehicleCategory } from "../materials/materials.types.js";

export type { VehicleCategory };

export type InvoiceStatus = "ISSUED" | "CANCELLED";

export type PaymentStatus =
  | "UNPAID"
  | "PARTIALLY_PAID"
  | "PAID"
  | "CANCELLED"
  | "REFUND_DUE";

export interface InvoiceItemDto {
  id: number;
  materialId: number;
  materialName: string;
  quantity: string;
  unitPrice: string;
  lineTotal: string;
  unitSnapshot?: string;
  vehicleCategorySnapshot?: VehicleCategory | null;
}

export interface InvoicePaymentDto {
  id: number;
  receiptNumber: string;
  invoiceId: number;
  cashierUserId: string;
  cashierName: string;
  amount: string;
  paymentMethod: "CASH";
  notes: string | null;
  createdAt: string;
}

export interface InvoiceSummaryDto {
  id: number;
  invoiceNumber: string;
  customerId: number;
  customerName: string;
  customerPhone: string;
  customerLocation: string;
  hasTransport: boolean;
  transportFee: string;
  subtotal: string;
  grandTotal: string;
  effectiveGrandTotal: string;
  paidAmount: string;
  balanceDue: string;
  paymentStatus: PaymentStatus;
  invoiceStatus: InvoiceStatus;
  issuedByUserId: string;
  issuedByName: string;
  issuedAt: string;
  businessDate: string;
  vehicleCategory?: VehicleCategory | null;
  unitSnapshot?: string;
}

export interface InvoicePaymentAdjustmentDto {
  id: number;
  adjustmentNumber: string;
  paymentId: number;
  receiptNumber: string;
  adjustmentType: "ENTRY_REVERSAL" | "CASH_REFUND";
  adjustmentAmount: string;
  reason: string;
  authorizedByOwnerId: string;
  authorizedByOwnerName: string;
  createdAt: string;
}

export interface InvoiceDetailDto extends InvoiceSummaryDto {
  items: InvoiceItemDto[];
  payments: InvoicePaymentDto[];
  adjustments?: InvoicePaymentAdjustmentDto[];
}

export interface CreateInvoiceItemInput {
  materialId: number;
  quantity: string | number;
}

export interface CreateInvoiceInput {
  customerId?: number;
  customer?: {
    name: string;
    phone: string;
    location: string;
    notes?: string | null;
  };
  vehicleCategory: VehicleCategory;
  items: CreateInvoiceItemInput[];
  hasTransport: boolean;
  transportFee: string | number;
  initialPaymentAmount?: string | number;
  initialPaymentNotes?: string | null;
  idempotencyKey: string;
}
