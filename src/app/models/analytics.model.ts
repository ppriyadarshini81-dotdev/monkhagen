export interface AnalyticsPeriod {
  range: string; label: string; timezone: string; startDate: string; endDate: string;
}
export interface MetricValue { value: number; previous: number; changePercent: number | null; }
export interface AnalyticsOverview { period: AnalyticsPeriod; metrics: Record<string, MetricValue>; definitions: Record<string, string>; trackingStartedAt: string | null; }
export interface RevenuePoint { date: string; orders: number; revenue: number; visitors: number; addToCarts: number; }
export interface RevenueReport { period: AnalyticsPeriod; points: RevenuePoint[]; }
export interface FunnelStage { label: string; count: number; conversionFromPrevious: number; dropOffFromPrevious: number; }
export interface FunnelReport { period: AnalyticsPeriod; stages: FunnelStage[]; guest: { visitors: number;
  productViewers: number; addToCartVisitors: number; checkoutVisitors: number; laterLoggedIn: number; purchased: number }; }
export interface ProductAnalytics {
  id: string; name: string; views: number; uniqueViewers: number; addToCarts: number;
  loggedInViewers: number; guestViewers: number;
  uniqueCartVisitors: number; addToCartRate: number; cartPurchaseRate: number; checkouts: number; unitsSold: number; orders: number;
  revenue: number; conversionRate: number;
}
export interface ProductAnalyticsReport { period: AnalyticsPeriod; products: ProductAnalytics[]; }
export interface CartAnalytics {
  id: string; customerReference: string; products: string; quantity: number; value: number;
  status: string; lastActivity: string; ageHours: number; checkoutStarted: boolean;
  paymentAttempted: boolean; lastPaymentStatus: string; purchased: boolean; abandoned: boolean;
}
export interface CartAnalyticsReport {
  period: AnalyticsPeriod;
  summary: { total: number; active: number; abandoned: number; recovered: number; estimatedAbandonedValue: number };
  carts: CartAnalytics[];
}
export interface PaymentIssue {
  orderReference: string; customerReference: string; amount: number; status: string;
  paymentMethod: string; providerReference: string; failureCategory: string; attemptedAt: string;
  retried: boolean; eventuallyPurchased: boolean;
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
export interface TrendPoint { date: string; [key: string]: string | number; }
export interface TrendReport { period: AnalyticsPeriod; points: TrendPoint[]; }
export interface AnalyticsDrilldown { metric: string; date: string; definition: string;
  columns: Array<{ key: string; label: string }>; rows: Array<Record<string, unknown>>; }
export interface LoginAnalyticsReport { period: AnalyticsPeriod; events: Array<{ occurredAt: string; type: string;
  customerReference: string; visitorReference: string; entryPath: string; exitPath?: string }>;
  users: Array<{ customerReference: string; loginCount: number; firstLogin: string; lastLogin: string }> }
export interface ReturnAnalyticsReport { period: AnalyticsPeriod; summary: { requested: number; received: number;
  completed: number; failedOrCancelled: number; refundedAmount: number }; returns: Array<{ id: string; returnNumber: string;
  orderNumber: string; customerReference: string; status: string; refundStatus: string; refundAmount: number;
  requestedAt: string; receivedAt?: string; refundedAt?: string }> }
export interface ErrorAnalyticsReport { period: AnalyticsPeriod; errors: Array<{ occurredAt: string; path: string;
  visitorReference: string; message: string; source: string }> }
