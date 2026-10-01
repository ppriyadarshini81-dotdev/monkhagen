const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const text = (value, max, min = 0) => typeof value === 'string' && value.trim().length >= min && value.length <= max && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value);
const integer = (value, max, min = 0) => Number.isSafeInteger(value) && value >= min && value <= max;
const price = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1000000 && Math.abs(value * 100 - Math.round(value * 100)) < 0.000001;
function mediaUrl(value) {
  if (!text(value, 2048)) return false;
  if (!value) return true;
  if (/^\/(?!\/)[a-zA-Z0-9_./%-]+$/.test(value) && !value.includes('..')) return true;
  try { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password && (!url.port || url.port === '443'); }
  catch { return false; }
}
function reject(res) { return res.status(400).json({ message: 'Invalid request fields. Check their types, lengths and supported ranges.' }); }

function requestShape(req, res, next) {
  for (const [key, value] of Object.entries(req.query)) {
    if (!text(key, 60, 1) || !text(value, key === 'url' ? 2048 : 200)) return reject(res);
    if (['page','limit','offset'].includes(key) && (!/^\d{1,6}$/.test(value) || Number(value) > (key === 'limit' ? 100 : 100000) || (key !== 'offset' && Number(value) < 1))) return reject(res);
    if (key === 'featured' && !['true','false'].includes(value)) return reject(res);
  }
  if (req.is('application/json') && ['POST','PUT','PATCH'].includes(req.method) && !object(req.body)) return reject(res);
  next();
}

function params(router) {
  for (const key of ['id','itemId','orderId','returnId']) router.param(key, (req, res, next, value) => UUID.test(value) ? next() : reject(res));
  router.param('idOrSlug', (req, res, next, value) => text(value, 255, 1) && /^[a-zA-Z0-9-]+$/.test(value) ? next() : reject(res));
}

function body(kind) {
  return (req, res, next) => {
    if (!['POST','PUT','PATCH'].includes(req.method)) return next();
    const data = req.body;
    if (!object(data)) return reject(res);
    let valid = true;
    const optional = (key, check) => { if (data[key] !== undefined && !check(data[key])) valid = false; };
    const uuid = value => typeof value === 'string' && UUID.test(value);
    if (kind === 'product') {
      if (req.method === 'POST' && (!text(data.name, 255, 1) || !uuid(data.categoryId) || !price(data.basePrice))) valid = false;
      optional('name', value => text(value, 255, 1));
      optional('description', value => text(value, 10000));
      optional('categoryId', uuid); optional('badgeId', value => value === null || uuid(value));
      optional('basePrice', price);
      for (const key of ['featured','isActive']) optional(key, value => typeof value === 'boolean');
      for (const key of ['sizeIds','colorIds']) optional(key, value => Array.isArray(value) && value.length <= 50 && value.every(uuid) && new Set(value.map(id => id.toLowerCase())).size === value.length);
      optional('images', value => Array.isArray(value) && value.length <= 20 && value.every(image =>
        typeof image === 'string' ? mediaUrl(image) && Boolean(image) : object(image) && mediaUrl(image.url) && Boolean(image.url) &&
        (image.cloudinaryPublicId == null || text(image.cloudinaryPublicId, 255))));
      optional('variants', value => Array.isArray(value) && value.length <= 250 && value.every(variant => object(variant) &&
        text(variant.size, 50, 1) && text(variant.color, 50, 1) &&
        (variant.stock === undefined || integer(variant.stock, 1000000)) &&
        (variant.price == null || price(variant.price)) && (variant.sku == null || text(variant.sku, 100)) &&
        (variant.sizeId == null || uuid(variant.sizeId)) && (variant.colorId == null || uuid(variant.colorId)) &&
        (variant.isActive === undefined || typeof variant.isActive === 'boolean')));
    } else if (kind === 'category' || kind === 'named') {
      if (req.method === 'POST' && !text(data.name, kind === 'category' ? 255 : 100, 1)) valid = false;
      optional('name', value => text(value, kind === 'category' ? 255 : 100, 1));
      optional('isActive', value => typeof value === 'boolean');
      if (kind === 'category') { optional('image', mediaUrl); optional('description', value => text(value, 10000)); }
    } else if (kind === 'profile') {
      optional('name', value => text(value, 100, 2));
      optional('phone', value => value === null || value === '' || typeof value === 'string' && /^[6-9]\d{9}$/.test(value));
      optional('dateOfBirth', value => {
        if (value === null || value === '') return true;
        if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
        const date = new Date(value);
        return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value && value >= '1900-01-01' && date.getTime() <= Date.now();
      });
    } else if (kind === 'payment') {
      for (const key of ['addressId','checkoutToken','localOrderId']) optional(key, uuid);
      for (const key of ['razorpay_payment_id','razorpay_order_id']) optional(key, value => typeof value === 'string' && /^[a-zA-Z0-9_]{1,255}$/.test(value));
      optional('razorpay_signature', value => typeof value === 'string' && /^[a-f0-9]{64}$/i.test(value));
    }
    return valid ? next() : reject(res);
  };
}

module.exports = { UUID, text, integer, price, mediaUrl, requestShape, params, body };
module.exports.pagination = function pagination(query = {}) {
  const limit = Number(query.limit || 100);
  const offset = query.offset !== undefined ? Number(query.offset) : (Number(query.page || 1) - 1) * limit;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100 || !Number.isSafeInteger(offset) || offset < 0 || offset > 100000) {
    throw Object.assign(new Error('Invalid pagination range.'), { status: 400 });
  }
  return { limit, offset };
};
