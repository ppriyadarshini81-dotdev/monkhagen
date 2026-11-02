import { DOCUMENT } from '@angular/common';
import { Inject, Injectable, NgZone, OnDestroy } from '@angular/core';
import type { CartItem } from '../models/cart.model';
import type { Product } from '../models/product.model';
import type { PaymentOrder, VerifiedPayment } from './payment.service';

type Parameters = Record<string, unknown>;
type Pixel = (...args: unknown[]) => void;
declare global { interface Window { fbq?: Pixel; } }

const PIXEL_ID = '2904268629955209';
const PURCHASES_KEY = 'mh_meta_purchases_v1';

@Injectable({ providedIn: 'root' })
export class MetaPixelService implements OnDestroy {
  private readonly sent = new Set<string>();

  constructor(@Inject(DOCUMENT) private document: Document, zone: NgZone) {
    // PageView is handled by Meta's base code and History API integration.
    // Do not also emit it on NavigationEnd: that would duplicate route views.
    zone.runOutsideAngular(() => {
      document.addEventListener('click', this.interaction, true);
      document.addEventListener('change', this.interaction, true);
    });
  }

  viewProduct(product: Product): void {
    this.standard('ViewContent', {
      content_ids: [product.id], content_type: 'product', content_name: product.name,
      content_category: product.category, currency: 'INR', value: product.price
    });
  }

  search(term: string, count: number): void {
    const text = term.trim().slice(0, 100);
    if (!text) return;
    // Search terms can accidentally contain contact details. Omit those terms.
    const safe = !/@|https?:|\d{7,}/i.test(text);
    this.standard('Search', { ...(safe ? { search_string: text } : {}), result_count: count });
  }

  cartChange(item: Pick<CartItem, 'productId' | 'price'>, quantity: number, added: boolean): void {
    const value = (item.price || 0) * quantity;
    if (!Number.isSafeInteger(quantity) || quantity <= 0 || !Number.isFinite(value) || value < 0) return;
    const data = { content_ids: [item.productId], content_type: 'product',
      contents: [{ id: item.productId, quantity, item_price: item.price || 0 }],
      num_items: quantity, currency: 'INR', value };
    if (added) this.standard('AddToCart', data);
    else this.custom('RemoveFromCart', data);
  }

  initiateCheckout(items: readonly CartItem[], value: number, token: string): void {
    if (!items.length || this.sent.has(`checkout:${token}`)) return;
    if (this.standard('InitiateCheckout', { ...this.contents(items), currency: 'INR', value })) {
      this.sent.add(`checkout:${token}`);
    }
  }

  paymentStarted(order: PaymentOrder, items: readonly CartItem[]): void {
    this.custom('PaymentStarted', { ...this.contents(items), currency: order.currency, value: order.amount / 100 });
  }

  paymentInfoAdded(order: PaymentOrder, items: readonly CartItem[]): void {
    this.standard('AddPaymentInfo', { ...this.contents(items), currency: order.currency,
      value: order.amount / 100, payment_method: 'razorpay' });
  }

  purchase(order: PaymentOrder, verified: VerifiedPayment, items: readonly CartItem[]): void {
    if (verified.paymentStatus !== 'paid' || verified.localOrderId !== order.localOrderId ||
        order.currency !== 'INR' || !Number.isSafeInteger(order.amount) || order.amount <= 0) return;
    const eventId = `purchase:${verified.localOrderId}`;
    const remembered = this.readPurchases();
    if (this.sent.has(eventId) || remembered.includes(eventId)) return;
    // The amount is the server-created Razorpay amount in paise, not a cart estimate.
    if (!this.standard('Purchase', { ...this.contents(items), currency: order.currency,
      value: order.amount / 100 }, eventId)) return;
    this.sent.add(eventId);
    try {
      this.document.defaultView?.localStorage.setItem(PURCHASES_KEY,
        JSON.stringify([...remembered, eventId].slice(-1000)));
    } catch { /* Storage restrictions must never interrupt checkout. */ }
  }

  standard(name: 'ViewContent' | 'Search' | 'AddToCart' | 'InitiateCheckout' | 'AddPaymentInfo' |
    'Purchase' | 'Contact' | 'Lead' | 'CompleteRegistration', data: Parameters = {}, eventId?: string): boolean {
    return this.emit('trackSingle', name, data, eventId);
  }

  custom(name: string, data: Parameters = {}): boolean {
    return this.emit('trackSingleCustom', name, data);
  }

  private emit(command: string, name: string, data: Parameters, eventId?: string): boolean {
    const view = this.document.defaultView;
    if (!view?.fbq || this.internalPage()) return false;
    try {
      const args: unknown[] = [command, PIXEL_ID, name, data];
      if (eventId) args.push({ eventID: eventId });
      view.fbq(...args);
      return true;
    } catch { return false; } // Ad blockers and provider errors cannot break shopping.
  }

  private contents(items: readonly CartItem[]): Parameters {
    return { content_ids: [...new Set(items.map(item => item.productId))], content_type: 'product',
      contents: items.map(item => ({ id: item.productId, quantity: item.quantity, item_price: item.price || 0 })),
      num_items: items.reduce((sum, item) => sum + item.quantity, 0) };
  }

  private readPurchases(): string[] {
    try {
      const data: unknown = JSON.parse(this.document.defaultView?.localStorage.getItem(PURCHASES_KEY) || '[]');
      return Array.isArray(data) ? data.filter((value): value is string =>
        typeof value === 'string' && /^purchase:[a-zA-Z0-9-]{1,80}$/.test(value)).slice(-1000) : [];
    } catch { return []; }
  }

  private internalPage(): boolean {
    return /^\/(?:admin(?:\/|$)|dashboard(?:\/|$))/.test(this.document.location?.pathname || '');
  }

  private page(path = this.document.location?.pathname || '/'): string {
    if (path.startsWith('/product/')) return 'product';
    const known = ['products', 'cart', 'login', 'about', 'contact', 'contact/email', 'refund-policy',
      'newsletter/unsubscribe', 'account', 'account/profile', 'account/addresses', 'account/orders',
      'account/returns', 'account/credits'];
    const value = path.replace(/^\/|\/$/g, '');
    return value === '' ? 'home' : known.includes(value) ? value : 'other';
  }

  private readonly interaction = (event: Event): void => {
    const target = event.target as Element | null;
    const element = target?.closest?.('button,a,select,summary,[role="button"],input[type="radio"],input[type="checkbox"]');
    if (!element || element.hasAttribute('disabled') || element.getAttribute('aria-disabled') === 'true') return;
    if ((element.matches('select,input') && event.type !== 'change') ||
        (!element.matches('select,input') && event.type !== 'click')) return;
    const action = element.getAttribute('data-meta-action');
    const data: Parameters = { page: this.page(), control: element.tagName.toLowerCase(),
      action: action && /^[a-zA-Z][a-zA-Z0-9]{0,63}$/.test(action) ? action : 'activate' };
    // Use fixed route groups and action names, never visible text, URLs, or input values.
    if (element.tagName === 'A') {
      if (action === 'closeMenu' || action === 'dismissProfileHint') data['action'] = 'navigate';
      const href = element.getAttribute('href') || '';
      if (/^(mailto:|tel:|https:\/\/(?:wa\.me|api\.whatsapp\.com)\/)/i.test(href)) {
        this.standard('Contact', { contact_channel: href.startsWith('mailto:') ? 'email' :
          href.startsWith('tel:') ? 'phone' : 'whatsapp' });
      } else {
        try {
          const url = new URL(href, this.document.baseURI);
          data['destination'] = url.origin === this.document.location.origin ? this.page(url.pathname) : 'external';
        } catch { /* No raw URL is collected. */ }
      }
    }
    this.custom('UIInteraction', data);
  };

  ngOnDestroy(): void {
    this.document.removeEventListener('click', this.interaction, true);
    this.document.removeEventListener('change', this.interaction, true);
  }
}
