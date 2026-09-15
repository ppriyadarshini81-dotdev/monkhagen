import { CommonModule } from '@angular/common';
import { Component, Input, OnDestroy, OnInit } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { Product } from '../../models/product.model';
import { CartService } from '../../services/cart.service';
import { AuthService } from '../../services/auth.service';
import { ProductService } from '../../services/product.service';
import { cachedMediaUrl } from '../../utils/media-url';
import { sortSizes } from '../../utils/size-order';

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
  adding = false;
  loadingSizes = false;
  showSizePicker = false;
  addError = '';
  quickProduct?: Product;
  currentImageIndex = 0;
  private imageTimer?: ReturnType<typeof setInterval>;

  constructor(
    private cart: CartService,
    private auth: AuthService,
    private productService: ProductService,
    private router: Router
  ) {}

  get currentImage(): string {
    const image = this.product.images[this.currentImageIndex] || this.product.images[0] || '';
    return cachedMediaUrl(image);
  }

  ngOnInit(): void {
    this.startImageTimer(2000);
  }

  onMouseEnter(): void {
    this.startImageTimer(3000);
  }

  onMouseLeave(): void {
    this.startImageTimer(2000);
    if (!this.adding) this.showSizePicker = false;
  }

  get availableSizes(): string[] {
    if (!this.quickProduct) return [];
    return this.quickProduct.sizes.filter((size) =>
      this.quickProduct!.variants?.some(
        (variant) => variant.isActive && variant.stock > 0 && variant.size === size
      )
    );
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

    if (!this.auth.isLoggedIn) {
      this.router.navigate(['/login'], {
        queryParams: { redirect: this.router.url }
      });
      return;
    }

    this.addError = '';
    if (this.quickProduct) {
      this.showSizePicker = true;
      return;
    }

    this.loadingSizes = true;
    this.productService.getProduct(this.product.id).subscribe({
      next: (product) => {
        this.quickProduct = { ...product, sizes: sortSizes(product.sizes) };
        this.loadingSizes = false;
        this.showSizePicker = true;
        if (this.availableSizes.length === 0) {
          this.addError = 'No sizes are currently available.';
        }
      },
      error: () => {
        this.loadingSizes = false;
        this.showSizePicker = true;
        this.addError = 'Could not load available sizes.';
      }
    });
  }

  selectSize(event: Event, size: string): void {
    event.preventDefault();
    event.stopPropagation();
    if (!this.quickProduct || this.adding) return;

    this.adding = true;
    this.addError = '';
    this.cart.add(this.quickProduct, 1, size).subscribe({
      next: () => {
        this.adding = false;
        this.showSizePicker = false;
        this.added = true;
        setTimeout(() => (this.added = false), 1400);
      },
      error: (err) => {
        this.adding = false;
        this.addError = err?.error?.message || err?.message || 'Could not add this item.';
      }
    });
  }
}
