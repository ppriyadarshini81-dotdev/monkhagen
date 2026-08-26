const { pool } = require('../config/db');
const bcrypt = require('bcryptjs');

// In-process cache so we don't query roles table on every operation
let roleCache = null;
async function getRoleId(name) {
  if (!roleCache) {
    const { rows } = await pool.query('SELECT id, name FROM roles');
    roleCache = Object.fromEntries(rows.map((r) => [r.name, r.id]));
  }
  return roleCache[name];
}

const BASE_Q = `
  SELECT u.*, r.name AS role_name
  FROM users u
  JOIN roles r ON r.id = u.role_id
`;

function format(row) {
  return {
    id: row.id,
    name: row.name || null,
    email: row.email || null,
    phone: row.phone || null,
    role: row.role_name,
    profileImage: row.profile_image || null,
    googleUid: row.google_uid || null,
    phoneVerified: row.phone_verified,
    emailVerified: row.email_verified,
    isActive: row.is_active,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function wrapRow(row) {
  if (!row) return null;
  return {
    ...format(row),
    passwordHash: row.password_hash,
    comparePassword(plain) { return bcrypt.compare(plain, row.password_hash); },
    toJSON() { return format(row); }
  };
}

const User = {
  async findById(id) {
    const { rows } = await pool.query(`${BASE_Q} WHERE u.id = $1`, [id]);
    return wrapRow(rows[0]);
  },
  async findOne({ email }) {
    const { rows } = await pool.query(
      `${BASE_Q} WHERE LOWER(u.email) = LOWER($1)`, [email]
    );
    return wrapRow(rows[0]);
  },
  async findByPhone(phone) {
    const { rows } = await pool.query(`${BASE_Q} WHERE u.phone = $1`, [phone]);
    return wrapRow(rows[0]);
  },
  async create({ name, email, passwordHash, role = 'admin' }) {
    const roleId = await getRoleId(role);
    const { rows } = await pool.query(
      `INSERT INTO users (name, email, password_hash, role_id, email_verified)
       VALUES ($1, $2, $3, $4, TRUE) RETURNING id`,
      [name, email, passwordHash, roleId]
    );
    return this.findById(rows[0].id);
  },
  async createByPhone({ phone, name, role = 'customer' }) {
    const roleId = await getRoleId(role);
    const { rows } = await pool.query(
      `INSERT INTO users (name, phone, role_id, phone_verified)
       VALUES ($1, $2, $3, TRUE) RETURNING id`,
      [name, phone, roleId]
    );
    return this.findById(rows[0].id);
  },
  async updateLastLogin(id) {
    await pool.query('UPDATE users SET last_login_at = NOW() WHERE id = $1', [id]);
  },
  async findByGoogleUid(googleUid) {
    const { rows } = await pool.query(`${BASE_Q} WHERE u.google_uid = $1`, [googleUid]);
    return wrapRow(rows[0]);
  },
  async createGoogleCustomer({ googleUid, email, name, profileImage, emailVerified }) {
    const roleId = await getRoleId('customer');
    const { rows } = await pool.query(
      `INSERT INTO users (name, email, google_uid, profile_image, role_id, email_verified, is_active)
       VALUES ($1, $2, $3, $4, $5, $6, TRUE) RETURNING id`,
      [name, email, googleUid, profileImage, roleId, emailVerified]
    );
    return this.findById(rows[0].id);
  },
  async linkGoogleUid(id, { uid, picture, name }) {
    await pool.query(
      `UPDATE users
       SET google_uid = $1, profile_image = $2,
           name = COALESCE(NULLIF($3, ''), name),
           last_login_at = NOW(), updated_at = NOW()
       WHERE id = $4`,
      [uid, picture, name, id]
    );
    return this.findById(id);
  },
  async updateGoogleUser(id, { name, picture }) {
    await pool.query(
      `UPDATE users
       SET profile_image = $1,
           name = COALESCE(NULLIF($2, ''), name),
           last_login_at = NOW(), updated_at = NOW()
       WHERE id = $3`,
      [picture, name, id]
    );
    return this.findById(id);
  },
  async deleteMany() {
    await pool.query('DELETE FROM users');
  },
  hashPassword(plain) { return bcrypt.hash(plain, 10); }
};

module.exports = User;
