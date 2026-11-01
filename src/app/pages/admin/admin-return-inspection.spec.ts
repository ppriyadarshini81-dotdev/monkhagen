import { Subject } from 'rxjs';
import { AdminReturn, OrderService } from '../../services/order.service';
import { AdminComponent } from './admin.component';

describe('Admin return inspection', () => {
  const request = { id: 'return-1', requestType: 'return', status: 'return_created', refundAmount: 1349,
    returnShippingDeduction: 150, items: [{ id: 'item-1', productName: 'Tee', inspectionStatus: 'pending' }] } as AdminReturn;
  function component(orderService: OrderService): AdminComponent {
    return new AdminComponent({} as never, {} as never, {} as never, {} as never, orderService,
      {} as never, {} as never, {} as never, {} as never);
  }

  it('keeps the scheduled milestone during a pickup exception and tells admins how to follow up', () => {
    const instance = component({} as OrderService);
    const delayed = { ...request, status:'pickup_failed', pickupStatus:'RETURN PICKUP EXCEPTION' };
    expect(instance.itemTrackingStage(delayed,delayed.items[0])).toBe(1);
    expect(instance.requestStatusLabel(delayed)).toBe('Pickup reschedule pending');
    expect(instance.itemJourneyTitle(delayed,delayed.items[0])).toBe('Pickup reschedule pending');
    expect(instance.pickupExceptionMessage(delayed)).toContain('Confirm or reschedule the next pickup with Shiprocket');
    expect(instance.canInspectReplacementItem(delayed,delayed.items[0])).toBeFalse();
    expect(delayed.status).toBe('pickup_failed');
    const recovered = { ...delayed, status:'picked_up' };
    expect(instance.itemTrackingStage(recovered,recovered.items[0])).toBe(2);
    expect(instance.pickupExceptionMessage(recovered)).toBe('');
  });

  it('enables return inspection only after receipt and submits each decision with its reason', () => {
    const orders = jasmine.createSpyObj<OrderService>('OrderService', ['submitReplacementInspection']);
    orders.submitReplacementInspection.and.returnValue(new Subject());
    const instance = component(orders); instance.openReturnDetails(request);
    expect(instance.canInspectReplacementItem(request, request.items[0])).toBeFalse();
    const received = { ...request, status: 'received' };
    expect(instance.canInspectReplacementItem(received, request.items[0])).toBeTrue();
    expect(instance.canSubmitInspection(received)).toBeFalse();
    instance.inspectionDrafts['item-1'] = { decision: 'approved', reason: 'Passed warehouse inspection' };
    expect(instance.canSubmitInspection(received)).toBeTrue();
    instance.submitInspection(received);
    expect(orders.submitReplacementInspection).toHaveBeenCalledOnceWith('return-1', [
      { itemId: 'item-1', decision: 'approved', reason: 'Passed warehouse inspection' }
    ]);
  });

  it('tracks rejected returns through outbound delivery and keeps approved items on refund tracking', () => {
    const instance = component({} as OrderService);
    const outbound = { ...request, status: 'refund_initiated', shiprocketOutboundOrderId: 12, outboundStage: 3 };
    const rejected = { ...request.items[0], inspectionStatus: 'rejected' as const, inspectionReason: 'Used item' };
    const approved = { ...request.items[0], inspectionStatus: 'approved' as const };
    expect(instance.itemTrackingStage(outbound, rejected)).toBe(8);
    expect(instance.itemTrackingOutcome(outbound, rejected)).toBe('Original item return');
    expect(instance.itemJourneyTitle(outbound, rejected)).toBe('Return rejected');
    expect(instance.itemJourneyDetail(outbound, rejected)).toContain('Used item');
    expect(instance.itemTrackingStage(outbound, approved)).toBe(5);
    expect(instance.itemTrackingOutcome(outbound, approved)).toBe('Refund');
  });

  it('requires a rejection reason for photos and passes the review decision to the authenticated API', () => {
    const orders = jasmine.createSpyObj<OrderService>('OrderService', ['reviewDefectPhotos']);
    orders.reviewDefectPhotos.and.returnValue(new Subject());
    const instance = component(orders);
    const pending = { ...request, requestType: 'defect' as const, status: 'requested', defectPhotoReviewPending: true };
    expect(instance.requestStatusLabel(pending)).toBe('Awaiting photo review');
    instance.reviewDefectPhotos(pending, 'rejected'); expect(orders.reviewDefectPhotos).not.toHaveBeenCalled();
    instance.photoReviewReason = 'Needs physical inspection'; instance.reviewDefectPhotos(pending, 'rejected');
    expect(orders.reviewDefectPhotos).toHaveBeenCalledOnceWith('return-1','rejected','Needs physical inspection');
  });
});
