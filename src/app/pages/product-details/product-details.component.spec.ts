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

describe('Product details shared content', () => {
  let fixture: ComponentFixture<ProductDetailsComponent>;
  let productService: jasmine.SpyObj<ProductService>;
  let contentService: jasmine.SpyObj<ProductPageContentService>;
  const pixel = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
  const product = {
    id: 'product-test', name: 'Test Shirt', slug: 'test-shirt', category: 'Shirts',
    description: 'Details unique to this product.', price: 1499, rating: 0, stock: 78,
    images: [pixel], sizes: ['M', 'S'], colors: ['White']
  } as Product;
  const content: ProductPageContent = {
    sizeChartImageUrl: pixel, careInstructions: 'Wash cold.\nDry flat.',
    deliveryEstimate: '3–5 business days', deliveryNote: 'Remote areas may take longer.'
  };

  beforeEach(async () => {
    productService = jasmine.createSpyObj('ProductService', ['getProduct']);
    contentService = jasmine.createSpyObj('ProductPageContentService', ['getContent']);
    productService.getProduct.and.returnValue(of({ ...product }));
    contentService.getContent.and.returnValue(of({ ...content }));
    await TestBed.configureTestingModule({ imports: [ProductDetailsComponent], providers: [
      provideRouter([]),
      { provide: ActivatedRoute, useValue: { paramMap: of(convertToParamMap({ slug: 'test-shirt' })) } },
      { provide: ProductService, useValue: productService },
      { provide: ProductPageContentService, useValue: contentService },
      { provide: CartService, useValue: {
        prepaidOffer: { code: 'MONKHAGEN10', discountPercent: 10, eligible: false, eligibilityVerified: true, discountAmount: 0, totalAmount: 0 }
      } },
      { provide: AnalyticsService, useValue: { track: () => undefined } }
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
  });

  it('opens the configured size chart in a modal and closes with the cross or backdrop', () => {
    fixture.detectChanges();
    const root: HTMLElement = fixture.nativeElement;
    const dialog = root.querySelector('dialog')!;
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
});
