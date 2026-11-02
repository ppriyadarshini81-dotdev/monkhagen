import { HttpClient, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { metaPixelInterceptor } from './meta-pixel.interceptor';
import { MetaPixelService } from './meta-pixel.service';

describe('Meta Pixel confirmed customer actions', () => {
  let http: HttpClient;
  let backend: HttpTestingController;
  let meta: jasmine.SpyObj<MetaPixelService>;
  beforeEach(() => {
    meta = jasmine.createSpyObj('MetaPixelService', ['standard', 'custom']);
    TestBed.configureTestingModule({ providers: [
      provideHttpClient(withInterceptors([metaPixelInterceptor])), provideHttpClientTesting(),
      { provide: MetaPixelService, useValue: meta }
    ] });
    http = TestBed.inject(HttpClient);
    backend = TestBed.inject(HttpTestingController);
  });
  afterEach(() => backend.verify());

  it('reports successful contact submissions, never attempts or failed requests', () => {
    http.post('/api/contact', { email: 'private@example.com', query: 'private message' }).subscribe({ error: () => {} });
    expect(meta.standard).not.toHaveBeenCalled();
    backend.expectOne('/api/contact').flush({}, { status: 500, statusText: 'Unavailable' });
    expect(meta.standard).not.toHaveBeenCalled();
    http.post('/api/contact', { email: 'private@example.com', query: 'private message' }).subscribe();
    backend.expectOne('/api/contact').flush({ message: 'Sent' });
    expect(meta.standard).toHaveBeenCalledOnceWith('Contact', { contact_channel: 'form' });
  });

  it('distinguishes existing login, new registration and staff accounts without sending identities', () => {
    const login = (body: Record<string, unknown>) => {
      http.post('/api/auth/firebase', { idToken: 'private-token' }).subscribe();
      backend.expectOne('/api/auth/firebase').flush(body);
    };
    login({ user: { role: 'customer', email: 'private@example.com' }, isNewUser: false });
    expect(meta.custom).toHaveBeenCalledOnceWith('Login', { method: 'firebase' });
    expect(meta.standard).not.toHaveBeenCalled();
    login({ user: { role: 'customer' }, isNewUser: true });
    expect(meta.standard).toHaveBeenCalledOnceWith('CompleteRegistration', { registration_method: 'firebase', status: true });
    meta.custom.calls.reset(); meta.standard.calls.reset();
    login({ user: { role: 'admin' }, isNewUser: true });
    expect(meta.custom).not.toHaveBeenCalled();
    expect(meta.standard).not.toHaveBeenCalled();
  });

  it('reports account and after-sales successes without addresses, return reasons or bank details', () => {
    const operations = [
      ['PUT', '/api/account/profile', 'ProfileUpdated'],
      ['POST', '/api/account/addresses', 'AddressAdded'],
      ['PUT', '/api/account/addresses/address-1', 'AddressUpdated'],
      ['DELETE', '/api/account/addresses/address-1', 'AddressDeleted'],
      ['PATCH', '/api/account/addresses/address-1/default', 'DefaultAddressSelected'],
      ['POST', '/api/account/returns', 'ReturnRequested'],
      ['POST', '/api/account/returns/return-1/cancel', 'ReturnCancelled'],
      ['PUT', '/api/account/returns/return-1/refund-destination', 'RefundDestinationUpdated'],
      ['POST', '/api/account/orders/order-1/cancel', 'OrderCancelled'],
      ['POST', '/api/products/product-1/reviews', 'ReviewSubmitted'],
      ['PATCH', '/api/products/product-1/reviews/review-1', 'ReviewUpdated']
    ];
    for (const [method, url, event] of operations) {
      meta.custom.calls.reset();
      http.request(method, url, { body: { private: 'must never be forwarded' } }).subscribe();
      backend.expectOne(url).flush({ private: 'response details' });
      expect(meta.custom).toHaveBeenCalledOnceWith(event);
    }
  });

  it('does not turn analytics calls, admin mutations, payment attempts, or external requests into conversions', () => {
    for (const url of ['/api/analytics/events', '/api/admin/returns/return-1/approve',
      '/api/payments/create-order', '/api/payments/verify', 'https://other.example/api/contact']) {
      http.post(url, {}).subscribe(); backend.expectOne(url).flush({});
    }
    expect(meta.custom).not.toHaveBeenCalled();
    expect(meta.standard).not.toHaveBeenCalled();
  });

  it('records newsletter conversion only after successful subscription', () => {
    http.post('/api/newsletter', { email: 'private@example.com' }).subscribe();
    backend.expectOne('/api/newsletter').flush({ message: 'Subscribed' });
    expect(meta.standard).toHaveBeenCalledOnceWith('Lead', { content_name: 'Newsletter' });
    expect(meta.custom).toHaveBeenCalledOnceWith('NewsletterSubscribe');
  });
});
