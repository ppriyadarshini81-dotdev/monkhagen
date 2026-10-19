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
    trend: () => of({ ...emptyReport, points: [{ date: '2026-10-01T00:00:00.000Z', visitors: 1,
      uniqueUsersLoggedIn: 1, productViews: 1, revenue: 1499, paymentAttempts: 1, returnRequests: 1, frontendErrors: 1 }] }),
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

  it('shows one section with its KPIs, chart and detailed report without fetching again', () => {
    const component = fixture.componentInstance;
    const reportTitles = ['Visitor behaviour', 'Login & signup activity', 'Product performance',
      'Revenue & orders', 'Payment performance', 'Returns & refunds', 'Sanitized frontend errors'];
    const buttons = fixture.nativeElement.querySelectorAll('.dashboard-nav button') as NodeListOf<HTMLButtonElement>;
    component.sections.forEach((section,index) => {
      buttons[index].click(); fixture.detectChanges();
      expect(component.activeSection).toBe(section.key);
      expect(buttons[index].getAttribute('aria-current')).toBe('page');
      expect(fixture.nativeElement.querySelectorAll('.metric-group').length).toBe(1);
      expect(fixture.nativeElement.querySelector('.metric-group h2').textContent).toBe(component.activeGroup.title);
      expect(fixture.nativeElement.querySelector('.metric-trend h2').textContent).toBe(component.selectedDefinition.label);
      expect(fixture.nativeElement.querySelector('.bar-chart__item')).not.toBeNull();
      const headings = Array.from(fixture.nativeElement.querySelectorAll('.panel h2') as NodeListOf<HTMLElement>).map(item => item.textContent);
      expect(headings).toContain(reportTitles[index]);
      reportTitles.filter(title => title !== reportTitles[index]).forEach(title => expect(headings).not.toContain(title));
    });
    expect(service.dashboard).toHaveBeenCalledTimes(1);
  });

  it('keeps the selected date range and opens chart details for the active section', () => {
    const component = fixture.componentInstance;
    component.range = '30d';
    component.selectSection('orders'); fixture.detectChanges();
    (fixture.nativeElement.querySelector('.metric-trend .bar-chart__item') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(component.range).toBe('30d');
    expect(component.modalTitle).toBe('Net realized revenue');
    expect(fixture.nativeElement.querySelector('.metric-modal h2').textContent).toBe('Net realized revenue');
    component.selectSection('payments'); fixture.detectChanges();
    expect(component.metricModalOpen).toBeFalse();
    expect(component.selectedMetric).toBe('paymentAttempts');
    expect(service.dashboard).toHaveBeenCalledTimes(1);
  });

  it('keeps every dashboard section within the viewport and the menu above scrolling details', async () => {
    const frame = document.createElement('iframe');
    frame.style.cssText = 'position:absolute;left:-10000px;top:0;height:700px;border:0';
    const styles = Array.from(document.querySelectorAll('style,link[rel="stylesheet"]')).map(item => {
      const copy = item.cloneNode(true) as HTMLElement;
      if (item instanceof HTMLLinkElement) (copy as HTMLLinkElement).href = item.href;
      return copy.outerHTML;
    }).join('');
    document.body.append(frame);
    try {
      const loaded = new Promise<void>(resolve => frame.onload = () => resolve());
      frame.srcdoc = `<!doctype html><html><head><base href="${document.baseURI}">${styles}</head><body></body></html>`;
      await loaded;
      const doc = frame.contentDocument!;
      const header = doc.createElement('header'); header.style.height = 'var(--mh-header-h)';
      const dashboard = doc.createElement('app-admin-analytics');
      Array.from((fixture.nativeElement as HTMLElement).attributes).forEach(attribute => dashboard.setAttribute(attribute.name,attribute.value));
      doc.body.append(header,dashboard);
      for (const width of [1440,1024,768,390,320]) {
        frame.style.width = `${width}px`;
        for (const section of fixture.componentInstance.sections) {
          fixture.componentInstance.selectSection(section.key); fixture.detectChanges();
          dashboard.innerHTML = fixture.nativeElement.innerHTML;
          await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
          const nav = dashboard.querySelector<HTMLElement>('.dashboard-nav')!;
          const workspace = dashboard.querySelector<HTMLElement>('.dashboard-workspace')!;
          expect(doc.documentElement.scrollWidth).withContext(`${section.key} at ${width}px`).toBeLessThanOrEqual(width);
          expect(workspace.getBoundingClientRect().top - nav.getBoundingClientRect().bottom).toBeGreaterThanOrEqual(12);
          expect(workspace.getBoundingClientRect().bottom).toBeLessThanOrEqual(700);
          if (width <= 390) {
            const menu = dashboard.querySelector<HTMLElement>('.dashboard-nav__links')!;
            menu.scrollLeft = menu.scrollWidth;
            expect(menu.scrollLeft).toBeGreaterThan(0);
          }
        }
      }
    } finally { frame.remove(); }
  },20000);

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
