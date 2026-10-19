import { newOrderNeedsAction, newRequestWindow, newReturnNeedsAction } from './admin-action-highlights';
import { AdminReturn, Order } from '../services/order.service';

describe('New admin requests in India time', () => {
  const now = new Date('2026-10-19T08:00:00Z');
  const order = { createdAt: '2026-10-19T01:00:00Z', status: 'confirmed', paymentStatus: 'paid', paymentMethod: 'razorpay' } as Order;
  const request = { requestedAt: '2026-10-19T01:00:00Z', status: 'requested' } as AdminReturn;
  it('uses today and tomorrow across India midnight, month and year boundaries', () => {
    expect(newRequestWindow(new Date('2026-10-19T18:29:59Z'))).toEqual({ from:'2026-10-19',to:'2026-10-20' });
    expect(newRequestWindow(new Date('2026-10-19T18:30:00Z'))).toEqual({ from:'2026-10-20',to:'2026-10-21' });
    expect(newRequestWindow(new Date('2026-12-31T10:00:00Z'))).toEqual({ from:'2026-12-31',to:'2027-01-01' });
  });
  it('highlights new unfulfilled paid and COD orders but excludes old, unpaid and completed records', () => {
    expect(newOrderNeedsAction(order,now)).toBeTrue();
    expect(newOrderNeedsAction({...order,createdAt:'2026-10-20T12:00:00Z'},now)).toBeTrue();
    expect(newOrderNeedsAction({...order,paymentMethod:'cod',paymentStatus:'pending'},now)).toBeTrue();
    expect(newOrderNeedsAction({...order,paymentStatus:'pending'},now)).toBeFalse();
    for (const status of ['shipped','delivered','cancelled','returned']) expect(newOrderNeedsAction({...order,status},now)).toBeFalse();
    expect(newOrderNeedsAction({...order,createdAt:'2026-10-18T10:00:00Z'},now)).toBeFalse();
    expect(newOrderNeedsAction({...order,createdAt:'2026-10-21T10:00:00Z'},now)).toBeFalse();
    expect(newOrderNeedsAction({...order,shipment:{awbCode:'AWB',pickupStatus:'scheduled'} as any},now)).toBeFalse();
    expect(newOrderNeedsAction({...order,shipment:{trackingStatus:'DELIVERED'} as any},now)).toBeFalse();
  });
  it('highlights return initiation and inspection work while excluding closed and courier-handled requests', () => {
    expect(newReturnNeedsAction(request,now)).toBeTrue();
    expect(newReturnNeedsAction({...request,status:'received'},now)).toBeTrue();
    expect(newReturnNeedsAction({...request,status:'approved',refundStatus:'manual_required'},now)).toBeTrue();
    for (const status of ['cancelled','rejected','refunded','pickup_scheduled','picked_up','in_transit','refund_initiated']) {
      expect(newReturnNeedsAction({...request,status},now)).toBeFalse();
    }
    expect(newReturnNeedsAction({...request,requestedAt:'2026-10-18T10:00:00Z'},now)).toBeFalse();
  });
});
