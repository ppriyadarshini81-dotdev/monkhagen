const { shippingError } = require('../config/shiprocket');

function invalid(message) { return shippingError(400, 'SHIPPING_VALIDATION', message); }

function uuid(value) {
  if (typeof value !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
    throw invalid('A valid internal orderId is required.');
  }
  return value.toLowerCase();
}

function positive(value, label, max = 1000) {
  if (!['number', 'string'].includes(typeof value) || String(value).trim() === '') throw invalid(`${label} is required.`);
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0 || number > max) throw invalid(`${label} must be greater than zero and at most ${max}.`);
  return number;
}

function providerId(value, label) {
  const number = positive(value, label, Number.MAX_SAFE_INTEGER);
  if (!Number.isSafeInteger(number)) throw invalid(`${label} must be a positive integer.`);
  return number;
}

function text(value, label, max = 255) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > max) throw invalid(`${label} is required (maximum ${max} characters).`);
  return value.trim();
}

function postcode(value, label) {
  if (!['string', 'number'].includes(typeof value) || !/^[1-9]\d{5}$/.test(String(value))) throw invalid(`${label} must be a six-digit Indian PIN code.`);
  return String(value);
}

function serviceabilityInput(input) {
  const cod = input.cod;
  if (![true, false, 0, 1, '0', '1'].includes(cod)) throw invalid('cod must be true, false, 0, or 1.');
  return {
    pickup_postcode: postcode(input.pickup_postcode, 'pickup_postcode'),
    delivery_postcode: postcode(input.delivery_postcode, 'delivery_postcode'),
    weight: positive(input.weight, 'weight (kg)'),
    cod: cod === true || cod === 1 || cod === '1' ? 1 : 0
  };
}

function packageDetails(input = {}, env = process.env) {
  const values = {
    pickup_location: input.pickup_location ?? env.SHIPROCKET_PICKUP_LOCATION,
    weight: input.weight ?? env.SHIPROCKET_PACKAGE_WEIGHT_KG,
    length: input.length ?? env.SHIPROCKET_PACKAGE_LENGTH_CM,
    breadth: input.breadth ?? env.SHIPROCKET_PACKAGE_BREADTH_CM,
    height: input.height ?? env.SHIPROCKET_PACKAGE_HEIGHT_CM
  };
  if (Object.values(values).some(value => value == null || value === '')) {
    throw shippingError(503, 'SHIPPING_PACKAGE_NOT_CONFIGURED',
      'Configure the pickup location and packed-order weight/dimensions, or supply them as an administrator.');
  }
  return {
    pickup_location: text(values.pickup_location, 'pickup_location'),
    weight: positive(values.weight, 'weight (kg)'),
    length: positive(values.length, 'length (cm)'),
    breadth: positive(values.breadth, 'breadth (cm)'),
    height: positive(values.height, 'height (cm)')
  };
}

function assertShippable(order) {
  if (!order) throw shippingError(404, 'ORDER_NOT_FOUND', 'Order not found.');
  if (!['placed', 'confirmed', 'processing'].includes(order.order_status)) {
    throw shippingError(409, 'ORDER_NOT_SHIPPABLE', 'This order is not eligible for shipment creation.');
  }
  if (order.payment_method === 'cod' && ['pending', 'paid'].includes(order.payment_status)) return;
  if (order.payment_method !== 'razorpay' || order.payment_status !== 'paid' ||
      !order.razorpay_order_id || !order.razorpay_payment_id || !order.paid_at) {
    throw shippingError(409, 'PAYMENT_NOT_VERIFIED', 'A captured and verified payment is required before shipping a prepaid order.');
  }
}

function buildOrderPayload(order, address, items, parcel) {
  assertShippable(order);
  if (!address) throw invalid('The saved order address is missing.');
  const name = text(address.full_name, 'Customer name').split(/\s+/);
  let phone = String(address.phone || '').replace(/[\s()+-]/g, '');
  if (phone.length === 12 && phone.startsWith('91')) phone = phone.slice(2);
  if (!/^[6-9]\d{9}$/.test(phone)) throw invalid('The saved shipping phone must be a valid Indian mobile number.');
  if (String(address.country || '').toLowerCase() !== 'india') throw invalid('Only domestic Indian shipments are supported.');
  if (!order.customer_email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(order.customer_email)) throw invalid('The customer account needs a valid email address for shipping.');
  if (!items.length) throw invalid('The order has no items.');
  const orderItems = items.map(item => {
    const units = providerId(item.quantity, 'Item quantity');
    const price = Number(item.unit_price);
    if (!Number.isFinite(price) || price < 0) throw invalid('Order item price is invalid.');
    return { name: text(item.product_name, 'Product name'),
      sku: text(item.sku || item.variant_id || item.id, 'Item SKU', 100), units, selling_price: price };
  });
  const subtotal = Number(order.subtotal);
  const discount = Number(order.discount_amount);
  const shipping = Number(order.shipping_amount);
  const total = Number(order.total_amount);
  const itemTotal = orderItems.reduce((sum, item) => sum + Math.round(item.selling_price * 100) * item.units, 0);
  if (![subtotal, discount, shipping, total].every(value => Number.isFinite(value) && value >= 0) ||
      Math.round(subtotal * 100) !== itemTotal ||
      Math.round(total * 100) !== itemTotal - Math.round(discount * 100) + Math.round(shipping * 100)) {
    throw invalid('Saved order totals are inconsistent. Review this order before shipping.');
  }
  // Shiprocket order_date has no timezone field; format the order timestamp in India time.
  const orderDate = new Date(new Date(order.created_at).getTime() + 330 * 60000).toISOString().slice(0, 16).replace('T', ' ');
  return {
    order_id: order.id, order_date: orderDate, pickup_location: parcel.pickup_location,
    billing_customer_name: name.shift(), billing_last_name: name.join(' '),
    billing_address: text(address.address_line1, 'Address'),
    billing_address_2: [address.address_line2, address.landmark].filter(Boolean).join(', '),
    billing_city: text(address.city, 'City', 100), billing_state: text(address.state, 'State', 100),
    billing_pincode: postcode(address.postal_code, 'Saved address postcode'), billing_country: 'India',
    billing_email: order.customer_email, billing_phone: phone, shipping_is_billing: true,
    order_items: orderItems, payment_method: order.payment_method === 'cod' ? 'COD' : 'Prepaid',
    sub_total: subtotal, total_discount: discount, shipping_charges: shipping,
    length: parcel.length, breadth: parcel.breadth, height: parcel.height, weight: parcel.weight
  };
}

function optionalNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  return Number.isFinite(Number(value)) ? Number(value) : null;
}

function safeUrl(value) {
  try { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password ? url.href : null; }
  catch { return null; }
}

function normalizeCouriers(data) {
  const list = data.data?.available_courier_companies;
  if (!Array.isArray(list)) throw shippingError(502, 'SHIPROCKET_INVALID_RESPONSE', 'Shipping availability could not be read.');
  return { available: list.length > 0, currency: 'INR', couriers: list.map(courier => ({
    courierId: optionalNumber(courier.courier_company_id), courierName: courier.courier_name || null,
    estimatedDelivery: courier.etd || courier.edd || null,
    estimatedDeliveryDays: optionalNumber(courier.estimated_delivery_days),
    freightCharge: optionalNumber(courier.freight_charge), shippingCharge: optionalNumber(courier.rate) ?? optionalNumber(courier.freight_charge),
    codAvailable: Number(courier.cod) === 1, codCharge: optionalNumber(courier.cod_charges),
    rating: optionalNumber(courier.rating)
  })) };
}

function normalizeTracking(data) {
  const tracking = data.tracking_data;
  if (!tracking || typeof tracking !== 'object') throw shippingError(502, 'SHIPROCKET_INVALID_RESPONSE', 'Tracking information could not be read.');
  const track = tracking.shipment_track?.[0] || {};
  return {
    available: Number(tracking.track_status) === 1,
    status: track.current_status || null,
    statusCode: optionalNumber(tracking.shipment_status),
    trackingUrl: safeUrl(tracking.track_url),
    estimatedDelivery: tracking.etd || track.edd || null,
    pickedUpAt: track.pickup_date || null, deliveredAt: track.delivered_date || null,
    events: (Array.isArray(tracking.shipment_track_activities) ? tracking.shipment_track_activities : []).map(event => ({
      date: event.date || null, status: event.status || null,
      activity: event.activity || null, location: event.location || null
    }))
  };
}

module.exports = { uuid, positive, providerId, serviceabilityInput, packageDetails, assertShippable,
  buildOrderPayload, normalizeCouriers, normalizeTracking, optionalNumber, safeUrl };
