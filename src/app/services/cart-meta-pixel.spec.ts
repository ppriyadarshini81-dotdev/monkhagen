import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { BehaviorSubject } from 'rxjs';
import { AuthService } from './auth.service';
import { CartService } from './cart.service';
import { MetaPixelService } from './meta-pixel.service';
import { AnalyticsService } from './analytics.service';
import { CartItem } from '../models/cart.model';
import { Product } from '../models/product.model';

describe('Meta cart action integration', () => {
  let cart: CartService;
  let backend: HttpTestingController;
  let meta: jasmine.SpyObj<MetaPixelService>;
  let auth: { isLoggedIn: boolean; token: string | null; user$: BehaviorSubject<null> };
  const item = { id: 'item-1', productId: 'product-1', variantId: 'variant-1', quantity: 1, price: 1990, stock: 10 } as CartItem;
  const product: Product = { id: 'product-1', name: 'Shirt', slug: 'shirt', price: 1990, basePrice: 1990,
    category: 'Tshirts', categoryId: 'category-1', categorySlug: 'tshirts', description: '', sizes: ['M'],
    colors: ['Blue'], sizeIds: [], colorIds: [], images: [], rating: 0, stock: 10, featured: false, isActive: true,
    variants: [{ id: 'variant-1', size: 'M', color: 'Blue', sizeId: null, colorId: null, sku: null,
      isActive: true, stock: 10, price: 1990 }] };
  beforeEach(() => {
    localStorage.removeItem('mh_guest_cart_v1');
    meta = jasmine.createSpyObj('MetaPixelService', ['cartChange']);
    auth = { isLoggedIn: true, token: null, user$: new BehaviorSubject(null) };
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting(),
      { provide: AuthService, useValue: auth }, { provide: MetaPixelService, useValue: meta },
      { provide: AnalyticsService, useValue: { track: () => {} } }
    ] });
    cart = TestBed.inject(CartService);
    backend = TestBed.inject(HttpTestingController);
  });
  afterEach(() => { backend.verify(); localStorage.removeItem('mh_guest_cart_v1'); });

  it('does not count loaded carts or rejected additions; counts successful additions once', () => {
    cart.load().subscribe(); backend.expectOne('/api/cart').flush({ items: [item] });
    expect(meta.cartChange).not.toHaveBeenCalled();
    cart.add(product, 1, 'M', 'Blue').subscribe({ error: () => {} });
    backend.expectOne('/api/cart/items').flush({}, { status: 409, statusText: 'Out of stock' });
    expect(meta.cartChange).not.toHaveBeenCalled();
    cart.add(product, 1, 'M', 'Blue').subscribe();
    backend.expectOne('/api/cart/items').flush({ items: [{ ...item, quantity: 2 }] });
    expect(meta.cartChange).toHaveBeenCalledOnceWith(jasmine.objectContaining({ productId: 'product-1' }), 1, true);
  });

  it('tracks only the quantity delta, and never counts checkout reset as removal', () => {
    cart.load().subscribe(); backend.expectOne('/api/cart').flush({ items: [item] });
    cart.updateQuantity(item.id, 3).subscribe();
    backend.expectOne('/api/cart/items/item-1').flush({ items: [{ ...item, quantity: 3 }] });
    expect(meta.cartChange).toHaveBeenCalledOnceWith(jasmine.objectContaining({ quantity: 3 }), 2, true);
    meta.cartChange.calls.reset();
    cart.reset();
    expect(meta.cartChange).not.toHaveBeenCalled();
  });

  it('covers guest additions and removals without backend writes', () => {
    auth.isLoggedIn = false;
    cart.add(product, 2, 'M', 'Blue').subscribe();
    expect(meta.cartChange).toHaveBeenCalledOnceWith({ productId: 'product-1', price: 1990 }, 2, true);
    meta.cartChange.calls.reset();
    cart.remove(cart.items[0].id).subscribe();
    expect(meta.cartChange).toHaveBeenCalledOnceWith(jasmine.objectContaining({ productId: 'product-1' }), 2, false);
  });
});
