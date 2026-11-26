export type VehicleCategory = "TRACTOR" | "TIPPER";

export interface MaterialVehiclePriceDto {
  vehicleCategory: VehicleCategory;
  pricePerFt3: string | null;
  version: number;
  updatedAt: string;
}

export interface MaterialCatalogItem {
  id: number;
  code: string;
  name: string;
  unit: string;
  currentUnitPrice: string;
  isActive: boolean;
  version?: number;
  updatedAt?: string;
  vehiclePrices?: Record<VehicleCategory, MaterialVehiclePriceDto | null>;
  tractorPricePerFt3?: string | null;
  tipperPricePerFt3?: string | null;
}

export interface CustomerRecord {
  id: number;
  name: string;
  phone: string;
  location: string;
  notes: string | null;
  createdAt: string;
}

export type InvoicePaymentStatus =
  | "UNPAID"
  | "PARTIALLY_PAID"
  | "PAID"
  | "CANCELLED"
  | "REFUND_DUE";

export interface InvoiceItemRecord {
  id: number;
  materialId: number;
  materialName: string;
  quantity: string;
  unitPrice: string;
  lineTotal: string;
  unitSnapshot?: string;
  vehicleCategorySnapshot?: VehicleCategory | null;
}

export interface InvoicePaymentRecord {
  id: number;
  receiptNumber: string;
  invoiceId: number;
  cashierUserId: string;
  cashierName: string;
  amount: string;
  cashTendered: string | null;
  changeReturned: string | null;
  paymentMethod: "CASH";
  notes: string | null;
  createdAt: string;
}

export interface InvoiceSummary {
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
  paymentStatus: InvoicePaymentStatus;
  invoiceStatus: "ISSUED" | "CANCELLED";
  issuedByUserId: string;
  issuedByName: string;
  issuedAt: string;
  businessDate: string;
  vehicleCategory?: VehicleCategory | null;
  unitSnapshot?: string;
}

export interface InvoicePaymentAdjustmentRecord {
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

export interface InvoiceDetail extends InvoiceSummary {
  items: InvoiceItemRecord[];
  payments: InvoicePaymentRecord[];
  adjustments?: InvoicePaymentAdjustmentRecord[];
}

export interface OwnerOverviewMetrics {
  businessDate: string;
  todayInvoiceCount: number;
  todayBilledTotal: string;
  todayCashCollected: string;
  todayReceiptCount: number;
  totalOutstandingBalance: string;
  openInvoicesCount: number;
  totalIssuedInvoicesCount: number;
}

export interface CreateInvoiceRequest {
  customerId?: number;
  customer?: {
    name: string;
    phone: string;
    location: string;
    notes?: string | null;
  };
  vehicleCategory: VehicleCategory;
  items: Array<{
    materialId: number;
    quantity: string;
  }>;
  hasTransport: boolean;
  transportFee: string;
  initialPaymentAmount?: string;
  initialCashTendered?: string;
  initialPaymentNotes?: string | null;
  idempotencyKey: string;
}

export interface RecordPaymentRequest {
  invoiceId: number;
  amount: string;
  cashTendered?: string;
  idempotencyKey: string;
  notes?: string | null;
}

