import { CommonModule } from '@angular/common';
import { Component, ElementRef, HostListener, OnDestroy, OnInit, Optional, ViewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { Product } from '../../models/product.model';
import { ProductService } from '../../services/product.service';
import { CartService } from '../../services/cart.service';
import { sortSizes } from '../../utils/size-order';
import { ProductPageContent } from '../../models/product-page-content.model';
import { ProductPageContentService } from '../../services/product-page-content.service';
import { AnalyticsService } from '../../services/analytics.service';
import { cachedMediaUrl } from '../../utils/media-url';
import { AuthService } from '../../services/auth.service';
import { ReviewService, ReviewSort } from '../../services/review.service';
import { ProductReview, ReviewEligibility, ReviewSummary } from '../../models/review.model';
import { EMPTY, Subscription, expand, reduce } from 'rxjs';
import { ProductExploreComponent } from '../../components/product-explore/product-explore.component';
import { MetaPixelService } from '../../services/meta-pixel.service';

@Component({
  selector: 'app-product-details',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink, ProductExploreComponent],
  templateUrl: './product-details.component.html',
  styleUrl: './product-details.component.css'
})
export class ProductDetailsComponent implements OnInit, OnDestroy {
  readonly cachedMediaUrl = cachedMediaUrl;
  product?: Product;
  loading = true;
  notFound = false;
  exploreProducts: Product[] = [];
  exploreLoading = false;
  exploreError = false;
  private exploreRequest?: Subscription;
  private productRequest?: Subscription;
  private routeSubscription?: Subscription;

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
  @ViewChild('productImageStage') productImageStage?: ElementRef<HTMLElement>;
  @ViewChild('reviewDialog') reviewDialog?: ElementRef<HTMLDialogElement>;
  @ViewChild('reviewPhotoDialog') reviewPhotoDialog?: ElementRef<HTMLDialogElement>;
  reviewSummary: ReviewSummary = { average: 0, total: 0, distribution: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 } };
  reviews: ProductReview[] = [];
  reviewEligibility: ReviewEligibility | null = null;
  reviewsLoading = false;
  reviewsError = '';
  reviewSort: ReviewSort = 'recent';
  reviewPage = 1;
  readonly reviewLimit = 10;
  customerPhotos: Array<{ id: string; reviewId: string; url: string }> = [];
  reviewRating = 0;
  reviewText = '';
  reviewFiles: File[] = [];
  replaceReviewImages = false;
  reviewSubmitting = false;
  reviewFormError = '';
  activeReviewPhoto = '';
  readonly starValues = [1, 2, 3, 4, 5];
  imageZoom = 1;
  imagePanX = 0;
  imagePanY = 0;
  imagePanning = false;
  imageViewerOpen = false;
  private failedZoomImages = new Set<number>();
  private loadedViewerImages = new Set<number>();
  private touchStartX: number | null = null;
  private touchCurrentX: number | null = null;
  private touchPointCount = 0;
  private suppressImageOpen = false;
  private wheelDistance = 0;
  private wheelGestureActive = false;
  private lastWheelEventAt = 0;
  private viewerPointerStart: { x: number; y: number; index: number; pointerId: number; moved: boolean } | null = null;
  private viewerPointers = new Set<number>();
  private viewerPan: { pointerId: number; target: HTMLElement; image: HTMLImageElement;
    x: number; y: number; panX: number; panY: number; moved: boolean } | null = null;
  private lastViewerTapAt = 0;
  private lastViewerTapIndex = -1;
  private suppressSyntheticDoubleClickUntil = 0;

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
    this.imageZoom = 1;
    this.resetViewerInteraction();
    this.loadedViewerImages = new Set([this.activeImage]);
    this.imageViewerOpen = true;
    this.productImageDialog?.nativeElement.showModal();
    queueMicrotask(() => this.scrollViewerTo(this.activeImage, false));
  }

  closeImageViewer(): void {
    this.imageZoom = 1;
    this.resetViewerInteraction();
    this.imageViewerOpen = false;
    this.loadedViewerImages.clear();
    this.productImageDialog?.nativeElement.close();
  }

  imageViewerClosed(): void {
    this.imageZoom = 1;
    this.resetViewerInteraction();
    this.imageViewerOpen = false;
    this.loadedViewerImages.clear();
  }

  viewerImageUrl(index = this.activeImage): string {
    if (!this.product) return '';
    const zoomUrl = this.product.zoomImages?.[index];
    return this.loadedViewerImages.has(index) && zoomUrl && !this.failedZoomImages.has(index)
      ? zoomUrl
      : this.product.images[index];
  }

  viewerImageFailed(event: Event, index = this.activeImage): void {
    const zoomUrl = this.product?.zoomImages?.[index];
    if (!this.product || !zoomUrl || this.failedZoomImages.has(index)) return;
    this.failedZoomImages.add(index);
    (event.currentTarget as HTMLImageElement).src = this.cachedMediaUrl(this.product.images[index]);
  }

  closeImageOnBackdrop(event: MouseEvent): void {
    if (event.target === this.productImageDialog?.nativeElement) this.closeImageViewer();
  }

  setImageZoom(zoom: number): void {
    this.finishViewerPan();
    this.imageZoom = Math.min(3, Math.max(1, Number(zoom.toFixed(1))));
    this.constrainViewerPan();
  }

  selectImage(index: number): void {
    this.activeImage = index;
    this.imageZoom = 1;
    this.resetViewerInteraction();
    if (this.productImageDialog?.nativeElement.open) {
      this.loadedViewerImages.add(index);
      this.scrollViewerTo(index);
    }
  }

  viewerScrolled(event: Event): void {
    const stage = event.currentTarget as HTMLElement;
    const frames = Array.from(stage.querySelectorAll<HTMLElement>('[data-viewer-index]'));
    if (!frames.length) return;
    const stageCentre = stage.scrollTop + stage.clientHeight / 2;
    const active = frames.reduce((closest, frame) => {
      const distance = Math.abs(frame.offsetTop + frame.offsetHeight / 2 - stageCentre);
      return distance < closest.distance ? { frame, distance } : closest;
    }, { frame: frames[0], distance: Number.POSITIVE_INFINITY }).frame;
    const index = Number(active.dataset['viewerIndex']);
    if (!Number.isSafeInteger(index) || index === this.activeImage) return;
    this.activeImage = index;
    this.imageZoom = 1;
    this.resetViewerInteraction();
    this.loadedViewerImages.add(index);
  }

  toggleViewerZoom(index: number): void {
    const zoom = this.activeImage === index && this.imageZoom > 1 ? 1 : 2;
    if (index !== this.activeImage) this.resetViewerInteraction();
    this.activeImage = index;
    this.loadedViewerImages.add(index);
    this.setImageZoom(zoom);
  }

  viewerImageDoubleClick(event: MouseEvent, index: number): void {
    // Touch browsers commonly synthesize a dblclick after the second pointerup.
    // The pointer handler has already toggled zoom, so ignore only that echo.
    if (performance.now() < this.suppressSyntheticDoubleClickUntil) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    this.toggleViewerZoom(index);
  }

  viewerImagePointerDown(event: PointerEvent, index: number): void {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    if (event.pointerType !== 'touch' && this.imageZoom <= 1) return;
    this.viewerPointers.add(event.pointerId);
    if (this.viewerPointers.size > 1) {
      this.finishViewerPan();
      this.viewerPointerStart = null;
      this.clearViewerTap();
      return;
    }
    if (event.pointerType === 'touch') {
      this.viewerPointerStart = { x: event.clientX, y: event.clientY, index, pointerId: event.pointerId, moved: false };
    }
    if (this.imageZoom <= 1 || index !== this.activeImage) return;
    const target = event.currentTarget as HTMLElement;
    const image = target.querySelector<HTMLImageElement>('img');
    if (!image) return;
    this.constrainViewerPan(image);
    this.viewerPan = { pointerId: event.pointerId, target, image, x: event.clientX, y: event.clientY,
      panX: this.imagePanX, panY: this.imagePanY, moved: false };
    this.imagePanning = true;
    try { target.setPointerCapture(event.pointerId); }
    catch { /* Synthetic events and interrupted pointers may no longer be active. */ }
  }

  viewerImagePointerMove(event: PointerEvent): void {
    const tap = this.viewerPointerStart;
    if (tap?.pointerId === event.pointerId && Math.hypot(event.clientX - tap.x, event.clientY - tap.y) > 14) tap.moved = true;
    const pan = this.viewerPan;
    if (!pan || pan.pointerId !== event.pointerId) return;
    if (event.cancelable) event.preventDefault();
    const x = event.clientX - pan.x, y = event.clientY - pan.y;
    if (Math.hypot(x, y) > 5) pan.moved = true;
    this.imagePanX = pan.panX + x;
    this.imagePanY = pan.panY + y;
    this.constrainViewerPan(pan.image);
  }

  viewerImagePointerUp(event: PointerEvent, index: number): void {
    const dragged = this.viewerPan?.pointerId === event.pointerId && this.viewerPan.moved;
    if (this.viewerPan?.pointerId === event.pointerId) this.finishViewerPan();
    this.viewerPointers.delete(event.pointerId);
    if (dragged) {
      this.viewerPointerStart = null;
      this.clearViewerTap();
      this.suppressSyntheticDoubleClickUntil = performance.now() + 350;
      return;
    }
    if (event.pointerType !== 'touch') return;
    const start = this.viewerPointerStart;
    this.viewerPointerStart = null;
    if (!start || start.pointerId !== event.pointerId || start.index !== index || start.moved || this.viewerPointers.size ||
        Math.hypot(event.clientX - start.x, event.clientY - start.y) > 14) {
      this.clearViewerTap();
      return;
    }

    const now = event.timeStamp || performance.now();
    if (this.lastViewerTapIndex === index && now - this.lastViewerTapAt <= 350) {
      event.preventDefault();
      event.stopPropagation();
      this.lastViewerTapAt = 0;
      this.lastViewerTapIndex = -1;
      this.suppressSyntheticDoubleClickUntil = performance.now() + 500;
      this.toggleViewerZoom(index);
      return;
    }

    this.lastViewerTapAt = now;
    this.lastViewerTapIndex = index;
  }

  viewerImagePointerCancel(event: PointerEvent): void {
    this.viewerPointers.delete(event.pointerId);
    if (this.viewerPan?.pointerId === event.pointerId) this.finishViewerPan();
    this.viewerPointerStart = null;
    this.clearViewerTap();
  }

  viewerImageCaptureLost(event: PointerEvent): void {
    if (this.viewerPan?.pointerId === event.pointerId) this.viewerImagePointerCancel(event);
  }

  private finishViewerPan(): void {
    const pan = this.viewerPan;
    this.viewerPan = null;
    this.imagePanning = false;
    if (pan?.target.hasPointerCapture(pan.pointerId)) pan.target.releasePointerCapture(pan.pointerId);
  }

  private clearViewerTap(): void { this.lastViewerTapAt = 0; this.lastViewerTapIndex = -1; }

  private resetViewerInteraction(): void {
    this.finishViewerPan();
    this.imagePanX = 0; this.imagePanY = 0;
    this.viewerPointers.clear(); this.viewerPointerStart = null;
    this.touchStartX = null; this.touchCurrentX = null; this.touchPointCount = 0;
    this.clearViewerTap();
  }

  private constrainViewerPan(image?: HTMLImageElement): void {
    image ||= this.productImageStage?.nativeElement.querySelector<HTMLImageElement>(`[data-viewer-index="${this.activeImage}"] img`) || undefined;
    const frame = image?.parentElement;
    if (this.imageZoom <= 1 || !image || !frame) {
      this.imagePanX = 0; this.imagePanY = 0;
      return;
    }
    const maxX = Math.max(0, (image.clientWidth * this.imageZoom - frame.clientWidth) / 2);
    const maxY = Math.max(0, (image.clientHeight * this.imageZoom - frame.clientHeight) / 2);
    this.imagePanX = Math.max(-maxX, Math.min(maxX, this.imagePanX));
    this.imagePanY = Math.max(-maxY, Math.min(maxY, this.imagePanY));
  }

  viewerImageLoaded(event: Event, index: number): void {
    if (index === this.activeImage) this.constrainViewerPan(event.currentTarget as HTMLImageElement);
  }

  @HostListener('window:resize')
  viewerResized(): void { if (this.imageViewerOpen) this.constrainViewerPan(); }

  ngOnDestroy(): void {
    this.resetViewerInteraction();
    this.exploreRequest?.unsubscribe();
    this.productRequest?.unsubscribe();
    this.routeSubscription?.unsubscribe();
  }

  private scrollViewerTo(index: number, smooth = true): void {
    const stage = this.productImageStage?.nativeElement;
    const frame = stage?.querySelector<HTMLElement>(`[data-viewer-index="${index}"]`);
    if (!stage || !frame) return;
    stage.scrollTo({ top: frame.offsetTop, behavior: smooth ? 'smooth' : 'auto' });
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
    if (this.imageViewerOpen && this.imageZoom > 1) {
      event.preventDefault();
      this.imagePanX -= event.deltaX;
      this.imagePanY -= event.deltaY;
      this.constrainViewerPan();
      return;
    }
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
    public cart: CartService,
    private router: Router,
    private contentService: ProductPageContentService,
    private analytics: AnalyticsService,
    public auth: AuthService,
    private reviewService: ReviewService,
    @Optional() private meta?: MetaPixelService
  ) {}

  ngOnInit(): void {
    this.loadPageContent();
    this.routeSubscription = this.route.paramMap.subscribe((params) => {
      const slug = params.get('slug');
      if (!slug) {
        return;
      }
      this.loading = true;
      this.notFound = false;
      this.productRequest?.unsubscribe();
      this.exploreRequest?.unsubscribe();
      this.exploreProducts = [];
      this.exploreError = false;
      this.productRequest = this.productService.getProduct(slug).subscribe({
        next: (product) => {
          this.product = {
            ...product,
            sizes: sortSizes(product.sizes)
          };
          this.selectedSize = null;
          this.selectedColor = product.colors[0] ?? null;
          this.activeImage = 0;
          this.failedZoomImages.clear();
          this.quantity = 1;
          this.loading = false;
          this.analytics.track('PRODUCT_VIEWED', this.router.url, product.id);
          this.meta?.viewProduct(product);
          this.loadReviewData();
          this.loadExploreProducts(product);
        },
        error: () => {
          this.notFound = true;
          this.loading = false;
        }
      });
    });
  }

  private loadExploreProducts(current: Product): void {
    this.exploreLoading = true;
    this.exploreRequest = this.productService.getProducts({ limit: 100, offset: 0 }).pipe(
      expand((page, index) => page.length === 100
        ? this.productService.getProducts({ limit: 100, offset: (index + 1) * 100 }) : EMPTY),
      reduce((products, page) => [...products, ...page], [] as Product[])
    ).subscribe({
      next: products => {
        const unique = new Map(products.map(product => [product.id, product]));
        this.exploreProducts = [...unique.values()]
          .filter(product => product.id !== current.id && product.isActive !== false)
          .sort((a, b) => Number(b.category === current.category) - Number(a.category === current.category));
        this.exploreLoading = false;
      },
      error: () => { this.exploreLoading = false; this.exploreError = true; }
    });
  }

  loadReviewData(): void {
    if (!this.product) return;
    this.reviewService.summary(this.product.id).subscribe({
      next: summary => this.reviewSummary = summary,
      error: () => this.reviewsError = 'Ratings are temporarily unavailable.'
    });
    this.loadReviews();
    if (this.auth.isLoggedIn) {
      this.reviewService.eligibility(this.product.id).subscribe({
        next: eligibility => {
          this.reviewEligibility = eligibility;
          if (this.route.snapshot.queryParamMap.get('review') === 'write' && eligibility.eligible) {
            queueMicrotask(() => this.openReviewForm());
          }
        },
        error: error => {
          this.reviewEligibility = null;
          this.reviewsError = error?.error?.message || 'Review eligibility could not be checked.';
        }
      });
    } else {
      this.reviewEligibility = null;
    }
  }

  loadReviews(): void {
    if (!this.product || this.reviewsLoading) return;
    this.reviewsLoading = true;
    this.reviewsError = '';
    this.reviewService.list(this.product.id, this.reviewPage, this.reviewLimit, this.reviewSort).subscribe({
      next: page => {
        this.reviews = page.reviews;
        this.customerPhotos = page.customerPhotos;
        this.reviewsLoading = false;
      },
      error: () => {
        this.reviewsError = 'Customer reviews could not be loaded.';
        this.reviewsLoading = false;
      }
    });
  }

  changeReviewSort(): void {
    this.reviewPage = 1;
    this.loadReviews();
  }

  changeReviewPage(delta: number): void {
    const next = this.reviewPage + delta;
    if (next < 1 || (delta > 0 && this.reviewPage * this.reviewLimit >= this.reviewSummary.total)) return;
    this.reviewPage = next;
    this.loadReviews();
    document.getElementById('customer-reviews')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  writeReview(): void {
    if (!this.auth.isLoggedIn) {
      const slug = this.product?.slug || this.route.snapshot.paramMap.get('slug') || '';
      this.router.navigate(['/login'], { queryParams: { redirect: `/product/${slug}?review=write` } });
      return;
    }
    if (!this.reviewEligibility) {
      this.reviewService.eligibility(this.product!.id).subscribe({
        next: eligibility => { this.reviewEligibility = eligibility; this.openReviewForm(); },
        error: error => this.reviewsError = error?.error?.message || 'Review eligibility could not be checked.'
      });
      return;
    }
    this.openReviewForm();
  }

  openReviewForm(): void {
    if (!this.reviewEligibility?.eligible) {
      this.reviewsError = 'Only verified buyers with a delivered order can review this product.';
      return;
    }
    const own = this.reviewEligibility.ownReview;
    this.reviewRating = own?.rating || 0;
    this.reviewText = own?.text || '';
    this.reviewFiles = [];
    this.replaceReviewImages = false;
    this.reviewFormError = '';
    queueMicrotask(() => this.reviewDialog?.nativeElement.showModal());
  }

  closeReviewForm(): void { this.reviewDialog?.nativeElement.close(); }

  selectReviewPhotos(event: Event): void {
    const input = event.target as HTMLInputElement;
    const files = Array.from(input.files || []);
    this.reviewFormError = '';
    if (files.length > 5) {
      this.reviewFormError = 'Choose no more than 5 photos.';
      input.value = '';
      return;
    }
    if (files.some(file => !['image/jpeg','image/png','image/webp','image/avif'].includes(file.type) || file.size > 5 * 1024 * 1024)) {
      this.reviewFormError = 'Photos must be JPG, PNG, WebP or AVIF and no larger than 5 MB each.';
      input.value = '';
      return;
    }
    this.reviewFiles = files;
    this.replaceReviewImages = true;
  }

  removeReviewPhotos(): void {
    this.reviewFiles = [];
    this.replaceReviewImages = true;
  }

  submitReview(): void {
    if (!this.product || !this.reviewEligibility || this.reviewSubmitting) return;
    if (!Number.isInteger(this.reviewRating) || this.reviewRating < 1 || this.reviewRating > 5) {
      this.reviewFormError = 'Choose a rating from 1 to 5 stars.';
      return;
    }
    if (this.reviewText.trim().length > 2000) {
      this.reviewFormError = 'Review text cannot exceed 2000 characters.';
      return;
    }
    this.reviewSubmitting = true;
    this.reviewFormError = '';
    const own = this.reviewEligibility.ownReview;
    const request = own
      ? this.reviewService.update(this.product.id, own.id, this.reviewRating, this.reviewText, this.reviewFiles, this.replaceReviewImages)
      : this.reviewService.create(this.product.id, this.reviewRating, this.reviewText, this.reviewFiles);
    request.subscribe({
      next: () => {
        this.reviewSubmitting = false;
        this.closeReviewForm();
        this.reviewPage = 1;
        this.loadReviewData();
      },
      error: error => {
        this.reviewSubmitting = false;
        this.reviewFormError = error?.error?.message || 'Your review could not be saved.';
      }
    });
  }

  toggleHelpful(review: ProductReview): void {
    if (!this.auth.isLoggedIn) {
      this.router.navigate(['/login'], { queryParams: { redirect: this.router.url } });
      return;
    }
    this.reviewService.helpful(this.product!.id, review.id, !review.helpfulByMe).subscribe({
      next: result => { review.helpfulByMe = result.helpful; review.helpfulCount = result.helpfulCount; },
      error: error => this.reviewsError = error?.error?.message || 'Helpful vote could not be updated.'
    });
  }

  ratingPercent(star: number): number {
    return this.reviewSummary.total ? (this.reviewSummary.distribution[star as 1 | 2 | 3 | 4 | 5] / this.reviewSummary.total) * 100 : 0;
  }

  ratingCount(star: number): number {
    return this.reviewSummary.distribution[star as 1 | 2 | 3 | 4 | 5] || 0;
  }

  scrollToReviews(): void {
    document.getElementById('customer-reviews')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  openReviewPhoto(url: string): void {
    this.activeReviewPhoto = url;
    queueMicrotask(() => this.reviewPhotoDialog?.nativeElement.showModal());
  }

  changeQty(delta: number): void {
    this.quantity = Math.max(1, this.quantity + delta);
  }

  sizeAvailable(size: string): boolean {
    return this.product?.sizeAvailability?.find(item => item.size === size)?.available ??
      Boolean(this.product?.variants?.some(variant => variant.isActive && variant.size === size && (variant.available ?? variant.stock > 0)));
  }

  sizeLowStock(size: string): boolean {
    return Boolean(this.product?.sizeAvailability?.find(item => item.size === size)?.lowStock);
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
    this.imageZoom = 1;
    this.resetViewerInteraction();
    if (this.productImageDialog?.nativeElement.open) {
      this.loadedViewerImages.add(this.activeImage);
      this.scrollViewerTo(this.activeImage);
    }
  }

  addToCart(): void {
    if (!this.product) {
      return;
    }

    if (this.product.sizes.length > 0 && !this.selectedSize) {
      this.addError = 'Please select a size.';
      return;
    }
    if (this.selectedSize && !this.sizeAvailable(this.selectedSize)) {
      this.addError = `${this.selectedSize} is currently out of stock.`;
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
        this.cart.openPreview();
        setTimeout(() => (this.added = false), 1800);
      },
      error: (err) => {
        this.adding = false;
        this.addError = err?.error?.message || err?.message || 'Could not add this item.';
      }
    });
  }
}
