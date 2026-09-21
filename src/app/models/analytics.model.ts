export interface AnalyticsPeriod {
  range: string; label: string; timezone: string; startDate: string; endDate: string;
}
export interface MetricValue { value: number; previous: number; changePercent: number | null; }
export interface AnalyticsOverview { period: AnalyticsPeriod; metrics: Record<string, MetricValue>; }
export interface RevenuePoint { date: string; orders: number; revenue: number; visitors: number; addToCarts: number; }
export interface RevenueReport { period: AnalyticsPeriod; points: RevenuePoint[]; }
export interface FunnelStage { label: string; count: number; conversionFromPrevious: number; dropOffFromPrevious: number; }
export interface FunnelReport { period: AnalyticsPeriod; stages: FunnelStage[]; }
export interface ProductAnalytics {
  id: string; name: string; views: number; uniqueViewers: number; addToCarts: number;
  addToCartRate: number; checkouts: number; unitsSold: number; orders: number;
  revenue: number; conversionRate: number;
}
export interface ProductAnalyticsReport { period: AnalyticsPeriod; products: ProductAnalytics[]; }
export interface CartAnalytics {
  id: string; customerReference: string; products: string; quantity: number; value: number;
  status: string; lastActivity: string; ageHours: number; checkoutStarted: boolean;
  purchased: boolean; abandoned: boolean;
}
export interface CartAnalyticsReport {
  period: AnalyticsPeriod;
  summary: { total: number; active: number; abandoned: number; recovered: number; estimatedAbandonedValue: number };
  carts: CartAnalytics[];
}
export interface PaymentIssue {
  orderReference: string; customerReference: string; amount: number; status: string;
  failureCategory: string; attemptedAt: string;
}
export interface PaymentAnalyticsReport {
  period: AnalyticsPeriod;
  summary: { attempts: number; successful: number; failed: number; pending: number; successRate: number; failureRate: number };
  issues: PaymentIssue[];
}
export interface VisitorAnalyticsReport {
  period: AnalyticsPeriod;
  summary: { visitors: number; newVisitors: number; returningVisitors: number; newUsers: number;
    customersPurchased: number; customersNeverPurchased: number; repeatCustomers: number };
  hourly: Array<{ hour: number; sessions: number; visitors: number }>;
}
