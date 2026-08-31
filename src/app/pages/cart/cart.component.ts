import { CommonModule } from '@angular/common';
import { Component } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { CartService } from '../../services/cart.service';
import { OrderService } from '../../services/order.service';
import { CartItem } from '../../models/cart.model';

@Component({
  selector: 'app-cart',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  templateUrl: './cart.component.html',
  styleUrl: './cart.component.css'
})
export class CartComponent {
  shipping = { name: '', address: '', city: '', state: '', zip: '', phone: '' };
  placing = false;
  error = '';
  orderId: string | null = null;

  constructor(
    public cart: CartService,
    private orders: OrderService
  ) {}

  get shippingFee(): number {
    return this.cart.total >= 2999 || this.cart.total === 0 ? 0 : 99;
  }

  get grandTotal(): number {
    return this.cart.total + this.shippingFee;
  }

  checkout(): void {
    this.error = '';
    if (!this.shipping.name || !this.shipping.address || !this.shipping.phone) {
      this.error = 'Please fill in name, address and phone.';
      return;
    }
    this.placing = true;
    this.orders.checkout(this.shipping).subscribe({
      next: (order) => {
        this.orderId = (order as any).orderNumber ?? order.id;
        this.cart.reset();
        this.placing = false;
      },
      error: (err) => {
        this.error = err?.error?.message || 'Could not place order.';
        this.placing = false;
      }
    });
  }

  updateQuantity(item: CartItem, quantity: number): void {
    this.error = '';
    this.cart.updateQuantity(item.id, quantity).subscribe({
      error: (err) => {
        this.error = err?.error?.message || 'Could not update the cart.';
      }
    });
  }

  remove(item: CartItem): void {
    this.error = '';
    this.cart.remove(item.id).subscribe({
      error: (err) => {
        this.error = err?.error?.message || 'Could not remove the item.';
      }
    });
  }
}
