# Monk Hagen analytics

The admin dashboard combines anonymous first-party behaviour events with authoritative commerce records. It is available only to authenticated admin users at `/dashboard`; the API is under `/api/admin/analytics/*` and uses the existing `authenticate` and `requireAdmin` middleware.

## Time and identity rules

- All dashboard date boundaries and labels use `Asia/Kolkata`.
- A visitor is an opaque UUID stored in browser local storage. It is not an email, phone number, IP address or advertising identifier.
- A session is an opaque UUID and rotates after 30 minutes of inactivity.
- When a guest signs in, the current session is linked to the customer account without replacing its anonymous visitor ID. This preserves the journey without exposing identity in drilldowns.
- Admin and super-admin sessions are marked internal and excluded from traffic, engagement, product, funnel and browser-error reports.
- Engagement is accumulated foreground activity reported in 30-second heartbeats. Idle/background time and raw tab-open duration are not counted.
- Browser errors are sanitized and length-limited. Stack traces, form values, query strings and credentials are not stored.

## KPI definitions

| KPI | Definition / source |
| --- | --- |
| Unique visitors | Distinct non-internal `analytics_sessions.visitor_id` values in the period. |
| New visitors | Visitors whose earliest recorded session is in the period. |
| Returning visitors | Visitors with at least one recorded session before the period. |
| Logged-in visitors | Distinct visitor IDs linked to a customer account in the period. |
| Guest visitors | Distinct visitor IDs never linked to an account in the period. |
| Sessions | Non-internal sessions started in the period; inactivity expiry is 30 minutes. |
| Page views | `PAGE_VIEW` activity for non-internal sessions. |
| Active time / session | Average accumulated `active_seconds`, not elapsed session duration. |
| Pages / session | Page views divided by sessions. |
| Product views | `PRODUCT_VIEWED` events. Product unique viewers use visitor IDs, not session IDs. |
| Added / removed from cart | Authenticated actions are recorded by the server; guest actions are browser events with bounded quantity/value metadata. |
| Cart abandonment | A non-empty cart inactive for at least 24 hours and not purchased. Guest cart journeys are included where browser tracking exists. |
| Checkout starters | Distinct tracked visitors reaching `CHECKOUT_STARTED`. |
| Checkout abandonment | Checkout starters without a successful order divided by checkout starters. |
| Payment attempts / successes / failures | `payment_attempts`, written by the payment workflow. |
| Payment failure rate | Failed attempts divided by all attempts. |
| Successful orders | Paid, refunded or partially refunded orders created in the period. |
| Orders placed | Confirmed COD orders plus successfully paid online orders, excluding cancelled orders. |
| Successful credits | Successful credit transactions in `financial_transactions`. |
| Completed refunds | Successful debit transactions in `financial_transactions`. |
| Pending refunds | Pending debit transactions in `financial_transactions`. |
| Net realized revenue | Successful credits minus completed refunds. |
| Average order value | Net realized revenue divided by successful orders. |
| Visitor conversion | Successful orders divided by distinct visitors. |
| Return requests | `return_requests` created in the period. |
| Completed returns | Return requests at the explicit `refunded` lifecycle state. |
| Return rate | Return requests divided by qualifying successful orders in the same selected period. |
| Frontend errors | Sanitized `FRONTEND_ERROR` events for non-internal sessions. |

Additional visible KPI derivations:

| KPI | Database tables | Formula / query logic |
| --- | --- | --- |
| Total active time | `analytics_sessions` | Sum `active_seconds`. |
| Unique users logged in | `analytics_events` | Distinct `user_id` for `LOGIN`, excluding internal sessions. |
| Successful logins | `analytics_events` | Count deduplicated `LOGIN` events. |
| Repeat-login users | `analytics_events` | Users with more than one `LOGIN` in the period. |
| New signups | `analytics_events` | Count server-recorded `SIGNUP` events. |
| Unique product viewers | `analytics_events`, `analytics_sessions` | Distinct visitor IDs having a product view. |
| Products viewed | `analytics_events` | Distinct non-null product IDs viewed. |
| Add-to-cart visitors | `analytics_events`, `analytics_sessions` | Distinct visitor IDs with an add event. |
| Unique purchasers | `orders` | Distinct user IDs on qualifying successful orders. |
| Gross order value | `orders` | Sum qualifying order totals before refunds. |
| Payment success rate | `payment_attempts` | Successful attempts / all attempts. |
| Refunds initiated | `return_requests` | Refund status is `processing` or `refunded`; an operational count only. |
| Refunds completed | `return_requests` | Refund status is `refunded`; monetary value still comes from the ledger. |
| Affected sessions | `analytics_events` | Distinct sessions having at least one sanitized frontend error. |
| Error rate | `analytics_events`, `analytics_sessions` | Affected sessions / non-internal sessions. |

Every card compares the selected period with the immediately preceding period of equal length. “No prior baseline” means the prior value was zero, so a percentage change would be misleading.

## Data ownership

- Browser: page/product/cart-view/checkout navigation, anonymous cart actions, foreground active time, sanitized frontend errors.
- Server: authenticated cart changes, login/signup/logout, payment lifecycle, orders, returns and refunds.
- Financial ledger: the only source for dashboard money-in, refund and net realized revenue totals.

Client events are deduplicated by UUID. Server events use deterministic dedupe keys where a business reference exists. The API rejects browser claims for authenticated cart actions or authoritative payment/order outcomes.

## Migration and operation

Apply pending local migrations with:

```powershell
npm.cmd run db:migrate
```

Migration `016_analytics_dashboard.sql` is additive. It adds active-time, exit-path, heartbeat, internal-traffic and event-metadata fields plus reporting indexes, and backfills known admin sessions as internal.

No new environment variables or third-party analytics services are required. The dashboard depends on PostgreSQL, the existing auth middleware and the existing order/payment/return/financial-ledger records.

## Validation and troubleshooting

1. Open the site in a customer or anonymous browser, visit products, add an item, and wait at least one heartbeat interval.
2. Open `/dashboard` as an admin, select Today, then Refresh.
3. Click a KPI card to change the daily trend chart.
4. Confirm admin browsing does not increase customer traffic cards.
5. Compare revenue/refund totals with `/ledger` using the same IST dates.

If the dashboard cannot load, confirm migration 016 is applied, inspect the API response for `/api/admin/analytics/overview`, and verify the signed-in account has the admin role. Empty results are valid when the selected period predates `trackingStartedAt`; analytics are not backfilled from page logs.

## Retention and scale recommendations

Current indexes support the present dataset and bounded 366-day queries. Continue the existing analytics-event retention job. Before sustained high volume, add daily rollup tables for visitor/funnel/product metrics and archive raw events after the agreed retention window. Keep financial transactions and return records under their separate accounting retention policy.
