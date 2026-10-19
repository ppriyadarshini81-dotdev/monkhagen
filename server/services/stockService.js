const { pool } = require('../config/db');
const inventory = require('./inventoryService');

function fault(status, message) { return Object.assign(new Error(message), { status }); }
const SIZE_ORDER = `CASE UPPER(s.name) WHEN 'XXS' THEN 0 WHEN 'XS' THEN 1 WHEN 'S' THEN 2
  WHEN 'M' THEN 3 WHEN 'L' THEN 4 WHEN 'XL' THEN 5 WHEN 'XXL' THEN 6 WHEN '2XL' THEN 6
  WHEN 'XXXL' THEN 7 WHEN '3XL' THEN 7 WHEN '4XL' THEN 8 WHEN '5XL' THEN 9 ELSE 100 END`;
const STATUS_SQL = `CASE WHEN NOT psd.inventory_configured THEN 'SETUP_REQUIRED'
  WHEN psd.stock_quantity = 0 THEN 'OUT_OF_STOCK'
  WHEN psd.stock_quantity <= psd.low_stock_threshold_quantity THEN 'LOW_STOCK'
  ELSE 'IN_STOCK' END`;

function row(record) {
  return {
    inventoryId: record.inventory_id, productId: record.product_id, productName: record.product_name,
    productSlug: record.product_slug, imageUrl: record.image_url || null, categoryId: record.category_id,
    category: record.category_name, sizeId: record.size_id, size: record.size_name,
    currentStock: Number(record.stock_quantity), initialStock: Number(record.initial_stock_quantity),
    threshold: Number(record.low_stock_threshold_quantity), configured: record.inventory_configured,
    remainingPercent: Number(record.initial_stock_quantity) > 0
      ? Number(((Number(record.stock_quantity) / Number(record.initial_stock_quantity)) * 100).toFixed(1)) : null,
    status: record.stock_status, updatedAt: record.updated_at
  };
}

async function list(query = {}, database = pool) {
  const page = Number(query.page || 1); const limit = Number(query.limit || 25);
  const grouped = query.groupBy === 'product';
  if (!Number.isSafeInteger(page) || page < 1 || ![25, 50, 100].includes(limit)) throw fault(400, 'Invalid stock pagination.');
  const conditions = ['p.is_active = TRUE', 'psd.is_active = TRUE']; const values = [];
  const add = value => { values.push(value); return `$${values.length}`; };
  if (query.search) { const ref = add(`%${String(query.search).trim()}%`); conditions.push(`(p.name ILIKE ${ref} OR c.name ILIKE ${ref} OR s.name ILIKE ${ref} OR EXISTS (SELECT 1 FROM product_variants pv WHERE pv.product_id = p.id AND pv.size_id = s.id AND pv.sku ILIKE ${ref}))`); }
  if (query.category) conditions.push(`c.id = ${add(query.category)}::uuid`);
  if (query.size) conditions.push(`s.id = ${add(query.size)}::uuid`);
  const statuses = new Set(['IN_STOCK','LOW_STOCK','OUT_OF_STOCK','SETUP_REQUIRED']);
  if (query.status && query.status !== 'ALL') {
    if (!statuses.has(query.status)) throw fault(400, 'Invalid stock status filter.');
    conditions.push(`${STATUS_SQL} = ${add(query.status)}`);
  }
  const order = {
    lowest: `CASE ${STATUS_SQL} WHEN 'SETUP_REQUIRED' THEN 0 WHEN 'OUT_OF_STOCK' THEN 1 WHEN 'LOW_STOCK' THEN 2 ELSE 3 END, psd.stock_quantity, p.name, ${SIZE_ORDER}`,
    highest: `psd.stock_quantity DESC, p.name, ${SIZE_ORDER}`,
    product: `p.name, ${SIZE_ORDER}`,
    updated: 'psd.updated_at DESC, p.name'
  }[query.sort || 'lowest'];
  if (!order) throw fault(400, 'Invalid stock sort.');
  const where = conditions.join(' AND ');
  const count = await database.query(`SELECT COUNT(${grouped ? 'DISTINCT p.id' : '*'})::int AS count FROM product_size_details psd
    JOIN products p ON p.id = psd.product_id JOIN categories c ON c.id = p.category_id
    JOIN sizes s ON s.id = psd.size_id WHERE ${where}`, values);
  const offset = (page - 1) * limit; const dataValues = [...values, limit, offset];
  const select = `SELECT psd.id AS inventory_id, psd.product_id, p.name AS product_name,
    p.slug AS product_slug, p.category_id, c.name AS category_name, psd.size_id, s.name AS size_name,
    psd.stock_quantity, psd.initial_stock_quantity, psd.low_stock_threshold_quantity,
    psd.inventory_configured, psd.updated_at, ${STATUS_SQL} AS stock_status,
    image.image_url${grouped ? `, ROW_NUMBER() OVER (ORDER BY ${order}, p.id, psd.id) AS stock_rank` : ''} FROM product_size_details psd JOIN products p ON p.id = psd.product_id
    JOIN categories c ON c.id = p.category_id JOIN sizes s ON s.id = psd.size_id
    LEFT JOIN LATERAL (SELECT image_url FROM product_images WHERE product_id = p.id
      ORDER BY is_primary DESC, display_order, created_at LIMIT 1) image ON TRUE
    WHERE ${where}`;
  const result = await database.query(grouped
    ? `WITH matching AS (${select}), selected_products AS (
        SELECT product_id, MIN(stock_rank) AS product_rank FROM matching GROUP BY product_id
        ORDER BY product_rank LIMIT $${dataValues.length - 1} OFFSET $${dataValues.length})
      SELECT matching.* FROM matching JOIN selected_products USING (product_id)
      ORDER BY selected_products.product_rank, matching.stock_rank`
    : `${select} ORDER BY ${order} LIMIT $${dataValues.length - 1} OFFSET $${dataValues.length}`, dataValues);
  const summaryResult = await database.query(`SELECT COUNT(DISTINCT p.id)::int AS total_products,
    COALESCE(SUM(CASE WHEN psd.inventory_configured THEN psd.stock_quantity ELSE 0 END),0)::int AS total_units,
    COUNT(*) FILTER (WHERE psd.inventory_configured AND psd.stock_quantity > 0 AND psd.stock_quantity <= psd.low_stock_threshold_quantity)::int AS low_stock_sizes,
    COUNT(*) FILTER (WHERE psd.inventory_configured AND psd.stock_quantity = 0)::int AS out_of_stock_sizes,
    COUNT(*) FILTER (WHERE NOT psd.inventory_configured)::int AS setup_required_sizes
    FROM product_size_details psd JOIN products p ON p.id = psd.product_id
    WHERE p.is_active = TRUE AND psd.is_active = TRUE`);
  return { items: result.rows.map(row), summary: {
    totalProducts: summaryResult.rows[0].total_products, totalUnits: summaryResult.rows[0].total_units,
    lowStockSizes: summaryResult.rows[0].low_stock_sizes, outOfStockSizes: summaryResult.rows[0].out_of_stock_sizes,
    setupRequiredSizes: summaryResult.rows[0].setup_required_sizes
  }, pagination: { page, limit, total: count.rows[0].count, pages: Math.max(1, Math.ceil(count.rows[0].count / limit)) } };
}

async function adjust(inventoryId, { adjustment, reason }, adminId, database = pool) {
  if (!Number.isSafeInteger(adjustment) || adjustment === 0 || Math.abs(adjustment) > 1000000) throw fault(400, 'Adjustment must be a non-zero whole number.');
  if (typeof reason !== 'string' || reason.trim().length < 2 || reason.length > 500) throw fault(400, 'Enter a reason for the stock adjustment.');
  const client = await database.connect();
  try {
    await client.query('BEGIN');
    const found = await client.query(`SELECT psd.*, p.name AS product_name, s.name AS size_name
      FROM product_size_details psd JOIN products p ON p.id = psd.product_id JOIN sizes s ON s.id = psd.size_id
      WHERE psd.id = $1 AND psd.is_active = TRUE FOR UPDATE OF psd`, [inventoryId]);
    const item = found.rows[0];
    if (!item) throw fault(404, 'Size inventory not found.');
    if (!item.inventory_configured) throw fault(409, 'Configure opening stock from Edit Product before making adjustments.');
    const before = Number(item.stock_quantity); const after = before + adjustment;
    if (after < 0) throw fault(409, `Cannot reduce ${item.size_name} below zero.`);
    await client.query('UPDATE product_size_details SET stock_quantity = $1, updated_at = NOW() WHERE id = $2', [after, inventoryId]);
    await inventory.recordMovement(client, { inventoryId, productId: item.product_id, sizeId: item.size_id,
      movementType: 'ADMIN_ADJUSTMENT', quantityChange: adjustment, quantityBefore: before, quantityAfter: after,
      reason: reason.trim(), createdBy: adminId });
    await client.query('COMMIT');
    return { inventoryId, productName: item.product_name, size: item.size_name, previousStock: before, currentStock: after };
  } catch (error) { await client.query('ROLLBACK').catch(() => {}); throw error; }
  finally { client.release(); }
}

async function history(inventoryId, database = pool) {
  const found = await database.query('SELECT id FROM product_size_details WHERE id = $1', [inventoryId]);
  if (!found.rows.length) throw fault(404, 'Size inventory not found.');
  const result = await database.query(`SELECT im.id, im.movement_type, im.quantity_change, im.quantity_before,
    im.quantity_after, im.reason, im.created_at, o.order_number, rr.return_number, u.name AS created_by_name
    FROM inventory_movements im LEFT JOIN orders o ON o.id = im.order_id
    LEFT JOIN return_requests rr ON rr.id = im.return_id LEFT JOIN users u ON u.id = im.created_by
    WHERE im.product_size_detail_id = $1 ORDER BY im.created_at DESC, im.id DESC LIMIT 100`, [inventoryId]);
  return result.rows.map(item => ({ id: item.id, type: item.movement_type, quantityChange: item.quantity_change,
    quantityBefore: item.quantity_before, quantityAfter: item.quantity_after, reason: item.reason,
    orderNumber: item.order_number || null, returnNumber: item.return_number || null,
    createdBy: item.created_by_name || 'System', createdAt: item.created_at }));
}

module.exports = { list, adjust, history };
