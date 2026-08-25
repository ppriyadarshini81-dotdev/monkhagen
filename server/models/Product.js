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
    size: row.size,
    color: row.color,
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
function formatRow(row, images = [], variants = []) {
  const activeVariants = variants.filter((v) => v.isActive);
  const sizes = [...new Set(activeVariants.map((v) => v.size))];
  const colors = [...new Set(activeVariants.map((v) => v.color))];
  const stock = activeVariants.reduce((s, v) => s + v.stock, 0);
  const prices = activeVariants.map((v) => v.price !== null ? v.price : Number(row.base_price));
  const price = prices.length ? Math.min(...prices) : Number(row.base_price);
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    description: row.description,
    basePrice: Number(row.base_price),
    price,
    featured: row.featured,
    badge: row.badge,
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
    pi.image_url AS primary_image_url,
    COALESCE(v.total_stock, 0) AS agg_stock,
    v.min_price
  FROM products p
  JOIN categories c ON c.id = p.category_id
  LEFT JOIN product_images pi
    ON pi.product_id = p.id AND pi.is_primary = TRUE
  LEFT JOIN LATERAL (
    SELECT
      SUM(pv.stock)              AS total_stock,
      MIN(COALESCE(pv.price, p.base_price)) AS min_price
    FROM product_variants pv
    WHERE pv.product_id = p.id AND pv.is_active = TRUE
  ) v ON TRUE
`;

async function fetchVariantsAndImages(productId) {
  const [imgRes, varRes] = await Promise.all([
    pool.query('SELECT * FROM product_images WHERE product_id = $1 ORDER BY display_order, created_at', [productId]),
    pool.query('SELECT * FROM product_variants WHERE product_id = $1 ORDER BY size, color', [productId])
  ]);
  return { images: imgRes.rows.map(formatImage), variants: varRes.rows.map(formatVariant) };
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
    // For list view, use primary image only (no full variant/image fetch)
    return rows.map((r) => {
      const img = r.primary_image_url ? [{ url: r.primary_image_url, isPrimary: true }] : [];
      return formatRow(r, img, []);
    });
  },

  async findById(id, { full = true } = {}) {
    const { rows } = await pool.query(`${LIST_Q} WHERE p.id = $1`, [id]);
    if (!rows[0]) return null;
    if (!full) return formatRow(rows[0]);
    const { images, variants } = await fetchVariantsAndImages(id);
    return formatRow(rows[0], images, variants);
  },

  async findBySlug(slug, { full = true } = {}) {
    const { rows } = await pool.query(`${LIST_Q} WHERE p.slug = $1`, [slug]);
    if (!rows[0]) return null;
    if (!full) return formatRow(rows[0]);
    const { images, variants } = await fetchVariantsAndImages(rows[0].id);
    return formatRow(rows[0], images, variants);
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

  async create({ name, categoryId, description = '', basePrice, featured = false, badge = '', images = [], variants = [] }) {
    const slug = `${slugify(name)}-${Date.now().toString(36).slice(-4)}`;
    const { rows } = await pool.query(
      `INSERT INTO products (name, slug, category_id, description, base_price, featured, badge)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
      [name, slug, categoryId, description, basePrice, featured, badge]
    );
    const productId = rows[0].id;
    for (let i = 0; i < images.length; i++) {
      const img = images[i];
      await pool.query(
        `INSERT INTO product_images (product_id, image_url, cloudinary_public_id, display_order, is_primary)
         VALUES ($1,$2,$3,$4,$5)`,
        [productId, img.url || img, img.cloudinaryPublicId || null, i, i === 0]
      );
    }
    for (const v of variants) {
      await pool.query(
        `INSERT INTO product_variants (product_id, size, color, sku, price, stock)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [productId, v.size, v.color, v.sku || null, v.price || null, v.stock || 0]
      );
    }
    return this.findById(productId);
  },

  async update(id, data) {
    const fieldMap = { basePrice: 'base_price', categoryId: 'category_id', isActive: 'is_active' };
    const fields = [];
    const values = [];
    let idx = 1;
    for (const [js, db] of Object.entries(fieldMap)) {
      if (data[js] !== undefined) { fields.push(`${db} = $${idx++}`); values.push(data[js]); }
    }
    for (const key of ['name', 'description', 'featured', 'badge']) {
      if (data[key] !== undefined) { fields.push(`${key} = $${idx++}`); values.push(data[key]); }
    }
    if (fields.length) {
      fields.push('updated_at = NOW()');
      values.push(id);
      await pool.query(`UPDATE products SET ${fields.join(', ')} WHERE id = $${idx}`, values);
    }
    return this.findById(id);
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

