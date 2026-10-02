const { pool } = require('../config/db');

function slugify(value) {
  return String(value)
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function formatVariant(row, exposeInventory = false) {
  const configured = Boolean(row.inventory_configured);
  const available = configured && row.size_inventory_active !== false && Number(row.size_stock || 0) > 0;
  return {
    id: row.id,
    size: row.size_name || row.size,
    color: row.color_name || row.color,
    sizeId: row.size_id || null,
    colorId: row.color_id || null,
    sku: row.sku || null,
    price: row.price !== null ? Number(row.price) : null,
    stock: exposeInventory ? Number(row.size_stock || 0) : (available ? 100 : 0),
    available,
    lowStock: available && Number(row.size_stock || 0) <= Number(row.low_stock_threshold_quantity || 0),
    isActive: row.is_active
  };
}

function formatImage(row) {
  return {
    id: row.id,
    url: row.image_url,
    zoomUrl: row.zoom_image_url || null,
    cloudinaryPublicId: row.cloudinary_public_id || null,
    displayOrder: row.display_order,
    isPrimary: row.is_primary
  };
}

// Produces a response compatible with the existing Angular frontend
function formatRow(row, images = [], variants = [], sizeDetails = [], colorDetails = [], exposeInventory = false) {
  const activeVariants = variants.filter((v) => v.isActive);
  const activeSizes = sizeDetails.filter(detail => detail.inventory_active !== false);
  const sizes = sizeDetails.length
    ? activeSizes.map((detail) => detail.name)
    : [...new Set(activeVariants.map((v) => v.size))];
  const colors = colorDetails.length
    ? colorDetails.map((detail) => detail.name)
    : [...new Set(activeVariants.map((v) => v.color))];
  const exactStock = sizeDetails.length
    ? activeSizes.filter(detail => detail.inventory_configured).reduce((sum, detail) => sum + Number(detail.stock_quantity || 0), 0)
    : Number(row.agg_stock || 0);
  const setupRequired = sizeDetails.length
    ? activeSizes.some(detail => !detail.inventory_configured)
    : Boolean(row.inventory_setup_required);
  const stock = exposeInventory ? exactStock : (exactStock > 0 && !setupRequired ? 1 : 0);
  const prices = activeVariants.map((v) => v.price !== null ? v.price : Number(row.base_price));
  const price = prices.length
    ? Math.min(...prices)
    : Number(row.min_price !== null && row.min_price !== undefined ? row.min_price : row.base_price);
  const zoomImages = images.some((image) => image.zoomUrl)
    ? images.map((image) => image.zoomUrl || null)
    : [];
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    description: row.description,
    basePrice: Number(row.base_price),
    price,
    featured: row.featured,
    badge: row.badge_name || '',
    badgeId: row.badge_id || null,
    isActive: row.is_active,
    // Backward-compat fields the Angular frontend already uses
    category: row.category_name || null,
    categoryId: row.category_id,
    categorySlug: row.category_slug || null,
    images: images.map((i) => i.url),
    zoomImages,
    imageObjects: images,
    variants,
    sizeAvailability: activeSizes.map(detail => ({
      size: detail.name,
      sizeId: detail.id,
      available: Boolean(detail.inventory_configured) && Number(detail.stock_quantity || 0) > 0,
      lowStock: Boolean(detail.inventory_configured) && Number(detail.stock_quantity || 0) > 0 &&
        Number(detail.stock_quantity || 0) <= Number(detail.low_stock_threshold_quantity || 0)
    })),
    ...(exposeInventory ? { sizeInventory: activeSizes.map(detail => ({
      id: detail.inventory_id,
      size: detail.name,
      sizeId: detail.id,
      stockQuantity: Number(detail.stock_quantity || 0),
      initialStockQuantity: Number(detail.initial_stock_quantity || 0),
      lowStockThresholdQuantity: Number(detail.low_stock_threshold_quantity || 0),
      configured: Boolean(detail.inventory_configured),
      active: detail.inventory_active !== false,
      updatedAt: detail.inventory_updated_at || null
    })) } : {}),
    inventorySetupRequired: setupRequired,
    sizes,
    colors,
    sizeIds: activeSizes.map((detail) => detail.id),
    colorIds: colorDetails.map((detail) => detail.id),
    stock,
    rating: 0,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

// List query — joins category + primary image + aggregated variant data via LATERAL
const LIST_Q = `
  SELECT
    p.*,
    c.name  AS category_name,
    c.slug  AS category_slug,
    b.name  AS badge_name,
    image_list.image_urls,
    COALESCE(v.total_stock, 0) AS agg_stock,
    COALESCE(v.inventory_setup_required, FALSE) AS inventory_setup_required,
    v.min_price
  FROM products p
  JOIN categories c ON c.id = p.category_id
  LEFT JOIN badges b ON b.id = p.badge_id AND b.is_active = TRUE
  LEFT JOIN LATERAL (
    SELECT ARRAY_AGG(img.image_url ORDER BY img.is_primary DESC, img.display_order, img.created_at) AS image_urls
    FROM product_images img
    WHERE img.product_id = p.id
  ) image_list ON TRUE
  LEFT JOIN LATERAL (
    SELECT
      SUM(CASE WHEN psd.inventory_configured AND psd.is_active THEN psd.stock_quantity ELSE 0 END) AS total_stock,
      BOOL_OR(psd.is_active AND NOT psd.inventory_configured) AS inventory_setup_required,
      (SELECT MIN(COALESCE(pv.price, p.base_price)) FROM product_variants pv
        WHERE pv.product_id = p.id AND pv.is_active = TRUE) AS min_price
    FROM product_size_details psd
    WHERE psd.product_id = p.id AND psd.is_active = TRUE
  ) v ON TRUE
`;

async function fetchVariantsAndImages(productId, { activeOnly = false } = {}) {
  const [imgRes, varRes, sizeRes, colorRes] = await Promise.all([
    pool.query('SELECT * FROM product_images WHERE product_id = $1 ORDER BY display_order, created_at', [productId]),
    pool.query(
      `SELECT pv.*, s.name AS size_name, c.name AS color_name,
         psd.stock_quantity AS size_stock, psd.low_stock_threshold_quantity,
         psd.inventory_configured, psd.is_active AS size_inventory_active
       FROM product_variants pv
       LEFT JOIN sizes s ON s.id = pv.size_id
       LEFT JOIN colors c ON c.id = pv.color_id
       LEFT JOIN product_size_details psd ON psd.product_id = pv.product_id AND psd.size_id = pv.size_id
       WHERE pv.product_id = $1 ${activeOnly ? 'AND pv.is_active = TRUE AND (s.id IS NULL OR s.is_active = TRUE) AND (c.id IS NULL OR c.is_active = TRUE)' : ''}
       ORDER BY CASE UPPER(COALESCE(s.name, pv.size)) WHEN 'XXS' THEN 0 WHEN 'XS' THEN 1 WHEN 'S' THEN 2 WHEN 'M' THEN 3 WHEN 'L' THEN 4 WHEN 'XL' THEN 5 WHEN 'XXL' THEN 6 WHEN '2XL' THEN 6 WHEN 'XXXL' THEN 7 WHEN '3XL' THEN 7 ELSE 100 END,
         COALESCE(s.name, pv.size), COALESCE(c.name, pv.color)`,
      [productId]
    ),
    pool.query(
      `SELECT s.id, s.name, psd.id AS inventory_id, psd.stock_quantity,
         psd.initial_stock_quantity, psd.low_stock_threshold_quantity,
         psd.inventory_configured, psd.is_active AS inventory_active,
         psd.updated_at AS inventory_updated_at
       FROM product_size_details psd
       JOIN sizes s ON s.id = psd.size_id
       WHERE psd.product_id = $1 ${activeOnly ? 'AND s.is_active = TRUE AND psd.is_active = TRUE' : ''}
       ORDER BY CASE UPPER(s.name) WHEN 'XXS' THEN 0 WHEN 'XS' THEN 1 WHEN 'S' THEN 2 WHEN 'M' THEN 3 WHEN 'L' THEN 4 WHEN 'XL' THEN 5 WHEN 'XXL' THEN 6 WHEN '2XL' THEN 6 WHEN 'XXXL' THEN 7 WHEN '3XL' THEN 7 ELSE 100 END, s.name`,
      [productId]
    ),
    pool.query(
      `SELECT c.id, c.name
       FROM product_color_details pcd
       JOIN colors c ON c.id = pcd.color_id
       WHERE pcd.product_id = $1 ${activeOnly ? 'AND c.is_active = TRUE' : ''}
       ORDER BY c.name`,
      [productId]
    )
  ]);
  return {
    images: imgRes.rows.map(formatImage),
    variants: varRes.rows,
    sizeDetails: sizeRes.rows,
    colorDetails: colorRes.rows
  };
}

async function replaceImages(client, productId, images, zoomImages = []) {
  await client.query('DELETE FROM product_images WHERE product_id = $1', [productId]);
  for (let i = 0; i < images.length; i++) {
    const image = images[i];
    const url = typeof image === 'string' ? image : image.url;
    if (!url) continue;
    const zoomUrl = typeof image === 'string'
      ? (zoomImages[i] || null)
      : (image.zoomUrl || image.zoomImageUrl || zoomImages[i] || null);
    await client.query(
      `INSERT INTO product_images
         (product_id, image_url, zoom_image_url, cloudinary_public_id, display_order, is_primary)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [productId, url, zoomUrl, typeof image === 'string' ? null : image.cloudinaryPublicId || null, i, i === 0]
    );
  }
}

async function replaceVariants(client, productId, variants) {
  // Carts and order history reference variant IDs. Never delete/recreate them
  // during a product edit; retain removed combinations as inactive history.
  await client.query(
    'UPDATE product_variants SET is_active = FALSE, updated_at = NOW() WHERE product_id = $1',
    [productId]
  );
  for (const variant of variants) {
    await client.query(
      `INSERT INTO product_variants
         (product_id, size, color, size_id, color_id, sku, price, stock, is_active)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT (product_id, size, color) DO UPDATE SET
         size_id = EXCLUDED.size_id,
         color_id = EXCLUDED.color_id,
         sku = CASE WHEN $10 THEN EXCLUDED.sku ELSE product_variants.sku END,
         price = CASE WHEN $11 THEN EXCLUDED.price ELSE product_variants.price END,
         stock = 0,
         is_active = EXCLUDED.is_active,
         updated_at = NOW()`,
      [
        productId,
        variant.size,
        variant.color,
        variant.sizeId || null,
        variant.colorId || null,
        variant.sku || null,
        variant.price ?? null,
        0,
        variant.isActive ?? true,
        Object.prototype.hasOwnProperty.call(variant, 'sku'),
        Object.prototype.hasOwnProperty.call(variant, 'price')
      ]
    );
  }
}

async function replaceProductOptions(client, productId, table, column, optionIds) {
  await client.query(`DELETE FROM ${table} WHERE product_id = $1`, [productId]);
  for (const optionId of [...new Set(optionIds)]) {
    await client.query(
      `INSERT INTO ${table} (product_id, ${column}) VALUES ($1, $2)`,
      [productId, optionId]
    );
  }
}

async function replaceSizeInventory(client, productId, sizeIds, sizeInventory, createdBy = null, reason = null) {
  const selected = [...new Set(sizeIds)];
  const inventoryBySize = new Map((sizeInventory || []).map(item => [item.sizeId, item]));
  if (selected.some(sizeId => !inventoryBySize.has(sizeId))) {
    throw Object.assign(new Error('Enter stock for every selected size.'), { status: 400 });
  }
  const deselected = await client.query(`SELECT psd.id, s.name, psd.stock_quantity
    FROM product_size_details psd JOIN sizes s ON s.id = psd.size_id
    WHERE psd.product_id = $1 AND psd.is_active = TRUE AND NOT (psd.size_id = ANY($2::uuid[])) FOR UPDATE`,
  [productId, selected]);
  const stocked = deselected.rows.find(row => Number(row.stock_quantity) > 0);
  if (stocked) throw Object.assign(new Error(`Set ${stocked.name} stock to 0 before removing that size.`), { status: 409 });
  await client.query(`UPDATE product_size_details SET is_active = FALSE, updated_at = NOW()
    WHERE product_id = $1 AND NOT (size_id = ANY($2::uuid[]))`, [productId, selected]);

  for (const sizeId of selected) {
    const input = inventoryBySize.get(sizeId);
    const quantity = Number(input.stockQuantity);
    const requestedThreshold = input.lowStockThresholdQuantity;
    if (!Number.isSafeInteger(quantity) || quantity < 0 || quantity > 1000000 ||
        (requestedThreshold != null && (!Number.isSafeInteger(Number(requestedThreshold)) || Number(requestedThreshold) < 0 || Number(requestedThreshold) > 1000000))) {
      throw Object.assign(new Error('Size stock and threshold must be whole non-negative numbers.'), { status: 400 });
    }
    const existingResult = await client.query(
      'SELECT * FROM product_size_details WHERE product_id = $1 AND size_id = $2 FOR UPDATE', [productId, sizeId]
    );
    const existing = existingResult.rows[0];
    const before = existing?.inventory_configured ? Number(existing.stock_quantity) : 0;
    const initial = existing?.inventory_configured ? Number(existing.initial_stock_quantity) : quantity;
    const threshold = requestedThreshold == null
      ? (existing?.inventory_configured ? Number(existing.low_stock_threshold_quantity) : Math.ceil(initial * 0.1))
      : Number(requestedThreshold);
    const saved = await client.query(`INSERT INTO product_size_details
      (product_id, size_id, stock_quantity, initial_stock_quantity, low_stock_threshold_quantity,
       inventory_configured, is_active, updated_at)
      VALUES ($1,$2,$3,$4,$5,TRUE,TRUE,NOW())
      ON CONFLICT (product_id, size_id) DO UPDATE SET
        stock_quantity = EXCLUDED.stock_quantity,
        initial_stock_quantity = CASE WHEN product_size_details.inventory_configured
          THEN product_size_details.initial_stock_quantity ELSE EXCLUDED.initial_stock_quantity END,
        low_stock_threshold_quantity = EXCLUDED.low_stock_threshold_quantity,
        inventory_configured = TRUE, is_active = TRUE, updated_at = NOW()
      RETURNING id`, [productId, sizeId, quantity, initial, threshold]);
    const change = quantity - before;
    if (change !== 0) {
      await client.query(`INSERT INTO inventory_movements
        (product_size_detail_id, product_id, size_id, movement_type, quantity_change,
         quantity_before, quantity_after, reason, created_by)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [saved.rows[0].id, productId, sizeId, existing?.inventory_configured ? 'ADMIN_ADJUSTMENT' : 'OPENING_STOCK',
        change, before, quantity, reason || (existing?.inventory_configured ? 'Product stock updated' : 'Opening size stock'), createdBy]);
    }
  }
}

const Product = {
  isValidId(str) { return UUID_RE.test(str); },

  async findAll({ category, search, featured, activeOnly = true, exposeInventory = false, limit = 100, offset = 0 } = {}) {
    const conditions = activeOnly ? ['p.is_active = TRUE', 'c.is_active = TRUE'] : ['TRUE'];
    const params = [];
    let idx = 1;

    if (category && category.toLowerCase() !== 'all') {
      conditions.push(`LOWER(c.name) = LOWER($${idx++})`);
      params.push(category);
    }
    if (featured) conditions.push('p.featured = TRUE');
    if (search) {
      conditions.push(`(p.name ILIKE $${idx} OR p.description ILIKE $${idx} OR c.name ILIKE $${idx})`);
      params.push(`%${search}%`);
      idx++;
    }

    params.push(limit, offset);
    const { rows } = await pool.query(
      `${LIST_Q} WHERE ${conditions.join(' AND ')} ORDER BY p.featured DESC, p.created_at DESC LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );
    // Return every image so selected storefront cards can rotate their media.
    return rows.map((r) => {
      const images = (r.image_urls || []).map((url, index) => ({
        url,
        isPrimary: index === 0,
        displayOrder: index
      }));
      return formatRow(r, images, [], [], [], exposeInventory);
    });
  },

  async findById(id, { full = true, activeOnly = false, exposeInventory = false } = {}) {
    const { rows } = await pool.query(`${LIST_Q} WHERE p.id = $1 ${activeOnly ? 'AND p.is_active = TRUE AND c.is_active = TRUE' : ''}`, [id]);
    if (!rows[0]) return null;
    if (!full) return formatRow(rows[0], [], [], [], [], exposeInventory);
    const { images, variants, sizeDetails, colorDetails } = await fetchVariantsAndImages(id, { activeOnly });
    return formatRow(rows[0], images, variants.map(row => formatVariant(row, exposeInventory)), sizeDetails, colorDetails, exposeInventory);
  },

  async findBySlug(slug, { full = true, activeOnly = false, exposeInventory = false } = {}) {
    const { rows } = await pool.query(`${LIST_Q} WHERE p.slug = $1 ${activeOnly ? 'AND p.is_active = TRUE AND c.is_active = TRUE' : ''}`, [slug]);
    if (!rows[0]) return null;
    if (!full) return formatRow(rows[0], [], [], [], [], exposeInventory);
    const { images, variants, sizeDetails, colorDetails } = await fetchVariantsAndImages(rows[0].id, { activeOnly });
    return formatRow(rows[0], images, variants.map(row => formatVariant(row, exposeInventory)), sizeDetails, colorDetails, exposeInventory);
  },

  async findVariantById(variantId) {
    const { rows } = await pool.query(
      `SELECT pv.*, p.name AS product_name, p.base_price,
              psd.stock_quantity AS size_stock, psd.inventory_configured, psd.is_active AS size_inventory_active,
              COALESCE(pv.price, p.base_price) AS effective_price
       FROM product_variants pv
       JOIN products p ON p.id = pv.product_id
       JOIN product_size_details psd ON psd.product_id = pv.product_id AND psd.size_id = pv.size_id
       WHERE pv.id = $1 AND pv.is_active = TRUE AND psd.is_active = TRUE AND psd.inventory_configured = TRUE`,
      [variantId]
    );
    if (!rows[0]) return null;
    const r = rows[0];
    return {
      id: r.id, productId: r.product_id, productName: r.product_name,
      sku: r.sku || null, size: r.size, color: r.color,
      price: Number(r.effective_price), stock: Number(r.size_stock), available: Number(r.size_stock) > 0
    };
  },

  async create({
    name, categoryId, description = '', basePrice, featured = false, badgeId = null,
    images = [], zoomImages = [], variants = [], sizeIds = [], colorIds = [], sizeInventory = [], createdBy = null,
    inventoryReason = null
  }) {
    const slug = `${slugify(name)}-${Date.now().toString(36).slice(-4)}`;
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const { rows } = await client.query(
        `INSERT INTO products (name, slug, category_id, description, base_price, featured, badge_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
        [name, slug, categoryId, description, basePrice, featured, badgeId || null]
      );
      const productId = rows[0].id;
      await replaceImages(client, productId, images, zoomImages);
      await replaceSizeInventory(client, productId, sizeIds, sizeInventory, createdBy, inventoryReason);
      await replaceProductOptions(client, productId, 'product_color_details', 'color_id', colorIds);
      await replaceVariants(client, productId, variants);
      await client.query('COMMIT');
      return this.findById(productId, { exposeInventory: true });
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  },

  async update(id, data) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const fieldMap = {
        basePrice: 'base_price', categoryId: 'category_id', badgeId: 'badge_id', isActive: 'is_active'
      };
      const fields = [];
      const values = [];
      for (const [js, db] of Object.entries(fieldMap)) {
        if (data[js] !== undefined) {
          fields.push(`${db} = $${values.length + 1}`);
          values.push(js === 'badgeId' ? data[js] || null : data[js]);
        }
      }
      for (const key of ['name', 'description', 'featured']) {
        if (data[key] !== undefined) {
          fields.push(`${key} = $${values.length + 1}`);
          values.push(data[key]);
        }
      }
      if (fields.length) {
        values.push(id);
        await client.query(
          `UPDATE products SET ${fields.join(', ')}, updated_at = NOW() WHERE id = $${values.length}`,
          values
        );
      }
      if (Array.isArray(data.images)) await replaceImages(client, id, data.images, data.zoomImages || []);
      if (Array.isArray(data.sizeIds)) {
        await replaceSizeInventory(client, id, data.sizeIds, data.sizeInventory || [], data.createdBy || null, data.inventoryReason || null);
      }
      if (Array.isArray(data.colorIds)) {
        await replaceProductOptions(client, id, 'product_color_details', 'color_id', data.colorIds);
      }
      if (Array.isArray(data.variants)) await replaceVariants(client, id, data.variants);
      await client.query('COMMIT');
      return this.findById(id, { exposeInventory: true });
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  },

  async findByIdAndDelete(id) {
    const product = await this.findById(id, { full: false });
    if (!product) return null;
    await pool.query('DELETE FROM products WHERE id = $1', [id]);
    return product;
  },

  async categoryProductCounts() {
    const { rows } = await pool.query(
      `SELECT c.name AS _id, COUNT(p.id)::int AS count
       FROM categories c
       LEFT JOIN products p ON p.category_id = c.id AND p.is_active = TRUE
       GROUP BY c.name`
    );
    return rows.map((r) => ({ _id: r._id, count: r.count }));
  },

  async deleteMany() {
    await pool.query('DELETE FROM products');
  }
};

module.exports = Product;

