import { TestBed } from '@angular/core/testing';
import { of, Subject } from 'rxjs';
import { CartComponent } from './cart.component';
import { CartItem } from '../../models/cart.model';
import { MetaPixelService } from '../../services/meta-pixel.service';
import { PaymentOrder, PaymentService, RazorpaySuccess, VerifiedPayment } from '../../services/payment.service';

describe('Checkout Meta tracking', () => {
  let component: CartComponent;
  let payments: jasmine.SpyObj<PaymentService>;
  let pixel: jasmine.Spy;
  let previous: Window['fbq'];
  let cart: { items: CartItem[]; reset: jasmine.Spy };
  let verification: Subject<VerifiedPayment>;
  const order: PaymentOrder = { keyId: 'public-key', razorpayOrderId: 'rzp-order', amount: 179100,
    currency: 'INR', localOrderId: 'checkout-order', orderNumber: 'MH-1' };
  const result: RazorpaySuccess = { razorpay_payment_id: 'payment', razorpay_order_id: 'rzp-order', razorpay_signature: 'signature' };

  beforeEach(() => {
    previous = window.fbq; pixel = jasmine.createSpy('fbq'); window.fbq = pixel;
    localStorage.removeItem('mh_meta_purchases_v1');
    verification = new Subject<VerifiedPayment>();
    payments = jasmine.createSpyObj('PaymentService', ['openCheckout', 'verify']);
    payments.openCheckout.and.resolveTo(result);
    payments.verify.and.returnValue(verification);
    cart = { items: [{ productId: 'product-1', quantity: 1, price: 1990 } as CartItem], reset: jasmine.createSpy('reset') };
    component = new CartComponent(cart as never, {} as never, {} as never, payments,
      { track: () => {} } as never, {} as never, {} as never, {} as never, TestBed.inject(MetaPixelService));
    component.addressDialog = { nativeElement: { close: () => {}, open: false } } as never;
  });
  afterEach(() => { window.fbq = previous; localStorage.removeItem('mh_meta_purchases_v1'); });
  const names = (spy: jasmine.Spy): string[] => spy.calls.allArgs().map(args => args[2]);

  it('emits Purchase only after backend verification and keeps the pre-payment product snapshot', async () => {
    await component['openRazorpay'](order);
    expect(names(pixel)).toContain('PaymentStarted');
    expect(names(pixel)).toContain('AddPaymentInfo');
    expect(names(pixel)).not.toContain('Purchase');
    cart.items = [];
    verification.next({ localOrderId: order.localOrderId, orderNumber: order.orderNumber,
      paymentStatus: 'paid', orderStatus: 'confirmed' });
    const purchase = pixel.calls.allArgs().find(args => args[2] === 'Purchase')!;
    expect(purchase[3]).toEqual(jasmine.objectContaining({ value: 1791, content_ids: ['product-1'] }));
    expect(cart.reset).toHaveBeenCalled();
  });

  it('does not report cancelled or failed provider interactions as purchases or added payment info', async () => {
    payments.openCheckout.and.rejectWith(new Error('Payment window was closed.'));
    await component['openRazorpay'](order);
    expect(names(pixel)).toContain('PaymentCancelled');
    expect(names(pixel)).not.toContain('AddPaymentInfo');
    expect(names(pixel)).not.toContain('Purchase');
    expect(payments.verify).not.toHaveBeenCalled();
    expect(cart.reset).not.toHaveBeenCalled();
  });

  it('reports failed verification without clearing the cart or reporting revenue', async () => {
    await component['openRazorpay'](order);
    verification.error({ error: { message: 'Verification unavailable' } });
    expect(names(pixel)).toContain('PaymentFailed');
    expect(names(pixel)).not.toContain('Purchase');
    expect(cart.reset).not.toHaveBeenCalled();
  });
});
