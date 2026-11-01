interface PickupState { status: string; pickupStatus?: string | null; }

export function returnMilestoneStage(status: string): number {
  if (['approved', 'refund_initiated', 'refunded'].includes(status)) return 5;
  if (status === 'received') return 4;
  if (status === 'in_transit') return 3;
  if (status === 'picked_up') return 2;
  // A pickup exception pauses the journey; it does not create a new request.
  if (['pickup_scheduled', 'pickup_failed'].includes(status)) return 1;
  return 0;
}

export function returnPickupExceptionMessage(request: PickupState, audience: 'customer' | 'admin' = 'customer'): string {
  if (request.status !== 'pickup_failed') return '';
  const providerStatus = (request.pickupStatus || '').replace(/[_-]+/g, ' ');
  // The same backend status also covers lost, damaged and undelivered parcels.
  // Do not suggest pickup rescheduling for those different courier problems.
  if (providerStatus && !/\bpickup\b/i.test(providerStatus)) return '';
  return audience === 'admin'
    ? 'The courier reported a pickup exception. The return remains active at the Scheduled step. Confirm or reschedule the next pickup with Shiprocket; no new return request is needed.'
    : 'The courier reported a pickup issue. Your return is still active, and a new pickup date is awaiting courier confirmation. Please keep your parcel ready. There is no need to create another return request.';
}
