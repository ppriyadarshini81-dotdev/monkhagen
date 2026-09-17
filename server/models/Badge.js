const { pool } = require('../config/db');

function format(row) {
  return {
    id: row.id,
    name: row.name,
    isActive: row.is_active,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

const Badge = {
  async find({ activeOnly = true } = {}) {
    const where = activeOnly ? 'WHERE is_active = TRUE' : '';
    const { rows } = await pool.query(`SELECT * FROM badges ${where} ORDER BY name ASC`);
    return rows.map(format);
  },

  async findById(id) {
    const { rows } = await pool.query('SELECT * FROM badges WHERE id = $1', [id]);
    return rows[0] ? format(rows[0]) : null;
  },

  async create({ name }) {
    const { rows } = await pool.query(
      'INSERT INTO badges (name) VALUES ($1) RETURNING *',
      [name]
    );
    return format(rows[0]);
  },

  async update(id, data) {
    const fields = [];
    const values = [];
    if (data.name !== undefined) {
      fields.push(`name = $${values.length + 1}`);
      values.push(data.name);
    }
    if (data.isActive !== undefined) {
      fields.push(`is_active = $${values.length + 1}`);
      values.push(data.isActive);
    }
    if (!fields.length) return this.findById(id);

    values.push(id);
    const { rows } = await pool.query(
      `UPDATE badges SET ${fields.join(', ')}, updated_at = NOW()
       WHERE id = $${values.length} RETURNING *`,
      values
    );
    return rows[0] ? format(rows[0]) : null;
  },

  async remove(id) {
    const { rows } = await pool.query('DELETE FROM badges WHERE id = $1 RETURNING *', [id]);
    return rows[0] ? format(rows[0]) : null;
  }
};

module.exports = Badge;
