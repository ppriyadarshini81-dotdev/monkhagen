import { CommonModule } from '@angular/common';
import { Component, HostListener, OnDestroy, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { Subscription, finalize } from 'rxjs';
import {
  AnalyticsOverview, CartAnalyticsReport, FunnelReport, MetricValue,
  PaymentAnalyticsReport, ProductAnalytics, ProductAnalyticsReport,
  RevenueReport, VisitorAnalyticsReport, TrendReport, LoginAnalyticsReport,
  ReturnAnalyticsReport, ErrorAnalyticsReport, TrendPoint
  , AnalyticsDrilldown
} from '../../models/analytics.model';
import { AdminAnalyticsService, AnalyticsFilter } from '../../services/admin-analytics.service';

interface KpiDefinition { key: string; label: string; format?: 'currency' | 'percent' | 'duration' | 'decimal'; }
type DashboardSection = 'traffic' | 'customers' | 'products' | 'orders' | 'payments' | 'returns' | 'health';
interface KpiGroup { section: DashboardSection; title: string; description: string; items: KpiDefinition[]; }

@Component({
  selector: 'app-admin-analytics',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  templateUrl: './admin-analytics.component.html',
  styleUrls: ['./admin-analytics.component.css', './dashboard-navigation.css']
})
export class AdminAnalyticsComponent implements OnInit, OnDestroy {
  private dashboardRequest?: Subscription;
  private drilldownRequest?: Subscription;
  activeSection: DashboardSection = 'traffic';
  readonly sections: Array<{ key: DashboardSection; label: string; icon: string; metric: string }> = [
    { key: 'traffic', label: 'Traffic', icon: '↗', metric: 'visitors' },
    { key: 'customers', label: 'Customers', icon: '◎', metric: 'uniqueUsersLoggedIn' },
    { key: 'products', label: 'Products & carts', icon: '◇', metric: 'productViews' },
    { key: 'orders', label: 'Orders & revenue', icon: '▤', metric: 'revenue' },
    { key: 'payments', label: 'Payments', icon: '₹', metric: 'paymentAttempts' },
    { key: 'returns', label: 'Returns', icon: '↺', metric: 'returnRequests' },
    { key: 'health', label: 'Site health', icon: '♡', metric: 'frontendErrors' }
  ];
  range = '7d';
  customStart = '';
  customEnd = '';
  loading = true;
  error = '';
  refreshedAt?: Date;
  productSort = 'revenue';
  productDirection: 'asc' | 'desc' = 'desc';

  overview?: AnalyticsOverview;
  revenue?: RevenueReport;
  funnel?: FunnelReport;
  products?: ProductAnalyticsReport;
  carts?: CartAnalyticsReport;
  payments?: PaymentAnalyticsReport;
  visitors?: VisitorAnalyticsReport;
  trend?: TrendReport;
  logins?: LoginAnalyticsReport;
  returns?: ReturnAnalyticsReport;
  errors?: ErrorAnalyticsReport;
  selectedMetric = 'visitors';
  activeKpi: KpiDefinition = { key: 'visitors', label: 'Unique visitors' };
  modalTitle = 'Net realized revenue';
  modalDescription = '';
  modalValue = '₹0';
  modalChange = 'No prior baseline';
  drilldown?: AnalyticsDrilldown;
  drilldownLoading = false;
  drilldownError = '';
  metricModalOpen = false;

  readonly kpiGroups: KpiGroup[] = [
    { section: 'traffic', title: 'Traffic & engagement', description: 'Understand how shoppers find and explore your store. Admin sessions are excluded.', items: [
      { key: 'visitors', label: 'Unique visitors' }, { key: 'newVisitors', label: 'New visitors' },
      { key: 'returningVisitors', label: 'Returning visitors' }, { key: 'loggedInVisitors', label: 'Logged-in visitors' },
      { key: 'anonymousVisitors', label: 'Guest visitors' }, { key: 'sessions', label: 'Sessions' },
      { key: 'pageViews', label: 'Page views' }, { key: 'averageSessionSeconds', label: 'Active time / session', format: 'duration' },
      { key: 'totalActiveSeconds', label: 'Total active time', format: 'duration' },
      { key: 'averagePageViewsPerSession', label: 'Pages / session', format: 'decimal' }
    ]},
    { section: 'customers', title: 'Customers', description: 'Successful authentication events—not visits or page views.', items: [
      { key: 'uniqueUsersLoggedIn', label: 'Unique users logged in' }, { key: 'loginEvents', label: 'Successful logins' },
      { key: 'repeatLoginUsers', label: 'Repeat-login users' }, { key: 'signups', label: 'New signups' }
    ]},
    { section: 'products', title: 'Products & shopping intent', description: 'Follow product discovery, cart activity and the journey to checkout.', items: [
      { key: 'productViews', label: 'Product views' }, { key: 'uniqueProductViewers', label: 'Unique product viewers' },
      { key: 'productsViewed', label: 'Products viewed' }, { key: 'addToCarts', label: 'Added to cart' },
      { key: 'addToCartVisitors', label: 'Add-to-cart visitors' },
      { key: 'removeFromCarts', label: 'Removed from cart' }, { key: 'cartAbandonmentRate', label: 'Cart abandonment', format: 'percent' },
      { key: 'checkoutStarted', label: 'Checkout starters' }, { key: 'checkoutAbandonmentRate', label: 'Checkout abandonment', format: 'percent' }
    ]},
    { section: 'orders', title: 'Orders & realized revenue', description: 'Track purchases and revenue. Money values come from the immutable financial ledger.', items: [
      { key: 'ordersPlaced', label: 'Orders placed' }, { key: 'successfulOrders', label: 'Successful payments' },
      { key: 'uniquePurchasers', label: 'Unique purchasers' },
      { key: 'grossOrderValue', label: 'Gross order value', format: 'currency' },
      { key: 'grossRevenue', label: 'Successful credits', format: 'currency' },
      { key: 'refunds', label: 'Completed refunds', format: 'currency' }, { key: 'pendingRefunds', label: 'Pending refunds', format: 'currency' },
      { key: 'revenue', label: 'Net realized revenue', format: 'currency' }, { key: 'averageOrderValue', label: 'Average order value', format: 'currency' },
      { key: 'conversionRate', label: 'Visitor conversion', format: 'percent' }
    ]},
    { section: 'payments', title: 'Payments', description: 'Understand successful payments, failures and attempts that need attention.', items: [
      { key: 'paymentAttempts', label: 'Payment attempts' }, { key: 'paymentSuccesses', label: 'Payment successes' },
      { key: 'paymentFailures', label: 'Payment failures' }, { key: 'paymentSuccessRate', label: 'Payment success rate', format: 'percent' },
      { key: 'paymentFailureRate', label: 'Payment failure rate', format: 'percent' }
    ]},
    { section: 'returns', title: 'Returns & refunds', description: 'Follow return requests, completed returns and refund activity.', items: [
      { key: 'returnRequests', label: 'Return requests' }, { key: 'completedReturns', label: 'Completed returns' },
      { key: 'returnRate', label: 'Return rate', format: 'percent' },
      { key: 'refundsInitiated', label: 'Refunds initiated' }, { key: 'refundsCompleted', label: 'Refunds completed' }
    ]},
    { section: 'health', title: 'Site health', description: 'Spot frontend errors and understand how many shopping sessions are affected.', items: [
      { key: 'frontendErrors', label: 'Frontend errors' }, { key: 'affectedErrorSessions', label: 'Affected sessions' },
      { key: 'errorRate', label: 'Error rate', format: 'percent' }
    ]}
  ];
  readonly primaryKpis = this.kpiGroups.flatMap(group => group.items);
  readonly math = Math;

  constructor(private analytics: AdminAnalyticsService) {}
  ngOnInit(): void { this.refresh(); }
  ngOnDestroy(): void { this.dashboardRequest?.unsubscribe(); this.drilldownRequest?.unsubscribe(); }

  get activeGroup(): KpiGroup { return this.kpiGroups.find(group => group.section === this.activeSection)!; }
  selectSection(key: DashboardSection): void {
    const section = this.sections.find(item => item.key === key);
    if (!section || key === this.activeSection) return;
    this.activeSection = key;
    this.setChartMetric(section.metric);
  }
  setChartMetric(key: string): void {
    const selected = this.primaryKpis.find(item => item.key === key);
    if (!selected) return;
    this.closeMetricModal();
    this.selectedMetric = key;
    this.activeKpi = selected;
  }

  refresh(): void {
    if (this.range === 'custom' && (!this.customStart || !this.customEnd || this.customStart > this.customEnd)) {
      this.error = 'Choose a valid custom start and end date.';
      return;
    }
    this.dashboardRequest?.unsubscribe();
    this.loading = true;
    this.error = '';
    const filter = this.filter();
    this.dashboardRequest = this.analytics.dashboard(filter, this.productSort, this.productDirection)
      .pipe(finalize(() => (this.loading = false))).subscribe({
      next: data => {
        Object.assign(this, data);
        this.refreshedAt = new Date();
      },
      error: error => {
        this.error = error?.error?.message || 'Analytics could not be loaded. Please try again.';
      }
    });
  }

  changeRange(): void { if (this.range !== 'custom') this.refresh(); }
  sortProducts(key: string): void {
    if (this.productSort === key) this.productDirection = this.productDirection === 'desc' ? 'asc' : 'desc';
    else { this.productSort = key; this.productDirection = 'desc'; }
    this.analytics.products(this.filter(), this.productSort, this.productDirection).subscribe({
      next: report => (this.products = report),
      error: () => (this.error = 'Product analytics could not be refreshed.')
    });
  }

  metric(key: string): MetricValue { return this.overview?.metrics[key] || { value: 0, previous: 0, changePercent: null }; }
  value(definition: KpiDefinition): string {
    const value = Number(this.metric(definition.key).value || 0);
    if (definition.format === 'currency') return this.currency(value);
    if (definition.format === 'percent') return `${value.toFixed(1)}%`;
    if (definition.format === 'duration') return value < 60 ? `${Math.round(value)}s` : `${Math.floor(value / 60)}m ${Math.round(value % 60)}s`;
    if (definition.format === 'decimal') return value.toFixed(2);
    return new Intl.NumberFormat('en-IN').format(value);
  }
  currency(value: number): string { return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(Number(value || 0)); }
  shortDate(value: string): string {
    const raw = String(value || '');
    const parsed = new Date(/^\d{4}-\d{2}-\d{2}$/.test(raw) ? `${raw}T00:00:00` : raw);
    return Number.isNaN(parsed.getTime()) ? raw.slice(0, 10) : new Intl.DateTimeFormat('en-IN', { day: '2-digit', month: 'short' }).format(parsed);
  }
  changeLabel(metric: MetricValue): string {
    if (metric.changePercent == null) return 'No prior baseline';
    if (metric.changePercent === 0) return 'No change';
    return `${metric.changePercent > 0 ? '+' : ''}${metric.changePercent}% vs prior period`;
  }
  selectMetric(key: string): void {
    const selected = this.primaryKpis.find(item => item.key === key);
    if (!selected) return;
    this.setChartMetric(key);
    this.modalTitle = selected.label;
    this.modalDescription = this.definition(key);
    this.modalValue = this.value(selected);
    this.modalChange = this.changeLabel(this.metric(key));
    this.drilldown = undefined; this.drilldownError = ''; this.metricModalOpen = true;
    const latest = [...(this.trend?.points || [])].reverse().find(point => Number(point[key] || 0) > 0);
    if (latest) this.openDrilldown(latest);
  }
  closeMetricModal(): void {
    this.drilldownRequest?.unsubscribe();
    this.metricModalOpen = false; this.drilldown = undefined; this.drilldownError = ''; this.drilldownLoading = false;
  }
  @HostListener('document:keydown.escape') onEscape(): void { if (this.metricModalOpen) this.closeMetricModal(); }
  definition(key: string): string { return this.overview?.definitions?.[key] || ''; }
  get selectedDefinition(): KpiDefinition {
    return this.activeKpi;
  }
  trendValue(point: TrendPoint): number { return Number(point[this.selectedMetric] || 0); }
  get trendMax(): number { return Math.max(1, ...(this.trend?.points || []).map(point => this.trendValue(point))); }
  get hasTrendData(): boolean { return (this.trend?.points || []).some(point => this.trendValue(point) > 0); }
  trendHeight(point: TrendPoint): number { return this.trendValue(point) * 100 / this.trendMax; }
  trendLabel(point: TrendPoint): string {
    const value = this.trendValue(point); const definition = this.selectedDefinition;
    if (definition.format === 'currency') return this.currency(value);
    if (definition.format === 'percent') return `${value.toFixed(1)}%`;
    if (definition.format === 'duration') return `${Math.round(value)}s`;
    return new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2 }).format(value);
  }
  openDrilldown(point: TrendPoint): void {
    this.drilldownRequest?.unsubscribe();
    this.modalTitle = this.selectedDefinition.label;
    this.modalDescription = this.definition(this.selectedMetric);
    this.modalValue = this.value(this.selectedDefinition);
    this.modalChange = this.changeLabel(this.metric(this.selectedMetric));
    const date = String(point['date']).slice(0, 10);
    this.metricModalOpen = true;
    this.drilldownLoading = true; this.drilldownError = ''; this.drilldown = undefined;
    this.drilldownRequest = this.analytics.drilldown(this.selectedMetric,date).pipe(finalize(() => (this.drilldownLoading=false))).subscribe({
      next: value => (this.drilldown=value),
      error: error => (this.drilldownError=error?.error?.message || 'Metric details could not be loaded.')
    });
  }
  cell(row: Record<string, unknown>,key: string): string {
    const value=row[key]; if(value===null || value===undefined || value==='') return '—';
    if(key.includes('amount')) return this.currency(Number(value));
    if(/(_at|seen|event)$/.test(key)) return new Intl.DateTimeFormat('en-IN',{dateStyle:'medium',timeStyle:'short'}).format(new Date(String(value)));
    if(key==='active_seconds') { const seconds=Number(value); return seconds<60?`${seconds}s`:`${Math.floor(seconds/60)}m ${seconds%60}s`; }
    return String(value);
  }

  get revenuePoints(): string {
    const points = this.revenue?.points || [];
    const max = Math.max(1, ...points.map(point => point.revenue));
    return points.map((point, index) => `${this.chartX(index, points.length)},${230 - (point.revenue / max) * 190}`).join(' ');
  }
  get revenueArea(): string {
    const line = this.revenuePoints;
    const count = this.revenue?.points.length || 0;
    return line ? `M ${line.replaceAll(' ', ' L ')} L ${this.chartX(count - 1, count)},230 L 20,230 Z` : '';
  }
  get maxRevenue(): number { return Math.max(0, ...(this.revenue?.points || []).map(point => point.revenue)); }
  get maxDailyVisitors(): number { return Math.max(1, ...(this.revenue?.points || []).map(point => point.visitors)); }
  get maxDailyAdds(): number { return Math.max(1, ...(this.revenue?.points || []).map(point => point.addToCarts)); }
  get maxHourlyVisitors(): number { return Math.max(1, ...(this.visitors?.hourly || []).map(point => point.visitors)); }
  get behaviorSegments(): Array<{ label: string; count: number }> {
    const stages = this.funnel?.stages.map(stage => stage.count) || [];
    if (!stages.length) return [];
    return [
      { label: 'Visited only', count: Math.max(0, stages[0] - stages[1]) },
      { label: 'Viewed, no cart', count: Math.max(0, stages[1] - stages[2]) },
      { label: 'Cart, no checkout', count: Math.max(0, stages[2] - stages[3]) },
      { label: 'Checkout, no payment', count: Math.max(0, stages[3] - stages[4]) },
      { label: 'Payment, no purchase', count: Math.max(0, stages[4] - stages[5]) },
      { label: 'Purchased', count: stages[6] || stages[5] || 0 }
    ];
  }
  get highlights(): Array<{ label: string; product?: ProductAnalytics; value: string }> {
    const products = this.products?.products || [];
    const best = (key: keyof ProductAnalytics) => [...products].sort((a, b) => Number(b[key]) - Number(a[key]))[0];
    return [
      { label: 'Most viewed', product: best('views'), value: `${best('views')?.views || 0} views` },
      { label: 'Most added', product: best('addToCarts'), value: `${best('addToCarts')?.addToCarts || 0} adds` },
      { label: 'Best seller', product: best('unitsSold'), value: `${best('unitsSold')?.unitsSold || 0} units` },
      { label: 'Highest revenue', product: best('revenue'), value: this.currency(best('revenue')?.revenue || 0) }
    ];
  }
  funnelWidth(count: number): number {
    const first = this.funnel?.stages[0]?.count || 0;
    return first ? Math.max(count ? 8 : 2, count * 100 / first) : 2;
  }

  private chartX(index: number, count: number): number { return count <= 1 ? 20 : 20 + index * 860 / (count - 1); }
  private filter(): AnalyticsFilter {
    return { range: this.range, ...(this.range === 'custom' ? { start: this.customStart, end: this.customEnd } : {}) };
  }
}
