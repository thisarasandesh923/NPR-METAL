import { apiRequest } from "./client.ts";
import type {
  CreateInvoiceRequest,
  CustomerRecord,
  InvoiceDetail,
  InvoicePaymentRecord,
  InvoiceSummary,
  MaterialCatalogItem,
  OwnerOverviewMetrics,
  RecordPaymentRequest,
} from "../types/billing.ts";

export async function fetchMaterials(): Promise<MaterialCatalogItem[]> {
  const data = await apiRequest<{ materials: MaterialCatalogItem[] }>(
    "/api/materials",
    { method: "GET" }
  );
  return data.materials;
}

export async function searchCustomers(query = ""): Promise<CustomerRecord[]> {
  const qs = query.trim() ? `?q=${encodeURIComponent(query.trim())}` : "";
  const data = await apiRequest<{ customers: CustomerRecord[] }>(
    `/api/customers${qs}`,
    { method: "GET" }
  );
  return data.customers;
}

export async function createCustomerRequest(input: {
  name: string;
  phone: string;
  location: string;
  notes?: string | null;
}): Promise<CustomerRecord> {
  const data = await apiRequest<{ customer: CustomerRecord }>("/api/customers", {
    method: "POST",
    body: input,
  });
  return data.customer;
}

export async function fetchInvoices(filters?: {
  q?: string;
  status?: string;
  limit?: number;
}): Promise<InvoiceSummary[]> {
  const params = new URLSearchParams();
  if (filters?.q?.trim()) {
    params.set("q", filters.q.trim());
  }
  if (filters?.status?.trim()) {
    params.set("status", filters.status.trim());
  }
  if (filters?.limit) {
    params.set("limit", String(filters.limit));
  }
  const qs = params.toString() ? `?${params.toString()}` : "";
  const data = await apiRequest<{ invoices: InvoiceSummary[] }>(
    `/api/invoices${qs}`,
    { method: "GET" }
  );
  return data.invoices;
}

export async function fetchInvoiceDetail(id: number): Promise<InvoiceDetail> {
  const data = await apiRequest<{ invoice: InvoiceDetail }>(
    `/api/invoices/${id}`,
    { method: "GET" }
  );
  return data.invoice;
}

export async function issueInvoiceRequest(
  payload: CreateInvoiceRequest
): Promise<{ invoice: InvoiceDetail; replayed: boolean }> {
  return apiRequest<{ invoice: InvoiceDetail; replayed: boolean }>(
    "/api/invoices",
    {
      method: "POST",
      body: payload,
    }
  );
}

export async function recordCashPaymentRequest(
  payload: RecordPaymentRequest
): Promise<{
  payment: InvoicePaymentRecord;
  invoice: InvoiceDetail;
  replayed: boolean;
}> {
  return apiRequest<{
    payment: InvoicePaymentRecord;
    invoice: InvoiceDetail;
    replayed: boolean;
  }>("/api/payments", {
    method: "POST",
    body: payload,
  });
}

export async function fetchOwnerOverview(): Promise<OwnerOverviewMetrics> {
  const data = await apiRequest<{ overview: OwnerOverviewMetrics }>(
    "/api/reports/overview",
    { method: "GET" }
  );
  return data.overview;
}
