import { CommonModule } from '@angular/common';
import { Component, Input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Product } from '../../models/product.model';
import { CartService } from '../../services/cart.service';

@Component({
  selector: 'app-product-card',
  standalone: true,
  imports: [CommonModule, RouterLink],
  templateUrl: './product-card.component.html',
  styleUrl: './product-card.component.css'
})
export class ProductCardComponent {
  @Input({ required: true }) product!: Product;
  added = false;

  constructor(private cart: CartService) {}

  quickAdd(event: Event): void {
    event.preventDefault();
    event.stopPropagation();
    this.cart.add(
      this.product,
      1,
      this.product.sizes[0] ?? null,
      this.product.colors[0] ?? null
    );
    this.added = true;
    setTimeout(() => (this.added = false), 1400);
  }
}
