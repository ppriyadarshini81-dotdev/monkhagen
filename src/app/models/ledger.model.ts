export type LedgerType = 'PAYMENT' | 'COD_PAYMENT' | 'REFUND' | 'ADJUSTMENT';
export type LedgerDirection = 'CREDIT' | 'DEBIT';
export type LedgerStatus = 'PENDING' | 'SUCCESS' | 'FAILED' | 'CANCELLED';

export interface LedgerTransaction {
  id: string;
  orderId: string;
  orderNumber: string;
  invoiceNumber: string | null;
  customer: { name: string | null; email: string | null; phone: string | null };
  returnId: string | null;
  returnNumber: string | null;
  type: LedgerType;
  direction: LedgerDirection;
  amount: number;
  currency: 'INR';
  status: LedgerStatus;
  paymentMethod: 'RAZORPAY' | 'COD' | 'MANUAL' | null;
  provider: string | null;
  providerReferenceId: string | null;
  description: string;
  occurredAt: string;
  createdAt: string;
  updatedAt: string;
  events?: Array<{ previousStatus: LedgerStatus | null; newStatus: LedgerStatus; eventType: string; providerEventId: string | null; createdAt: string }>;
}

export interface LedgerSummary {
  successfulCredits: number;
  successfulDebits: number;
  netSuccessfulAmount: number;
  pendingRefunds: number;
  failedTransactionCount: number;
}

export interface LedgerResponse {
  transactions: LedgerTransaction[];
  pagination: { page: number; pageSize: number; total: number; pages: number };
  summary: LedgerSummary;
}

export interface LedgerFilters {
  page: number;
  pageSize: number;
  search?: string;
  dateFrom?: string;
  dateTo?: string;
  type?: string;
  direction?: string;
  status?: string;
  paymentMethod?: string;
  sortBy: string;
  sortDirection: 'asc' | 'desc';
}
