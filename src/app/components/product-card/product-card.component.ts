import { CommonModule } from '@angular/common';
import { Component, Input, OnChanges, OnDestroy } from '@angular/core';
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
export class ProductCardComponent implements OnChanges, OnDestroy {
  @Input({ required: true }) product!: Product;
  @Input() cycleImages = false;
  added = false;
  adding = false;
  loadingSizes = false;
  showSizePicker = false;
  addError = '';
  quickProduct?: Product;
  currentImageIndex = 0;
  imageSlides: string[] = [];
  imagesActivated = false;
  imageAnimating = false;
  private hovered = false;
  private loadedImages = new Set<number>();
  private imageTimer?: ReturnType<typeof setInterval>;

  constructor(
    private cart: CartService,
    private auth: AuthService,
    private productService: ProductService,
    private router: Router
  ) {}

  ngOnChanges(): void {
    this.stopImageTimer();
    this.hovered = false;
    this.imagesActivated = false;
    this.imageAnimating = false;
    this.currentImageIndex = 0;
    this.loadedImages.clear();
    this.imageSlides = this.product.images.map(cachedMediaUrl);
    if (this.cycleImages && this.imageSlides.length > 1) {
      this.imageSlides = [...this.imageSlides, this.imageSlides[0]];
    }
  }

  onMouseEnter(): void {
    if (!this.cycleImages || this.product.images.length < 2) return;
    this.hovered = true;
    this.imagesActivated = true;
    this.startImagePreview();
  }

  onMouseLeave(): void {
    this.stopImageTimer();
    this.hovered = false;
    this.imageAnimating = false;
    this.currentImageIndex = 0;
    if (!this.adding) this.showSizePicker = false;
  }

  onImageLoaded(index: number): void {
    this.loadedImages.add(index);
    if (index === 1) this.startImagePreview();
  }

  onImageTransitionEnd(event: TransitionEvent): void {
    if (event.propertyName !== 'transform' || this.currentImageIndex !== this.product.images.length) return;
    this.imageAnimating = false;
    this.currentImageIndex = 0;
  }

  get availableSizes(): string[] {
    if (!this.quickProduct) return [];
    return this.quickProduct.sizes.filter((size) =>
      this.quickProduct!.variants?.some(
        (variant) => variant.isActive && variant.stock > 0 && variant.size === size
      )
    );
  }

  private startImagePreview(): void {
    if (!this.hovered || this.imageTimer || !this.loadedImages.has(1)) return;
    // Keep the primary photo visible until the first alternate is loaded.
    this.imageAnimating = true;
    this.currentImageIndex = 1;
    this.imageTimer = setInterval(() => {
      const next = (this.currentImageIndex + 1) % this.imageSlides.length;
      if (!this.loadedImages.has(next)) return;
      this.imageAnimating = true;
      this.currentImageIndex = next;
    }, 2000);
  }

  private stopImageTimer(): void {
    if (!this.imageTimer) return;
    clearInterval(this.imageTimer);
    this.imageTimer = undefined;
  }

  ngOnDestroy(): void {
    this.stopImageTimer();
    this.hovered = false;
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
