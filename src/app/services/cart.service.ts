import { Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';
import { CartItem } from '../models/cart.model';
import { Product } from '../models/product.model';

const CART_KEY = 'mh_cart';

@Injectable({ providedIn: 'root' })
export class CartService {
  private itemsSubject = new BehaviorSubject<CartItem[]>(this.read());
  items$ = this.itemsSubject.asObservable();

  private read(): CartItem[] {
    const raw = localStorage.getItem(CART_KEY);
    return raw ? (JSON.parse(raw) as CartItem[]) : [];
  }

  private save(items: CartItem[]): void {
    localStorage.setItem(CART_KEY, JSON.stringify(items));
    this.itemsSubject.next(items);
  }

  get items(): CartItem[] {
    return this.itemsSubject.value;
  }

  get count(): number {
    return this.items.reduce((sum, i) => sum + i.quantity, 0);
  }

  get total(): number {
    return this.items.reduce((sum, i) => sum + (i.price ?? 0) * i.quantity, 0);
  }

  add(
    product: Product,
    quantity = 1,
    size: string | null = null,
    color: string | null = null
  ): void {
    const items = [...this.items];
    const existing = items.find(
      (i) => i.productId === product.id && i.size === size && i.color === color
    );
    const variant = product.variants?.find((v) => v.size === size && v.color === color);
    if (existing) {
      existing.quantity += quantity;
    } else {
      items.push({
        id: `local-${Date.now()}`,
        cartId: 'local',
        productId: product.id,
        variantId: variant?.id ?? '',
        quantity,
        productName: product.name,
        productSlug: product.slug,
        size,
        color,
        sku: variant?.sku ?? null,
        price: variant?.price ?? product.price,
        imageUrl: product.images[0] ?? null,
        stock: variant?.stock ?? null
      });
    }
    this.save(items);
  }

  updateQuantity(index: number, quantity: number): void {
    const items = [...this.items];
    if (items[index]) {
      items[index].quantity = Math.max(1, quantity);
      this.save(items);
    }
  }

  remove(index: number): void {
    const items = this.items.filter((_, i) => i !== index);
    this.save(items);
  }

  clear(): void {
    this.save([]);
  }
}

