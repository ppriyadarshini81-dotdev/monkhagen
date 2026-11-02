import { HttpInterceptorFn, HttpResponse } from '@angular/common/http';
import { inject } from '@angular/core';
import { tap } from 'rxjs';
import { MetaPixelService } from './meta-pixel.service';

// Observe confirmed customer operations. Never inspect request bodies or forward API responses.
export const metaPixelInterceptor: HttpInterceptorFn = (request, next) => {
  const meta = inject(MetaPixelService);
  const path = request.url.split(/[?#]/, 1)[0];
  if (!path.startsWith('/api/') || !['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method)) return next(request);
  return next(request).pipe(tap(event => {
    if (!(event instanceof HttpResponse) || !event.ok) return;
    const method = request.method;
    if (method === 'POST' && /^\/api\/auth\/(firebase|google|otp\/verify)$/.test(path)) {
      // The backend distinguishes new accounts; ordinary sign-in is not registration.
      const response = event.body as { isNewUser?: boolean; user?: { role?: string } } | null;
      if (response?.user?.role !== 'customer') return;
      const channel = path.endsWith('/otp/verify') ? 'otp' : 'firebase';
      meta.custom('Login', { method: channel });
      if (response.isNewUser === true) meta.standard('CompleteRegistration', { registration_method: channel, status: true });
      return;
    }
    if (method === 'POST' && path === '/api/contact') {
      meta.standard('Contact', { contact_channel: 'form' });
      return;
    }
    if (method === 'POST' && path === '/api/newsletter') {
      meta.standard('Lead', { content_name: 'Newsletter' });
      meta.custom('NewsletterSubscribe');
      return;
    }
    const exact: Record<string, string> = {
      'POST /api/auth/logout': 'Logout', 'POST /api/auth/otp/send': 'OTPRequested',
      'POST /api/auth/email-otp/send': 'EmailOTPRequested', 'POST /api/auth/email-otp/verify': 'EmailVerified',
      'POST /api/auth/link-google': 'AccountLinked', 'POST /api/newsletter/unsubscribe': 'NewsletterUnsubscribe',
      'PUT /api/account/profile': 'ProfileUpdated', 'POST /api/account/addresses': 'AddressAdded',
      'POST /api/account/returns': 'ReturnRequested'
    };
    const name = exact[`${method} ${path}`];
    if (name) { meta.custom(name); return; }
    if (/^\/api\/account\/addresses\/[^/]+$/.test(path)) {
      if (method === 'PUT') meta.custom('AddressUpdated');
      if (method === 'DELETE') meta.custom('AddressDeleted');
    } else if (method === 'PATCH' && /^\/api\/account\/addresses\/[^/]+\/default$/.test(path)) {
      meta.custom('DefaultAddressSelected');
    } else if (method === 'POST' && /^\/api\/account\/orders\/[^/]+\/cancel$/.test(path)) {
      meta.custom('OrderCancelled');
    } else if (method === 'POST' && /^\/api\/account\/returns\/[^/]+\/cancel$/.test(path)) {
      meta.custom('ReturnCancelled');
    } else if (method === 'PUT' && /^\/api\/account\/returns\/[^/]+\/refund-destination$/.test(path)) {
      meta.custom('RefundDestinationUpdated');
    } else if (method === 'POST' && /^\/api\/account\/orders\/[^/]+\/items\/[^/]+\/defect-photos$/.test(path)) {
      meta.custom('DefectPhotosSubmitted');
    } else if (/^\/api\/products\/[^/]+\/reviews(?:\/[^/]+)?$/.test(path)) {
      if (method === 'POST') meta.custom('ReviewSubmitted');
      if (method === 'PATCH') meta.custom('ReviewUpdated');
    } else if (/^\/api\/products\/[^/]+\/reviews\/[^/]+\/helpful$/.test(path)) {
      meta.custom('ReviewHelpful', { selected: method === 'POST' });
    }
  }));
};
