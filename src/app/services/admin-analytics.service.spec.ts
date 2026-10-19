import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { AdminAnalyticsService, AnalyticsDashboard } from './admin-analytics.service';

describe('AdminAnalyticsService dashboard requests', () => {
  it('loads the full dashboard in one GET with date and product sort filters', () => {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    const service = TestBed.inject(AdminAnalyticsService);
    const http = TestBed.inject(HttpTestingController);
    let result: AnalyticsDashboard | undefined;
    service.dashboard({ range: 'custom', start: '2026-10-01', end: '2026-10-19' }, 'views', 'asc')
      .subscribe(value => result = value);
    const request = http.expectOne(req => req.url === '/api/admin/analytics/dashboard');
    expect(request.request.method).toBe('GET');
    expect(request.request.params.get('start')).toBe('2026-10-01');
    expect(request.request.params.get('end')).toBe('2026-10-19');
    expect(request.request.params.get('sort')).toBe('views');
    expect(request.request.params.get('direction')).toBe('asc');
    request.flush({ overview: { metrics: {} }, products: { products: [] } });
    expect(result?.products.products).toEqual([]);
    http.verify();
  });
});
