import { CommonModule } from '@angular/common';
import { Component, Input, OnDestroy, OnInit } from '@angular/core';
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
export class ProductCardComponent implements OnInit, OnDestroy {
  @Input({ required: true }) product!: Product;
  @Input() cycleImages = false;
  added = false;
  currentImageIndex = 0;
  private imageTimer?: ReturnType<typeof setInterval>;

  constructor(private cart: CartService) {}

  get currentImage(): string {
    return this.product.images[this.currentImageIndex] || this.product.images[0] || '';
  }

  ngOnInit(): void {
    this.startImageTimer(2000);
  }

  onMouseEnter(): void {
    this.startImageTimer(3000);
  }

  onMouseLeave(): void {
    this.startImageTimer(2000);
  }

  private startImageTimer(delay: number): void {
    if (this.imageTimer) clearInterval(this.imageTimer);
    if (!this.cycleImages || this.product.images.length < 2) return;
    this.imageTimer = setInterval(() => {
      this.currentImageIndex = (this.currentImageIndex + 1) % this.product.images.length;
    }, delay);
  }

  ngOnDestroy(): void {
    if (this.imageTimer) clearInterval(this.imageTimer);
  }

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
