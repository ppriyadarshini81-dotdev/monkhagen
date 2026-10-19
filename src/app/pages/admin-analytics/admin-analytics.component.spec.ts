import { ComponentFixture, TestBed } from '@angular/core/testing';
import { forkJoin, Observable, of, Subject } from 'rxjs';
import { provideRouter } from '@angular/router';
import { AdminAnalyticsComponent } from './admin-analytics.component';
import { AdminAnalyticsService } from '../../services/admin-analytics.service';

describe('AdminAnalyticsComponent metric modal', () => {
  let fixture: ComponentFixture<AdminAnalyticsComponent>;
  const period = { range: '7d', label: 'Last 7 days', timezone: 'Asia/Kolkata', startDate: '2026-09-26', endDate: '2026-10-02' };
  const emptyReport = { period };
  const service = {
    dashboard: (): Observable<any> => forkJoin({ overview: service.overview(), revenue: service.revenue(),
      funnel: service.funnel(), products: service.products(), carts: service.carts(), payments: service.payments(),
      visitors: service.visitors(), trend: service.trend(), logins: service.logins(), returns: service.returns(), errors: service.errors() }),
    overview: () => of({ period, metrics: { visitors: { value: 1, previous: 1, changePercent: 0 } },
      definitions: { visitors: 'Distinct visitors.' }, trackingStartedAt: '2026-09-21T00:00:00Z' }),
    revenue: () => of({ ...emptyReport, points: [] }), funnel: () => of({ ...emptyReport, stages: [], guest: {} }),
    products: () => of({ ...emptyReport, products: [] }), carts: () => of({ ...emptyReport, summary: {}, carts: [] }),
    payments: () => of({ ...emptyReport, summary: {}, issues: [] }), visitors: () => of({ ...emptyReport, summary: {}, hourly: [] }),
    trend: () => of({ ...emptyReport, points: [{ date: '2026-10-01T00:00:00.000Z', visitors: 1 }] }),
    logins: () => of({ ...emptyReport, events: [], users: [] }), returns: () => of({ ...emptyReport, summary: {}, returns: [] }),
    errors: () => of({ ...emptyReport, errors: [] }),
    drilldown: () => of({ metric: 'visitors', date: '2026-10-01', definition: 'Distinct visitors.',
      columns: [{ key: 'customer', label: 'Customer' }], rows: [{ customer: 'Guest' }] })
  };

  beforeEach(async () => {
    spyOn(service, 'dashboard').and.callThrough();
    await TestBed.configureTestingModule({ imports: [AdminAnalyticsComponent],
      providers: [provideRouter([]), { provide: AdminAnalyticsService, useValue: service }] }).compileComponents();
    fixture = TestBed.createComponent(AdminAnalyticsComponent);
    fixture.detectChanges();
  });

  it('loads all dashboard sections with one request per refresh', () => {
    expect(service.dashboard).toHaveBeenCalledTimes(1);
    expect(fixture.componentInstance.overview?.metrics['visitors'].value).toBe(1);
    fixture.componentInstance.refresh();
    expect(service.dashboard).toHaveBeenCalledTimes(2);
  });

  it('cancels superseded dashboard requests and unsubscribes when leaving the page', () => {
    const first = new Subject<any>();
    const second = new Subject<any>();
    (service.dashboard as jasmine.Spy).and.returnValues(first, second);
    fixture.componentInstance.refresh();
    expect(first.observed).toBeTrue();
    fixture.componentInstance.range = '30d';
    fixture.componentInstance.changeRange();
    expect(first.observed).toBeFalse();
    expect(second.observed).toBeTrue();
    expect(fixture.componentInstance.loading).toBeTrue();
    fixture.destroy();
    expect(second.observed).toBeFalse();
  });

  it('opens a populated details modal when a KPI card is clicked', () => {
    const card = fixture.nativeElement.querySelector('.kpi') as HTMLButtonElement;
    card.click(); fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.metric-modal')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('.metric-modal h2').textContent.trim()).toBe('Unique visitors');
    expect(fixture.nativeElement.querySelector('.metric-modal__body').textContent).toContain('Guest');
  });
});
