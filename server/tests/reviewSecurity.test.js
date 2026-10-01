const test = require('node:test');
const assert = require('node:assert/strict');
process.env.JWT_SECRET ||= 'review-security-test-secret-value-123456';
process.env.ADMIN_GOOGLE_EMAIL ||= 'admin@example.test';
const {
  summary, listReviews, eligiblePurchase, createReview, assertOwner, updateReview,
  setHelpful, cleanText, validRating, displayName
} = require('../services/reviewService');
const { authenticate } = require('../middleware/auth');

const PRODUCT = '10000000-0000-4000-8000-000000000001';
const USER = '20000000-0000-4000-8000-000000000001';
const OTHER = '20000000-0000-4000-8000-000000000002';
const ORDER = '30000000-0000-4000-8000-000000000001';
const ITEM = '40000000-0000-4000-8000-000000000001';
const REVIEW = '50000000-0000-4000-8000-000000000001';

function summaryDb(row) {
  return { async query(sql) {
    if (String(sql).startsWith('SELECT id FROM products')) return { rows: [{ id: PRODUCT }] };
    return { rows: [row] };
  } };
}

test('zero-review and populated summaries expose accurate server-side distributions', async () => {
  assert.deepEqual(await summary(PRODUCT, summaryDb({ total: 0, average: '0', five: 0, four: 0, three: 0, two: 0, one: 0 })),
    { average: 0, total: 0, distribution: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 } });
  assert.deepEqual(await summary(PRODUCT, summaryDb({ total: 4, average: '4.3', five: 2, four: 1, three: 1, two: 0, one: 0 })),
    { average: 4.3, total: 4, distribution: { 1: 0, 2: 0, 3: 1, 4: 1, 5: 2 } });
});

test('public listing returns approved reviews only and never exposes private customer fields', async () => {
  const statements = [];
  const database = { async query(sql) {
    sql = String(sql); statements.push(sql);
    if (sql.startsWith('SELECT id FROM products')) return { rows: [{ id: PRODUCT }] };
    if (sql.includes('FROM product_reviews r') && sql.includes('COUNT(*) OVER')) return { rows: [{
      id: REVIEW, product_id: PRODUCT, rating: 5, review_text: 'Great fit', customer_name: 'Priyanka Priyadarshini',
      size: 'M', helpful_count: 2, helpful_by_me: false, total_count: 1, created_at: new Date(), updated_at: new Date()
    }] };
    return { rows: [] };
  } };
  const result = await listReviews(PRODUCT, { limit: 10, offset: 0, sort: 'recent' }, database);
  assert.equal(result.reviews[0].displayName, 'Priyanka P.');
  assert.equal(result.reviews[0].verifiedBuyer, true);
  assert.equal('email' in result.reviews[0], false);
  assert.ok(statements.some(sql => sql.includes("r.moderation_status = 'approved'")));
});

test('guests cannot pass authenticated review submission middleware', async () => {
  const response = { statusCode: 200, body: null, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
  await authenticate({ headers: {} }, response, () => assert.fail('guest authentication must not continue'));
  assert.equal(response.statusCode, 401);
});

test('eligibility requires the caller product purchase and a persisted delivery timestamp', async () => {
  let sqlSeen = '';
  const absent = { async query(sql) { sqlSeen = String(sql); return { rows: [] }; } };
  assert.equal(await eligiblePurchase(PRODUCT, USER, absent), null);
  assert.match(sqlSeen, /o\.user_id = \$2/);
  assert.match(sqlSeen, /o\.delivered_at IS NOT NULL/);
  assert.match(sqlSeen, /oi\.product_id = \$1/);
});

function createDb({ delivered = true, duplicate = false } = {}) {
  const statements = [];
  const query = async (sql, params = []) => {
    sql = String(sql); statements.push({ sql, params });
    if (['BEGIN','COMMIT','ROLLBACK'].includes(sql)) return { rows: [] };
    if (sql.startsWith('SELECT id FROM products')) return { rows: [{ id: PRODUCT }] };
    if (sql.includes('FROM order_items oi')) return { rows: delivered ? [{ order_item_id: ITEM, order_id: ORDER, size: 'M', delivered_at: new Date() }] : [] };
    if (sql.startsWith('INSERT INTO product_reviews')) {
      if (duplicate) throw Object.assign(new Error('duplicate'), { code: '23505' });
      return { rows: [{ id: REVIEW }] };
    }
    return { rows: [] };
  };
  return { statements, connect: async () => ({ query, release() {} }), query };
}

test('delivered purchasers can submit rating-only reviews while non-purchasers cannot', async () => {
  const allowed = createDb();
  assert.deepEqual(await createReview(PRODUCT, USER, { rating: 5, text: '' }, [], allowed), { id: REVIEW });
  assert.ok(allowed.statements.some(item => item.sql.startsWith('INSERT INTO product_reviews')));
  await assert.rejects(createReview(PRODUCT, USER, { rating: 4, text: 'No delivery' }, [], createDb({ delivered: false })),
    error => error.code === 'REVIEW_NOT_ELIGIBLE');
});

test('ratings and text are validated and HTML is stored only as sanitized plain text', () => {
  assert.throws(() => validRating(0), error => error.code === 'REVIEW_RATING_INVALID');
  assert.throws(() => validRating(6), error => error.code === 'REVIEW_RATING_INVALID');
  assert.equal(cleanText(' <b>Good</b><script>alert(1)</script> '), 'Goodalert(1)');
  assert.equal(displayName('Ananya Sharma'), 'Ananya S.');
});

test('database uniqueness converts duplicate product reviews into a safe conflict', async () => {
  await assert.rejects(createReview(PRODUCT, USER, { rating: 5, text: 'Again' }, [], createDb({ duplicate: true })),
    error => error.status === 409 && error.code === 'REVIEW_ALREADY_EXISTS');
});

test('review photos require generated review object keys and are capped at five', async () => {
  await assert.rejects(createReview(PRODUCT, USER, { rating: 5 }, [{ key: 'products/not-a-review.jpg', url: 'x', mimeType: 'image/jpeg' }], createDb()),
    error => error.code === 'REVIEW_IMAGES_INVALID');
  const images = Array.from({ length: 6 }, (_, i) => ({ key: `reviews/${i}.jpg`, url: `u${i}`, mimeType: 'image/jpeg' }));
  await assert.rejects(createReview(PRODUCT, USER, { rating: 5 }, images, createDb()), error => error.code === 'REVIEW_IMAGES_INVALID');
});

test('customers cannot edit another customer review', async () => {
  const database = { query: async () => ({ rows: [] }) };
  await assert.rejects(assertOwner(PRODUCT, REVIEW, OTHER, database), error => error.code === 'REVIEW_NOT_FOUND');
  const ownerMismatch = createDb();
  ownerMismatch.connect = async () => ({ query: async sql => {
    if (String(sql).startsWith('SELECT * FROM product_reviews')) return { rows: [{ id: REVIEW, user_id: USER }] };
    return { rows: [] };
  }, release() {} });
  await assert.rejects(updateReview(PRODUCT, REVIEW, OTHER, { rating: 4, text: 'Changed' }, [], false, ownerMismatch),
    error => error.code === 'REVIEW_NOT_FOUND');
});

test('helpful votes are idempotent through a database uniqueness upsert', async () => {
  const votes = new Set();
  const database = { async query(sql, params) {
    sql = String(sql);
    if (sql.startsWith('SELECT id, user_id')) return { rows: [{ id: REVIEW, user_id: OTHER }] };
    if (sql.startsWith('INSERT INTO product_review_helpful')) { votes.add(`${params[0]}:${params[1]}`); return { rows: [] }; }
    if (sql.startsWith('SELECT COUNT')) return { rows: [{ count: votes.size }] };
    return { rows: [] };
  } };
  await setHelpful(PRODUCT, REVIEW, USER, true, database);
  const second = await setHelpful(PRODUCT, REVIEW, USER, true, database);
  assert.equal(second.helpfulCount, 1);
});

test('pagination and sorting are bounded to the server whitelist', async () => {
  const database = { async query(sql) {
    sql = String(sql);
    if (sql.startsWith('SELECT id FROM products')) return { rows: [{ id: PRODUCT }] };
    if (sql.includes('COUNT(*) OVER')) { assert.match(sql, /r\.rating DESC/); assert.match(sql, /LIMIT \$3 OFFSET \$4/); return { rows: [] }; }
    return { rows: [] };
  } };
  await listReviews(PRODUCT, { limit: 10, offset: 20, sort: 'highest' }, database);
  await assert.rejects(listReviews(PRODUCT, { sort: 'DROP TABLE' }, database), error => error.code === 'REVIEW_SORT_INVALID');
});

test('returned or refunded purchases remain historically verified after delivery', async () => {
  const database = { async query(sql) {
    assert.match(String(sql), /delivered_at IS NOT NULL/);
    assert.doesNotMatch(String(sql), /payment_status/);
    return { rows: [{ order_item_id: ITEM, order_id: ORDER, size: 'L', delivered_at: new Date() }] };
  } };
  assert.equal((await eligiblePurchase(PRODUCT, USER, database)).order_item_id, ITEM);
});
