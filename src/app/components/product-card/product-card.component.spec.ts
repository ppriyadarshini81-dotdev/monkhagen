import { fakeAsync, tick } from '@angular/core/testing';
import { Router } from '@angular/router';
import { Product } from '../../models/product.model';
import { AuthService } from '../../services/auth.service';
import { CartService } from '../../services/cart.service';
import { ProductService } from '../../services/product.service';
import { ProductCardComponent } from './product-card.component';

describe('Product card hover slideshow', () => {
  function createCard(images = ['first.webp', 'second.webp', 'third.webp']): ProductCardComponent {
    const card = new ProductCardComponent({} as CartService, {} as AuthService, {} as ProductService, {} as Router);
    card.product = { images } as Product;
    card.cycleImages = true;
    card.ngOnChanges();
    return card;
  }

  it('does not load alternate photos or rotate before hover', fakeAsync(() => {
    const card = createCard();
    card.onImageLoaded(0);
    tick(10000);
    expect(card.imagesActivated).toBeFalse();
    expect(card.currentImageIndex).toBe(0);
    card.ngOnDestroy();
  }));

  it('slides through every photo while hovered and loops seamlessly', fakeAsync(() => {
    const card = createCard();
    card.onMouseEnter();
    expect(card.imagesActivated).toBeTrue();
    expect(card.currentImageIndex).toBe(0);
    [0, 1, 2, 3].forEach(index => card.onImageLoaded(index));
    expect(card.currentImageIndex).toBe(1);
    tick(2000);
    expect(card.currentImageIndex).toBe(2);
    tick(2000);
    expect(card.currentImageIndex).toBe(3);
    card.onImageTransitionEnd({ propertyName: 'transform' } as TransitionEvent);
    expect(card.currentImageIndex).toBe(0);
    expect(card.imageAnimating).toBeFalse();
    tick(2000);
    expect(card.currentImageIndex).toBe(1);
    card.ngOnDestroy();
  }));

  it('stops on mouse leave and reuses loaded photos on the next hover', fakeAsync(() => {
    const card = createCard();
    card.onMouseEnter();
    card.onImageLoaded(1);
    card.onMouseLeave();
    tick(10000);
    expect(card.currentImageIndex).toBe(0);
    expect(card.imageAnimating).toBeFalse();
    expect(card.imagesActivated).toBeTrue();
    card.onMouseEnter();
    expect(card.currentImageIndex).toBe(1);
    card.ngOnDestroy();
  }));

  it('does not start if a photo finishes loading after the mouse leaves', fakeAsync(() => {
    const card = createCard();
    card.onMouseEnter();
    card.onMouseLeave();
    card.onImageLoaded(1);
    tick(6000);
    expect(card.currentImageIndex).toBe(0);
    card.ngOnDestroy();
  }));

  it('keeps the current photo visible while the next one is still loading', fakeAsync(() => {
    const card = createCard();
    card.onMouseEnter();
    card.onImageLoaded(1);
    tick(2000);
    expect(card.currentImageIndex).toBe(1);
    card.onImageLoaded(2);
    tick(2000);
    expect(card.currentImageIndex).toBe(2);
    card.ngOnDestroy();
  }));

  it('does not start a slideshow for products with only one image', fakeAsync(() => {
    const card = createCard(['first.webp']);
    card.onMouseEnter();
    tick(6000);
    expect(card.imagesActivated).toBeFalse();
    expect(card.imageSlides.length).toBe(1);
    expect(card.currentImageIndex).toBe(0);
    card.ngOnDestroy();
  }));
});
