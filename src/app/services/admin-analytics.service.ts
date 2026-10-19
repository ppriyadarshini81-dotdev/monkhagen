import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import {
  AnalyticsOverview, CartAnalyticsReport, FunnelReport, PaymentAnalyticsReport,
  ProductAnalyticsReport, RevenueReport, VisitorAnalyticsReport, TrendReport,
  LoginAnalyticsReport, ReturnAnalyticsReport, ErrorAnalyticsReport
  , AnalyticsDrilldown
} from '../models/analytics.model';

export interface AnalyticsFilter { range: string; start?: string; end?: string; }
export interface AnalyticsDashboard {
  overview: AnalyticsOverview; revenue: RevenueReport; funnel: FunnelReport;
  products: ProductAnalyticsReport; carts: CartAnalyticsReport; payments: PaymentAnalyticsReport;
  visitors: VisitorAnalyticsReport; trend: TrendReport; logins: LoginAnalyticsReport;
  returns: ReturnAnalyticsReport; errors: ErrorAnalyticsReport;
}

@Injectable({ providedIn: 'root' })
export class AdminAnalyticsService {
  private readonly api = '/api/admin/analytics';
  constructor(private http: HttpClient) {}

  dashboard(filter: AnalyticsFilter, sort = 'revenue', direction = 'desc'): Observable<AnalyticsDashboard> {
    return this.http.get<AnalyticsDashboard>(`${this.api}/dashboard`, {
      params: this.params(filter).set('sort', sort).set('direction', direction)
    });
  }

  overview(filter: AnalyticsFilter): Observable<AnalyticsOverview> {
    return this.http.get<AnalyticsOverview>(`${this.api}/overview`, { params: this.params(filter) });
  }
  revenue(filter: AnalyticsFilter): Observable<RevenueReport> {
    return this.http.get<RevenueReport>(`${this.api}/revenue`, { params: this.params(filter) });
  }
  funnel(filter: AnalyticsFilter): Observable<FunnelReport> {
    return this.http.get<FunnelReport>(`${this.api}/funnel`, { params: this.params(filter) });
  }
  products(filter: AnalyticsFilter, sort = 'revenue', direction = 'desc'): Observable<ProductAnalyticsReport> {
    return this.http.get<ProductAnalyticsReport>(`${this.api}/products`, {
      params: this.params(filter).set('sort', sort).set('direction', direction)
    });
  }
  carts(filter: AnalyticsFilter): Observable<CartAnalyticsReport> {
    return this.http.get<CartAnalyticsReport>(`${this.api}/carts`, { params: this.params(filter) });
  }
  payments(filter: AnalyticsFilter): Observable<PaymentAnalyticsReport> {
    return this.http.get<PaymentAnalyticsReport>(`${this.api}/payments`, { params: this.params(filter) });
  }
  visitors(filter: AnalyticsFilter): Observable<VisitorAnalyticsReport> {
    return this.http.get<VisitorAnalyticsReport>(`${this.api}/visitors`, { params: this.params(filter) });
  }
  trend(filter: AnalyticsFilter): Observable<TrendReport> {
    return this.http.get<TrendReport>(`${this.api}/trend`, { params: this.params(filter) });
  }
  logins(filter: AnalyticsFilter): Observable<LoginAnalyticsReport> {
    return this.http.get<LoginAnalyticsReport>(`${this.api}/logins`, { params: this.params(filter) });
  }
  returns(filter: AnalyticsFilter): Observable<ReturnAnalyticsReport> {
    return this.http.get<ReturnAnalyticsReport>(`${this.api}/returns`, { params: this.params(filter) });
  }
  errors(filter: AnalyticsFilter): Observable<ErrorAnalyticsReport> {
    return this.http.get<ErrorAnalyticsReport>(`${this.api}/errors`, { params: this.params(filter) });
  }
  drilldown(metric: string, date: string): Observable<AnalyticsDrilldown> {
    return this.http.get<AnalyticsDrilldown>(`${this.api}/drilldown`, {
      params: new HttpParams().set('metric', metric).set('date', date.slice(0, 10))
    });
  }

  private params(filter: AnalyticsFilter): HttpParams {
    let params = new HttpParams().set('range', filter.range);
    if (filter.range === 'custom' && filter.start && filter.end) {
      params = params.set('start', filter.start).set('end', filter.end);
    }
    return params;
  }
}
