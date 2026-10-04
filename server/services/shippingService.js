const Shipment = require('../models/Shipment');
const { shiprocket, shippingError } = require('../config/shiprocket');
const { uuid, providerId, serviceabilityInput, packageDetails, assertShippable, assertFulfillmentSafe,
  buildOrderPayload, normalizeCouriers, normalizeTracking, normalizeInvoice, optionalNumber, safeUrl } = require('./shippingMapping');
const emails = require('./transactionalEmailService');
const { mappedForwardStatus } = require('./shippingWebhookService');

const REVIEW_MESSAGE = 'A previous shipping operation has an uncertain outcome. Reconcile it with Shiprocket before retrying.';
async function notifySafely(action) {
  try { await action(); }
  catch (error) { console.error('Shipping notification could not be queued.', { code: /^[A-Z0-9_]{1,100}$/.test(error.code || '') ? error.code : 'EMAIL_QUEUE_FAILED' }); }
}

function requireShipment(row) {
  if (!row?.shiprocket_shipment_id) throw shippingError(409, 'SHIPMENT_NOT_CREATED', 'Create the shipment first.');
}

function requireAwb(row) {
  requireShipment(row);
  if (!row.awb_code) throw shippingError(409, 'AWB_NOT_ASSIGNED', 'Assign a courier and AWB first.');
}

function requireIdle(row) {
  if (row?.pending_operation) throw shippingError(409, 'SHIPPING_RECONCILIATION_REQUIRED', REVIEW_MESSAGE);
}

function providerResult(message) { return shippingError(502, 'SHIPROCKET_INVALID_RESPONSE', message, true); }

function parcelFromRow(row, overrides) {
  const saved = row?.pickup_location ? {
    pickup_location: row.pickup_location, weight: row.package_weight, length: row.package_length,
    breadth: row.package_breadth, height: row.package_height
  } : {};
  return packageDetails({ ...saved, ...overrides });
}

function indiaTimestamp(value) {
  if (typeof value !== 'string' || !value || value.startsWith('0000')) return null;
  const normalized = /^\d{4}-\d\d-\d\d[ T]\d\d:\d\d:\d\d$/.test(value)
    ? value.replace(' ', 'T') + '+05:30' : value;
  const date = new Date(normalized);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function invoiceFailure(error) {
  const message = 'Invoice is not available yet. Please try again later.';
  if (error.code === 'SHIPROCKET_TIMEOUT') return shippingError(504, 'INVOICE_TIMEOUT', message);
  if (error.code === 'SHIPROCKET_AUTH_FAILED' || error.code === 'SHIPROCKET_NOT_CONFIGURED' ||
      error.code === 'SHIPROCKET_PERMISSION_DENIED') {
    return shippingError(503, 'INVOICE_PROVIDER_UNAVAILABLE', message);
  }
  if (error.upstreamStatus === 429) return shippingError(429, 'INVOICE_RATE_LIMITED', message);
  if ([400, 404, 409, 422].includes(error.upstreamStatus)) {
    return shippingError(404, 'INVOICE_NOT_AVAILABLE', message);
  }
  return shippingError(502, 'INVOICE_UNAVAILABLE', message);
}

function invoiceFilename(source, shiprocketOrderId) {
  const orderReference = String(source.order_number || source.id)
    .replace(/[^a-zA-Z0-9_-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 80) || 'Order';
  return `${orderReference}_Invoice_${shiprocketOrderId}.pdf`;
}

function createShippingService({ repository = Shipment, api = shiprocket, notifications = null } = {}) {
  const emailNotifications = notifications || (repository === Shipment && api === shiprocket ? emails : {
    orderShipped: async () => {}, orderOutForDelivery: async () => {}, orderDelivered: async () => {}, shipmentFailure: async () => {}
  });
  async function mutate(client, orderId, row, operation, action) {
    requireIdle(row);
    await repository.patch(client, orderId, {
      pending_operation: operation, operation_started_at: new Date(), last_error_code: null,
      attempt_count: row.attempt_count + 1
    });
    try {
      const changes = await action();
      return await repository.save(client, orderId, {
        ...changes, pending_operation: null, operation_started_at: null, last_error_code: null
      });
    } catch (error) {
      const recognized = error.code?.startsWith('SHIPROCKET_');
      const uncertain = !recognized || error.uncertain;
      const code = recognized ? error.code : 'SHIPPING_PERSISTENCE_FAILED';
      const needsConfiguration = [
        'SHIPROCKET_AUTH_FAILED',
        'SHIPROCKET_NOT_CONFIGURED',
        'SHIPROCKET_PERMISSION_DENIED'
      ].includes(code);
      await repository.patch(client, orderId, {
        ...(uncertain ? {} : { pending_operation: null, operation_started_at: null }),
        ...(operation === 'create' ? {
          shipping_status: uncertain
            ? 'needs_review'
            : needsConfiguration ? 'needs_configuration' : 'retry_pending'
        } : {}),
        last_error_code: code,
        next_attempt_at: new Date(Date.now() + 5 * 60000)
      }).catch(() => {}); // Durable operation intent remains if saving the failure also fails.
      if (uncertain) throw shippingError(409, 'SHIPPING_RECONCILIATION_REQUIRED', REVIEW_MESSAGE);
      throw error;
    }
  }

  async function serviceability(input) {
    const query = serviceabilityInput(input);
    return normalizeCouriers(await api.request('/courier/serviceability/', { query }));
  }

  async function createShipment(orderId, overrides = {}) {
    orderId = uuid(orderId);
    return repository.withLock(orderId, async client => {
      const order = await repository.order(client, orderId);
      if (!order) throw shippingError(404, 'ORDER_NOT_FOUND', 'Order not found.');
      let row = await repository.find(client, orderId);
      if (row?.shiprocket_shipment_id) return repository.format(row);
      try { assertShippable(order); }
      catch (error) {
        if (row && !row.pending_operation) {
          await repository.patch(client, orderId, { shipping_status: 'validation_failed', last_error_code: error.code });
        }
        throw error;
      }
      requireIdle(row);
      await repository.enqueue(client, orderId);
      row = await repository.find(client, orderId);
      let payload;
      let parcel;
      try {
        parcel = parcelFromRow(row, overrides);
        const details = await repository.details(client, orderId);
        payload = buildOrderPayload(order, details.address, details.items, parcel);
      } catch (error) {
        await repository.patch(client, orderId, {
          shipping_status: error.code === 'SHIPPING_PACKAGE_NOT_CONFIGURED' ? 'needs_configuration' : 'validation_failed',
          last_error_code: error.code === 'SHIPPING_PACKAGE_NOT_CONFIGURED' ? error.code : 'SHIPPING_VALIDATION',
          next_attempt_at: new Date(Date.now() + 5 * 60000)
        });
        if (!error.code) throw shippingError(400, 'SHIPPING_VALIDATION', 'Review the saved order and package data before shipping.');
        throw error;
      }
      await repository.patch(client, orderId, {
        pickup_location: parcel.pickup_location, package_weight: parcel.weight, package_length: parcel.length,
        package_breadth: parcel.breadth, package_height: parcel.height
      });
      const updated = await mutate(client, orderId, row, 'create', async () => {
        const result = await api.request('/orders/create/adhoc', { method: 'POST', body: payload });
        if (!Number.isSafeInteger(Number(result.order_id)) || Number(result.order_id) <= 0 ||
            !Number.isSafeInteger(Number(result.shipment_id)) || Number(result.shipment_id) <= 0) {
          throw providerResult('The shipping provider did not confirm the created shipment.');
        }
        return {
          shiprocket_order_id: result.order_id, shiprocket_shipment_id: result.shipment_id,
          shipping_status: 'created', awb_code: result.awb_code || null,
          courier_id: optionalNumber(result.courier_company_id), courier_name: result.courier_name || null
        };
      });
      return repository.format(updated);
    });
  }

  async function assignAwb(orderId, courierId) {
    orderId = uuid(orderId);
    courierId = providerId(courierId, 'courier_id');
    return repository.withLock(orderId, async client => {
      const row = await repository.find(client, orderId);
      requireShipment(row);
      if (row.awb_code) {
        if (Number(row.courier_id) !== courierId) throw shippingError(409, 'COURIER_ALREADY_ASSIGNED', 'This shipment already has a different courier.');
        return repository.format(row);
      }
      assertShippable(await repository.order(client, orderId));
      const updated = await mutate(client, orderId, row, 'awb', async () => {
        const result = await api.request('/courier/assign/awb', {
          method: 'POST', body: { shipment_id: Number(row.shiprocket_shipment_id), courier_id: courierId }
        });
        const data = result.response?.data;
        if (Number(result.awb_assign_status) !== 1 || !data?.awb_code || !data.courier_name ||
            Number(data.courier_company_id) !== courierId ||
            (data.shipment_id && Number(data.shipment_id) !== Number(row.shiprocket_shipment_id))) {
          throw providerResult('The shipping provider did not confirm AWB assignment.');
        }
        return { awb_code: String(data.awb_code), courier_id: courierId, courier_name: data.courier_name,
          shipping_status: 'awb_assigned', shipping_charge: optionalNumber(data.applied_weight_amount ?? data.freight_charge),
          estimated_delivery: typeof data.etd === 'string' ? data.etd : null };
      });
      return repository.format(updated);
    });
  }

  async function generatePickup(orderId) {
    orderId = uuid(orderId);
    return repository.withLock(orderId, async client => {
      const row = await repository.find(client, orderId);
      requireAwb(row);
      if (row.pickup_status === 'scheduled') return repository.format(row);
      assertShippable(await repository.order(client, orderId));
      const updated = await mutate(client, orderId, row, 'pickup', async () => {
        const result = await api.request('/courier/generate/pickup', {
          method: 'POST', body: { shipment_id: [Number(row.shiprocket_shipment_id)] }
        });
        if (Number(result.pickup_status) !== 1) throw providerResult('The shipping provider did not confirm pickup scheduling.');
        return { pickup_status: 'scheduled', shipping_status: 'pickup_scheduled',
          pickup_scheduled_date: result.response?.pickup_scheduled_date || null };
      });
      return repository.format(updated);
    });
  }

  async function generateLabel(orderId) {
    orderId = uuid(orderId);
    return repository.withLock(orderId, async client => {
      const row = await repository.find(client, orderId);
      requireAwb(row);
      if (row.label_url) return repository.format(row);
      assertFulfillmentSafe(await repository.order(client, orderId));
      const updated = await mutate(client, orderId, row, 'label', async () => {
        const result = await api.request('/courier/generate/label', {
          method: 'POST', body: { shipment_id: [Number(row.shiprocket_shipment_id)] }
        });
        const label = safeUrl(result.label_url);
        if (Number(result.label_created) !== 1 || !label) throw providerResult('The shipping provider did not return a label.');
        return { label_url: label };
      });
      return repository.format(updated);
    });
  }

  async function tracking(orderId, user) {
    orderId = uuid(orderId);
    return repository.withLock(orderId, async client => {
      const order = await repository.order(client, orderId);
      if (!order || (order.user_id !== user.id && !['admin', 'super_admin'].includes(user.role))) {
        throw shippingError(404, 'ORDER_NOT_FOUND', 'Order not found.');
      }
      let row = await repository.find(client, orderId);
      let available = Boolean(row?.tracking_status);
      if (row?.awb_code && (!row.tracking_checked_at || Date.now() - new Date(row.tracking_checked_at).getTime() > 60000)) {
        const result = normalizeTracking(await api.request(`/courier/track/awb/${encodeURIComponent(row.awb_code)}`));
        available = result.available;
        const deliveredAt = result.statusCode === 7 ? indiaTimestamp(result.deliveredAt) : null;
        row = await repository.save(client, orderId, {
          tracking_status: result.status || row.tracking_status,
          tracking_url: result.trackingUrl || row.tracking_url,
          estimated_delivery: result.estimatedDelivery || row.estimated_delivery,
          tracking_events: result.events,
          tracking_checked_at: new Date(),
          ...(result.available && result.status ? { shipping_status: result.status } : {})
        }, { pickedUpAt: indiaTimestamp(result.pickedUpAt), deliveredAt });
        const normalized = mappedForwardStatus({ shipment_status_id: result.statusCode, shipment_status: result.status });
        if (normalized === 'shipped') await notifySafely(() => emailNotifications.orderShipped(orderId));
        if (normalized === 'out_for_delivery') await notifySafely(() => emailNotifications.orderOutForDelivery(orderId));
        if (normalized === 'delivered') await notifySafely(() => emailNotifications.orderDelivered(orderId));
      }
      // Customer responses deliberately omit label links, internal operation state and provider IDs.
      return {
        orderId, available, awbCode: row?.awb_code || order.awb_number || null,
        courierName: row?.courier_name || order.courier_name || null,
        shippingStatus: row?.shipping_status || 'not_created', trackingStatus: row?.tracking_status || null,
        trackingUrl: row?.tracking_url || order.tracking_url || null,
        estimatedDelivery: row?.estimated_delivery || null,
        pickupStatus: row?.pickup_status || null,
        events: row?.tracking_events || [], lastCheckedAt: row?.tracking_checked_at || null
      };
    });
  }

  async function invoice(orderId, user) {
    orderId = uuid(orderId);
    const source = await repository.invoiceSource(orderId);
    if (!source || (source.user_id !== user.id && !['admin', 'super_admin'].includes(user.role))) {
      throw shippingError(404, 'ORDER_NOT_FOUND', 'Order not found.');
    }
    let shiprocketOrderId;
    try { shiprocketOrderId = providerId(source.shiprocket_order_id, 'shiprocket_order_id'); }
    catch { throw shippingError(404, 'INVOICE_NOT_AVAILABLE', 'Invoice is not available yet. Please try again later.'); }
    try {
      const result = await api.request('/orders/print/invoice', {
        method: 'POST', body: { ids: [shiprocketOrderId] }
      });
      const invoiceUrl = normalizeInvoice(result);
      const document = await api.downloadInvoice(invoiceUrl);
      return { document, filename: invoiceFilename(source, shiprocketOrderId) };
    } catch (error) {
      if (error.code?.startsWith('INVOICE_')) throw error;
      throw invoiceFailure(error);
    }
  }

  // Recover a remote success lost to a timeout/crash without trusting IDs or status supplied by Angular.
  async function reconcile(orderId, remoteOrderId) {
    orderId = uuid(orderId);
    remoteOrderId = providerId(remoteOrderId, 'shiprocket_order_id');
    return repository.withLock(orderId, async client => {
      const order = await repository.order(client, orderId);
      if (!order) throw shippingError(404, 'ORDER_NOT_FOUND', 'Order not found.');
      const row = await repository.find(client, orderId);
      if (!row) throw shippingError(409, 'SHIPMENT_NOT_CREATED', 'No local shipment attempt exists.');
      if (row.shiprocket_order_id && Number(row.shiprocket_order_id) !== remoteOrderId) {
        throw shippingError(409, 'SHIPMENT_MISMATCH', 'This order is already linked to another Shiprocket order.');
      }
      const result = await api.request(`/orders/show/${remoteOrderId}`);
      const remote = result.data;
      const shipment = Array.isArray(remote?.shipments) ? remote.shipments[0] : remote?.shipments;
      if (remote?.channel_order_id !== orderId || Number(remote.id) !== remoteOrderId || !shipment?.id ||
          (Array.isArray(remote.shipments) && remote.shipments.length !== 1) ||
          (row.shiprocket_shipment_id && Number(row.shiprocket_shipment_id) !== Number(shipment.id))) {
        throw shippingError(409, 'SHIPMENT_MISMATCH', 'Shiprocket did not confirm a matching order and shipment.');
      }
      const awb = shipment.awb || shipment.awb_code || null;
      const pickupDate = shipment.pickup_scheduled_date || null;
      if ((row.pending_operation === 'awb' && !awb) || (row.pending_operation === 'pickup' && !pickupDate)) {
        throw shippingError(409, 'SHIPPING_RECONCILIATION_REQUIRED', 'Shiprocket has not confirmed the previous operation. Resolve it in the Shiprocket dashboard before retrying.');
      }
      const updated = await repository.save(client, orderId, {
        shiprocket_order_id: remoteOrderId, shiprocket_shipment_id: providerId(shipment.id, 'shipment_id'),
        awb_code: awb ? String(awb) : row.awb_code,
        courier_id: optionalNumber(shipment.courier_id ?? shipment.courier_company_id) ?? row.courier_id,
        courier_name: shipment.courier || shipment.courier_name || row.courier_name,
        shipping_charge: optionalNumber(remote.awb_data?.charges?.applied_weight_amount) ?? optionalNumber(shipment.cost) ?? row.shipping_charge,
        estimated_delivery: shipment.etd || row.estimated_delivery,
        shipping_status: remote.status || (awb ? 'awb_assigned' : 'created'),
        pickup_status: pickupDate ? 'scheduled' : row.pickup_status,
        pickup_scheduled_date: pickupDate || row.pickup_scheduled_date,
        label_url: safeUrl(shipment.label_url) || row.label_url,
        pending_operation: null, operation_started_at: null, last_error_code: null
      });
      return repository.format(updated);
    });
  }

  // Payment success is independent of shipping provider availability; the durable row remains retryable.
  async function processPendingOrder(orderId) {
    try { await createShipment(orderId); }
    catch (error) {
      console.error('Shipment processing deferred:', {
        orderId, code: /^[A-Z_]+$/.test(error.code || '') ? error.code : 'SHIPPING_INTERNAL_ERROR'
      });
      if (['SHIPROCKET_AUTH_FAILED','SHIPROCKET_NOT_CONFIGURED','SHIPROCKET_PERMISSION_DENIED','SHIPPING_RECONCILIATION_REQUIRED'].includes(error.code)) {
        await notifySafely(() => emailNotifications.shipmentFailure(orderId, error.code));
      }
    }
  }

  return { serviceability, createShipment, assignAwb, generatePickup, generateLabel, tracking, invoice, reconcile, processPendingOrder };
}

module.exports = { ...createShippingService({ notifications: emails }), createShippingService };
