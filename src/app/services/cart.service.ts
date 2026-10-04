import { HttpClient } from '@angular/common/http';
import { Injectable, Optional } from '@angular/core';
import { BehaviorSubject, firstValueFrom, Observable, of, tap, throwError } from 'rxjs';
import { Cart, CartItem, PrepaidOffer } from '../models/cart.model';
import { Product } from '../models/product.model';
import { AuthService } from './auth.service';
import { AnalyticsService } from './analytics.service';

const EMPTY_OFFER: PrepaidOffer = {
  code: 'MONKHAGEN10', discountPercent: 10, eligible: false, eligibilityVerified: false,
  discountAmount: 0, totalAmount: 0
};
const EMPTY_CART: Cart = { cartId: '', items: [], total: 0, prepaidOffer: EMPTY_OFFER };
const GUEST_CART_KEY = 'mh_guest_cart_v1';

@Injectable({ providedIn: 'root' })
export class CartService {
  private readonly api = '/api/cart';
  private readonly itemsSubject = new BehaviorSubject<CartItem[]>([]);
  private readonly loadingSubject = new BehaviorSubject(false);
  private readonly previewOpenSubject = new BehaviorSubject(false);
  private currentPrepaidOffer: PrepaidOffer = EMPTY_OFFER;

  readonly items$ = this.itemsSubject.asObservable();
  readonly loading$ = this.loadingSubject.asObservable();
  readonly previewOpen$ = this.previewOpenSubject.asObservable();

  constructor(
    private http: HttpClient,
    private auth: AuthService,
    @Optional() private analytics?: AnalyticsService
  ) {
    // Remove the obsolete cart shape. Guest carts use a versioned, variant-based shape.
    localStorage.removeItem('mh_cart');
    this.auth.user$.subscribe((user) => {
      if (user && this.auth.token) {
        void this.activateAuthenticatedCart();
      } else {
        this.apply(this.guestCart());
      }
    });
  }

  get items(): CartItem[] {
    return this.itemsSubject.value;
  }

  get loading(): boolean {
    return this.loadingSubject.value;
  }

  get count(): number {
    return this.items.reduce((sum, item) => sum + item.quantity, 0);
  }

  get total(): number {
    return this.items.reduce(
      (sum, item) => sum + (item.price ?? 0) * item.quantity,
      0
    );
  }

  get prepaidOffer(): PrepaidOffer {
    return this.currentPrepaidOffer;
  }

  openPreview(): void {
    this.previewOpenSubject.next(true);
  }

  closePreview(): void {
    this.previewOpenSubject.next(false);
  }

  load(): Observable<Cart> {
    if (!this.auth.isLoggedIn) {
      const cart = this.guestCart();
      this.apply(cart);
      return of(cart);
    }
    this.loadingSubject.next(true);
    return this.http.get<Cart>(this.api).pipe(
      tap({
        next: (cart) => {
          this.apply(cart);
          this.loadingSubject.next(false);
        },
        error: () => this.loadingSubject.next(false)
      })
    );
  }

  add(
    product: Product,
    quantity = 1,
    size: string | null = null,
    color: string | null = null
  ): Observable<Cart> {
    if (product.sizes.length > 0 && !size) {
      return throwError(() => new Error('Please select a size.'));
    }

    const variants = (product.variants || []).filter(
      (variant) => variant.isActive && variant.stock > 0 && variant.size === size
    );
    const variant = color
      ? variants.find((item) => item.color === color)
      : variants[0];

    if (!variant) {
      return throwError(() => new Error('The selected size is currently unavailable.'));
    }

    const safeQuantity = Math.max(1, Math.trunc(quantity));
    if (!this.auth.isLoggedIn) {
      const items = [...this.readGuestItems()];
      const index = items.findIndex((item) => item.variantId === variant.id);
      const nextQuantity = (index >= 0 ? items[index].quantity : 0) + safeQuantity;
      if (nextQuantity > variant.stock) {
        return throwError(() => new Error(`Only ${variant.stock} item(s) are available.`));
      }
      if (index >= 0) {
        items[index] = { ...items[index], quantity: nextQuantity, stock: variant.stock };
      } else {
        items.push({
          id: `guest:${variant.id}`,
          cartId: 'guest',
          productId: product.id,
          variantId: variant.id,
          quantity: safeQuantity,
          productName: product.name,
          productSlug: product.slug,
          size: variant.size || size,
          color: variant.color || color,
          sku: variant.sku,
          price: variant.price ?? product.price,
          imageUrl: product.images[0] || null,
          stock: variant.stock
        });
      }
      const cart = this.persistGuestItems(items);
      this.analytics?.track('ADD_TO_CART', location.pathname, product.id, {
        quantity: safeQuantity, estimatedValue: (variant.price ?? product.price) * safeQuantity
      });
      return of(cart);
    }

    return this.http.post<Cart>(`${this.api}/items`, {
      productId: product.id,
      variantId: variant.id,
      quantity: safeQuantity
    }).pipe(tap((cart) => this.apply(cart)));
  }

  updateQuantity(itemId: string, quantity: number): Observable<Cart> {
    if (!this.auth.isLoggedIn) {
      const items = [...this.readGuestItems()];
      const index = items.findIndex((item) => item.id === itemId);
      if (index < 0) return throwError(() => new Error('Cart item not found.'));
      const safeQuantity = Math.max(1, Math.trunc(quantity));
      if (items[index].stock !== null && safeQuantity > items[index].stock!) {
        return throwError(() => new Error(`Only ${items[index].stock} item(s) are available.`));
      }
      const previousQuantity = items[index].quantity;
      items[index] = { ...items[index], quantity: safeQuantity };
      const difference = safeQuantity - previousQuantity;
      if (difference !== 0) this.analytics?.track(difference > 0 ? 'ADD_TO_CART' : 'REMOVE_FROM_CART',
        location.pathname, items[index].productId, {
          quantity: Math.abs(difference), estimatedValue: (items[index].price || 0) * Math.abs(difference)
        });
      return of(this.persistGuestItems(items));
    }
    return this.http.put<Cart>(`${this.api}/items/${itemId}`, {
      quantity: Math.max(1, Math.trunc(quantity))
    }).pipe(tap((cart) => this.apply(cart)));
  }

  remove(itemId: string): Observable<Cart> {
    if (!this.auth.isLoggedIn) {
      const items = this.readGuestItems();
      const removed = items.find(item => item.id === itemId);
      const cart = this.persistGuestItems(items.filter((item) => item.id !== itemId));
      if (removed) this.analytics?.track('REMOVE_FROM_CART', location.pathname, removed.productId, {
        quantity: removed.quantity, estimatedValue: (removed.price || 0) * removed.quantity
      });
      return of(cart);
    }
    return this.http.delete<Cart>(`${this.api}/items/${itemId}`).pipe(
      tap((cart) => this.apply(cart))
    );
  }

  clear(): Observable<{ message: string }> {
    if (!this.auth.isLoggedIn) {
      for (const item of this.readGuestItems()) this.analytics?.track('REMOVE_FROM_CART', location.pathname, item.productId, {
        quantity: item.quantity, estimatedValue: (item.price || 0) * item.quantity
      });
      localStorage.removeItem(GUEST_CART_KEY);
      this.apply(EMPTY_CART);
      return of({ message: 'Cart cleared.' });
    }
    return this.http.delete<{ message: string }>(this.api).pipe(
      tap(() => this.reset())
    );
  }

  reset(): void {
    localStorage.removeItem(GUEST_CART_KEY);
    this.apply(EMPTY_CART);
    this.closePreview();
    this.loadingSubject.next(false);
  }

  private apply(cart: Cart): void {
    this.itemsSubject.next(cart.items || []);
    this.currentPrepaidOffer = cart.prepaidOffer || EMPTY_OFFER;
  }

  private guestCart(): Cart {
    const items = this.readGuestItems();
    const total = items.reduce((sum, item) => sum + (item.price || 0) * item.quantity, 0);
    const discountAmount = Math.round(total * EMPTY_OFFER.discountPercent) / 100;
    return {
      cartId: 'guest',
      items,
      total,
      prepaidOffer: {
        ...EMPTY_OFFER,
        eligible: true,
        eligibilityVerified: false,
        discountAmount,
        totalAmount: total - discountAmount
      }
    };
  }

  private readGuestItems(): CartItem[] {
    try {
      const parsed = JSON.parse(localStorage.getItem(GUEST_CART_KEY) || '[]');
      if (!Array.isArray(parsed)) return [];
      return parsed.filter((item): item is CartItem =>
        item && typeof item.id === 'string' && typeof item.productId === 'string' &&
        typeof item.variantId === 'string' && Number.isSafeInteger(item.quantity) &&
        item.quantity > 0 && item.quantity <= 100 &&
        (item.price === null || (Number.isFinite(item.price) && item.price >= 0))
      );
    } catch {
      localStorage.removeItem(GUEST_CART_KEY);
      return [];
    }
  }

  private persistGuestItems(items: CartItem[]): Cart {
    localStorage.setItem(GUEST_CART_KEY, JSON.stringify(items));
    const cart = this.guestCart();
    this.apply(cart);
    return cart;
  }

  private async activateAuthenticatedCart(): Promise<void> {
    this.loadingSubject.next(true);
    let serverCart: Cart | null = null;
    try {
      serverCart = await firstValueFrom(this.http.get<Cart>(this.api));
      for (const guestItem of this.readGuestItems()) {
        const existing: CartItem | undefined = serverCart.items.find(
          (item: CartItem) => item.variantId === guestItem.variantId
        );
        if (existing && guestItem.quantity > existing.quantity) {
          serverCart = await firstValueFrom(this.http.put<Cart>(`${this.api}/items/${existing.id}`, {
            quantity: guestItem.quantity
          }));
        } else if (!existing) {
          serverCart = await firstValueFrom(this.http.post<Cart>(`${this.api}/items`, {
            productId: guestItem.productId,
            variantId: guestItem.variantId,
            quantity: guestItem.quantity
          }));
        }
      }
      localStorage.removeItem(GUEST_CART_KEY);
      this.apply(serverCart);
    } catch {
      if (serverCart) this.apply(serverCart);
    } finally {
      this.loadingSubject.next(false);
    }
  }
}
