import { CommonModule } from '@angular/common';
import { Component, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { forkJoin, finalize } from 'rxjs';
import {
  AnalyticsOverview, CartAnalyticsReport, FunnelReport, MetricValue,
  PaymentAnalyticsReport, ProductAnalytics, ProductAnalyticsReport,
  RevenueReport, VisitorAnalyticsReport
} from '../../models/analytics.model';
import { AdminAnalyticsService, AnalyticsFilter } from '../../services/admin-analytics.service';

interface KpiDefinition { key: string; label: string; format?: 'currency' | 'percent' | 'duration'; }

@Component({
  selector: 'app-admin-analytics',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './admin-analytics.component.html',
  styleUrl: './admin-analytics.component.css'
})
export class AdminAnalyticsComponent implements OnInit {
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

  readonly primaryKpis: KpiDefinition[] = [
    { key: 'visitors', label: 'Visitors' },
    { key: 'revenue', label: 'Net revenue', format: 'currency' },
    { key: 'successfulOrders', label: 'Successful orders' },
    { key: 'conversionRate', label: 'Conversion', format: 'percent' },
    { key: 'averageOrderValue', label: 'Average order value', format: 'currency' }
  ];
  readonly secondaryKpis: KpiDefinition[] = [
    { key: 'uniqueVisitors', label: 'Unique visitors' },
    { key: 'loggedInVisitors', label: 'Logged-in visitors' },
    { key: 'anonymousVisitors', label: 'Anonymous visitors' },
    { key: 'sessions', label: 'Sessions' },
    { key: 'productViews', label: 'Product views' },
    { key: 'addToCarts', label: 'Add to carts' },
    { key: 'checkoutStarted', label: 'Checkout started' },
    { key: 'paymentAttempts', label: 'Payment attempts' },
    { key: 'cartAbandonmentRate', label: 'Cart abandonment', format: 'percent' },
    { key: 'checkoutAbandonmentRate', label: 'Checkout abandonment', format: 'percent' },
    { key: 'paymentFailureRate', label: 'Payment failure', format: 'percent' },
    { key: 'averageSessionSeconds', label: 'Average session', format: 'duration' }
  ];
  readonly math = Math;

  constructor(private analytics: AdminAnalyticsService) {}
  ngOnInit(): void { this.refresh(); }

  refresh(): void {
    if (this.range === 'custom' && (!this.customStart || !this.customEnd || this.customStart > this.customEnd)) {
      this.error = 'Choose a valid custom start and end date.';
      return;
    }
    this.loading = true;
    this.error = '';
    const filter = this.filter();
    forkJoin({
      overview: this.analytics.overview(filter), revenue: this.analytics.revenue(filter),
      funnel: this.analytics.funnel(filter),
      products: this.analytics.products(filter, this.productSort, this.productDirection),
      carts: this.analytics.carts(filter), payments: this.analytics.payments(filter),
      visitors: this.analytics.visitors(filter)
    }).pipe(finalize(() => (this.loading = false))).subscribe({
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
    const value = this.metric(definition.key).value;
    if (definition.format === 'currency') return this.currency(value);
    if (definition.format === 'percent') return `${value.toFixed(1)}%`;
    if (definition.format === 'duration') return value < 60 ? `${Math.round(value)}s` : `${Math.floor(value / 60)}m ${Math.round(value % 60)}s`;
    return new Intl.NumberFormat('en-IN').format(value);
  }
  currency(value: number): string { return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(value); }
  shortDate(value: string): string { return new Intl.DateTimeFormat('en-IN', { day: '2-digit', month: 'short' }).format(new Date(`${value}T00:00:00`)); }
  changeLabel(metric: MetricValue): string {
    if (metric.changePercent == null) return 'No prior baseline';
    if (metric.changePercent === 0) return 'No change';
    return `${metric.changePercent > 0 ? '+' : ''}${metric.changePercent}% vs prior period`;
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
