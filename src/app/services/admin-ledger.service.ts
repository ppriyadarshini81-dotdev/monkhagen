import { HttpClient, HttpParams, HttpResponse } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { LedgerFilters, LedgerResponse, LedgerTransaction } from '../models/ledger.model';

@Injectable({ providedIn: 'root' })
export class AdminLedgerService {
  private readonly api = '/api/admin/ledger';
  constructor(private http: HttpClient) {}

  list(filters: LedgerFilters): Observable<LedgerResponse> {
    return this.http.get<LedgerResponse>(this.api, { params: this.params(filters) });
  }
  detail(id: string): Observable<LedgerTransaction> {
    return this.http.get<LedgerTransaction>(`${this.api}/${id}`);
  }
  export(filters: LedgerFilters): Observable<HttpResponse<Blob>> {
    return this.http.get(`${this.api}/export`, {
      params: this.params(filters), observe: 'response', responseType: 'blob'
    });
  }

  private params(filters: LedgerFilters): HttpParams {
    let params = new HttpParams()
      .set('page', filters.page).set('pageSize', filters.pageSize)
      .set('sortBy', filters.sortBy).set('sortDirection', filters.sortDirection);
    for (const key of ['search', 'dateFrom', 'dateTo', 'type', 'direction', 'status', 'paymentMethod'] as const) {
      if (filters[key]) params = params.set(key, filters[key]!);
    }
    return params;
  }
}
