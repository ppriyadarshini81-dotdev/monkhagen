const { pool } = require('../config/db');

function format(row) {
  if (!row) return null;
  return { heroImages: row.hero_images, adVideoUrl: row.ad_video_url,
    adVideoPosterUrl: row.ad_video_poster_url, instagramPosts: row.instagram_posts,
    instagramProfileUrl: row.instagram_profile_url, revision: row.revision, updatedAt: row.updated_at };
}

module.exports = {
  async get() {
    const { rows } = await pool.query('SELECT * FROM homepage_media WHERE id = TRUE');
    return format(rows[0]);
  },
  async save(content) {
    const { rows } = await pool.query(`UPDATE homepage_media SET
      hero_images = $1::jsonb, ad_video_url = $2, ad_video_poster_url = $3,
      instagram_posts = $4::jsonb, instagram_profile_url = $5,
      revision = revision + 1, updated_at = NOW()
      WHERE id = TRUE AND revision = $6 RETURNING *`, [JSON.stringify(content.heroImages),
      content.adVideoUrl, content.adVideoPosterUrl, JSON.stringify(content.instagramPosts),
      content.instagramProfileUrl, content.revision]);
    if (!rows.length) throw Object.assign(new Error('Homepage media changed in another session. Reload the saved version before saving again.'), { status: 409 });
    return format(rows[0]);
  }
};
