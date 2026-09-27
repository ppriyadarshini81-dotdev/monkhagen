import { HttpClient, HttpResponse } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { User } from '../models/user.model';
import {
  Address, AddressPayload, Order, TrackingInfo,
  ReturnRequest, ReturnPayload, CreditTransaction
} from '../models/account.model';

@Injectable({ providedIn: 'root' })
export class AccountService {
  private readonly api = '/api/account';

  constructor(private http: HttpClient) {}

  // ── Profile ────────────────────────────────────────────────
  getProfile(): Observable<User> {
    return this.http.get<User>(`${this.api}/profile`);
  }

  updateProfile(data: { name: string; phone?: string; dateOfBirth?: string }): Observable<User> {
    return this.http.put<User>(`${this.api}/profile`, data);
  }

  // ── Addresses ──────────────────────────────────────────────
  getAddresses(): Observable<Address[]> {
    return this.http.get<Address[]>(`${this.api}/addresses`);
  }

  getDefaultAddress(): Observable<Address | null> {
    return this.http.get<Address | null>(`${this.api}/addresses/default`);
  }

  addAddress(payload: AddressPayload): Observable<Address> {
    return this.http.post<Address>(`${this.api}/addresses`, payload);
  }

  updateAddress(id: string, payload: AddressPayload): Observable<Address> {
    return this.http.put<Address>(`${this.api}/addresses/${id}`, payload);
  }

  deleteAddress(id: string): Observable<{ message: string }> {
    return this.http.delete<{ message: string }>(`${this.api}/addresses/${id}`);
  }

  setDefaultAddress(id: string): Observable<Address> {
    return this.http.patch<Address>(`${this.api}/addresses/${id}/default`, {});
  }

  // ── Orders ─────────────────────────────────────────────────
  getOrders(): Observable<Order[]> {
    return this.http.get<Order[]>(`${this.api}/orders`);
  }

  getOrder(orderId: string): Observable<Order> {
    return this.http.get<Order>(`${this.api}/orders/${orderId}`);
  }

  getTracking(orderId: string): Observable<TrackingInfo> {
    return this.http.get<TrackingInfo>(`${this.api}/orders/${orderId}/tracking`);
  }

  getInvoice(orderId: string): Observable<HttpResponse<Blob>> {
    return this.http.get(`${this.api}/orders/${orderId}/invoice`, {
      observe: 'response',
      responseType: 'blob'
    });
  }

  // ── Returns ────────────────────────────────────────────────
  getReturns(): Observable<ReturnRequest[]> {
    return this.http.get<ReturnRequest[]>(`${this.api}/returns`);
  }

  createReturn(payload: ReturnPayload): Observable<ReturnRequest> {
    return this.http.post<ReturnRequest>(`${this.api}/returns`, payload);
  }

  // ── Credits ────────────────────────────────────────────────
  getCredits(): Observable<{ balance: number }> {
    return this.http.get<{ balance: number }>(`${this.api}/credits`);
  }

  getCreditTransactions(): Observable<CreditTransaction[]> {
    return this.http.get<CreditTransaction[]>(`${this.api}/credits/transactions`);
  }
}
