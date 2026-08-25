const { pool } = require('../config/db');

function slugify(name) {
  return String(name).toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

function format(row) {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    image: row.image,
    description: row.description,
    isActive: row.is_active,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

const Category = {
  async find({ activeOnly = true } = {}) {
    const where = activeOnly ? 'WHERE is_active = TRUE' : '';
    const { rows } = await pool.query(`SELECT * FROM categories ${where} ORDER BY name ASC`);
    return rows.map(format);
  },

  async findOne({ slug, id } = {}) {
    if (slug) {
      const { rows } = await pool.query('SELECT * FROM categories WHERE slug = $1', [slug]);
      return rows[0] ? format(rows[0]) : null;
    }
    if (id) {
      const { rows } = await pool.query('SELECT * FROM categories WHERE id = $1', [id]);
      return rows[0] ? format(rows[0]) : null;
    }
    return null;
  },

  async create({ name, image = '', description = '' }) {
    const slug = slugify(name);
    const { rows } = await pool.query(
      `INSERT INTO categories (name, slug, image, description) VALUES ($1, $2, $3, $4) RETURNING *`,
      [name, slug, image, description]
    );
    return format(rows[0]);
  },

  async findByIdAndUpdate(id, data) {
    const fieldMap = { isActive: 'is_active' };
    const fields = [];
    const values = [];
    let idx = 1;
    for (const [jsKey, dbKey] of Object.entries(fieldMap)) {
      if (data[jsKey] !== undefined) { fields.push(`${dbKey} = $${idx++}`); values.push(data[jsKey]); }
    }
    for (const key of ['name', 'image', 'description']) {
      if (data[key] !== undefined) { fields.push(`${key} = $${idx++}`); values.push(data[key]); }
    }
    if (!fields.length) return this.findOne({ id });
    values.push(id);
    const { rows } = await pool.query(
      `UPDATE categories SET ${fields.join(', ')}, updated_at = NOW() WHERE id = $${idx} RETURNING *`,
      values
    );
    return rows[0] ? format(rows[0]) : null;
  },

  async findByIdAndDelete(id) {
    const { rows } = await pool.query('DELETE FROM categories WHERE id = $1 RETURNING *', [id]);
    return rows[0] ? format(rows[0]) : null;
  },

  async deleteMany() {
    await pool.query('DELETE FROM categories');
  }
};

module.exports = Category;
