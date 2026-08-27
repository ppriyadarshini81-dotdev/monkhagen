const { pool } = require('../config/db');

const OPTIONS = {
  sizes: {
    column: 'size_id', valueColumn: 'size', detailTable: 'product_size_details'
  },
  colors: {
    column: 'color_id', valueColumn: 'color', detailTable: 'product_color_details'
  }
};

function config(table) {
  const selected = OPTIONS[table];
  if (!selected) throw new Error('Unsupported variant option table.');
  return selected;
}

function format(row) {
  return {
    id: row.id,
    name: row.name,
    isActive: row.is_active,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

const VariantOption = {
  async find(table, { activeOnly = true } = {}) {
    config(table);
    const where = activeOnly ? 'WHERE is_active = TRUE' : '';
    const { rows } = await pool.query(`SELECT * FROM ${table} ${where} ORDER BY name ASC`);
    return rows.map(format);
  },

  async findById(table, id) {
    config(table);
    const { rows } = await pool.query(`SELECT * FROM ${table} WHERE id = $1`, [id]);
    return rows[0] ? format(rows[0]) : null;
  },

  async create(table, name) {
    config(table);
    const { rows } = await pool.query(
      `INSERT INTO ${table} (name) VALUES ($1) RETURNING *`,
      [name]
    );
    return format(rows[0]);
  },

  async update(table, id, data) {
    const { column, valueColumn } = config(table);
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
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
      if (!fields.length) {
        await client.query('ROLLBACK');
        return this.findById(table, id);
      }
      values.push(id);
      const { rows } = await client.query(
        `UPDATE ${table} SET ${fields.join(', ')}, updated_at = NOW()
         WHERE id = $${values.length} RETURNING *`,
        values
      );
      if (rows[0] && data.name !== undefined) {
        await client.query(
          `UPDATE product_variants SET ${valueColumn} = $1, updated_at = NOW() WHERE ${column} = $2`,
          [data.name, id]
        );
      }
      await client.query('COMMIT');
      return rows[0] ? format(rows[0]) : null;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  },

  async usageCount(table, id) {
    const { column, detailTable } = config(table);
    const { rows } = await pool.query(
      `SELECT
         (SELECT COUNT(*) FROM product_variants WHERE ${column} = $1) +
         (SELECT COUNT(*) FROM ${detailTable} WHERE ${column} = $1) AS count`,
      [id]
    );
    return Number(rows[0].count);
  },

  async remove(table, id) {
    config(table);
    const { rows } = await pool.query(`DELETE FROM ${table} WHERE id = $1 RETURNING *`, [id]);
    return rows[0] ? format(rows[0]) : null;
  }
};

module.exports = VariantOption;
