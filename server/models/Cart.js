const { pool } = require('../config/db');
const offers = require('../services/offerService');

function httpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function formatItem(row) {
  return {
    id: row.id,
    cartId: row.cart_id,
    productId: row.product_id,
    variantId: row.variant_id,
    quantity: row.quantity,
    productName: row.product_name || null,
    productSlug: row.product_slug || null,
    size: row.size || null,
    color: row.color || null,
    sku: row.sku || null,
    price: row.effective_price !== null ? Number(row.effective_price) : null,
    imageUrl: row.image_url || null,
    stock: row.stock !== undefined ? row.stock : null
  };
}

const Cart = {
  async getOrCreate(userId) {
    const { rows } = await pool.query(
      `SELECT id FROM carts WHERE user_id = $1 AND status = 'active' LIMIT 1`, [userId]
    );
    if (rows[0]) return rows[0].id;
    try {
      const { rows: newRows } = await pool.query(
        `INSERT INTO carts (user_id) VALUES ($1) RETURNING id`, [userId]
      );
      return newRows[0].id;
    } catch (error) {
      if (error.code !== '23505') throw error;
      const { rows: existingRows } = await pool.query(
        `SELECT id FROM carts WHERE user_id = $1 AND status = 'active' LIMIT 1`,
        [userId]
      );
      if (!existingRows[0]) throw error;
      return existingRows[0].id;
    }
  },

  async getWithItems(userId) {
    const cartId = await this.getOrCreate(userId);
    const { rows } = await pool.query(`
      SELECT
        ci.id, ci.cart_id, ci.product_id, ci.variant_id, ci.quantity,
        p.name  AS product_name,
        p.slug  AS product_slug,
        pv.size, pv.color, pv.sku,
        COALESCE(pv.price, p.base_price) AS effective_price,
        CASE WHEN psd.inventory_configured AND psd.is_active THEN psd.stock_quantity ELSE 0 END AS stock,
        pi.image_url
      FROM cart_items ci
      JOIN products p       ON p.id  = ci.product_id
      JOIN product_variants pv ON pv.id = ci.variant_id
      LEFT JOIN product_size_details psd ON psd.product_id = p.id AND psd.size_id = pv.size_id
      LEFT JOIN product_images pi ON pi.product_id = p.id AND pi.is_primary = TRUE
      WHERE ci.cart_id = $1
      ORDER BY ci.created_at
    `, [cartId]);
    const items = rows.map(formatItem);
    const total = items.reduce((s, i) => s + (i.price || 0) * i.quantity, 0);
    const prepaidOffer = await offers.firstPrepaidOffer(pool, userId, Math.round(total * 100));
    return { cartId, items, total, prepaidOffer: offers.publicOffer(prepaidOffer) };
  },

  async addItem(userId, { productId, variantId, quantity = 1 }) {
    const cartId = await this.getOrCreate(userId);
    const { rows: variantRows } = await pool.query(
      `SELECT psd.stock_quantity AS stock, pv.size
       FROM product_variants pv
       JOIN products p ON p.id = pv.product_id
       JOIN product_size_details psd ON psd.product_id = p.id AND psd.size_id = pv.size_id
       WHERE pv.id = $1
         AND pv.product_id = $2
         AND pv.is_active = TRUE
         AND p.is_active = TRUE
         AND psd.is_active = TRUE
         AND psd.inventory_configured = TRUE`,
      [variantId, productId]
    );
    if (!variantRows[0]) {
      throw httpError(409, 'The selected product size is unavailable.');
    }

    const { rows: itemRows } = await pool.query(
      `SELECT id, quantity FROM cart_items WHERE cart_id = $1 AND variant_id = $2`,
      [cartId, variantId]
    );
    const nextQuantity = Number(itemRows[0]?.quantity || 0) + quantity;
    if (!Number.isSafeInteger(nextQuantity) || nextQuantity < 1 || nextQuantity > 100) throw httpError(400, 'A maximum of 100 units per item is supported.');
    if (nextQuantity > variantRows[0].stock) {
      throw httpError(409, `${variantRows[0].size} has only ${variantRows[0].stock} item(s) available.`);
    }

    if (itemRows[0]) {
      await pool.query(
        `UPDATE cart_items
         SET quantity = $1, updated_at = NOW()
         WHERE id = $2 AND cart_id = $3`,
        [nextQuantity, itemRows[0].id, cartId]
      );
    } else {
      await pool.query(
        `INSERT INTO cart_items (cart_id, product_id, variant_id, quantity) VALUES ($1,$2,$3,$4)`,
        [cartId, productId, variantId, quantity]
      );
    }
    return this.getWithItems(userId);
  },

  async updateItem(userId, itemId, { quantity }) {
    const cartId = await this.getOrCreate(userId);
    const { rows } = await pool.query(
      `SELECT ci.id, pv.size, psd.stock_quantity AS stock
       FROM cart_items ci
       JOIN product_variants pv ON pv.id = ci.variant_id
       JOIN product_size_details psd ON psd.product_id = ci.product_id AND psd.size_id = pv.size_id
       WHERE ci.id = $1 AND ci.cart_id = $2`,
      [itemId, cartId]
    );
    if (!rows[0]) {
      throw httpError(404, 'Cart item not found.');
    }
    if (quantity > rows[0].stock) {
      throw httpError(409, `${rows[0].size} has only ${rows[0].stock} item(s) available.`);
    }

    await pool.query(
      `UPDATE cart_items SET quantity = $1, updated_at = NOW() WHERE id = $2 AND cart_id = $3`,
      [quantity, itemId, cartId]
    );
    return this.getWithItems(userId);
  },

  async removeItem(userId, itemId) {
    const cartId = await this.getOrCreate(userId);
    const { rowCount } = await pool.query(
      `DELETE FROM cart_items WHERE id = $1 AND cart_id = $2`,
      [itemId, cartId]
    );
    if (rowCount === 0) {
      throw httpError(404, 'Cart item not found.');
    }
    return this.getWithItems(userId);
  },

  async clear(userId) {
    const cartId = await this.getOrCreate(userId);
    await pool.query(`DELETE FROM cart_items WHERE cart_id = $1`, [cartId]);
  },

  async markConverted(userId) {
    await pool.query(
      `UPDATE carts SET status = 'converted', updated_at = NOW()
       WHERE user_id = $1 AND status = 'active'`,
      [userId]
    );
  }
};

module.exports = Cart;
