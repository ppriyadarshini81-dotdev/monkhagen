import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { StockMovement, StockResponse } from '../models/stock.model';

export interface StockFilters { page: number; limit: number; search?: string; status?: string; category?: string; size?: string; sort?: string; }

@Injectable({ providedIn: 'root' })
export class AdminStockService {
  private readonly api = '/api/admin/stock';
  constructor(private http: HttpClient) {}
  list(filters: StockFilters): Observable<StockResponse> {
    let params = new HttpParams().set('page', filters.page).set('limit', filters.limit).set('groupBy', 'product');
    for (const key of ['search','status','category','size','sort'] as const) if (filters[key]) params = params.set(key, filters[key]!);
    return this.http.get<StockResponse>(this.api, { params });
  }
  adjust(inventoryId: string, adjustment: number, reason: string): Observable<unknown> {
    return this.http.post(`${this.api}/${inventoryId}/adjust`, { adjustment, reason });
  }
  history(inventoryId: string): Observable<StockMovement[]> { return this.http.get<StockMovement[]>(`${this.api}/${inventoryId}/history`); }
}
