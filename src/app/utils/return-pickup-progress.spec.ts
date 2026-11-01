import { returnMilestoneStage, returnPickupExceptionMessage } from './return-pickup-progress';

describe('Return pickup exception presentation', () => {
  it('keeps Scheduled complete during an exception and continues after a retry succeeds', () => {
    expect(['requested','return_created','pickup_scheduled','pickup_failed','pickup_scheduled','picked_up','in_transit','received','refunded']
      .map(returnMilestoneStage)).toEqual([0,0,1,1,1,2,3,4,5]);
  });

  it('explains a pickup exception without promising an automatic retry or a pickup date', () => {
    const request = { status: 'pickup_failed', pickupStatus: 'RETURN PICKUP EXCEPTION' };
    expect(returnPickupExceptionMessage(request)).toContain('Your return is still active');
    expect(returnPickupExceptionMessage(request)).toContain('awaiting courier confirmation');
    expect(returnPickupExceptionMessage(request)).toContain('no need to create another return request');
    expect(returnPickupExceptionMessage(request,'admin')).toContain('Confirm or reschedule');
    expect(request.status).toBe('pickup_failed');
  });

  it('removes the notice after recovery and does not suggest rescheduling lost or damaged shipments', () => {
    for (const pickupStatus of ['LOST','DAMAGED','RETURN UNDELIVERED']) {
      expect(returnPickupExceptionMessage({status:'pickup_failed',pickupStatus})).toBe('');
    }
    for (const status of ['pickup_scheduled','picked_up','in_transit','cancelled','refunded']) {
      expect(returnPickupExceptionMessage({status,pickupStatus:'RETURN PICKUP EXCEPTION'})).toBe('');
    }
    expect(returnPickupExceptionMessage({status:'pickup_failed',pickupStatus:null})).not.toBe('');
  });
});
