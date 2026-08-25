import { HttpClient } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { CartItem } from '../models/cart.model';

export interface ShippingForm {
  name?: string;
  address?: string;
  city?: string;
  state?: string;
  zip?: string;
  phone?: string;
}

export interface Order {
  id: string;
  orderNumber?: string;
  totalAmount?: number;
  total?: number;
  status: string;
  createdAt: string;
  items: { name: string; quantity: number; price: number }[];
}

@Injectable({ providedIn: 'root' })
export class OrderService {
  private readonly api = '/api/orders';

  constructor(private http: HttpClient) {}

  checkout(items: CartItem[], shipping: ShippingForm): Observable<Order> {
    return this.http.post<Order>(this.api, {
      items: items.map((i) => ({ variantId: i.variantId, quantity: i.quantity })),
      address: {
        fullName: shipping.name,
        addressLine1: shipping.address,
        city: shipping.city,
        state: shipping.state || shipping.city,
        postalCode: shipping.zip,
        phone: shipping.phone
      },
      shippingAmount: 0,
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
