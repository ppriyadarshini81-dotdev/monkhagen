import { HttpClient } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';

export interface Order {
  id: string;
  orderNumber?: string;
  userId?: string;
  orderType?: 'normal' | 'replacement' | 'rejected_return';
  sourceOrderId?: string | null; sourceOrderNumber?: string | null;
  returnId?: string | null; returnNumber?: string | null;
  fulfillmentHoldReason?: string | null;
  subtotal?: number;
  discountAmount?: number;
  shippingAmount?: number;
  totalAmount?: number;
  total?: number;
  status: string;
  paymentStatus?: string;
  paymentMethod?: string;
  shipment?: {
    shiprocketOrderId: string | number | null;
    shiprocketShipmentId: string | number | null;
    shippingStatus: string;
    awbCode: string | null;
    courierName: string | null;
    pickupStatus: string;
    lastErrorCode: string | null;
    trackingStatus?: string | null; trackingUrl?: string | null; pendingOperation?: string | null;
  };
  address?: {
    fullName?: string;
    phone?: string;
    addressLine1?: string;
    addressLine2?: string;
    landmark?: string;
    city?: string;
    state?: string;
    postalCode?: string;
    country?: string;
  } | null;
  createdAt: string;
  updatedAt?: string;
  items: {
    id?: string;
    productId?: string;
    variantId?: string;
    name?: string;
    productName: string;
    sku?: string;
    size?: string;
    color?: string;
    quantity: number;
    price?: number;
    unitPrice: number;
    totalPrice?: number;
    imageUrl?: string | null; fulfillmentType?: 'normal' | 'replacement' | 'rejected_return'; inspectionReason?: string | null;
  }[];
}

export interface AdminReturn {
  trackingSyncUnavailable?: boolean;
  defectPhotoReviewPending?: boolean;
  defectPhotoReview?: { decision: 'approved' | 'rejected'; reason: string } | null;
  id: string;
  orderId: string;
  orderNumber: string | null;
  returnNumber: string;
  requestType: 'return' | 'defect' | 'replacement';
  status: string;
  reason: string | null;
  comments: string | null;
  refundAmount: number;
  returnShippingDeduction: number;
  refundStatus: string;
  paymentMethod: string;
  refundDestination: {
    required: boolean; provided: boolean; method: 'UPI' | 'BANK' | null; masked: string | null;
    status: 'PROVIDED' | 'PROCESSING' | 'FAILED' | 'COMPLETED' | 'REDACTED' | null;
    canEdit: boolean; transactionReference: string | null; completedAt: string | null;
  };
  shiprocketReturnOrderId: number | null;
  returnAwb: string | null;
  pickupStatus: string | null;
  pickupDelayed: boolean;
  cancellationPending: boolean;
  requestedAt: string;
  receivedAt: string | null;
  approvedAt?: string | null;
  customer?: { name: string | null; email: string | null; phone: string | null };
  shiprocketOutboundOrderId?: number | null;
  outboundAwb?: string | null;
  outboundStatus?: string | null;
  outboundTrackingUrl?: string | null;
  outboundCreatedAt?: string | null;
  replacementShipmentPending?: boolean;
  outboundStage?: number;
  outboundOrder?: { id: string; orderNumber: string; orderType: 'replacement' | 'rejected_return'; status: string } | null;
  adminCategory?: string;
  items: Array<{ id: string; imageUrl?: string | null; productName: string; sku: string | null; size: string | null; color: string | null; quantity: number; reason: string; comments: string | null; replacementSize?: string | null; inspectionStatus?: 'pending' | 'approved' | 'rejected'; inspectionReason?: string | null; inspectedAt?: string | null; refundAmount: number; defectPhotos?: Array<{ id: string; url: string }> }>;
}

export interface EligibilityOverride {
  id: string;
  orderId: string;
  userId: string;
  requestType: 'return' | 'defect' | 'replacement';
  reason: string;
  grantedAt: string;
  usedAt: string | null;
  grantedBy: string;
}

export interface EligibilityOverrideHistory {
  overrides: EligibilityOverride[];
  audit: Array<{ action: string; reason: string | null; metadata: Record<string, unknown>; createdAt: string }>;
}

export type CodRefundReveal = { method: 'UPI'; upiId: string; refundAmount: number; status: string; masked: string }
  | { method: 'BANK'; accountHolderName: string; accountNumber: string; ifsc: string; bankName: string | null;
      refundAmount: number; status: string; masked: string };

export interface AdminListFilters {
  search?: string; status?: string; paymentStatus?: string; paymentMethod?: string;
  requestType?: string; refundStatus?: string; fulfillment?: string; from?: string; to?: string; sort?: string;
}

@Injectable({ providedIn: 'root' })
export class OrderService {
  private filterParams(filters: AdminListFilters): Record<string, string> {
    return Object.fromEntries(Object.entries(filters).filter(([, value]) => value !== '').map(([key, value]) => [key, value]));
  }
  private readonly api = '/api/orders';

  constructor(private http: HttpClient) {}

  checkout(addressId: string, checkoutToken: string): Observable<Order> {
    return this.http.post<Order>(this.api, {
      addressId,
      checkoutToken,
      paymentMethod: 'cod'
    });
  }

  myOrders(): Observable<Order[]> {
    return this.http.get<Order[]>(`${this.api}/mine`);
  }

  allOrders(filters: AdminListFilters = {}, limit = 100, offset = 0): Observable<Order[]> {
    return this.http.get<Order[]>(this.api, { params: { ...this.filterParams(filters), limit, offset } });
  }

  updateStatus(id: string, status: string): Observable<Order> {
    return this.http.put<Order>(`${this.api}/${id}/status`, { status });
  }

  adminReturns(tab = 'all', limit = 100, offset = 0, filters: AdminListFilters = {}): Observable<AdminReturn[]> {
    return this.http.get<AdminReturn[]>('/api/admin/returns', { params: { ...this.filterParams(filters), tab, limit, offset } });
  }
  adminAfterSalesOrders(limit = 100, offset = 0, filters: AdminListFilters = {}): Observable<Order[]> {
    return this.http.get<Order[]>('/api/admin/returns/outbound-orders', { params: { ...this.filterParams(filters), limit, offset } });
  }
  adminReturn(id: string): Observable<AdminReturn> { return this.http.get<AdminReturn>(`/api/admin/returns/${id}`); }
  approveReturn(id: string): Observable<AdminReturn> { return this.http.post<AdminReturn>(`/api/admin/returns/${id}/approve`, {}); }
  inspectReturnItem(returnId: string, itemId: string, decision: 'approved' | 'rejected', reason?: string): Observable<AdminReturn> {
    return this.http.post<AdminReturn>(`/api/admin/returns/${returnId}/items/${itemId}/inspection`, { decision, reason });
  }
  createReplacementShipment(id: string): Observable<AdminReturn> { return this.http.post<AdminReturn>(`/api/admin/returns/${id}/replacement-shipment`, {}); }
  reviewDefectPhotos(id: string, decision: 'approved' | 'rejected', reason: string): Observable<AdminReturn> {
    return this.http.post<AdminReturn>(`/api/admin/returns/${id}/photo-review`, { decision, reason });
  }
  submitReplacementInspection(id: string, items: Array<{ itemId: string; decision: 'approved' | 'rejected'; reason: string }>): Observable<AdminReturn> {
    return this.http.post<AdminReturn>(`/api/admin/returns/${id}/submit-inspection`, { items });
  }
  rejectReturn(id: string, confirmedNoRemote = false): Observable<AdminReturn> {
    return this.http.post<AdminReturn>(`/api/admin/returns/${id}/reject`, { confirmedNoRemote });
  }
  refundReturn(id: string): Observable<AdminReturn> { return this.http.post<AdminReturn>(`/api/admin/returns/${id}/refund`, {}); }
  revealCodRefund(id: string): Observable<CodRefundReveal> { return this.http.get<CodRefundReveal>(`/api/admin/returns/${id}/refund-destination/reveal`); }
  startCodRefund(id: string): Observable<AdminReturn> { return this.http.post<AdminReturn>(`/api/admin/returns/${id}/refund/start`, {}); }
  failCodRefund(id: string, internalNote: string): Observable<AdminReturn> { return this.http.post<AdminReturn>(`/api/admin/returns/${id}/refund/fail`, { internalNote }); }
  completeCodRefund(id: string, transactionReference: string, internalNote: string): Observable<AdminReturn> {
    return this.http.post<AdminReturn>(`/api/admin/returns/${id}/refund/complete`, { transactionReference, internalNote });
  }
  retryReturnCreation(id: string): Observable<AdminReturn> { return this.http.post<AdminReturn>(`/api/admin/returns/${id}/retry-creation`, {}); }
  grantEligibilityOverride(payload: { orderId: string; userId: string; requestType: 'return' | 'defect' | 'replacement'; reason: string }): Observable<EligibilityOverride> {
    return this.http.post<EligibilityOverride>('/api/admin/returns/eligibility-overrides', payload);
  }
  eligibilityOverrideHistory(orderId: string): Observable<EligibilityOverrideHistory> {
    return this.http.get<EligibilityOverrideHistory>('/api/admin/returns/eligibility-overrides', { params: { orderId } });
  }
}
