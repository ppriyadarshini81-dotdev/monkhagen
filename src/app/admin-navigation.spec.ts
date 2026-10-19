import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { routes } from './app.routes';
import { AuthService } from './services/auth.service';

@Component({ standalone: true, template: '<p>Page content</p>' })
class PageStub {}

describe('Admin navigation', () => {
  const auth = { isLoggedIn: true, isAdmin: true };

  beforeEach(async () => {
    auth.isLoggedIn = true;
    auth.isAdmin = true;
    const navigationRoutes = routes.filter(route => ['dashboard', 'admin/analytics', 'admin', 'login'].includes(route.path || '')).map(route => {
      if (route.path === 'admin') return {
        ...route,
        children: route.children?.map(child => child.loadComponent ? { ...child, loadComponent: async () => PageStub } : child)
      };
      return route.loadComponent ? { ...route, loadComponent: async () => PageStub } : route;
    });
    await TestBed.configureTestingModule({ providers: [
      provideRouter(navigationRoutes), { provide: AuthService, useValue: auth }
    ] }).compileComponents();
  });

  it('opens dashboard separately and redirects legacy analytics links', async () => {
    const harness = await RouterTestingHarness.create();
    for (const url of ['/dashboard', '/admin/dashboard', '/admin/analytics']) {
      await harness.navigateByUrl(url);
      expect(TestBed.inject(Router).url).toBe('/dashboard');
      expect(harness.routeNativeElement?.querySelector('.admin-portal__nav')).toBeNull();
    }
  });

  it('opens orders in the admin shell without a dashboard management tab', async () => {
    const harness = await RouterTestingHarness.create('/admin');
    expect(TestBed.inject(Router).url).toBe('/admin/orders');
    const links = Array.from(harness.routeNativeElement!.querySelectorAll<HTMLAnchorElement>('.admin-portal__primary a'));
    expect(links.length).toBe(6);
    expect(links.some(link => link.textContent?.includes('Dashboard'))).toBeFalse();
    expect(links.find(link => link.textContent?.includes('Orders'))?.classList.contains('active')).toBeTrue();
  });

  it('keeps standalone dashboard and admin pages restricted to admins', async () => {
    auth.isAdmin = false;
    const harness = await RouterTestingHarness.create();
    for (const url of ['/dashboard', '/admin/orders']) {
      await harness.navigateByUrl(url);
      expect(TestBed.inject(Router).url).toBe('/login');
    }
  });
});
