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

  openSizeChart(): void {
    if (this.pageContent?.sizeChartImageUrl) this.sizeChartDialog?.nativeElement.showModal();
  }

  closeSizeChart(): void {
    this.sizeChartDialog?.nativeElement.close();
  }

  closeOnBackdrop(event: MouseEvent): void {
    if (event.target === this.sizeChartDialog?.nativeElement) this.closeSizeChart();
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
