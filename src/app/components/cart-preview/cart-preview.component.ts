import { CommonModule } from '@angular/common';
import { Component, HostListener } from '@angular/core';
import { RouterLink } from '@angular/router';
import { finalize } from 'rxjs';
import { CartItem } from '../../models/cart.model';
import { CartService } from '../../services/cart.service';
import { cachedMediaUrl } from '../../utils/media-url';

@Component({
  selector: 'app-cart-preview',
  standalone: true,
  imports: [CommonModule, RouterLink],
  templateUrl: './cart-preview.component.html',
  styleUrl: './cart-preview.component.css'
})
export class CartPreviewComponent {
  readonly cachedMediaUrl = cachedMediaUrl;
  readonly open$ = this.cart.previewOpen$;
  updatingIds = new Set<string>();
  error = '';

  constructor(public cart: CartService) {}

  get prepaidTotal(): number {
    return this.cart.total - (this.cart.prepaidOffer.eligible ? this.cart.prepaidOffer.discountAmount : 0);
  }

  close(): void {
    this.error = '';
    this.cart.closePreview();
  }

  closeOnBackdrop(event: MouseEvent): void {
    if (event.target === event.currentTarget) this.close();
  }

  changeQuantity(item: CartItem, delta: number): void {
    const quantity = item.quantity + delta;
    if (quantity < 1 || this.updatingIds.has(item.id)) return;
    if (item.stock !== null && quantity > item.stock) return;
    this.runUpdate(item.id, this.cart.updateQuantity(item.id, quantity));
  }

  decreaseOrRemove(item: CartItem): void {
    if (item.quantity === 1) {
      this.remove(item);
      return;
    }
    this.changeQuantity(item, -1);
  }

  remove(item: CartItem): void {
    if (this.updatingIds.has(item.id)) return;
    this.runUpdate(item.id, this.cart.remove(item.id));
  }

  isUpdating(item: CartItem): boolean {
    return this.updatingIds.has(item.id);
  }

  @HostListener('document:keydown.escape')
  escape(): void {
    this.close();
  }

  private runUpdate(itemId: string, request: ReturnType<CartService['remove']>): void {
    this.error = '';
    this.updatingIds.add(itemId);
    request.pipe(finalize(() => this.updatingIds.delete(itemId))).subscribe({
      error: (err) => {
        this.error = err?.error?.message || 'Could not update your cart. Please try again.';
      }
    });
  }
}
