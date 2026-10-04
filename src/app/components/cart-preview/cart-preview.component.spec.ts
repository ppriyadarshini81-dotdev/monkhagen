import { NavigationStart } from '@angular/router';
import { fakeAsync, flushMicrotasks } from '@angular/core/testing';
import { BehaviorSubject, of, Subject } from 'rxjs';
import { CartPreviewComponent } from './cart-preview.component';

describe('CartPreviewComponent overlay lifecycle', () => {
  let open$: BehaviorSubject<boolean>;
  let events: Subject<unknown>;
  let cart: any;
  let component: CartPreviewComponent;

  beforeEach(() => {
    document.body.classList.remove('mh-scroll-locked');
    open$ = new BehaviorSubject(false);
    events = new Subject();
    cart = {
      previewOpen$: open$.asObservable(),
      closePreview: jasmine.createSpy('closePreview').and.callFake(() => open$.next(false)),
      remove: jasmine.createSpy('remove').and.returnValue(of({})),
      updateQuantity: jasmine.createSpy('updateQuantity').and.returnValue(of({})),
      items: [{ id: 'line-1' }], count: 1, total: 10,
      prepaidOffer: { eligible: false, discountAmount: 0 }
    };
    component = new CartPreviewComponent(cart, { events: events.asObservable() } as any);
  });

  afterEach(() => component.ngOnDestroy());

  it('locks only while open and closes from backdrop', () => {
    open$.next(true);
    expect(document.body.classList.contains('mh-scroll-locked')).toBeTrue();
    component.closeOnBackdrop({ target: 1, currentTarget: 1 } as any);
    expect(cart.closePreview).toHaveBeenCalled();
    expect(document.body.classList.contains('mh-scroll-locked')).toBeFalse();
  });

  it('closes with Escape and route navigation without leaving a stale lock', () => {
    open$.next(true);
    component.escape();
    expect(document.body.classList.contains('mh-scroll-locked')).toBeFalse();
    open$.next(true);
    events.next(new NavigationStart(1, '/cart'));
    expect(cart.closePreview).toHaveBeenCalledTimes(2);
    expect(document.body.classList.contains('mh-scroll-locked')).toBeFalse();
  });

  it('removes a quantity-one item instead of disabling decrease', () => {
    const item = { id: 'line-1', quantity: 1, stock: 3 } as any;
    component.decreaseOrRemove(item);
    expect(cart.remove).toHaveBeenCalledWith('line-1');
  });

  it('updates quantity immediately for available stock', () => {
    const item = { id: 'line-1', quantity: 2, stock: 3 } as any;
    component.changeQuantity(item, 1);
    expect(cart.updateQuantity).toHaveBeenCalledWith('line-1', 3);
  });

  it('closes immediately instead of showing an empty drawer', fakeAsync(() => {
    cart.items = [];
    open$.next(true);
    flushMicrotasks();
    expect(cart.closePreview).toHaveBeenCalled();
    expect(document.body.classList.contains('mh-scroll-locked')).toBeFalse();
  }));
});
