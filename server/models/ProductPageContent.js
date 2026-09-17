const { pool } = require('../config/db');

function formatContent(row) {
  if (!row) return null;
  return {
    sizeChartImageUrl: row.size_chart_image_url,
    careInstructions: row.care_instructions,
    deliveryEstimate: row.delivery_estimate,
    deliveryNote: row.delivery_note,
    updatedAt: row.updated_at
  };
}

module.exports = {
  async get() {
    const { rows } = await pool.query('SELECT * FROM product_page_content WHERE id = TRUE');
    return formatContent(rows[0]);
  },

  async save(content) {
    const { rows } = await pool.query(
      `INSERT INTO product_page_content
         (id, size_chart_image_url, care_instructions, delivery_estimate, delivery_note)
       VALUES (TRUE, $1, $2, $3, $4)
       ON CONFLICT (id) DO UPDATE SET
         size_chart_image_url = EXCLUDED.size_chart_image_url,
         care_instructions = EXCLUDED.care_instructions,
         delivery_estimate = EXCLUDED.delivery_estimate,
         delivery_note = EXCLUDED.delivery_note,
         updated_at = NOW()
       RETURNING *`,
      [content.sizeChartImageUrl, content.careInstructions, content.deliveryEstimate, content.deliveryNote]
    );
    return formatContent(rows[0]);
  }
};
