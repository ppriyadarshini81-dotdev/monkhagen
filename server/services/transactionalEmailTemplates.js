const SUPPORT_EMAIL = 'official@monkhagen.in';

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
  })[character]);
}

function safeUrl(value) {
  try {
    const url = new URL(String(value || ''));
    return url.protocol === 'https:' && !url.username && !url.password ? url.href : null;
  } catch { return null; }
}

function siteUrl(environment = process.env) {
  return safeUrl(environment.PUBLIC_SITE_URL) || 'https://monkhagen.in/';
}

function link(path, environment) {
  return new URL(path.replace(/^\//, ''), siteUrl(environment)).href;
}

function money(value) {
  const number = Number(value);
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: 2 })
    .format(Number.isFinite(number) ? number : 0);
}

function indiaDate(value, includeTime = false) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return 'Not available';
  return new Intl.DateTimeFormat('en-IN', {
    timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric',
    ...(includeTime ? { hour: '2-digit', minute: '2-digit' } : {})
  }).format(date);
}

function firstName(value) {
  return String(value || 'Customer').trim().split(/\s+/)[0] || 'Customer';
}

function paymentLabel(value) { return value === 'cod' ? 'Cash on Delivery' : 'Prepaid'; }

function addressText(address) {
  if (!address) return 'Not available';
  return [address.full_name, address.phone, address.address_line1, address.address_line2, address.landmark,
    [address.city, address.state, address.postal_code].filter(Boolean).join(', '), address.country]
    .filter(Boolean).join('\n');
}

function addressHtml(address) { return escapeHtml(addressText(address)).replace(/\n/g, '<br>'); }

function detailRows(rows) {
  return `<table role="presentation" style="width:100%;border-collapse:collapse">${rows.filter(row => row[1] !== null && row[1] !== undefined && row[1] !== '').map(([label, value]) =>
    `<tr><td style="padding:7px 12px 7px 0;color:#707070;font-size:13px;vertical-align:top">${escapeHtml(label)}</td><td style="padding:7px 0;color:#111;font-size:13px;font-weight:600;text-align:right;vertical-align:top">${value}</td></tr>`
  ).join('')}</table>`;
}

function itemCards(items = []) {
  return items.map(item => {
    const image = safeUrl(item.image_url);
    const options = [item.size ? `Size: ${item.size}` : '', item.color ? `Color: ${item.color}` : ''].filter(Boolean).join(' · ');
    return `<div style="display:flex;gap:14px;padding:14px 0;border-bottom:1px solid #eceae6">
      ${image ? `<img src="${escapeHtml(image)}" alt="" width="72" height="88" style="width:72px;height:88px;object-fit:cover;border-radius:8px;background:#f4f2ef">` : ''}
      <div style="flex:1;min-width:0"><strong style="display:block;color:#111;font-size:14px;line-height:1.45">${escapeHtml(item.product_name)}</strong>
      ${options ? `<span style="display:block;margin-top:4px;color:#707070;font-size:12px">${escapeHtml(options)}</span>` : ''}
      <span style="display:block;margin-top:5px;color:#707070;font-size:12px">Quantity: ${escapeHtml(item.quantity)}</span></div>
      <strong style="color:#111;font-size:13px;white-space:nowrap">${money(item.total_price ?? item.refund_amount)}</strong>
    </div>`;
  }).join('');
}

function cta(label, href) {
  const url = safeUrl(href);
  return url ? `<p style="margin:26px 0 8px"><a href="${escapeHtml(url)}" style="display:inline-block;padding:13px 22px;border-radius:6px;background:#2348e8;color:#fff;text-decoration:none;font-size:13px;font-weight:700">${escapeHtml(label)}</a></p>` : '';
}

function layout(title, content) {
  return `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head>
  <body style="margin:0;background:#f5f4f1;color:#111;font-family:Arial,sans-serif"><div style="display:none;max-height:0;overflow:hidden">${escapeHtml(title)}</div>
  <table role="presentation" style="width:100%;border-collapse:collapse"><tr><td style="padding:24px 12px" align="center">
  <table role="presentation" style="width:100%;max-width:640px;border-collapse:collapse;background:#fff;border:1px solid #e5e2dc">
  <tr><td style="padding:24px 28px;border-bottom:1px solid #e5e2dc;font-size:20px;font-weight:800;letter-spacing:6px">MONK HAGEN</td></tr>
  <tr><td style="padding:30px 28px"><h1 style="margin:0 0 18px;font-size:25px;line-height:1.25">${escapeHtml(title)}</h1>${content}</td></tr>
  <tr><td style="padding:22px 28px;border-top:1px solid #e5e2dc;color:#777;font-size:11px;line-height:1.7">MONK HAGEN<br>Customer Support · <a href="mailto:${SUPPORT_EMAIL}" style="color:#2348e8">${SUPPORT_EMAIL}</a><br>Transactional notification — no marketing content.</td></tr>
  </table></td></tr></table></body></html>`;
}

function paragraph(value) { return `<p style="margin:0 0 16px;color:#333;font-size:14px;line-height:1.7">${escapeHtml(value)}</p>`; }
function card(content) { return `<div style="margin:20px 0;padding:18px;border:1px solid #e5e2dc;border-radius:10px;background:#faf9f7">${content}</div>`; }
function heading(value) { return `<h2 style="margin:22px 0 8px;font-size:14px;letter-spacing:.08em;text-transform:uppercase">${escapeHtml(value)}</h2>`; }

function plainText(html) {
  return html.replace(/<style[\s\S]*?<\/style>/gi, '').replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>|<\/div>|<\/tr>|<\/h\d>/gi, '\n').replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/\n{3,}/g, '\n\n').trim();
}

function orderSummary(order) {
  return detailRows([
    ['Subtotal', escapeHtml(money(order.subtotal))],
    ['Discount', `-${escapeHtml(money(order.discount_amount))}`],
    ['Shipping', escapeHtml(money(order.shipping_amount))],
    ['Total', escapeHtml(money(order.total_amount))],
    ['Payment', escapeHtml(paymentLabel(order.payment_method))]
  ]);
}

function orderConfirmed(order, admin, environment) {
  const title = admin ? 'New order received' : 'Order confirmed';
  const customer = order.customer_name || order.full_name || 'Customer';
  let content = admin
    ? paragraph('A genuine customer order has been confirmed and is ready for fulfilment.')
    : paragraph(`Hi ${firstName(customer)},`) + paragraph('Thank you for shopping with MONK HAGEN. Your order has been confirmed.');
  content += card(detailRows([
    ['Order ID', escapeHtml(order.order_number)], ['Order date', escapeHtml(indiaDate(order.created_at, true))],
    ...(admin ? [['Customer', escapeHtml(customer)], ['Email', escapeHtml(order.customer_email || 'Not provided')], ['Phone', escapeHtml(order.customer_phone || order.phone || 'Not provided')]] : [])
  ]));
  content += heading('Items') + itemCards(order.items) + heading('Order summary') + card(orderSummary(order));
  content += heading('Delivery address') + paragraph(addressText(order.address));
  if (admin) content += card(detailRows([
    ['Payment status', escapeHtml(order.payment_status)],
    ['Shiprocket order status', escapeHtml(order.shiprocket_order_id ? 'Created' : (order.shipping_status || 'Pending'))]
  ])) + cta('Open Admin Orders', link('/admin', environment));
  else content += cta('View Order', link('/account/orders', environment)) + paragraph("We'll let you know as your order moves through delivery.");
  return {
    subject: admin ? `New Order Received – ${order.order_number} – ${money(order.total_amount)}` : `Order Confirmed – ${order.order_number} | MONK HAGEN`,
    html: layout(title, content)
  };
}

function shippingUpdate(type, order, environment) {
  const tracking = safeUrl(order.tracking_url) || link('/account/orders', environment);
  const common = card(detailRows([
    ['Order', escapeHtml(order.order_number)], ['Courier', escapeHtml(order.courier_name || 'Courier partner')],
    ['Tracking / AWB', escapeHtml(order.awb_code || 'Available in your account')]
  ]));
  if (type === 'ORDER_SHIPPED_CUSTOMER') {
    const estimated = order.estimated_delivery ? card(detailRows([['Estimated delivery', escapeHtml(order.estimated_delivery)]])) : '';
    return { subject: `Your MONK HAGEN Order ${order.order_number} Has Shipped`, html: layout('Your order has shipped',
      paragraph(`Hi ${firstName(order.customer_name)},`) + paragraph('Your MONK HAGEN order is on its way.') + common + estimated + cta('Track Order', tracking)) };
  }
  if (type === 'ORDER_OUT_FOR_DELIVERY_CUSTOMER') {
    const cod = order.payment_method === 'cod' ? card(detailRows([['Amount to pay', escapeHtml(money(order.total_amount))]])) : '';
    return { subject: `Your Order ${order.order_number} Is Out for Delivery`, html: layout('Out for delivery',
      paragraph(`Hi ${firstName(order.customer_name)},`) + paragraph('Good news — your MONK HAGEN order is out for delivery today.') + common + cod + cta('Track Order', tracking)) };
  }
  const reviewPath = order.items.find(item => item.product_slug)?.product_slug;
  return { subject: `Your MONK HAGEN Order ${order.order_number} Has Been Delivered`, html: layout('Your order has been delivered',
    paragraph(`Hi ${firstName(order.customer_name)},`) + paragraph('Your order has been delivered.') +
    card(detailRows([['Order', escapeHtml(order.order_number)], ['Delivered', escapeHtml(indiaDate(order.delivered_at, true))]])) +
    paragraph('We hope you love your MONK HAGEN purchase.') + heading('How did we do?') +
    cta('Rate Your Purchase', reviewPath ? link(`/product/${encodeURIComponent(reviewPath)}?review=write`, environment) : link('/account/orders', environment))) };
}

function returnDetails(record, includeCustomer = false) {
  return card(detailRows([
    ['Return ID', escapeHtml(record.return_number)], ['Order', escapeHtml(record.order_number)],
    ...(includeCustomer ? [['Customer', escapeHtml(record.customer_name || 'Customer')], ['Email', escapeHtml(record.customer_email || 'Not provided')], ['Phone', escapeHtml(record.customer_phone || record.phone || 'Not provided')]] : []),
    ['Expected refund', escapeHtml(money(record.refund_amount))], ['Payment', escapeHtml(paymentLabel(record.payment_method))]
  ]));
}

function reasonText(item) { return String(item.reason || 'Not provided').replace(/_/g, ' ').replace(/\b\w/g, value => value.toUpperCase()); }

function returnRequested(record, admin, environment) {
  let content = admin ? paragraph('A new legitimate customer return request requires review.')
    : paragraph(`Hi ${firstName(record.customer_name)},`) + paragraph("We've received your return request.");
  content += returnDetails(record, admin) + heading('Items') + itemCards(record.items);
  if (admin) {
    content += card(detailRows([
      ['Reason', escapeHtml(record.items.map(reasonText).join(', '))],
      ['Customer comments', escapeHtml(record.items.map(item => item.comments).filter(Boolean).join(' | ') || record.comments || 'None')],
      ['Original order amount', escapeHtml(money(record.order_total))],
      ['Pickup address', addressHtml(record.address)],
      ['Return destination', escapeHtml(record.return_destination || 'Configured Shiprocket pickup location')],
      ['Shiprocket reverse status', escapeHtml(record.status || 'Creating')],
      ['AWB', record.return_awb ? escapeHtml(record.return_awb) : null]
    ])) + cta('Review Return', link('/admin', environment));
  } else {
    content += card(detailRows([['Reason', escapeHtml(record.items.map(reasonText).join(', '))]]));
    content += paragraph('This is the expected refund amount. The refund will be processed after the returned item is received and approved.');
    if (!['pickup_scheduled','picked_up','in_transit','received'].includes(record.status)) content += paragraph("We'll update you once your return pickup is arranged.");
  }
  return { subject: admin ? `New Return Request – ${record.return_number} – Order ${record.order_number}` : `Return Request Received – ${record.return_number}`,
    html: layout(admin ? 'New return request' : 'Return request received', content) };
}

function returnStatus(type, record, environment) {
  const base = paragraph(`Hi ${firstName(record.customer_name)},`) + returnDetails(record) + heading('Items') + itemCards(record.items);
  const tracking = safeUrl(record.tracking_url) || link('/account/returns', environment);
  if (type === 'RETURN_PICKUP_SCHEDULED_CUSTOMER') {
    const pickupDate = record.pickup_scheduled_date ? card(detailRows([['Pickup date', escapeHtml(record.pickup_scheduled_date)]])) : '';
    return { subject: `Your Return Pickup Has Been Scheduled – ${record.return_number}`, html: layout('Return pickup scheduled', base +
      heading('Pickup address') + paragraph(addressText(record.address)) + card(detailRows([
        ['Courier', escapeHtml(record.return_courier_name || 'Courier partner')], ['AWB / tracking', record.return_awb ? escapeHtml(record.return_awb) : null]
      ])) + pickupDate + paragraph('Please keep the item securely packed and ready for pickup.') + cta('View Return', tracking)) };
  }
  if (type === 'RETURN_PICKED_UP_CUSTOMER') return { subject: `We've Picked Up Your MONK HAGEN Return – ${record.return_number}`,
    html: layout('Your return has been picked up', base + paragraph("Your return is now on its way back to us. We'll update you once it has been received and reviewed.") + cta('View Return', tracking)) };
  if (type === 'RETURN_RECEIVED_CUSTOMER') return { subject: `We've Received Your Return – ${record.return_number}`,
    html: layout('We received your return', base + paragraph("We've received your returned item. We'll inspect it and update you once the return is approved and the refund process begins.")) };
  const approvalMessage = record.payment_method === 'cod'
    ? `Your approved COD refund of ${money(record.refund_amount)} needs a refund destination. Open Returns in your account and provide a UPI ID or bank account.`
    : `Your refund of ${money(record.refund_amount)} will now be initiated to the original payment method.`;
  return { subject: `Your Return Has Been Approved – ${record.return_number}`,
    html: layout('Return approved', base + paragraph(approvalMessage)) };
}

function refundMessage(type, record) {
  const admin = type.endsWith('_ADMIN');
  const completed = type.startsWith('REFUND_COMPLETED');
  const cod = record.payment_method === 'cod';
  const required = type === 'COD_REFUND_REQUIRED_ADMIN';
  const pending = type.startsWith('COD_REFUND_PENDING');
  const status = required ? 'COD refund destination required' : completed ? 'Completed' : pending ? 'Pending manual transfer' : 'Initiated';
  const method = cod ? (record.refund_destination_method === 'UPI' ? 'UPI' : record.refund_destination_method === 'BANK' ? 'Bank Transfer' : 'Customer-provided destination') : 'Original payment method';
  const content = (admin ? paragraph('Refund status update for operations.') : paragraph(`Hi ${firstName(record.customer_name)},`)) +
    returnDetails(record, admin) + heading('Items') + itemCards(record.items) +
    card(detailRows([['Refund amount', escapeHtml(money(record.refund_amount))], ['Refund method', escapeHtml(method)],
      ['Destination', cod && record.refund_destination_masked ? escapeHtml(record.refund_destination_masked) : null],
      ['Refund status', escapeHtml(status)], ['Transaction reference', completed && record.refund_transaction_reference ? escapeHtml(record.refund_transaction_reference) : null],
      ['Date/time', escapeHtml(indiaDate(completed ? record.refunded_at : record.refund_initiated_at || record.updated_at, true))]])) +
    (admin ? '' : paragraph(completed
      ? (cod ? 'Your COD refund has been processed to the refund destination you provided.' : 'Your MONK HAGEN refund has been processed. Depending on your bank/payment provider, it may take some time to appear in your account.')
      : (cod ? 'We received your refund destination. Your refund remains pending until our team completes the transfer.' : 'The refund has been initiated to your original payment method. The time it takes to appear depends on your bank/payment provider.')));
  return {
    subject: admin ? `Refund ${status} – ${record.return_number} – ${money(record.refund_amount)}`
      : `${completed ? 'Refund Completed' : pending ? 'COD Refund Details Received' : 'Refund Initiated'} – ${money(record.refund_amount)} – ${record.order_number}`,
    html: layout(required ? 'COD refund destination required' : `Refund ${status.toLowerCase()}`, content)
  };
}

function failureMessage(type, data, environment) {
  const labels = {
    SHIPMENT_CREATION_FAILED_ADMIN: ['Shipment Creation Failed', data.order_number],
    RETURN_CREATION_FAILED_ADMIN: ['Return Creation Failed', data.return_number],
    REFUND_FAILED_ADMIN: ['Refund Failed', data.return_number]
  };
  const [label, reference] = labels[type];
  const content = paragraph('An operational action needs attention. The customer-facing business record remains safe.') +
    card(detailRows([['Order', escapeHtml(data.order_number || 'Not available')], ['Return', data.return_number ? escapeHtml(data.return_number) : null],
      ['Safe error category', escapeHtml(data.failure_code || 'OPERATION_FAILED')], ['Date/time', escapeHtml(indiaDate(new Date(), true))]])) +
    cta('Open Admin', link('/admin', environment));
  return { subject: `ACTION REQUIRED – ${label} – ${reference}`, html: layout(`Action required: ${label}`, content) };
}

function buildEmail(eventType, data, environment = process.env) {
  let message;
  if (eventType === 'ORDER_CONFIRMED_CUSTOMER') message = orderConfirmed(data, false, environment);
  else if (eventType === 'ORDER_CONFIRMED_ADMIN') message = orderConfirmed(data, true, environment);
  else if (['ORDER_SHIPPED_CUSTOMER','ORDER_OUT_FOR_DELIVERY_CUSTOMER','ORDER_DELIVERED_CUSTOMER'].includes(eventType)) message = shippingUpdate(eventType, data, environment);
  else if (eventType === 'RETURN_REQUESTED_CUSTOMER') message = returnRequested(data, false, environment);
  else if (eventType === 'RETURN_REQUESTED_ADMIN') message = returnRequested(data, true, environment);
  else if (['RETURN_PICKUP_SCHEDULED_CUSTOMER','RETURN_PICKED_UP_CUSTOMER','RETURN_RECEIVED_CUSTOMER','RETURN_APPROVED_CUSTOMER'].includes(eventType)) message = returnStatus(eventType, data, environment);
  else if (['REFUND_INITIATED_CUSTOMER','REFUND_INITIATED_ADMIN','REFUND_COMPLETED_CUSTOMER','REFUND_COMPLETED_ADMIN',
    'COD_REFUND_REQUIRED_ADMIN','COD_REFUND_PENDING_CUSTOMER','COD_REFUND_PENDING_ADMIN'].includes(eventType)) message = refundMessage(eventType, data);
  else if (['SHIPMENT_CREATION_FAILED_ADMIN','RETURN_CREATION_FAILED_ADMIN','REFUND_FAILED_ADMIN'].includes(eventType)) message = failureMessage(eventType, data, environment);
  else throw Object.assign(new Error('Unsupported transactional email event.'), { code: 'EMAIL_EVENT_UNSUPPORTED' });
  return { ...message, text: plainText(message.html) };
}

module.exports = { buildEmail, escapeHtml, safeUrl, money, indiaDate, plainText, addressText };
