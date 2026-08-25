import { CommonModule } from '@angular/common';
import { Component } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { CartService } from '../../services/cart.service';
import { AuthService } from '../../services/auth.service';
import { OrderService } from '../../services/order.service';

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
    private auth: AuthService,
    private orders: OrderService,
    private router: Router
  ) {}

  get isLoggedIn(): boolean {
    return this.auth.isLoggedIn;
  }

  get shippingFee(): number {
    return this.cart.total >= 2999 || this.cart.total === 0 ? 0 : 99;
  }

  get grandTotal(): number {
    return this.cart.total + this.shippingFee;
  }

  checkout(): void {
    this.error = '';
    if (!this.isLoggedIn) {
      this.router.navigate(['/login'], {
        queryParams: { redirect: '/cart' }
      });
      return;
    }
    if (!this.shipping.name || !this.shipping.address || !this.shipping.phone) {
      this.error = 'Please fill in name, address and phone.';
      return;
    }
    this.placing = true;
    this.orders.checkout(this.cart.items, this.shipping).subscribe({
      next: (order) => {
        this.orderId = (order as any).orderNumber ?? order.id;
        this.cart.clear();
        this.placing = false;
      },
      error: (err) => {
        this.error = err?.error?.message || 'Could not place order.';
        this.placing = false;
      }
    });
  }
}
