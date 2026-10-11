const { shippingError } = require('../config/shiprocket');
const EMAIL = /^[^\s@\r\n]+@[^\s@\r\n]+\.[^\s@\r\n]+$/;

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

function customerEmail(customerEmail) {
  const customer = typeof customerEmail === 'string' ? customerEmail.trim().toLowerCase() : '';
  if (EMAIL.test(customer)) return customer;
  throw invalid('The saved delivery email is missing or invalid. Ask the customer to update their delivery address.');
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

function itemQuantity(items) {
  if (!Array.isArray(items) || !items.length) throw invalid('The parcel must contain products.');
  let quantity = 0;
  for (const item of items) {
    quantity += providerId(item?.quantity ?? item?.units, 'Item quantity');
    if (!Number.isSafeInteger(quantity)) throw invalid('The parcel product quantity is too large.');
  }
  return quantity;
}

function packageForItems(items, env = process.env) {
  const quantity = itemQuantity(items);
  const profile = require('../config/shippingPackages')(env).find(row => quantity >= row.minimumQuantity &&
    (row.maximumQuantity === null || quantity <= row.maximumQuantity));
  if (!profile) throw shippingError(503, 'SHIPPING_PACKAGE_NOT_CONFIGURED', 'Configure packing measurements for this product quantity.');
  return { weight: profile.weight, length: profile.length, breadth: profile.breadth, height: profile.height };
}

function packageDetails(input = {}, env = process.env, items) {
  let profile = {};
  if (items !== undefined) {
    if (['weight', 'length', 'breadth', 'height'].every(field => input[field] != null)) itemQuantity(items);
    else profile = packageForItems(items, env);
  }
  const values = {
    pickup_location: input.pickup_location ?? env.SHIPROCKET_PICKUP_LOCATION,
    weight: input.weight ?? profile.weight ?? env.SHIPROCKET_PACKAGE_WEIGHT_KG,
    length: input.length ?? profile.length ?? env.SHIPROCKET_PACKAGE_LENGTH_CM,
    breadth: input.breadth ?? profile.breadth ?? env.SHIPROCKET_PACKAGE_BREADTH_CM,
    height: input.height ?? profile.height ?? env.SHIPROCKET_PACKAGE_HEIGHT_CM
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

function assertFulfillmentSafe(order) {
  if (order?.fulfillment_hold_reason) {
    throw shippingError(409, 'ORDER_FULFILLMENT_HELD', 'This order requires inventory or payment review before shipping.');
  }
  if (!order) throw shippingError(404, 'ORDER_NOT_FOUND', 'Order not found.');
  if (['cancelled', 'returned'].includes(order.order_status)) {
    throw shippingError(409, 'ORDER_NOT_SHIPPABLE', 'This order is not eligible for shipment creation.');
  }
  if (['replacement', 'rejected_return'].includes(order.order_type)) {
    if (order.source_order_id && order.return_request_id && Number(order.total_amount) === 0 &&
        order.after_sales_return_status === 'approved' && !order.after_sales_pending_operation) return;
    throw shippingError(409, 'ORDER_FULFILLMENT_HELD', 'The linked inspection must be completed before this outbound order can ship.');
  }
  if (order.payment_method === 'cod' && ['pending', 'paid'].includes(order.payment_status)) return;
  if (order.payment_method !== 'razorpay' || order.payment_status !== 'paid' ||
      !order.razorpay_order_id || !order.razorpay_payment_id || !order.paid_at) {
    throw shippingError(409, 'PAYMENT_NOT_VERIFIED', 'A captured and verified payment is required before shipping a prepaid order.');
  }
}

function assertShippable(order) {
  assertFulfillmentSafe(order);
  if (!['placed', 'confirmed', 'processing'].includes(order.order_status)) {
    throw shippingError(409, 'ORDER_NOT_SHIPPABLE', 'This order is not eligible for shipment creation.');
  }
}

function productTaxPercent(env = process.env) {
  const value = Number(env.SHIPROCKET_PRODUCT_TAX_PERCENT);
  if (typeof env.SHIPROCKET_PRODUCT_TAX_PERCENT !== 'string' || !env.SHIPROCKET_PRODUCT_TAX_PERCENT.trim() || !Number.isFinite(value) || value < 0 || value > 100) {
    throw shippingError(503, 'SHIPROCKET_NOT_CONFIGURED', 'Configure the Shiprocket product tax percentage in the backend environment.');
  }
  return value;
}

function buildOrderPayload(order, address, items, parcel, env = process.env) {
  assertShippable(order);
  if (!address) throw invalid('The saved order address is missing.');
  const name = text(address.full_name, 'Customer name').split(/\s+/);
  let phone = String(address.phone || '').replace(/[\s()+-]/g, '');
  if (phone.length === 12 && phone.startsWith('91')) phone = phone.slice(2);
  if (!/^[6-9]\d{9}$/.test(phone)) throw invalid('The saved shipping phone must be a valid Indian mobile number.');
  if (String(address.country || '').toLowerCase() !== 'india') throw invalid('Only domestic Indian shipments are supported.');
  const billingEmail = customerEmail(address.email);
  if (!items.length) throw invalid('The order has no items.');
  const tax = productTaxPercent(env);
  const orderItems = items.map(item => {
    const units = providerId(item.quantity, 'Item quantity');
    const price = Number(item.unit_price);
    if (!Number.isFinite(price) || price < 0) throw invalid('Order item price is invalid.');
    return { name: text(item.product_name, 'Product name'),
      // Create Custom Order expects selling_price inclusive of GST. Sending
      // only the taxable base would understate the payment/parcel value.
      sku: text(item.sku || item.variant_id || item.id, 'Item SKU', 100), units, selling_price: price, tax };
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
    billing_email: billingEmail, billing_phone: phone, shipping_is_billing: true,
    order_items: orderItems, payment_method: order.payment_method === 'cod' ? 'COD' : 'Prepaid',
    sub_total: subtotal - discount, total_discount: discount, shipping_charges: shipping,
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

function normalizeInvoice(data) {
  if (data?.is_invoice_created === false || data?.data?.is_invoice_created === false) {
    throw shippingError(404, 'INVOICE_NOT_AVAILABLE', 'Invoice is not available yet. Please try again later.');
  }
  const candidate = data?.invoice_url ?? data?.invoiceUrl ?? data?.url ??
    data?.data?.invoice_url ?? data?.data?.invoiceUrl ?? data?.data?.url;
  const invoiceUrl = safeUrl(candidate);
  if (!invoiceUrl) {
    throw shippingError(502, 'SHIPROCKET_INVALID_RESPONSE', 'Shiprocket did not return a valid invoice URL.');
  }
  return invoiceUrl;
}

module.exports = { uuid, positive, providerId, serviceabilityInput, packageDetails, packageForItems, productTaxPercent, customerEmail, assertFulfillmentSafe, assertShippable,
  buildOrderPayload, normalizeCouriers, normalizeTracking, normalizeInvoice, optionalNumber, safeUrl };
