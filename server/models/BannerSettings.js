const { pool } = require('../config/db');
function format(row) {
  return row ? { messages: row.messages, revision: row.revision, updatedAt: row.updated_at } : null;
}
module.exports = {
  async get() {
    return format((await pool.query('SELECT * FROM banner_settings WHERE id = TRUE')).rows[0]);
  },
  async save({ messages, revision }) {
    const result = await pool.query(`UPDATE banner_settings SET messages = $1::jsonb,
      revision = revision + 1, updated_at = NOW() WHERE id = TRUE AND revision = $2 RETURNING *`,
    [JSON.stringify(messages), revision]);
    if (!result.rows.length) throw Object.assign(new Error('Banner changed in another session. Reload before saving again.'), { status: 409 });
    return format(result.rows[0]);
  }
};
