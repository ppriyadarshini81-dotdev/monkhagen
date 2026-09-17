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

@Injectable({ providedIn: 'root' })
export class OrderService {
  private readonly api = '/api/orders';

  constructor(private http: HttpClient) {}

  checkout(addressId: string): Observable<Order> {
    return this.http.post<Order>(this.api, {
      addressId,
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
}
