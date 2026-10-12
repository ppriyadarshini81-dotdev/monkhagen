import { HttpClient, HttpResponse } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { Observable, shareReplay } from 'rxjs';
import { User } from '../models/user.model';
import {
  Address, AddressPayload, IndiaLocations, PincodeLocation, Order, TrackingInfo,
  ReturnRequest, ReturnPayload, ReturnEligibility, CreditTransaction, CodRefundDestination, CodRefundDestinationPayload, CancellationEligibility
} from '../models/account.model';

@Injectable({ providedIn: 'root' })
export class AccountService {
  private readonly api = '/api/account';
  private addressLocations$?: Observable<IndiaLocations>;

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

  getAddressLocations(): Observable<IndiaLocations> {
    return this.addressLocations$ ||= this.http.get<IndiaLocations>(`${this.api}/addresses/locations`).pipe(
      shareReplay({ bufferSize: 1, refCount: false })
    );
  }

  lookupPincode(postalCode: string): Observable<PincodeLocation> {
    return this.http.get<PincodeLocation>(`${this.api}/addresses/pincode/${encodeURIComponent(postalCode)}`);
  }

  // ── Orders ─────────────────────────────────────────────────
  getOrders(limit = 10, offset = 0, status = '', sort: 'newest' | 'oldest' = 'newest', dateFrom = '', dateTo = ''): Observable<Order[]> {
    const params: Record<string, string | number> = { limit, offset, sort };
    if (dateFrom) params['dateFrom'] = dateFrom;
    if (dateTo) params['dateTo'] = dateTo;
    if (status) params['status'] = status;
    return this.http.get<Order[]>(`${this.api}/orders`, { params });
  }

  getOrder(orderId: string): Observable<Order> {
    return this.http.get<Order>(`${this.api}/orders/${orderId}`);
  }

  getTracking(orderId: string): Observable<TrackingInfo> {
    return this.http.get<TrackingInfo>(`${this.api}/orders/${orderId}/tracking`);
  }
  getCancellationEligibility(orderId: string): Observable<CancellationEligibility> {
    return this.http.get<CancellationEligibility>(`${this.api}/orders/${orderId}/cancellation-eligibility`);
  }
  cancelOrder(orderId: string, reason?: string): Observable<CancellationEligibility['cancellation']> {
    return this.http.post<CancellationEligibility['cancellation']>(`${this.api}/orders/${orderId}/cancel`, reason ? { reason } : {});
  }

  getInvoice(orderId: string): Observable<HttpResponse<Blob>> {
    return this.http.get(`${this.api}/orders/${orderId}/invoice`, {
      observe: 'response',
      responseType: 'blob'
    });
  }

  // ── Returns ────────────────────────────────────────────────
  getReturns(limit = 10, offset = 0, status = '', orderId = ''): Observable<ReturnRequest[]> {
    const params: Record<string, string | number> = { limit, offset };
    if (orderId) params['orderId'] = orderId;
    if (status) params['status'] = status;
    return this.http.get<ReturnRequest[]>(`${this.api}/returns`, { params });
  }

  createReturn(payload: ReturnPayload): Observable<ReturnRequest> {
    return this.http.post<ReturnRequest>(`${this.api}/returns`, payload);
  }
  uploadDefectPhotos(orderId: string, itemId: string, files: File[]): Observable<Array<{ id: string; url: string }>> {
    const form = new FormData(); files.forEach(file => form.append('images', file));
    return this.http.post<Array<{ id: string; url: string }>>(`${this.api}/orders/${orderId}/items/${itemId}/defect-photos`, form);
  }
  cancelReturn(returnId: string): Observable<ReturnRequest> {
    return this.http.post<ReturnRequest>(`${this.api}/returns/${returnId}/cancel`, {});
  }

  getReturnEligibility(orderId: string): Observable<ReturnEligibility> {
    return this.http.get<ReturnEligibility>(`${this.api}/orders/${orderId}/return-eligibility`);
  }

  saveCodRefundDestination(returnId: string, payload: CodRefundDestinationPayload): Observable<CodRefundDestination> {
    return this.http.put<CodRefundDestination>(`${this.api}/returns/${returnId}/refund-destination`, payload);
  }

  // ── Credits ────────────────────────────────────────────────
  getCredits(): Observable<{ balance: number }> {
    return this.http.get<{ balance: number }>(`${this.api}/credits`);
  }

  getCreditTransactions(): Observable<CreditTransaction[]> {
    return this.http.get<CreditTransaction[]>(`${this.api}/credits/transactions`);
  }
}
