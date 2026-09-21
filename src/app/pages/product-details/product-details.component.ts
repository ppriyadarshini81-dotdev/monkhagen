import { CommonModule } from '@angular/common';
import { Component, ElementRef, OnInit, ViewChild } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { Product } from '../../models/product.model';
import { ProductService } from '../../services/product.service';
import { CartService } from '../../services/cart.service';
import { AuthService } from '../../services/auth.service';
import { sortSizes } from '../../utils/size-order';
import { ProductPageContent } from '../../models/product-page-content.model';
import { ProductPageContentService } from '../../services/product-page-content.service';
import { AnalyticsService } from '../../services/analytics.service';
import { cachedMediaUrl } from '../../utils/media-url';

@Component({
  selector: 'app-product-details',
  standalone: true,
  imports: [CommonModule, RouterLink],
  templateUrl: './product-details.component.html',
  styleUrl: './product-details.component.css'
})
export class ProductDetailsComponent implements OnInit {
  readonly cachedMediaUrl = cachedMediaUrl;
  product?: Product;
  loading = true;
  notFound = false;

  activeImage = 0;
  selectedSize: string | null = null;
  selectedColor: string | null = null;
  quantity = 1;
  added = false;
  adding = false;
  addError = '';
  pageContent?: ProductPageContent;
  contentLoading = false;
  contentError = '';
  careItems: string[] = [];
  @ViewChild('sizeChartDialog') sizeChartDialog?: ElementRef<HTMLDialogElement>;
  @ViewChild('productImageDialog') productImageDialog?: ElementRef<HTMLDialogElement>;
  imageZoom = 1;
  private touchStartX: number | null = null;
  private touchCurrentX: number | null = null;
  private touchPointCount = 0;
  private suppressImageOpen = false;
  private wheelDistance = 0;
  private wheelGestureActive = false;
  private lastWheelEventAt = 0;

  openSizeChart(): void {
    if (this.pageContent?.sizeChartImageUrl) this.sizeChartDialog?.nativeElement.showModal();
  }

  closeSizeChart(): void {
    this.sizeChartDialog?.nativeElement.close();
  }

  closeOnBackdrop(event: MouseEvent): void {
    if (event.target === this.sizeChartDialog?.nativeElement) this.closeSizeChart();
  }

  openImageViewer(): void {
    if (this.suppressImageOpen) return;
    if (!this.product?.images.length) return;
    this.imageZoom = 1.2;
    this.productImageDialog?.nativeElement.showModal();
  }

  closeImageViewer(): void {
    this.imageZoom = 1;
    this.productImageDialog?.nativeElement.close();
  }

  closeImageOnBackdrop(event: MouseEvent): void {
    if (event.target === this.productImageDialog?.nativeElement) this.closeImageViewer();
  }

  setImageZoom(zoom: number): void {
    this.imageZoom = Math.min(3, Math.max(1, Number(zoom.toFixed(1))));
  }

  selectImage(index: number): void {
    this.activeImage = index;
    this.imageZoom = this.productImageDialog?.nativeElement.open ? 1.2 : 1;
  }

  imageViewerKeydown(event: KeyboardEvent): void {
    if (event.key === 'ArrowLeft') {
      event.preventDefault();
      this.changeImage(-1);
    } else if (event.key === 'ArrowRight') {
      event.preventDefault();
      this.changeImage(1);
    } else if (event.key === '+' || event.key === '=') {
      event.preventDefault();
      this.setImageZoom(this.imageZoom + 0.5);
    } else if (event.key === '-') {
      event.preventDefault();
      this.setImageZoom(this.imageZoom - 0.5);
    }
  }

  imageTouchStart(event: TouchEvent): void {
    const points = Array.from(event.touches);
    if (!points.length || points.length > 2) return;
    const centre = points.reduce((sum, point) => sum + point.clientX, 0) / points.length;
    this.touchStartX = centre;
    this.touchCurrentX = centre;
    this.touchPointCount = points.length;
  }

  imageTouchMove(event: TouchEvent): void {
    const points = Array.from(event.touches);
    if (!points.length || points.length > 2) return;
    this.touchCurrentX = points.reduce((sum, point) => sum + point.clientX, 0) / points.length;
    this.touchPointCount = Math.max(this.touchPointCount, points.length);
  }

  imageTouchEnd(event: TouchEvent): void {
    if (event.touches.length > 0 || this.touchStartX === null || this.touchCurrentX === null) return;
    const distance = this.touchCurrentX - this.touchStartX;
    const allowSwipe = this.imageZoom === 1 || this.touchPointCount === 2;
    this.touchStartX = null;
    this.touchCurrentX = null;
    this.touchPointCount = 0;
    if (!allowSwipe || Math.abs(distance) < 45) return;
    this.suppressImageOpen = true;
    setTimeout(() => (this.suppressImageOpen = false), 400);
    this.changeImage(distance > 0 ? -1 : 1);
  }

  imageTrackpadSlide(event: WheelEvent): void {
    if (Math.abs(event.deltaX) <= Math.abs(event.deltaY)) return;
    event.preventDefault();
    const now = event.timeStamp || performance.now();
    if (now - this.lastWheelEventAt > 100) {
      this.wheelGestureActive = false;
      this.wheelDistance = 0;
    }
    this.lastWheelEventAt = now;
    if (this.wheelGestureActive) return;
    this.wheelDistance += event.deltaX;
    if (Math.abs(this.wheelDistance) < 45) return;
    this.changeImage(this.wheelDistance > 0 ? 1 : -1);
    this.wheelDistance = 0;
    this.wheelGestureActive = true;
  }

  constructor(
    private route: ActivatedRoute,
    private productService: ProductService,
    private cart: CartService,
    private auth: AuthService,
    private router: Router,
    private contentService: ProductPageContentService,
    private analytics: AnalyticsService
  ) {}

  ngOnInit(): void {
    this.loadPageContent();
    this.route.paramMap.subscribe((params) => {
      const slug = params.get('slug');
      if (!slug) {
        return;
      }
      this.loading = true;
      this.notFound = false;
      this.productService.getProduct(slug).subscribe({
        next: (product) => {
          this.product = {
            ...product,
            sizes: sortSizes(product.sizes)
          };
          this.selectedSize = null;
          this.selectedColor = product.colors[0] ?? null;
          this.activeImage = 0;
          this.quantity = 1;
          this.loading = false;
          this.analytics.track('PRODUCT_VIEWED', this.router.url, product.id);
        },
        error: () => {
          this.notFound = true;
          this.loading = false;
        }
      });
    });
  }

  changeQty(delta: number): void {
    this.quantity = Math.max(1, this.quantity + delta);
  }

  loadPageContent(): void {
    if (this.contentLoading) return;
    this.contentLoading = true;
    this.contentError = '';
    this.contentService.getContent().subscribe({
      next: content => {
        this.pageContent = content;
        this.careItems = content.careInstructions.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
        this.contentLoading = false;
      },
      error: () => {
        this.contentError = 'Size, care and delivery information is temporarily unavailable.';
        this.contentLoading = false;
      }
    });
  }

  changeImage(delta: -1 | 1): void {
    const imageCount = this.product?.images.length || 0;
    if (imageCount < 2) return;
    this.activeImage = (this.activeImage + delta + imageCount) % imageCount;
    this.imageZoom = this.productImageDialog?.nativeElement.open ? 1.2 : 1;
  }

  addToCart(): void {
    if (!this.product) {
      return;
    }

    if (!this.auth.isLoggedIn) {
      this.router.navigate(['/login'], {
        queryParams: { redirect: this.router.url }
      });
      return;
    }
    if (this.product.sizes.length > 0 && !this.selectedSize) {
      this.addError = 'Please select a size.';
      return;
    }

    this.adding = true;
    this.addError = '';
    this.cart.add(
      this.product,
      this.quantity,
      this.selectedSize,
      this.selectedColor
    ).subscribe({
      next: () => {
        this.adding = false;
        this.added = true;
        setTimeout(() => (this.added = false), 1800);
      },
      error: (err) => {
        this.adding = false;
        this.addError = err?.error?.message || err?.message || 'Could not add this item.';
      }
    });
  }
}
