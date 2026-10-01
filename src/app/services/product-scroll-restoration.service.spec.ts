import { fakeAsync, tick } from '@angular/core/testing';
import { NavigationStart, Router } from '@angular/router';
import { Subject } from 'rxjs';
import { ProductScrollRestorationService } from './product-scroll-restoration.service';

describe('ProductScrollRestorationService', () => {
  const storageKey = 'mh-product-scroll-return';

  afterEach(() => {
    sessionStorage.removeItem(storageKey);
    document.querySelectorAll('[data-scroll-product-id]').forEach(element => element.remove());
  });

  it('returns the clicked product card to the same viewport position on browser Back', fakeAsync(() => {
    const events = new Subject<NavigationStart>();
    const router = { url: '/', events: events.asObservable() } as unknown as Router;
    const service = new ProductScrollRestorationService(router);
    const card = document.createElement('a');
    card.dataset['scrollProductId'] = 'product-1';
    document.body.appendChild(card);
    let cardTop = 240;
    spyOn(card, 'getBoundingClientRect').and.callFake(() => ({ top: cardTop } as DOMRect));
    const scroll = spyOn(window, 'scrollTo');
    const originalScrollY = window.scrollY;

    service.remember('product-1', card);
    cardTop = 610;
    events.next(new NavigationStart(2, '/', 'popstate', { navigationId: 1 }));
    service.restoreAfterProductsRender();
    tick(20);

    expect(scroll).toHaveBeenCalled();
    expect(scroll.calls.mostRecent().args[0] as ScrollToOptions)
      .toEqual({ top: originalScrollY + 370, left: 0, behavior: 'auto' });
    expect(sessionStorage.getItem(storageKey)).toBeNull();
  }));

  it('does not restore a saved card during normal link navigation', fakeAsync(() => {
    const events = new Subject<NavigationStart>();
    const router = { url: '/', events: events.asObservable() } as unknown as Router;
    const service = new ProductScrollRestorationService(router);
    const card = document.createElement('a');
    card.dataset['scrollProductId'] = 'product-1';
    document.body.appendChild(card);
    spyOn(card, 'getBoundingClientRect').and.returnValue({ top: 240 } as DOMRect);
    const scroll = spyOn(window, 'scrollTo');

    service.remember('product-1', card);
    events.next(new NavigationStart(2, '/', 'imperative', null));
    service.restoreAfterProductsRender();
    tick(20);

    expect(scroll).not.toHaveBeenCalled();
  }));
});
