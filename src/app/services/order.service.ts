import { HttpClient } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';

export interface Order {
  id: string;
  orderNumber?: string;
  userId?: string;
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
  }[];
}

export interface AdminReturn {
  id: string;
  orderId: string;
  orderNumber: string | null;
  returnNumber: string;
  status: string;
  reason: string | null;
  comments: string | null;
  refundAmount: number;
  refundStatus: string;
  paymentMethod: string;
  shiprocketReturnOrderId: number | null;
  returnAwb: string | null;
  pickupStatus: string | null;
  pickupDelayed: boolean;
  cancellationPending: boolean;
  requestedAt: string;
  receivedAt: string | null;
  customer?: { name: string | null; email: string | null; phone: string | null };
  items: Array<{ productName: string; sku: string | null; size: string | null; color: string | null; quantity: number; reason: string; comments: string | null; refundAmount: number }>;
}

@Injectable({ providedIn: 'root' })
export class OrderService {
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

  allOrders(): Observable<Order[]> {
    return this.http.get<Order[]>(this.api);
  }

  updateStatus(id: string, status: string): Observable<Order> {
    return this.http.put<Order>(`${this.api}/${id}/status`, { status });
  }

  adminReturns(): Observable<AdminReturn[]> { return this.http.get<AdminReturn[]>('/api/admin/returns'); }
  approveReturn(id: string): Observable<AdminReturn> { return this.http.post<AdminReturn>(`/api/admin/returns/${id}/approve`, {}); }
  rejectReturn(id: string, confirmedNoRemote = false): Observable<AdminReturn> {
    return this.http.post<AdminReturn>(`/api/admin/returns/${id}/reject`, { confirmedNoRemote });
  }
  refundReturn(id: string): Observable<AdminReturn> { return this.http.post<AdminReturn>(`/api/admin/returns/${id}/refund`, {}); }
  retryReturnCreation(id: string): Observable<AdminReturn> { return this.http.post<AdminReturn>(`/api/admin/returns/${id}/retry-creation`, {}); }
}
