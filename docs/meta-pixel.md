# Meta Pixel events

Pixel ID: `2904268629955209`. This is browser Pixel tracking, using the existing
base loader in `public/meta-pixel.js`. No Conversions API credentials are required.

## Standard events

| Event | Trigger | Data |
| --- | --- | --- |
| PageView | Initial load and subsequent history navigation, handled by Meta's base library | Meta's normal page context |
| ViewContent | Product details successfully load | Product IDs, name, category, displayed price, INR |
| Search | A nonempty catalog search successfully returns | Search term and result count; email/phone/URL-like terms are omitted |
| AddToCart | Guest cart save or authenticated API addition succeeds; also quantity increases | Added quantity, product IDs, unit price, added value, INR |
| InitiateCheckout | Signed-in customer opens checkout | Cart contents, checkout estimate, INR; once per checkout token |
| AddPaymentInfo | Razorpay reports a successful payment interaction, before backend verification | Product IDs, server-created payment amount, INR, payment method; no payment credentials |
| Purchase | Backend verifies a paid order matching the server-created Razorpay order | Product contents, server amount converted from paise to rupees, INR, stable order-based event ID |
| CompleteRegistration | Successful authentication response explicitly says `isNewUser: true` for a customer | Authentication method and completion status |
| Contact | Successful contact form submission or a click on an email, telephone, or WhatsApp link | Channel only |
| Lead | Successful newsletter subscription | Newsletter label |

Product IDs are application product IDs, consistently used for views, cart actions,
and purchases. Any future Meta product catalog should use the same IDs.

## Custom events

- `UIInteraction`: button/link/selection actions throughout customer pages,
  including navigation, menus, product options, image controls, quick add, reviews,
  checkout controls, and account dialogs. Payloads contain a fixed page group,
  element type, and static `data-meta-action` name. No visible text, raw link URLs,
  input values, customer IDs, or order/return IDs are read from these controls.
- `ViewCart`, `RemoveFromCart`, `CategorySelected`, `SortChanged`.
- `CheckoutAddressSelected`, `PaymentStarted`, `PaymentCancelled`, `PaymentFailed`.
- `OrderPlaced` for accepted COD orders. COD acceptance is not reported as a paid
  Purchase. Cash on delivery is currently controlled by the existing feature flag.
- `Login`, `Logout`, `OTPRequested`, `EmailOTPRequested`, `EmailVerified`, `AccountLinked`.
- `NewsletterSubscribe`, `NewsletterUnsubscribe`, `ProfileUpdated`.
- `AddressAdded`, `AddressUpdated`, `AddressDeleted`, `DefaultAddressSelected`.
- `OrderCancelled`, `ReturnRequested`, `ReturnCancelled`, `RefundDestinationUpdated`,
  `DefectPhotosSubmitted`, `ReviewSubmitted`, `ReviewUpdated`, `ReviewHelpful`.

Mutation success events are observed by `metaPixelInterceptor`. Failed API requests
do not count as successful actions. Raw request bodies, API response data, review
text, contact messages, addresses, credentials and refund destinations are never
forwarded. Login handling reads only the role and new-user flag.

## Reliability and boundaries

- The existing base library already tracks Angular history changes. The Angular
  service does not add another PageView listener.
- A Purchase uses the cart snapshot taken before opening Razorpay, and the
  authoritative server-created payment amount. Refreshing orders/account pages,
  cancelling payment, and resetting the cart never generate a Purchase.
- Successful Purchase calls are remembered in memory and, when available, local
  storage (the most recent 1,000 order event IDs). A stable event ID is also sent.
- Explicit application events are scoped to this Pixel using `trackSingle` and
  `trackSingleCustom`.
- Additional customer action events are suppressed on `/admin` and `/dashboard`.
  This does not change the existing base library's automatic PageView behavior.
- A blocked/missing Pixel or unavailable browser storage never prevents shopping.
- Browser tracking cannot recover a purchase verified only by a server webhook
  after the customer closes the browser. Server-side delivery would require a
  separate Conversions API integration with secure backend credentials.

## Verification

Frontend tests mock the Pixel and payment APIs. Do not make real payments or
submit live customer data simply to test tracking.

After deployment, use Meta Events Manager **Test events** for normal customer
browsing. Check product views, catalog search, quick add, cart quantity changes,
and checkout. Confirm purchases only with an approved payment test setup. Include
the current day in the Overview date range. Standard and custom events appear
only after their applicable actions occur.
