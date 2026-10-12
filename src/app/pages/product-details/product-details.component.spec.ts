import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { of, throwError } from 'rxjs';
import { Product } from '../../models/product.model';
import { ProductPageContent } from '../../models/product-page-content.model';
import { ProductService } from '../../services/product.service';
import { ProductPageContentService } from '../../services/product-page-content.service';
import { CartService } from '../../services/cart.service';
import { AnalyticsService } from '../../services/analytics.service';
import { ProductDetailsComponent } from './product-details.component';
import { ReviewService } from '../../services/review.service';
import { AuthService } from '../../services/auth.service';

describe('Product details shared content', () => {
  let fixture: ComponentFixture<ProductDetailsComponent>;
  let productService: jasmine.SpyObj<ProductService>;
  let contentService: jasmine.SpyObj<ProductPageContentService>;
  let reviewService: jasmine.SpyObj<ReviewService>;
  let auth: { isLoggedIn: boolean; currentUser: null };
  const pixel = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
  const product = {
    id: 'product-test', name: 'Test Shirt', slug: 'test-shirt', category: 'Shirts',
    description: 'Details unique to this product.', price: 1499, rating: 0, stock: 78,
    images: [pixel], sizes: ['M', 'S'], colors: ['White'],
    sizeAvailability: [
      { size: 'S', sizeId: 'size-s', available: false, lowStock: false },
      { size: 'M', sizeId: 'size-m', available: true, lowStock: true }
    ]
  } as Product;
  const content: ProductPageContent = {
    sizeChartImageUrl: pixel, careInstructions: 'Wash cold.\nDry flat.',
    deliveryEstimate: '3–5 business days', deliveryNote: 'Remote areas may take longer.'
  };

  beforeEach(async () => {
    productService = jasmine.createSpyObj('ProductService', ['getProduct']);
    contentService = jasmine.createSpyObj('ProductPageContentService', ['getContent']);
    reviewService = jasmine.createSpyObj('ReviewService', ['summary', 'list', 'eligibility', 'create', 'update', 'helpful']);
    productService.getProduct.and.returnValue(of({ ...product }));
    contentService.getContent.and.returnValue(of({ ...content }));
    reviewService.summary.and.returnValue(of({ average: 0, total: 0, distribution: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 } }));
    reviewService.list.and.returnValue(of({ reviews: [], total: 0, limit: 10, offset: 0, customerPhotos: [] }));
    auth = { isLoggedIn: false, currentUser: null };
    await TestBed.configureTestingModule({ imports: [ProductDetailsComponent], providers: [
      provideRouter([]),
      { provide: ActivatedRoute, useValue: { paramMap: of(convertToParamMap({ slug: 'test-shirt' })), snapshot: {
        paramMap: convertToParamMap({ slug: 'test-shirt' }), queryParamMap: convertToParamMap({})
      } } },
      { provide: ProductService, useValue: productService },
      { provide: ProductPageContentService, useValue: contentService },
      { provide: CartService, useValue: {
        prepaidOffer: { code: 'MONKHAGEN10', discountPercent: 10, eligible: false, eligibilityVerified: true, discountAmount: 0, totalAmount: 0 }
      } },
      { provide: AnalyticsService, useValue: { track: () => undefined } },
      { provide: ReviewService, useValue: reviewService },
      { provide: AuthService, useValue: auth }
    ] }).compileComponents();
    fixture = TestBed.createComponent(ProductDetailsComponent);
  });

  it('renders per-product details and shared size, care and delivery data', () => {
    fixture.detectChanges();
    const root: HTMLElement = fixture.nativeElement;
    expect(root.querySelectorAll('.mh-pd__details details').length).toBe(2);
    expect(root.textContent).toContain(product.description);
    expect(Array.from(root.querySelectorAll('.mh-pd__care li')).map(item => item.textContent)).toEqual(['Wash cold.', 'Dry flat.']);
    expect(root.querySelector('.mh-pd__delivery')?.textContent).toContain('3–5 business days');
    expect(root.querySelector('.mh-pd__size-link')?.textContent).toBe('Size chart');
    expect(root.querySelector('.mh-pd__rating')).toBeNull();
    expect(root.querySelector('.mh-pd__size-chart')).toBeNull();
    expect(contentService.getContent).toHaveBeenCalledTimes(1);
    expect(root.querySelector('.mh-reviews__empty')?.textContent).toContain('No reviews yet');
  });

  it('renders real review summary data without fake zero-star labels', () => {
    reviewService.summary.and.returnValue(of({ average: 4.3, total: 3, distribution: { 1: 0, 2: 0, 3: 0, 4: 2, 5: 1 } }));
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.mh-pd__rating-link')?.textContent).toContain('4.3');
    expect(fixture.nativeElement.querySelector('.mh-reviews__score')?.textContent).toContain('3 Verified Buyers');
  });

  it('keeps the write-review action visible for a logged-in customer while eligibility is unavailable', () => {
    auth.isLoggedIn = true;
    reviewService.eligibility.and.returnValue(throwError(() => ({ error: { message: 'Review eligibility could not be checked.' } })));
    fixture.detectChanges();
    const root: HTMLElement = fixture.nativeElement;
    expect(root.querySelector<HTMLButtonElement>('.mh-reviews__head button')?.textContent).toContain('Write a review');
    expect(root.textContent).toContain('Review eligibility could not be checked.');
  });

  it('opens the configured size chart in a modal and closes with the cross or backdrop', () => {
    fixture.detectChanges();
    const root: HTMLElement = fixture.nativeElement;
    const dialog = root.querySelector<HTMLDialogElement>('.mh-pd__chart-dialog')!;
    const link = root.querySelector<HTMLButtonElement>('.mh-pd__size-link')!;
    link.click();
    fixture.detectChanges();
    expect(dialog.open).toBeTrue();
    expect(root.querySelector('.mh-pd__size-chart')?.getAttribute('src')).toBe(pixel);
    root.querySelector<HTMLImageElement>('.mh-pd__size-chart')!.click();
    expect(dialog.open).toBeTrue();
    root.querySelector<HTMLButtonElement>('.mh-pd__chart-close')!.click();
    expect(dialog.open).toBeFalse();
    link.click();
    fixture.detectChanges();
    dialog.click();
    expect(dialog.open).toBeFalse();
  });

  it('ignores blank care lines and trims each bullet from administrator content', () => {
    contentService.getContent.and.returnValue(of({ ...content, careInstructions: ' Wash inside out \r\n\r\n Do not bleach ' }));
    fixture.detectChanges();
    expect(fixture.componentInstance.careItems).toEqual(['Wash inside out', 'Do not bleach']);
  });

  it('hides stock counts while preserving sold-out purchase restrictions', () => {
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.mh-pd__stock')).toBeNull();
    fixture.componentInstance.product!.stock = 0;
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.mh-pd__stock').textContent).toBe('Sold out');
    expect(fixture.nativeElement.querySelector('.mh-pd__add').disabled).toBeTrue();
  });

  it('disables an out-of-stock size, exposes its accessible label and prevents adding it', () => {
    fixture.detectChanges();
    const root = fixture.nativeElement as HTMLElement;
    const buttons = Array.from(root.querySelectorAll<HTMLButtonElement>('.mh-pd__choices button'));
    const soldOut = buttons.find(button => button.textContent?.trim() === 'S')!;
    const lowStock = buttons.find(button => button.textContent?.trim() === 'M')!;
    expect(soldOut.disabled).toBeTrue();
    expect(soldOut.classList).toContain('is-unavailable');
    expect(soldOut.getAttribute('aria-label')).toContain('Out of stock');
    expect(lowStock.disabled).toBeFalse();
    fixture.componentInstance.selectedSize = 'S';
    fixture.componentInstance.addToCart();
    expect(fixture.componentInstance.addError).toContain('out of stock');
    expect(fixture.componentInstance.adding).toBeFalse();
  });

  it('hides optional guides until configured instead of inventing defaults', () => {
    contentService.getContent.and.returnValue(of({ ...content, careInstructions: '', sizeChartImageUrl: '' }));
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelectorAll('.mh-pd__details details').length).toBe(1);
    expect(fixture.nativeElement.querySelector('.mh-pd__size-chart')).toBeNull();
  });

  it('keeps product information available if shared content fails and supports retry', () => {
    contentService.getContent.and.returnValue(throwError(() => new Error('offline')));
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain(product.description);
    expect(fixture.nativeElement.querySelector('.mh-pd__delivery')).toBeNull();
    expect(fixture.nativeElement.querySelector('.mh-pd__content-error')).not.toBeNull();
    contentService.getContent.and.returnValue(of({ ...content }));
    fixture.componentInstance.loadPageContent();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.mh-pd__delivery')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('.mh-pd__content-error')).toBeNull();
  });

  it('renders care content as escaped text, never executable HTML', () => {
    contentService.getContent.and.returnValue(of({ ...content, careInstructions: '<script>alert(1)</script>' }));
    fixture.detectChanges();
    const root: HTMLElement = fixture.nativeElement;
    expect(root.querySelector('.mh-pd__details')?.textContent).toContain('<script>alert(1)</script>');
    expect(root.querySelector('.mh-pd__details script')).toBeNull();
  });

  it('does not render a high-resolution image until the enlarged viewer opens', () => {
    const zoomUrl = 'https://example.com/product-zoom.webp';
    productService.getProduct.and.returnValue(of({ ...product, zoomImages: [zoomUrl] }));
    fixture.detectChanges();
    const root: HTMLElement = fixture.nativeElement;
    expect(Array.from(root.querySelectorAll('img')).some(image => image.src === zoomUrl)).toBeFalse();

    root.querySelector<HTMLButtonElement>('.mh-pd__zoom-trigger')!.click();
    fixture.detectChanges();
    expect(root.querySelector<HTMLImageElement>('.mh-pd__image-stage img')?.src).toBe(zoomUrl);
  });

  it('uses the normal image when no matching zoom image exists', () => {
    productService.getProduct.and.returnValue(of({ ...product, zoomImages: [] }));
    fixture.detectChanges();
    fixture.componentInstance.openImageViewer();
    fixture.detectChanges();
    const root: HTMLElement = fixture.nativeElement;
    expect(root.querySelector<HTMLImageElement>('.mh-pd__image-stage img')?.src).toBe(pixel);
  });

  it('falls back once to the matching normal image when a zoom image fails', () => {
    const zoomUrl = 'https://example.com/broken-zoom.webp';
    productService.getProduct.and.returnValue(of({ ...product, zoomImages: [zoomUrl] }));
    fixture.detectChanges();
    fixture.componentInstance.openImageViewer();
    fixture.detectChanges();
    const root: HTMLElement = fixture.nativeElement;
    const image = root.querySelector<HTMLImageElement>('.mh-pd__image-stage img')!;
    image.dispatchEvent(new Event('error'));
    fixture.detectChanges();
    expect(image.src).toBe(pixel);
    expect(fixture.componentInstance.viewerImageUrl()).toBe(pixel);
  });

  it('shows every photo in a vertical viewer, lazy-loads each active zoom image and double-clicks to zoom', () => {
    const secondDisplay = 'https://example.com/second-display.webp';
    const firstZoom = 'https://example.com/first-zoom.webp';
    const secondZoom = 'https://example.com/second-zoom.webp';
    productService.getProduct.and.returnValue(of({
      ...product,
      images: [pixel, secondDisplay],
      zoomImages: [firstZoom, secondZoom]
    }));
    fixture.detectChanges();
    fixture.componentInstance.openImageViewer();
    fixture.detectChanges();
    const root: HTMLElement = fixture.nativeElement;
    const images = root.querySelectorAll<HTMLImageElement>('.mh-pd__viewer-frame img');
    expect(images.length).toBe(2);
    expect(fixture.componentInstance.imageZoom).toBe(1);
    expect(images[0].src).toBe(firstZoom);
    expect(images[1].src).toBe(secondDisplay);

    fixture.componentInstance.selectImage(1);
    fixture.detectChanges();
    expect(images[1].src).toBe(secondZoom);
    images[1].dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    fixture.detectChanges();
    expect(fixture.componentInstance.imageZoom).toBe(2);
  });

  it('toggles viewer zoom when a touch pointer double-taps an image', () => {
    fixture.detectChanges();
    fixture.componentInstance.openImageViewer();
    fixture.detectChanges();
    const root: HTMLElement = fixture.nativeElement;
    const image = root.querySelector<HTMLImageElement>('.mh-pd__viewer-frame img')!;
    const tap = (type: string) => image.dispatchEvent(new PointerEvent(type, {
      bubbles: true,
      pointerType: 'touch',
      clientX: 100,
      clientY: 100
    }));

    tap('pointerdown');
    tap('pointerup');
    tap('pointerdown');
    tap('pointerup');
    fixture.detectChanges();

    expect(fixture.componentInstance.imageZoom).toBe(2);
  });

  function openPanningViewer() {
    productService.getProduct.and.returnValue(of({ ...product, images: [pixel, pixel] }));
    fixture.detectChanges(); fixture.componentInstance.openImageViewer(); fixture.detectChanges();
    const root = fixture.nativeElement as HTMLElement;
    const frame = root.querySelector<HTMLElement>('.mh-pd__viewer-frame')!;
    const image = frame.querySelector<HTMLImageElement>('img')!;
    spyOnProperty(image, 'clientWidth', 'get').and.returnValue(200);
    spyOnProperty(image, 'clientHeight', 'get').and.returnValue(220);
    const width = spyOnProperty(frame, 'clientWidth', 'get').and.returnValue(250);
    const height = spyOnProperty(frame, 'clientHeight', 'get').and.returnValue(300);
    let captured = false;
    const capture = spyOn(frame, 'setPointerCapture').and.callFake(() => { captured = true; });
    spyOn(frame, 'hasPointerCapture').and.callFake(() => captured);
    const release = spyOn(frame, 'releasePointerCapture').and.callFake(() => { captured = false; });
    image.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })); fixture.detectChanges();
    function pointer(type: string, pointerType: string, x: number, y: number, pointerId = 1) {
      frame.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, pointerType, pointerId,
        clientX: x, clientY: y, button: 0, buttons: type === 'pointerup' ? 0 : 1 }));
      fixture.detectChanges();
    }
    return { root, frame, image, width, height, capture, release, pointer, component: fixture.componentInstance };
  }

  for (const pointerType of ['mouse', 'touch']) {
    it(`pans a zoomed image in all four directions with ${pointerType}, clamps edges and releases dragging`, () => {
      const viewer = openPanningViewer();
      viewer.pointer('pointerdown', pointerType, 100, 100);
      expect(viewer.capture).toHaveBeenCalledWith(1);
      viewer.pointer('pointermove', pointerType, 140, 130);
      expect(viewer.image.style.transform).toContain('translate(40px, 30px)');
      expect(viewer.frame.classList.contains('is-panning')).toBeTrue();
      expect(getComputedStyle(viewer.image).cursor).toBe('grabbing');
      expect(getComputedStyle(viewer.root.querySelector('.mh-pd__image-stage')!).touchAction).toBe('none');
      viewer.pointer('pointermove', pointerType, -1000, -1000);
      expect(viewer.component.imagePanX).toBe(-75); expect(viewer.component.imagePanY).toBe(-70);
      viewer.pointer('pointermove', pointerType, 1000, 1000);
      expect(viewer.component.imagePanX).toBe(75); expect(viewer.component.imagePanY).toBe(70);
      viewer.pointer('pointerup', pointerType, 1000, 1000);
      expect(viewer.release).toHaveBeenCalledWith(1); expect(viewer.component.imagePanning).toBeFalse();
      expect(viewer.component.imageZoom).toBe(2); expect(viewer.component.activeImage).toBe(0);
      viewer.pointer('pointermove', pointerType, 0, 0);
      expect(viewer.component.imagePanX).toBe(75);
      viewer.root.querySelector<HTMLButtonElement>('.mh-pd__zoom-value')!.click(); fixture.detectChanges();
      expect(viewer.component.imagePanX).toBe(0); expect(viewer.component.imagePanY).toBe(0);
      expect(viewer.component.imageZoom).toBe(1);
    });
  }

  it('keeps a touch drag that returns to its starting point from being mistaken for a double-tap', () => {
    const viewer = openPanningViewer();
    viewer.pointer('pointerdown', 'touch', 100, 100); viewer.pointer('pointerup', 'touch', 100, 100);
    viewer.pointer('pointerdown', 'touch', 100, 100);
    viewer.pointer('pointermove', 'touch', 150, 140); viewer.pointer('pointermove', 'touch', 100, 100);
    viewer.pointer('pointerup', 'touch', 100, 100);
    expect(viewer.component.imageZoom).toBe(2);
  });

  it('ends panning on cancellation or lost capture without getting stuck or jumping on the next drag', () => {
    const viewer = openPanningViewer();
    for (const event of ['pointercancel', 'lostpointercapture']) {
      viewer.pointer('pointerdown', 'mouse', 100, 100); viewer.pointer('pointermove', 'mouse', 130, 120);
      const x = viewer.component.imagePanX, y = viewer.component.imagePanY;
      viewer.pointer(event, 'mouse', 130, 120);
      expect(viewer.component.imagePanning).toBeFalse();
      viewer.pointer('pointermove', 'mouse', 170, 150);
      expect(viewer.component.imagePanX).toBe(x); expect(viewer.component.imagePanY).toBe(y);
    }
  });

  it('clamps pan after zoom or viewport changes and resets it when changing photos or closing', () => {
    const viewer = openPanningViewer();
    viewer.pointer('pointerdown', 'mouse', 100, 100); viewer.pointer('pointermove', 'mouse', 200, 200);
    viewer.pointer('pointerup', 'mouse', 200, 200);
    viewer.component.setImageZoom(1.5);
    expect(viewer.component.imagePanX).toBe(25); expect(viewer.component.imagePanY).toBe(15);
    viewer.width.and.returnValue(500); viewer.height.and.returnValue(600); viewer.component.viewerResized();
    expect(viewer.component.imagePanX).toBe(0); expect(viewer.component.imagePanY).toBe(0);
    viewer.component.changeImage(1);
    expect(viewer.component.imageZoom).toBe(1); expect(viewer.component.imagePanX).toBe(0);
    viewer.component.closeImageViewer(); expect(viewer.component.imageViewerOpen).toBeFalse();
  });

  it('pans with a trackpad while zoomed instead of switching photos', () => {
    const viewer = openPanningViewer();
    viewer.root.querySelector('.mh-pd__image-stage')!.dispatchEvent(new WheelEvent('wheel', {
      bubbles: true, cancelable: true, deltaX: 30, deltaY: 20 }));
    expect(viewer.component.imagePanX).toBe(-30); expect(viewer.component.imagePanY).toBe(-20);
    expect(viewer.component.activeImage).toBe(0);
  });

  it('does not let a mouse press before zooming block a later touch drag', () => {
    const viewer = openPanningViewer(); viewer.component.setImageZoom(1);
    viewer.pointer('pointerdown', 'mouse', 100, 100);
    expect(viewer.capture).not.toHaveBeenCalled();
    viewer.component.setImageZoom(2);
    viewer.pointer('pointerdown', 'touch', 100, 100, 2); viewer.pointer('pointermove', 'touch', 130, 120, 2);
    expect(viewer.component.imagePanning).toBeTrue();
    expect(viewer.component.imagePanX).toBe(30); expect(viewer.component.imagePanY).toBe(20);
    viewer.pointer('pointerup', 'touch', 130, 120, 2);
  });

  it('ends one-finger panning when another finger arrives and permits a fresh drag afterward', () => {
    const viewer = openPanningViewer();
    viewer.pointer('pointerdown', 'touch', 100, 100);
    viewer.pointer('pointerdown', 'touch', 150, 150, 2);
    expect(viewer.component.imagePanning).toBeFalse();
    viewer.pointer('pointermove', 'touch', 170, 150);
    expect(viewer.component.imagePanX).toBe(0); expect(viewer.component.imagePanY).toBe(0);
    viewer.pointer('pointerup', 'touch', 170, 150); viewer.pointer('pointerup', 'touch', 150, 150, 2);
    expect(viewer.component.imageZoom).toBe(2);
    viewer.pointer('pointerdown', 'touch', 100, 100, 3); viewer.pointer('pointermove', 'touch', 130, 120, 3);
    expect(viewer.component.imagePanX).toBe(30); expect(viewer.component.imagePanY).toBe(20);
    viewer.pointer('pointerup', 'touch', 130, 120, 3);
  });
});
