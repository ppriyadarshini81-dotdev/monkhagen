import { HttpClient } from '@angular/common/http';
import { BehaviorSubject, firstValueFrom, of } from 'rxjs';
import { Cart } from '../models/cart.model';
import { Product } from '../models/product.model';
import { User } from '../models/user.model';
import { AuthService } from './auth.service';
import { CartService } from './cart.service';

class AuthStub {
  private readonly subject = new BehaviorSubject<User | null>(null);
  readonly user$ = this.subject.asObservable();
  token: string | null = null;

  get isLoggedIn(): boolean { return Boolean(this.token); }

  signIn(): void {
    this.token = 'test-token';
    this.subject.next({} as User);
  }
}

describe('CartService guest cart', () => {
  let http: jasmine.SpyObj<HttpClient>;
  let auth: AuthStub;
  let cart: CartService;
  const product = {
    id: 'product-1',
    name: 'Guest Tee',
    slug: 'guest-tee',
    price: 1499,
    images: ['https://media.example/tee.webp'],
    sizes: ['M'],
    variants: [{
      id: 'variant-1', size: 'M', color: 'Black', sizeId: null, colorId: null,
      sku: 'TEE-M', price: null, stock: 5, isActive: true
    }]
  } as Product;

  beforeEach(() => {
    localStorage.clear();
    http = jasmine.createSpyObj<HttpClient>('HttpClient', ['get', 'post', 'put', 'delete']);
    auth = new AuthStub();
    cart = new CartService(http, auth as unknown as AuthService);
  });

  afterEach(() => localStorage.clear());

  it('adds, updates and removes items locally without requiring authentication', async () => {
    const added = await firstValueFrom(cart.add(product, 2, 'M', 'Black'));
    expect(added.items[0].quantity).toBe(2);
    expect(cart.count).toBe(2);
    expect(http.post).not.toHaveBeenCalled();
    expect(localStorage.getItem('mh_guest_cart_v1')).not.toBeNull();

    const updated = await firstValueFrom(cart.updateQuantity(added.items[0].id, 3));
    expect(updated.items[0].quantity).toBe(3);
    await firstValueFrom(cart.remove(added.items[0].id));
    expect(cart.count).toBe(0);
  });

  it('merges guest variants into the authenticated server cart and then removes local data', async () => {
    const guest = await firstValueFrom(cart.add(product, 2, 'M', 'Black'));
    const emptyServerCart: Cart = {
      cartId: 'server-cart', items: [], total: 0,
      prepaidOffer: { code: 'MONKHAGEN10', discountPercent: 10, eligible: true, discountAmount: 0, totalAmount: 0 }
    };
    const mergedServerCart: Cart = {
      ...emptyServerCart,
      items: [{ ...guest.items[0], id: 'server-item', cartId: 'server-cart' }],
      total: 2998
    };
    http.get.and.returnValue(of(emptyServerCart));
    http.post.and.returnValue(of(mergedServerCart));

    auth.signIn();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(http.post).toHaveBeenCalledWith('/api/cart/items', {
      productId: 'product-1', variantId: 'variant-1', quantity: 2
    });
    expect(cart.items[0].id).toBe('server-item');
    expect(localStorage.getItem('mh_guest_cart_v1')).toBeNull();
  });
});
