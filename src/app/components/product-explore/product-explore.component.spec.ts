import { ComponentFixture, TestBed, fakeAsync, tick } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { provideRouter } from '@angular/router';
import { ProductExploreComponent } from './product-explore.component';
import { ProductCardComponent } from '../product-card/product-card.component';
import { Product } from '../../models/product.model';
import { ProductService } from '../../services/product.service';
import { CartService } from '../../services/cart.service';

describe('Product exploration carousel', () => {
  let fixture: ComponentFixture<ProductExploreComponent>;
  let component: ProductExploreComponent;
  let width: jasmine.Spy;
  const pixel = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
  const products = ['A', 'B', 'C', 'D'].map(id => ({ id, name: id, slug: id, images: [pixel, pixel], price: 100, category: 'Shirts' } as Product));

  beforeEach(async () => {
    width = spyOnProperty(window, 'innerWidth', 'get').and.returnValue(1440);
    spyOn(window, 'matchMedia').and.returnValue({ matches: false } as MediaQueryList);
    spyOnProperty(document, 'hidden', 'get').and.returnValue(false);
    spyOn(window, 'IntersectionObserver').and.callFake(function(callback: IntersectionObserverCallback) { return {
      observe: target => callback([{ isIntersecting: true, target } as IntersectionObserverEntry], {} as IntersectionObserver),
      disconnect() {}, unobserve() {}, takeRecords: () => [], root: null, rootMargin: '0px', thresholds: [0.1]
    } as IntersectionObserver; });
    await TestBed.configureTestingModule({ imports: [ProductExploreComponent], providers: [
      provideRouter([]), { provide: CartService, useValue: {} }, { provide: ProductService, useValue: {} }
    ] }).compileComponents();
  });

  function render(): void {
    fixture = TestBed.createComponent(ProductExploreComponent);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('products', products);
    fixture.detectChanges();
    component.visibleCount = 4;
    fixture.detectChanges();
  }

  it('both arrows loop when all four products already fit on desktop', fakeAsync(() => {
    render();
    const first = fixture.nativeElement.querySelector('[data-primary]') as HTMLElement;
    spyOn(first, 'getBoundingClientRect').and.returnValue({ width: 300 } as DOMRect);
    fixture.nativeElement.querySelector('[aria-label="Next products"]').click();
    expect(component.animating).toBeTrue();
    expect(component.offset).toBe(-320);
    tick(400); fixture.detectChanges();
    expect(component.items.map(item => item.id)).toEqual(['B', 'C', 'D', 'A']);
    fixture.nativeElement.querySelector('[aria-label="Previous products"]').click();
    tick(450); fixture.detectChanges();
    expect(component.items.map(item => item.id)).toEqual(['A', 'B', 'C', 'D']);
    expect(component.offset).toBe(0);
    fixture.destroy();
  }));

  it('advances every three seconds, pauses on hover and cleans up on leaving the page', fakeAsync(() => {
    render();
    tick(2999);
    expect(component.items[0].id).toBe('A');
    tick(401); fixture.detectChanges();
    expect(component.items[0].id).toBe('B');
    component.pointerEntered({ pointerType: 'mouse' } as PointerEvent);
    tick(6000);
    expect(component.items[0].id).toBe('B');
    component.pointerLeft({ pointerType: 'mouse' } as PointerEvent);
    tick(3000); tick(400);
    expect(component.items[0].id).toBe('C');
    fixture.destroy();
    tick(6000);
    expect(component.items[0].id).toBe('C');
  }));

  it('enables the home-page photo preview on every real product card', () => {
    render();
    const cards = fixture.debugElement.queryAll(By.css('[data-primary] app-product-card'));
    expect(cards.length).toBe(4);
    cards.forEach(card => expect((card.componentInstance as ProductCardComponent).cycleImages).toBeTrue());
    const clone = fixture.nativeElement.querySelector('[aria-hidden="true"][inert]');
    expect(clone).not.toBeNull();
    fixture.destroy();
  });

  it('allows automatic sliding to be paused and leaves a single product still', fakeAsync(() => {
    render();
    component.toggleAutoplay(); tick(6000);
    expect(component.items[0].id).toBe('A');
    fixture.componentRef.setInput('products', [products[0]]); fixture.detectChanges();
    component.toggleAutoplay(); tick(6000);
    expect(component.items.length).toBe(1);
    expect(component.animating).toBeFalse();
    fixture.destroy();
  }));

  it('uses a native scroll row on mobile with no arrows, clones or inaccessible cards', () => {
    width.and.returnValue(390);
    render();
    expect(fixture.nativeElement.querySelector('[aria-label="Next products"]')).toBeNull();
    expect(fixture.nativeElement.querySelector('[aria-label="Previous products"]')).toBeNull();
    expect(fixture.nativeElement.querySelector('[inert]')).toBeNull();
    expect(fixture.nativeElement.querySelector('.mh-explore__rail').style.transform).toBe('');
    const cards = fixture.debugElement.queryAll(By.css('[data-primary] app-product-card'));
    expect(cards.length).toBe(4);
    cards.forEach(card => {
      expect(card.componentInstance.swipeImages).toBeFalse();
      expect(card.componentInstance.cycleImages).toBeTrue();
    });
    fixture.destroy();
  });

  it('scrolls mobile products automatically, waits after touch and wraps at the end', fakeAsync(() => {
    width.and.returnValue(390);
    render();
    const viewport = component.viewport!.nativeElement;
    spyOnProperty(viewport, 'scrollWidth', 'get').and.returnValue(800);
    spyOnProperty(viewport, 'clientWidth', 'get').and.returnValue(400);
    spyOn(viewport.querySelector<HTMLElement>('[data-primary]')!, 'getBoundingClientRect').and.returnValue({ width: 190 } as DOMRect);
    const scroll = spyOn(viewport, 'scrollTo');
    tick(3000);
    expect(scroll.calls.mostRecent().args).toEqual([{ left: 210, behavior: 'smooth' }] as any);
    scroll.calls.reset();
    component.touch(true); tick(3000);
    expect(scroll).not.toHaveBeenCalled();
    component.touch(false); tick(1000); component.scrolled(); tick(2000);
    expect(scroll).not.toHaveBeenCalled();
    spyOnProperty(viewport, 'scrollLeft', 'get').and.returnValue(400);
    tick(3000);
    expect(scroll.calls.mostRecent().args).toEqual([{ left: 0, behavior: 'smooth' }] as any);
    expect(component.items.map(item => item.id)).toEqual(['A', 'B', 'C', 'D']);
    fixture.destroy();
  }));
});
