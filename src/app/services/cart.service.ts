import { HttpClient } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable, tap, throwError } from 'rxjs';
import { Cart, CartItem, PrepaidOffer } from '../models/cart.model';
import { Product } from '../models/product.model';
import { AuthService } from './auth.service';

const EMPTY_OFFER: PrepaidOffer = {
  code: 'MonkHagen10', discountPercent: 10, eligible: false, discountAmount: 0, totalAmount: 0
};
const EMPTY_CART: Cart = { cartId: '', items: [], total: 0, prepaidOffer: EMPTY_OFFER };

@Injectable({ providedIn: 'root' })
export class CartService {
  private readonly api = '/api/cart';
  private readonly itemsSubject = new BehaviorSubject<CartItem[]>([]);
  private readonly loadingSubject = new BehaviorSubject(false);
  private currentPrepaidOffer: PrepaidOffer = EMPTY_OFFER;

  readonly items$ = this.itemsSubject.asObservable();
  readonly loading$ = this.loadingSubject.asObservable();

  constructor(
    private http: HttpClient,
    private auth: AuthService
  ) {
    // Remove the legacy device-wide cart; authenticated carts now live in PostgreSQL.
    localStorage.removeItem('mh_cart');
    this.auth.user$.subscribe((user) => {
      if (user && this.auth.token) {
        this.load().subscribe({ error: () => this.reset() });
      } else {
        this.reset();
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

  load(): Observable<Cart> {
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
    if (!this.auth.isLoggedIn) {
      return throwError(() => new Error('Please sign in to add items to your cart.'));
    }
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

    return this.http.post<Cart>(`${this.api}/items`, {
      productId: product.id,
      variantId: variant.id,
      quantity: Math.max(1, Math.trunc(quantity))
    }).pipe(tap((cart) => this.apply(cart)));
  }

  updateQuantity(itemId: string, quantity: number): Observable<Cart> {
    return this.http.put<Cart>(`${this.api}/items/${itemId}`, {
      quantity: Math.max(1, Math.trunc(quantity))
    }).pipe(tap((cart) => this.apply(cart)));
  }

  remove(itemId: string): Observable<Cart> {
    return this.http.delete<Cart>(`${this.api}/items/${itemId}`).pipe(
      tap((cart) => this.apply(cart))
    );
  }

  clear(): Observable<{ message: string }> {
    return this.http.delete<{ message: string }>(this.api).pipe(
      tap(() => this.reset())
    );
  }

  reset(): void {
    this.apply(EMPTY_CART);
    this.loadingSubject.next(false);
  }

  private apply(cart: Cart): void {
    this.itemsSubject.next(cart.items || []);
    this.currentPrepaidOffer = cart.prepaidOffer || EMPTY_OFFER;
  }
}
