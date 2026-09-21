import { Routes } from '@angular/router';
import { adminGuard, customerGuard } from './guards';

export const routes: Routes = [
  {
    path: '',
    loadComponent: () =>
      import('./pages/home/home.component').then((m) => m.HomeComponent),
    title: 'Monk Hagen — Luxurywear'
  },
  {
    path: 'products',
    loadComponent: () =>
      import('./pages/products/products.component').then(
        (m) => m.ProductsComponent
      ),
    title: 'Products — Monk Hagen'
  },
  {
    path: 'product/:slug',
    loadComponent: () =>
      import('./pages/product-details/product-details.component').then(
        (m) => m.ProductDetailsComponent
      ),
    title: 'Product — Monk Hagen'
  },
  {
    path: 'cart',
    loadComponent: () =>
      import('./pages/cart/cart.component').then((m) => m.CartComponent),
    title: 'Cart — Monk Hagen'
  },
  {
    path: 'login',
    loadComponent: () =>
      import('./pages/login/login.component').then((m) => m.LoginComponent),
    title: 'Login — Monk Hagen'
  },
  {
    path: 'dashboard',
    canActivate: [adminGuard],
    loadComponent: () =>
      import('./pages/admin-analytics/admin-analytics.component').then((m) => m.AdminAnalyticsComponent),
    title: 'Dashboard — Monk Hagen'
  },
  {
    path: 'admin/analytics',
    redirectTo: 'dashboard',
    pathMatch: 'full'
  },
  {
    path: 'admin',
    canActivate: [adminGuard],
    loadComponent: () =>
      import('./pages/admin/admin.component').then((m) => m.AdminComponent),
    title: 'Admin — Monk Hagen'
  },
  {
    path: 'about',
    loadComponent: () =>
      import('./pages/about/about.component').then((m) => m.AboutComponent),
    title: 'About — Monk Hagen'
  },
  {
    path: 'contact/email',
    loadComponent: () =>
      import('./pages/contact-email/contact-email.component').then((m) => m.ContactEmailComponent),
    title: 'Email Us â€” Monk Hagen'
  },
  {
    path: 'contact',
    loadComponent: () =>
      import('./pages/contact/contact.component').then((m) => m.ContactComponent),
    title: 'Contact — Monk Hagen'
  },
  {
    path: 'refund-policy',
    loadComponent: () =>
      import('./pages/refund-policy/refund-policy.component').then((m) => m.RefundPolicyComponent),
    title: 'Refund & Return Policy — Monk Hagen'
  },
  {
    path: 'account',
    canActivate: [customerGuard],
    loadComponent: () =>
      import('./pages/account/account.component').then((m) => m.AccountComponent),
    children: [
      { path: '', redirectTo: 'profile', pathMatch: 'full' },
      { path: 'profile',   loadComponent: () => import('./pages/account/profile/profile.component').then((m) => m.AccountProfileComponent) },
      { path: 'addresses', loadComponent: () => import('./pages/account/addresses/addresses.component').then((m) => m.AccountAddressesComponent) },
      { path: 'orders',    loadComponent: () => import('./pages/account/orders/orders.component').then((m) => m.AccountOrdersComponent) },
      { path: 'returns',   loadComponent: () => import('./pages/account/returns/returns.component').then((m) => m.AccountReturnsComponent) },
      { path: 'credits',   loadComponent: () => import('./pages/account/credits/credits.component').then((m) => m.AccountCreditsComponent) },
    ],
    title: 'My Account — Monk Hagen'
  },
  { path: '**', redirectTo: '' }
];
