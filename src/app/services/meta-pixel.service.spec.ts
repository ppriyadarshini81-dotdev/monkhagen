import { TestBed } from '@angular/core/testing';
import { MetaPixelService } from './meta-pixel.service';
import { CartItem } from '../models/cart.model';
import { PaymentOrder, VerifiedPayment } from './payment.service';

describe('Meta Pixel customer events', () => {
  let meta: MetaPixelService;
  let pixel: jasmine.Spy;
  let original: Window['fbq'];
  const items = [{ productId: 'product-1', quantity: 2, price: 1990 }] as CartItem[];
  const order: PaymentOrder = { keyId: 'public-key', localOrderId: 'order-1', orderNumber: 'MH-1',
    razorpayOrderId: 'provider-order', amount: 358200, currency: 'INR' };
  const verified: VerifiedPayment = { localOrderId: 'order-1', orderNumber: 'MH-1', paymentStatus: 'paid', orderStatus: 'confirmed' };

  beforeEach(() => {
    original = window.fbq;
    pixel = jasmine.createSpy('fbq');
    window.fbq = pixel;
    localStorage.removeItem('mh_meta_purchases_v1');
    meta = TestBed.inject(MetaPixelService);
  });
  afterEach(() => {
    window.fbq = original;
    localStorage.removeItem('mh_meta_purchases_v1');
  });

  it('counts a confirmed order once and uses the server amount in rupees, not the cart estimate', () => {
    meta.purchase(order, verified, items);
    meta.purchase(order, verified, items);
    expect(pixel.calls.count()).toBe(1);
    expect(pixel).toHaveBeenCalledWith('trackSingle', '2904268629955209', 'Purchase', jasmine.objectContaining({
      value: 3582, currency: 'INR', content_ids: ['product-1'], num_items: 2,
      contents: [{ id: 'product-1', quantity: 2, item_price: 1990 }]
    }), { eventID: 'purchase:order-1' });
    // Recreating the application must not recount the same verified order.
    TestBed.resetTestingModule();
    TestBed.inject(MetaPixelService).purchase(order, verified, items);
    expect(pixel.calls.count()).toBe(1);
  });

  it('rejects unpaid, mismatched and invalid purchase responses', () => {
    meta.purchase(order, { ...verified, paymentStatus: 'pending' as 'paid' }, items);
    meta.purchase(order, { ...verified, localOrderId: 'other-order' }, items);
    meta.purchase({ ...order, amount: -1 }, verified, items);
    meta.purchase({ ...order, amount: 99.5 }, verified, items);
    expect(pixel).not.toHaveBeenCalled();
  });

  it('does not remember a purchase if the Pixel is unavailable or throws', () => {
    window.fbq = undefined;
    expect(() => meta.purchase(order, verified, items)).not.toThrow();
    window.fbq = () => { throw new Error('provider blocked'); };
    expect(() => meta.purchase(order, verified, items)).not.toThrow();
    window.fbq = pixel;
    meta.purchase(order, verified, items);
    expect(pixel.calls.count()).toBe(1);
  });

  it('survives denied storage and still prevents duplicate purchases in memory', () => {
    spyOn(Storage.prototype, 'getItem').and.throwError('storage blocked');
    spyOn(Storage.prototype, 'setItem').and.throwError('storage blocked');
    expect(() => { meta.purchase(order, verified, items); meta.purchase(order, verified, items); }).not.toThrow();
    expect(pixel.calls.count()).toBe(1);
  });

  it('counts cart additions/removals by the changed quantity and deduplicates checkout openings', () => {
    meta.cartChange(items[0], 1, true);
    meta.cartChange(items[0], 2, false);
    expect(pixel.calls.argsFor(0)).toEqual(['trackSingle', '2904268629955209', 'AddToCart', jasmine.objectContaining({ value: 1990, num_items: 1 })]);
    expect(pixel.calls.argsFor(1)[2]).toBe('RemoveFromCart');
    meta.initiateCheckout(items, 3582, 'attempt-1');
    meta.initiateCheckout(items, 3582, 'attempt-1');
    expect(pixel.calls.allArgs().filter(args => args[2] === 'InitiateCheckout').length).toBe(1);
  });

  it('omits personal data accidentally typed into search', () => {
    meta.search('blue oversized tshirt', 3);
    meta.search('test@example.com', 0);
    meta.search('9876543210', 0);
    expect(pixel.calls.argsFor(0)[3]).toEqual({ search_string: 'blue oversized tshirt', result_count: 3 });
    expect(JSON.stringify(pixel.calls.argsFor(1))).not.toContain('test@example.com');
    expect(JSON.stringify(pixel.calls.argsFor(2))).not.toContain('9876543210');
  });

  it('captures named actions and contact links without text, URLs or form values', () => {
    const container = document.createElement('div');
    container.innerHTML = '<button data-meta-action="submitReturn"><span>Private customer name</span></button>' +
      '<a href="mailto:private@example.com">Private email</a><input value="private form value">';
    document.body.append(container);
    try {
      container.querySelector('span')!.click();
      const link = container.querySelector('a')!;
      link.addEventListener('click', event => event.preventDefault());
      link.click();
      container.querySelector('input')!.dispatchEvent(new Event('change', { bubbles: true }));
      const output = JSON.stringify(pixel.calls.allArgs());
      expect(output).toContain('submitReturn');
      expect(output).toContain('Contact');
      expect(output).not.toContain('Private');
      expect(output).not.toContain('private@');
      expect(output).not.toContain('private form value');
      expect(pixel.calls.count()).toBe(3);
    } finally { container.remove(); }
  });

  it('does not emit a second PageView or track staff actions', () => {
    expect(pixel).not.toHaveBeenCalled();
    const before = location.pathname + location.search + location.hash;
    try {
      history.replaceState({}, '', '/admin/orders');
      meta.custom('UIInteraction', { action: 'approveReturn' });
      meta.purchase(order, verified, items);
      expect(pixel).not.toHaveBeenCalled();
    } finally { history.replaceState({}, '', before); }
  });
});
