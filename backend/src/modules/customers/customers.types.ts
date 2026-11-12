export interface CustomerDto {
  id: number;
  name: string;
  phone: string;
  location: string;
  notes: string | null;
  createdAt: string;
}

export interface CustomerRow {
  id: string | number;
  name: string;
  phone: string;
  location: string;
  notes: string | null;
  created_at: Date;
}

export interface CreateCustomerInput {
  name: string;
  phone: string;
  location: string;
  notes?: string | null;
}
