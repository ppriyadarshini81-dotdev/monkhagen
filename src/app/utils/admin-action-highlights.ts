import { AdminReturn, Order } from '../services/order.service';

function indiaDay(date: Date): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date);
  const part = (type: string) => parts.find(item => item.type === type)!.value;
  return `${part('year')}-${part('month')}-${part('day')}`;
}

export function newRequestWindow(now = new Date(Date.now())): { from: string; to: string } {
  const from = indiaDay(now);
  const tomorrow = new Date(`${from}T00:00:00Z`);
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
  return { from, to: tomorrow.toISOString().slice(0, 10) };
}

function isNew(date: string | undefined, now: Date): boolean {
  if (!date || !Number.isFinite(Date.parse(date))) return false;
  const day = indiaDay(new Date(date));
  const window = newRequestWindow(now);
  return day >= window.from && day <= window.to;
}

export function newOrderNeedsAction(order: Order, now = new Date(Date.now())): boolean {
  if (!isNew(order.createdAt, now)) return false;
  if (['shipped', 'delivered', 'cancelled', 'returned', 'return_requested'].includes(order.status)) return false;
  const labels = [order.shipment?.shippingStatus, order.shipment?.trackingStatus].map(value => String(value || '').toLowerCase().replace(/[_-]+/g, ' '));
  if (labels.some(value => ['shipped', 'delivered', 'shipment delivered', 'in transit', 'picked up', 'out for delivery', 'cancelled'].includes(value))) return false;
  if (order.paymentStatus !== 'paid' && !(order.paymentMethod === 'cod' && order.paymentStatus === 'pending')) return false;
  return !!order.fulfillmentHoldReason || !!order.shipment?.lastErrorCode || !order.shipment?.awbCode || order.shipment?.pickupStatus !== 'scheduled';
}

export function newReturnNeedsAction(request: AdminReturn, now = new Date(Date.now())): boolean {
  if (!isNew(request.requestedAt, now) || ['cancelled', 'rejected', 'refunded'].includes(request.status)) return false;
  if (request.pickupDelayed || request.defectPhotoReviewPending || request.replacementShipmentPending) return true;
  if (request.status === 'approved') return ['pending', 'manual_required', 'failed'].includes(request.refundStatus);
  return ['requested', 'return_created', 'shiprocket_failed', 'pickup_failed', 'received', 'manual_required'].includes(request.status);
}
