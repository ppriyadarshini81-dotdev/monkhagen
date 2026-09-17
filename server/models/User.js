const { pool } = require('../config/db');

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
    firebaseUid: row.firebase_uid || row.google_uid || null,
    googleUid: row.google_uid || null,
    dateOfBirth: row.date_of_birth || null,
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
  async updateProfile(id, { name, phone, dateOfBirth }) {
    const { rows } = await pool.query(
      `UPDATE users
       SET name = $1, phone = $2, date_of_birth = $3, updated_at = NOW()
       WHERE id = $4 RETURNING id`,
      [name, phone || null, dateOfBirth || null, id]
    );
    return this.findById(rows[0].id);
  },
  async findByFirebaseUid(firebaseUid) {
    const { rows } = await pool.query(`${BASE_Q} WHERE u.firebase_uid = $1`, [firebaseUid]);
    return wrapRow(rows[0]);
  },
  async createFirebaseUser({ firebaseUid, email, name, profileImage, emailVerified, role = 'customer' }) {
    const roleId = await getRoleId(role);
    const { rows } = await pool.query(
      `INSERT INTO users (name, email, firebase_uid, profile_image, role_id, email_verified, is_active)
       VALUES ($1, $2, $3, $4, $5, $6, TRUE) RETURNING id`,
      [name, email, firebaseUid, profileImage, roleId, emailVerified]
    );
    return this.findById(rows[0].id);
  },
  async setRole(id, role) {
    const roleId = await getRoleId(role);
    const { rows } = await pool.query(
      `UPDATE users
       SET role_id = $1, updated_at = NOW()
       WHERE id = $2
       RETURNING id`,
      [roleId, id]
    );
    return rows[0] ? this.findById(rows[0].id) : null;
  },
  async linkFirebaseUid(id, { uid, picture, name, emailVerified }) {
    await pool.query(
      `UPDATE users
       SET firebase_uid = $1,
           profile_image = COALESCE(NULLIF($2, ''), profile_image),
           name = COALESCE(NULLIF($3, ''), name),
           email_verified = email_verified OR $4,
           last_login_at = NOW(), updated_at = NOW()
       WHERE id = $5`,
      [uid, picture, name, Boolean(emailVerified), id]
    );
    return this.findById(id);
  },
  async updateFirebaseUser(id, { name, picture, emailVerified }) {
    await pool.query(
      `UPDATE users
       SET profile_image = COALESCE(NULLIF($1, ''), profile_image),
           name = COALESCE(NULLIF($2, ''), name),
           email_verified = email_verified OR $3,
           last_login_at = NOW(), updated_at = NOW()
       WHERE id = $4`,
      [picture, name, Boolean(emailVerified), id]
    );
    return this.findById(id);
  },
  async deleteMany() {
    await pool.query('DELETE FROM users');
  }
};

module.exports = User;
