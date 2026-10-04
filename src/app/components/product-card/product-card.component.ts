import { CommonModule } from '@angular/common';
import { AfterViewInit, Component, ElementRef, Input, OnChanges, OnDestroy, Optional } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Product } from '../../models/product.model';
import { CartService } from '../../services/cart.service';
import { ProductService } from '../../services/product.service';
import { cachedMediaUrl } from '../../utils/media-url';
import { sortSizes } from '../../utils/size-order';
import { ProductScrollRestorationService } from '../../services/product-scroll-restoration.service';

@Component({
  selector: 'app-product-card',
  standalone: true,
  imports: [CommonModule, RouterLink],
  templateUrl: './product-card.component.html',
  styleUrl: './product-card.component.css'
})
export class ProductCardComponent implements AfterViewInit, OnChanges, OnDestroy {
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
  private autoCycling = false;
  private loadedImages = new Set<number>();
  private imageTimer?: ReturnType<typeof setInterval>;
  private visibilityObserver?: IntersectionObserver;
  private touchStartX: number | null = null;
  private touchStartY: number | null = null;
  private suppressNavigation = false;
  private navigationResetTimer?: ReturnType<typeof setTimeout>;

  constructor(
    private cart: CartService,
    private productService: ProductService,
    @Optional() private productScroll?: ProductScrollRestorationService,
    @Optional() private host?: ElementRef<HTMLElement>
  ) {}

  ngAfterViewInit(): void {
    if (!this.cycleImages || this.product.images.length < 2 ||
        typeof window.matchMedia !== 'function' || !window.matchMedia('(max-width: 1023px)').matches) return;
    if (!this.host?.nativeElement || typeof IntersectionObserver === 'undefined') {
      this.updateViewportPreview(true);
      return;
    }
    this.visibilityObserver = new IntersectionObserver(entries => {
      this.updateViewportPreview(entries.some(entry => entry.isIntersecting && entry.intersectionRatio >= 0.35));
    }, { threshold: [0.35] });
    this.visibilityObserver.observe(this.host.nativeElement);
  }

  rememberPosition(event: MouseEvent): void {
    if (this.suppressNavigation) {
      event.preventDefault();
      event.stopPropagation();
      this.suppressNavigation = false;
      if (this.navigationResetTimer) clearTimeout(this.navigationResetTimer);
      this.navigationResetTimer = undefined;
      return;
    }
    if (event.defaultPrevented) return;
    this.productScroll?.remember(this.product.id, event.currentTarget as HTMLElement);
  }

  ngOnChanges(): void {
    this.stopImageTimer();
    this.hovered = false;
    this.autoCycling = false;
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
    if (!this.cycleImages || this.product.images.length < 2 || !this.isHoverCapable()) return;
    this.hovered = true;
    this.imagesActivated = true;
    this.startImagePreview();
  }

  onMouseLeave(): void {
    this.hovered = false;
    if (this.autoCycling) return;
    this.stopImageTimer();
    this.imageAnimating = false;
    this.currentImageIndex = 0;
    if (!this.adding) this.showSizePicker = false;
  }

  onImageLoaded(index: number): void {
    this.loadedImages.add(index);
    if (index === 1) this.startImagePreview();
  }

  updateViewportPreview(visible: boolean): void {
    this.autoCycling = visible;
    if (visible) {
      this.imagesActivated = true;
      this.startImagePreview();
      return;
    }
    if (this.hovered) return;
    this.stopImageTimer();
    this.imageAnimating = false;
    this.currentImageIndex = 0;
  }

  onImageTransitionEnd(event: TransitionEvent): void {
    if (event.propertyName !== 'transform' || this.currentImageIndex !== this.product.images.length) return;
    this.imageAnimating = false;
    this.currentImageIndex = 0;
  }

  onImageTouchStart(event: TouchEvent): void {
    if (!this.cycleImages || this.product.images.length < 2 || event.touches.length !== 1) return;
    this.imagesActivated = true;
    this.touchStartX = event.touches[0].clientX;
    this.touchStartY = event.touches[0].clientY;
  }

  onImageTouchEnd(event: TouchEvent): void {
    if (this.touchStartX === null || this.touchStartY === null || event.changedTouches.length !== 1) return;
    const deltaX = event.changedTouches[0].clientX - this.touchStartX;
    const deltaY = event.changedTouches[0].clientY - this.touchStartY;
    this.touchStartX = null;
    this.touchStartY = null;
    if (Math.abs(deltaX) < 36 || Math.abs(deltaX) <= Math.abs(deltaY)) return;

    event.preventDefault();
    event.stopPropagation();
    this.suppressNavigation = true;
    if (this.navigationResetTimer) clearTimeout(this.navigationResetTimer);
    this.navigationResetTimer = setTimeout(() => {
      this.suppressNavigation = false;
      this.navigationResetTimer = undefined;
    }, 400);
    this.imageAnimating = true;
    if (deltaX < 0) {
      this.currentImageIndex = this.currentImageIndex >= this.product.images.length - 1
        ? this.product.images.length
        : this.currentImageIndex + 1;
    } else {
      this.currentImageIndex = this.currentImageIndex <= 0
        ? this.product.images.length - 1
        : this.currentImageIndex - 1;
    }
  }

  get visibleImageIndex(): number {
    return this.currentImageIndex === this.product.images.length ? 0 : this.currentImageIndex;
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
    if ((!this.hovered && !this.autoCycling) || this.imageTimer || !this.loadedImages.has(1)) return;
    // Keep the primary photo visible until the first alternate is loaded.
    this.imageAnimating = true;
    this.currentImageIndex = 1;
    this.imageTimer = setInterval(() => {
      const next = (this.currentImageIndex + 1) % this.imageSlides.length;
      if (!this.loadedImages.has(next)) return;
      this.imageAnimating = true;
      this.currentImageIndex = next;
    }, this.autoCycling ? 2000 : 1200);
  }

  private isHoverCapable(): boolean {
    return typeof window.matchMedia !== 'function' || window.matchMedia('(hover: hover) and (pointer: fine)').matches;
  }

  private stopImageTimer(): void {
    if (!this.imageTimer) return;
    clearInterval(this.imageTimer);
    this.imageTimer = undefined;
  }

  ngOnDestroy(): void {
    this.stopImageTimer();
    this.visibilityObserver?.disconnect();
    if (this.navigationResetTimer) clearTimeout(this.navigationResetTimer);
    this.hovered = false;
  }

  quickAdd(event: Event): void {
    event.preventDefault();
    event.stopPropagation();

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
        this.cart.openPreview();
        setTimeout(() => (this.added = false), 1400);
      },
      error: (err) => {
        this.adding = false;
        this.addError = err?.error?.message || err?.message || 'Could not add this item.';
      }
    });
  }
}
