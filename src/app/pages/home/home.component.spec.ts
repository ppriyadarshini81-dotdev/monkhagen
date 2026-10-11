import { ElementRef } from '@angular/core';
import { fakeAsync, tick } from '@angular/core/testing';
import { of } from 'rxjs';
import { CategoryService } from '../../services/category.service';
import { ProductService } from '../../services/product.service';
import { HomeComponent } from './home.component';

describe('HomeComponent banner carousel', () => {
  function createHome(): HomeComponent {
    const products = jasmine.createSpyObj<ProductService>('ProductService', ['getProducts']);
    const categories = jasmine.createSpyObj<CategoryService>('CategoryService', ['getCategories']);
    products.getProducts.and.returnValue(of([]));
    categories.getCategories.and.returnValue(of([]));
    return new HomeComponent(products, categories, {} as never);
  }

  it('includes all five configured images and a duplicate for seamless looping', () => {
    const home = createHome();
    expect(home.posters.length).toBe(5);
    expect(home.heroSlides.slice(0, 5)).toEqual(home.posters);
    expect(home.heroSlides[5]).toBe(home.posters[0]);
  });

  it('advances through all five banners then loops forward to the first', fakeAsync(() => {
    const home = createHome();
    home.ngOnInit();
    for (let index = 1; index < 5; index++) {
      tick(2000);
      expect(home.currentSlide).toBe(index);
    }
    tick(2000);
    expect(home.heroPosition).toBe(5);
    expect(home.currentSlide).toBe(0);
    home.onHeroTransitionEnd({ propertyName: 'transform' } as TransitionEvent);
    expect(home.heroPosition).toBe(0);
    expect(home.heroAnimating).toBeFalse();
    tick(2000);
    expect(home.heroPosition).toBe(1);
    expect(home.heroAnimating).toBeTrue();
    home.ngOnDestroy();
  }));

  it('allows selecting the fifth banner and resets the autoplay countdown', fakeAsync(() => {
    const home = createHome();
    home.ngOnInit();
    tick(1000);
    home.selectSlide(4);
    expect(home.currentSlide).toBe(4);
    home.selectSlide(5);
    expect(home.currentSlide).toBe(4);
    tick(1999);
    expect(home.currentSlide).toBe(4);
    tick(1);
    expect(home.currentSlide).toBe(0);
    home.ngOnDestroy();
  }));

  it('stops autoplay when leaving the home page', fakeAsync(() => {
    const home = createHome();
    home.ngOnInit();
    home.ngOnDestroy();
    tick(12000);
    expect(home.heroPosition).toBe(0);
  }));

  it('auto-scrolls founder quotes every two seconds on mobile and tablet', fakeAsync(() => {
    const home = createHome();
    spyOn(window, 'matchMedia').and.callFake((query: string) => ({
      matches: query.includes('max-width'),
      media: query
    } as MediaQueryList));
    const scrollTo = jasmine.createSpy('scrollTo');
    const cards = [0, 260, 520].map(offsetLeft => ({ offsetLeft } as HTMLElement));
    const track = {
      offsetLeft: 0,
      querySelectorAll: () => cards,
      scrollTo
    } as unknown as HTMLElement;
    home.testimonialTrack = { nativeElement: track } as ElementRef<HTMLElement>;
    home.ngAfterViewInit();
    tick(2000);
    expect(scrollTo).toHaveBeenCalledWith({ left: 260, behavior: 'smooth' });
    tick(4000);
    expect(scrollTo).toHaveBeenCalledWith({ left: 0, behavior: 'smooth' });
    home.ngOnDestroy();
  }));
});
