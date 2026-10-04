import { NavigationStart } from '@angular/router';
import { BehaviorSubject, Subject } from 'rxjs';
import { HeaderComponent } from './header.component';

describe('HeaderComponent responsive navigation', () => {
  let user$: BehaviorSubject<any>;
  let routerEvents: Subject<unknown>;
  let cartOpen$: BehaviorSubject<boolean>;
  let cart: any;
  let auth: any;
  let router: any;
  let component: HeaderComponent;

  beforeEach(() => {
    document.body.classList.remove('mh-scroll-locked');
    sessionStorage.clear();
    user$ = new BehaviorSubject<any>(null);
    routerEvents = new Subject();
    cartOpen$ = new BehaviorSubject(false);
    cart = { previewOpen$: cartOpen$.asObservable(), closePreview: jasmine.createSpy('closePreview'), count: 0 };
    auth = { user$: user$.asObservable(), isAdmin: false, logout: jasmine.createSpy('logout') };
    router = { events: routerEvents.asObservable(), navigate: jasmine.createSpy('navigate') };
    component = new HeaderComponent(cart, auth, router);
  });

  afterEach(() => component.ngOnDestroy());

  it('opens the mobile menu, closes cart, and locks background scrolling', () => {
    component.toggleMenu();
    expect(component.menuOpen).toBeTrue();
    expect(cart.closePreview).toHaveBeenCalled();
    expect(document.body.classList.contains('mh-scroll-locked')).toBeTrue();
  });

  it('closes from the backdrop action and restores scroll', () => {
    component.toggleMenu();
    component.closeMenu();
    expect(component.menuOpen).toBeFalse();
    expect(document.body.classList.contains('mh-scroll-locked')).toBeFalse();
  });

  it('closes with Escape and on route navigation', () => {
    component.toggleMenu();
    component.closeMenuOnEscape();
    expect(component.menuOpen).toBeFalse();
    component.toggleMenu();
    routerEvents.next(new NavigationStart(1, '/products'));
    expect(component.menuOpen).toBeFalse();
  });

  it('closes the menu when the cart preview opens', () => {
    component.toggleMenu();
    cartOpen$.next(true);
    expect(component.menuOpen).toBeFalse();
  });

  it('closes the mobile menu when the customer starts scrolling', () => {
    component.toggleMenu();
    component.closeMenuOnPageMotion();
    expect(component.menuOpen).toBeFalse();
    expect(document.body.classList.contains('mh-scroll-locked')).toBeFalse();
  });

  it('supports both logged-out and logged-in account state', () => {
    expect(component.user$).toBeDefined();
    user$.next({ name: 'Priyanka', role: 'customer' });
    let current: any;
    component.user$.subscribe(user => current = user).unsubscribe();
    expect(current.name).toBe('Priyanka');
  });
});
