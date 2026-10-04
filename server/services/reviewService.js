const { pool } = require('../config/db');

const MAX_REVIEW_LENGTH = 2000;
const MAX_REVIEW_IMAGES = 5;
const SORTS = Object.freeze({
  recent: 'r.created_at DESC, r.id DESC',
  highest: 'r.rating DESC, r.created_at DESC, r.id DESC',
  lowest: 'r.rating ASC, r.created_at DESC, r.id DESC',
  helpful: 'helpful_count DESC, r.created_at DESC, r.id DESC'
});

function reviewError(status, code, message) {
  return Object.assign(new Error(message), { status, code });
}

function cleanText(value) {
  if (value == null) return '';
  if (typeof value !== 'string') throw reviewError(400, 'REVIEW_TEXT_INVALID', 'Review text must be plain text.');
  const normalized = value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').replace(/<[^>]*>/g, '').trim();
  if (normalized.length > MAX_REVIEW_LENGTH) throw reviewError(400, 'REVIEW_TEXT_INVALID', `Review text cannot exceed ${MAX_REVIEW_LENGTH} characters.`);
  return normalized;
}

function validRating(value) {
  const rating = typeof value === 'string' && /^[1-5]$/.test(value) ? Number(value) : value;
  if (!Number.isSafeInteger(rating) || rating < 1 || rating > 5) {
    throw reviewError(400, 'REVIEW_RATING_INVALID', 'Choose a rating from 1 to 5 stars.');
  }
  return rating;
}

function displayName(value) {
  const parts = String(value || 'Customer').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return 'Customer';
  return parts.length === 1 ? parts[0].slice(0, 40) : `${parts[0].slice(0, 30)} ${parts.at(-1)[0].toUpperCase()}.`;
}

function formatImage(row) {
  return { id: row.id, url: row.image_url, sortOrder: Number(row.sort_order) };
}

function formatReview(row, images = []) {
  return {
    id: row.id,
    productId: row.product_id,
    rating: Number(row.rating),
    text: row.review_text || '',
    displayName: displayName(row.customer_name),
    verifiedBuyer: true,
    sizePurchased: row.size || null,
    helpfulCount: Number(row.helpful_count || 0),
    helpfulByMe: Boolean(row.helpful_by_me),
    images,
    edited: Boolean(row.edited_at),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

async function ensureProduct(productId, database = pool) {
  const { rows } = await database.query('SELECT id FROM products WHERE id = $1 AND is_active = TRUE', [productId]);
  if (!rows[0]) throw reviewError(404, 'PRODUCT_NOT_FOUND', 'Product not found.');
}

async function eligiblePurchase(productId, userId, database = pool, orderItemId = null) {
  const params = [productId, userId];
  let requested = '';
  if (orderItemId) {
    params.push(orderItemId);
    requested = 'AND oi.id = $3';
  }
  const { rows } = await database.query(
    `SELECT oi.id AS order_item_id, oi.order_id, oi.size, o.delivered_at
       FROM order_items oi
       JOIN orders o ON o.id = oi.order_id
      WHERE oi.product_id = $1 AND o.user_id = $2 AND o.delivered_at IS NOT NULL
        AND o.order_status NOT IN ('cancelled') ${requested}
      ORDER BY o.delivered_at DESC, oi.created_at DESC, oi.id DESC LIMIT 1`, params
  );
  return rows[0] || null;
}

async function eligibility(productId, userId, database = pool) {
  await ensureProduct(productId, database);
  const [purchase, existing] = await Promise.all([
    eligiblePurchase(productId, userId, database),
    database.query(
      `SELECT r.*, u.name AS customer_name, oi.size,
         (SELECT COUNT(*)::integer FROM product_review_helpful h WHERE h.review_id = r.id) AS helpful_count,
         FALSE AS helpful_by_me
       FROM product_reviews r JOIN users u ON u.id = r.user_id
       JOIN order_items oi ON oi.id = r.order_item_id
       WHERE r.product_id = $1 AND r.user_id = $2`, [productId, userId]
    )
  ]);
  let ownReview = null;
  if (existing.rows[0]) {
    const images = await database.query('SELECT * FROM product_review_images WHERE review_id = $1 ORDER BY sort_order', [existing.rows[0].id]);
    ownReview = { ...formatReview(existing.rows[0], images.rows.map(formatImage)), moderationStatus: existing.rows[0].moderation_status };
  }
  return {
    eligible: Boolean(purchase),
    hasReview: Boolean(existing.rows[0]),
    orderItemId: purchase?.order_item_id || null,
    sizePurchased: purchase?.size || ownReview?.sizePurchased || null,
    ownReview
  };
}

async function summary(productId, database = pool) {
  await ensureProduct(productId, database);
  const { rows } = await database.query(
    `SELECT COUNT(*)::integer AS total,
       COALESCE(ROUND(AVG(rating)::numeric, 1), 0)::text AS average,
       COUNT(*) FILTER (WHERE rating = 5)::integer AS five,
       COUNT(*) FILTER (WHERE rating = 4)::integer AS four,
       COUNT(*) FILTER (WHERE rating = 3)::integer AS three,
       COUNT(*) FILTER (WHERE rating = 2)::integer AS two,
       COUNT(*) FILTER (WHERE rating = 1)::integer AS one
     FROM product_reviews WHERE product_id = $1 AND moderation_status = 'approved'`, [productId]
  );
  const row = rows[0] || {};
  return {
    average: Number(row.average || 0),
    total: Number(row.total || 0),
    distribution: { 5: Number(row.five || 0), 4: Number(row.four || 0), 3: Number(row.three || 0), 2: Number(row.two || 0), 1: Number(row.one || 0) }
  };
}

async function listReviews(productId, { userId = null, limit = 10, offset = 0, sort = 'recent' } = {}, database = pool) {
  await ensureProduct(productId, database);
  if (!SORTS[sort]) throw reviewError(400, 'REVIEW_SORT_INVALID', 'Invalid review sort option.');
  const params = [productId, userId, limit, offset];
  const { rows } = await database.query(
    `SELECT r.*, u.name AS customer_name, oi.size,
       (SELECT COUNT(*)::integer FROM product_review_helpful h WHERE h.review_id = r.id) AS helpful_count,
       EXISTS(SELECT 1 FROM product_review_helpful mine WHERE mine.review_id = r.id AND mine.user_id = $2::uuid) AS helpful_by_me,
       COUNT(*) OVER()::integer AS total_count
     FROM product_reviews r
     JOIN users u ON u.id = r.user_id
     JOIN order_items oi ON oi.id = r.order_item_id
     WHERE r.product_id = $1 AND r.moderation_status = 'approved'
     ORDER BY ${SORTS[sort]} LIMIT $3 OFFSET $4`, params
  );
  const ids = rows.map(row => row.id);
  const imageRows = ids.length
    ? (await database.query('SELECT * FROM product_review_images WHERE review_id = ANY($1::uuid[]) ORDER BY review_id, sort_order', [ids])).rows
    : [];
  const byReview = new Map();
  for (const image of imageRows) {
    if (!byReview.has(image.review_id)) byReview.set(image.review_id, []);
    byReview.get(image.review_id).push(formatImage(image));
  }
  const photoResult = await database.query(
    `SELECT i.id, i.image_url, i.sort_order, i.review_id
       FROM product_review_images i JOIN product_reviews r ON r.id = i.review_id
      WHERE r.product_id = $1 AND r.moderation_status = 'approved'
      ORDER BY r.created_at DESC, i.sort_order LIMIT 20`, [productId]
  );
  return {
    reviews: rows.map(row => formatReview(row, byReview.get(row.id) || [])),
    total: Number(rows[0]?.total_count || 0),
    limit,
    offset,
    customerPhotos: photoResult.rows.map(row => ({ id: row.id, reviewId: row.review_id, url: row.image_url }))
  };
}

function validateImages(images) {
  if (!Array.isArray(images) || images.length > MAX_REVIEW_IMAGES) throw reviewError(400, 'REVIEW_IMAGES_INVALID', `Upload no more than ${MAX_REVIEW_IMAGES} images.`);
  for (const image of images) {
    if (!image?.key || !image?.url || !image?.mimeType || !String(image.key).startsWith('reviews/')) {
      throw reviewError(400, 'REVIEW_IMAGES_INVALID', 'Invalid review image.');
    }
  }
}

async function createReview(productId, userId, input, images = [], database = pool) {
  const rating = validRating(input.rating);
  const text = cleanText(input.text);
  validateImages(images);
  const client = await database.connect();
  try {
    await client.query('BEGIN');
    const product = await client.query('SELECT id FROM products WHERE id = $1 AND is_active = TRUE FOR SHARE', [productId]);
    if (!product.rows[0]) throw reviewError(404, 'PRODUCT_NOT_FOUND', 'Product not found.');
    const purchase = await eligiblePurchase(productId, userId, client, input.orderItemId || null);
    if (!purchase) throw reviewError(403, 'REVIEW_NOT_ELIGIBLE', 'Only a verified buyer with a delivered order can review this product.');
    const inserted = await client.query(
      `INSERT INTO product_reviews (product_id, user_id, order_id, order_item_id, rating, review_text)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
      [productId, userId, purchase.order_id, purchase.order_item_id, rating, text]
    );
    for (let index = 0; index < images.length; index++) {
      const image = images[index];
      await client.query(
        `INSERT INTO product_review_images (review_id, object_key, image_url, mime_type, sort_order)
         VALUES ($1,$2,$3,$4,$5)`, [inserted.rows[0].id, image.key, image.url, image.mimeType, index]
      );
    }
    await client.query('COMMIT');
    return { id: inserted.rows[0].id };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    if (error.code === '23505') throw reviewError(409, 'REVIEW_ALREADY_EXISTS', 'You have already reviewed this product.');
    throw error;
  } finally { client.release(); }
}

async function assertOwner(productId, reviewId, userId, database = pool) {
  const { rows } = await database.query('SELECT id FROM product_reviews WHERE id = $1 AND product_id = $2 AND user_id = $3', [reviewId, productId, userId]);
  if (!rows[0]) throw reviewError(404, 'REVIEW_NOT_FOUND', 'Review not found.');
}

async function updateReview(productId, reviewId, userId, input, images = [], replaceImages = false, database = pool) {
  const rating = validRating(input.rating);
  const text = cleanText(input.text);
  validateImages(images);
  const client = await database.connect();
  let oldKeys = [];
  try {
    await client.query('BEGIN');
    const found = await client.query('SELECT * FROM product_reviews WHERE id = $1 AND product_id = $2 FOR UPDATE', [reviewId, productId]);
    if (!found.rows[0] || found.rows[0].user_id !== userId) throw reviewError(404, 'REVIEW_NOT_FOUND', 'Review not found.');
    await client.query(
      `UPDATE product_reviews SET rating = $1, review_text = $2, edited_at = NOW(), updated_at = NOW()
       WHERE id = $3`, [rating, text, reviewId]
    );
    if (replaceImages) {
      const old = await client.query('SELECT object_key FROM product_review_images WHERE review_id = $1', [reviewId]);
      oldKeys = old.rows.map(row => row.object_key);
      await client.query('DELETE FROM product_review_images WHERE review_id = $1', [reviewId]);
      for (let index = 0; index < images.length; index++) {
        const image = images[index];
        await client.query(
          `INSERT INTO product_review_images (review_id, object_key, image_url, mime_type, sort_order)
           VALUES ($1,$2,$3,$4,$5)`, [reviewId, image.key, image.url, image.mimeType, index]
        );
      }
    }
    await client.query('COMMIT');
    return { id: reviewId, oldKeys };
  } catch (error) { await client.query('ROLLBACK').catch(() => {}); throw error; }
  finally { client.release(); }
}

async function setHelpful(productId, reviewId, userId, helpful, database = pool) {
  const review = await database.query("SELECT id, user_id FROM product_reviews WHERE id = $1 AND product_id = $2 AND moderation_status = 'approved'", [reviewId, productId]);
  if (!review.rows[0]) throw reviewError(404, 'REVIEW_NOT_FOUND', 'Review not found.');
  if (review.rows[0].user_id === userId) throw reviewError(409, 'REVIEW_SELF_HELPFUL', 'You cannot mark your own review as helpful.');
  if (helpful) {
    await database.query('INSERT INTO product_review_helpful (review_id, user_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [reviewId, userId]);
  } else {
    await database.query('DELETE FROM product_review_helpful WHERE review_id = $1 AND user_id = $2', [reviewId, userId]);
  }
  const { rows } = await database.query('SELECT COUNT(*)::integer AS count FROM product_review_helpful WHERE review_id = $1', [reviewId]);
  return { helpful, helpfulCount: Number(rows[0]?.count || 0) };
}

async function adminList({ limit = 100, offset = 0, productId = null, rating = null, status = null, search = '' } = {}, database = pool) {
  const values = [];
  const where = [];
  const add = value => { values.push(value); return `$${values.length}`; };
  if (productId) where.push(`r.product_id = ${add(productId)}`);
  if (rating != null) where.push(`r.rating = ${add(validRating(rating))}`);
  if (status) {
    if (!['approved','hidden'].includes(status)) throw reviewError(400, 'REVIEW_STATUS_INVALID', 'Invalid moderation status.');
    where.push(`r.moderation_status = ${add(status)}`);
  }
  if (search) where.push(`p.name ILIKE ${add(`%${String(search).slice(0, 100)}%`)}`);
  values.push(limit, offset);
  const { rows } = await database.query(
    `SELECT r.*, p.name AS product_name, u.name AS customer_name, oi.size,
       (SELECT COUNT(*)::integer FROM product_review_helpful h WHERE h.review_id = r.id) AS helpful_count,
       COUNT(*) OVER()::integer AS total_count
     FROM product_reviews r JOIN products p ON p.id = r.product_id
     JOIN users u ON u.id = r.user_id JOIN order_items oi ON oi.id = r.order_item_id
     ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
     ORDER BY r.created_at DESC LIMIT $${values.length - 1} OFFSET $${values.length}`, values
  );
  const ids = rows.map(row => row.id);
  const imageRows = ids.length ? (await database.query('SELECT * FROM product_review_images WHERE review_id = ANY($1::uuid[]) ORDER BY review_id, sort_order', [ids])).rows : [];
  const byReview = new Map();
  for (const image of imageRows) {
    if (!byReview.has(image.review_id)) byReview.set(image.review_id, []);
    byReview.get(image.review_id).push(formatImage(image));
  }
  return {
    reviews: rows.map(row => ({ ...formatReview(row, byReview.get(row.id) || []), productName: row.product_name,
      customerName: displayName(row.customer_name), moderationStatus: row.moderation_status })),
    total: Number(rows[0]?.total_count || 0), limit, offset
  };
}

async function moderate(reviewId, status, database = pool) {
  if (!['approved','hidden'].includes(status)) throw reviewError(400, 'REVIEW_STATUS_INVALID', 'Choose approved or hidden.');
  const { rows } = await database.query(
    'UPDATE product_reviews SET moderation_status = $1, updated_at = NOW() WHERE id = $2 RETURNING id, moderation_status', [status, reviewId]
  );
  if (!rows[0]) throw reviewError(404, 'REVIEW_NOT_FOUND', 'Review not found.');
  return { id: rows[0].id, moderationStatus: rows[0].moderation_status };
}

module.exports = {
  MAX_REVIEW_LENGTH, MAX_REVIEW_IMAGES, SORTS, cleanText, validRating, displayName,
  eligiblePurchase, eligibility, summary, listReviews, createReview, assertOwner, updateReview,
  setHelpful, adminList, moderate, reviewError
};
