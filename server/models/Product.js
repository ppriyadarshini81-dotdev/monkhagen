const { pool } = require('../config/db');

function slugify(value) {
  return String(value)
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function formatVariant(row) {
  return {
    id: row.id,
    size: row.size_name || row.size,
    color: row.color_name || row.color,
    sizeId: row.size_id || null,
    colorId: row.color_id || null,
    sku: row.sku || null,
    price: row.price !== null ? Number(row.price) : null,
    stock: row.stock,
    isActive: row.is_active
  };
}

function formatImage(row) {
  return {
    id: row.id,
    url: row.image_url,
    cloudinaryPublicId: row.cloudinary_public_id || null,
    displayOrder: row.display_order,
    isPrimary: row.is_primary
  };
}

// Produces a response compatible with the existing Angular frontend
function formatRow(row, images = [], variants = [], sizeDetails = [], colorDetails = []) {
  const activeVariants = variants.filter((v) => v.isActive);
  const sizes = sizeDetails.length
    ? sizeDetails.map((detail) => detail.name)
    : [...new Set(activeVariants.map((v) => v.size))];
  const colors = colorDetails.length
    ? colorDetails.map((detail) => detail.name)
    : [...new Set(activeVariants.map((v) => v.color))];
  const stock = variants.length
    ? activeVariants.reduce((s, v) => s + v.stock, 0)
    : Number(row.agg_stock || 0);
  const prices = activeVariants.map((v) => v.price !== null ? v.price : Number(row.base_price));
  const price = prices.length
    ? Math.min(...prices)
    : Number(row.min_price !== null && row.min_price !== undefined ? row.min_price : row.base_price);
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
    imageObjects: images,
    variants,
    sizes,
    colors,
    sizeIds: sizeDetails.map((detail) => detail.id),
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
    v.min_price
  FROM products p
  JOIN categories c ON c.id = p.category_id
  LEFT JOIN badges b ON b.id = p.badge_id
  LEFT JOIN LATERAL (
    SELECT ARRAY_AGG(img.image_url ORDER BY img.is_primary DESC, img.display_order, img.created_at) AS image_urls
    FROM product_images img
    WHERE img.product_id = p.id
  ) image_list ON TRUE
  LEFT JOIN LATERAL (
    SELECT
      SUM(pv.stock)              AS total_stock,
      MIN(COALESCE(pv.price, p.base_price)) AS min_price
    FROM product_variants pv
    WHERE pv.product_id = p.id AND pv.is_active = TRUE
  ) v ON TRUE
`;

async function fetchVariantsAndImages(productId) {
  const [imgRes, varRes, sizeRes, colorRes] = await Promise.all([
    pool.query('SELECT * FROM product_images WHERE product_id = $1 ORDER BY display_order, created_at', [productId]),
    pool.query(
      `SELECT pv.*, s.name AS size_name, c.name AS color_name
       FROM product_variants pv
       LEFT JOIN sizes s ON s.id = pv.size_id
       LEFT JOIN colors c ON c.id = pv.color_id
       WHERE pv.product_id = $1
       ORDER BY COALESCE(s.name, pv.size), COALESCE(c.name, pv.color)`,
      [productId]
    ),
    pool.query(
      `SELECT s.id, s.name
       FROM product_size_details psd
       JOIN sizes s ON s.id = psd.size_id
       WHERE psd.product_id = $1
       ORDER BY s.name`,
      [productId]
    ),
    pool.query(
      `SELECT c.id, c.name
       FROM product_color_details pcd
       JOIN colors c ON c.id = pcd.color_id
       WHERE pcd.product_id = $1
       ORDER BY c.name`,
      [productId]
    )
  ]);
  return {
    images: imgRes.rows.map(formatImage),
    variants: varRes.rows.map(formatVariant),
    sizeDetails: sizeRes.rows,
    colorDetails: colorRes.rows
  };
}

async function replaceImages(client, productId, images) {
  await client.query('DELETE FROM product_images WHERE product_id = $1', [productId]);
  for (let i = 0; i < images.length; i++) {
    const image = images[i];
    const url = typeof image === 'string' ? image : image.url;
    if (!url) continue;
    await client.query(
      `INSERT INTO product_images
         (product_id, image_url, cloudinary_public_id, display_order, is_primary)
       VALUES ($1, $2, $3, $4, $5)`,
      [productId, url, typeof image === 'string' ? null : image.cloudinaryPublicId || null, i, i === 0]
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
         stock = EXCLUDED.stock,
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
        variant.stock ?? 0,
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

const Product = {
  isValidId(str) { return UUID_RE.test(str); },

  async findAll({ category, search, featured } = {}) {
    const conditions = ['p.is_active = TRUE'];
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

    const { rows } = await pool.query(
      `${LIST_Q} WHERE ${conditions.join(' AND ')} ORDER BY p.featured DESC, p.created_at DESC`,
      params
    );
    // Return every image so selected storefront cards can rotate their media.
    return rows.map((r) => {
      const images = (r.image_urls || []).map((url, index) => ({
        url,
        isPrimary: index === 0,
        displayOrder: index
      }));
      return formatRow(r, images, []);
    });
  },

  async findById(id, { full = true } = {}) {
    const { rows } = await pool.query(`${LIST_Q} WHERE p.id = $1`, [id]);
    if (!rows[0]) return null;
    if (!full) return formatRow(rows[0]);
    const { images, variants, sizeDetails, colorDetails } = await fetchVariantsAndImages(id);
    return formatRow(rows[0], images, variants, sizeDetails, colorDetails);
  },

  async findBySlug(slug, { full = true } = {}) {
    const { rows } = await pool.query(`${LIST_Q} WHERE p.slug = $1`, [slug]);
    if (!rows[0]) return null;
    if (!full) return formatRow(rows[0]);
    const { images, variants, sizeDetails, colorDetails } = await fetchVariantsAndImages(rows[0].id);
    return formatRow(rows[0], images, variants, sizeDetails, colorDetails);
  },

  async findVariantById(variantId) {
    const { rows } = await pool.query(
      `SELECT pv.*, p.name AS product_name, p.base_price,
              COALESCE(pv.price, p.base_price) AS effective_price
       FROM product_variants pv
       JOIN products p ON p.id = pv.product_id
       WHERE pv.id = $1 AND pv.is_active = TRUE`,
      [variantId]
    );
    if (!rows[0]) return null;
    const r = rows[0];
    return {
      id: r.id, productId: r.product_id, productName: r.product_name,
      sku: r.sku || null, size: r.size, color: r.color,
      price: Number(r.effective_price), stock: r.stock
    };
  },

  async create({
    name, categoryId, description = '', basePrice, featured = false, badgeId = null,
    images = [], variants = [], sizeIds = [], colorIds = []
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
      await replaceImages(client, productId, images);
      await replaceProductOptions(client, productId, 'product_size_details', 'size_id', sizeIds);
      await replaceProductOptions(client, productId, 'product_color_details', 'color_id', colorIds);
      await replaceVariants(client, productId, variants);
      await client.query('COMMIT');
      return this.findById(productId);
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
      if (Array.isArray(data.images)) await replaceImages(client, id, data.images);
      if (Array.isArray(data.sizeIds)) {
        await replaceProductOptions(client, id, 'product_size_details', 'size_id', data.sizeIds);
      }
      if (Array.isArray(data.colorIds)) {
        await replaceProductOptions(client, id, 'product_color_details', 'color_id', data.colorIds);
      }
      if (Array.isArray(data.variants)) await replaceVariants(client, id, data.variants);
      await client.query('COMMIT');
      return this.findById(id);
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

