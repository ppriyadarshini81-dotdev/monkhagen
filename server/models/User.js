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
  const placeholderName = row.name === 'Customer' && !row.email && !row.firebase_uid && !row.google_uid;
  return {
    id: row.id,
    name: placeholderName ? 'User' : row.name || null,
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
    sessionVersion: Number(row.session_version || 0),
    toJSON() { return format(row); }
  };
}

const User = {
  async revokeSessions(id) {
    await pool.query('UPDATE users SET session_version = session_version + 1 WHERE id = $1', [id]);
  },
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
  async linkVerifiedGoogleAccount(sourceId, { uid = null, email, name = '', picture = '' }) {
    const client = await pool.connect();
    let linkedId;
    try {
      await client.query('BEGIN');
      const sourceResult = await client.query(
        `${BASE_Q} WHERE u.id = $1 FOR UPDATE OF u`, [sourceId]
      );
      const source = sourceResult.rows[0];
      if (!source) throw Object.assign(new Error('User no longer exists.'), { status: 404 });
      if (!source.is_active || source.role_name !== 'customer' || !source.phone || !source.phone_verified) {
        throw Object.assign(new Error('Verify your mobile account before linking Google.'), { status: 403 });
      }

      const targetResult = await client.query(
        `${BASE_Q}
         WHERE ($1::varchar IS NOT NULL AND u.firebase_uid = $1) OR LOWER(u.email) = LOWER($2)
         ORDER BY CASE WHEN $1::varchar IS NOT NULL AND u.firebase_uid = $1 THEN 0 ELSE 1 END
         FOR UPDATE OF u`,
        [uid, email]
      );
      if (targetResult.rows.length > 1) {
        throw Object.assign(new Error('This Google identity is linked to conflicting accounts. Contact support.'), { status: 409 });
      }
      const target = targetResult.rows[0] || null;

      if (!target || target.id === source.id) {
        if (uid && source.firebase_uid && source.firebase_uid !== uid) {
          throw Object.assign(new Error('This account is linked to a different Google identity.'), { status: 409 });
        }
        await client.query(
          `UPDATE users
           SET email = $1, firebase_uid = COALESCE($2, firebase_uid),
               profile_image = COALESCE(NULLIF($3, ''), profile_image),
               name = CASE
                 WHEN name IS NULL OR BTRIM(name) = '' OR name IN ('Customer', 'User')
                   THEN COALESCE(NULLIF($4, ''), 'User')
                 ELSE name
               END,
               email_verified = TRUE, last_login_at = NOW(), updated_at = NOW()
           WHERE id = $5`,
          [email, uid, picture || null, name || null, source.id]
        );
        linkedId = source.id;
      } else {
        if (!target.is_active || target.role_name !== 'customer') {
          throw Object.assign(new Error('This email cannot be linked to a customer account.'), { status: 403 });
        }
        if (uid && target.firebase_uid && target.firebase_uid !== uid) {
          throw Object.assign(new Error('This email is linked to a different Google identity.'), { status: 409 });
        }
        if (target.email && target.email.trim().toLowerCase() !== email.toLowerCase()) {
          throw Object.assign(new Error('The verified Google email does not match this account.'), { status: 409 });
        }
        if (target.phone && target.phone !== source.phone) {
          throw Object.assign(new Error('That Google account already has a different mobile number. Contact support.'), { status: 409 });
        }

        const addressCounts = await client.query(
          `SELECT user_id, COUNT(*)::integer AS count
           FROM customer_addresses WHERE user_id IN ($1, $2) GROUP BY user_id`,
          [source.id, target.id]
        );
        const totalAddresses = addressCounts.rows.reduce((sum, row) => sum + Number(row.count), 0);
        if (totalAddresses > 50) {
          throw Object.assign(new Error('These accounts have too many saved addresses to merge. Contact support.'), { status: 409 });
        }

        const carts = await client.query(
          `SELECT id, user_id FROM carts
           WHERE user_id IN ($1, $2) AND status = 'active'
           FOR UPDATE`,
          [source.id, target.id]
        );
        const sourceCart = carts.rows.find(row => row.user_id === source.id);
        const targetCart = carts.rows.find(row => row.user_id === target.id);
        if (sourceCart && targetCart) {
          await client.query(
            `INSERT INTO cart_items (cart_id, product_id, variant_id, quantity)
             SELECT $1, product_id, variant_id, quantity FROM cart_items WHERE cart_id = $2
             ON CONFLICT (cart_id, variant_id) DO UPDATE
             SET quantity = LEAST(100, cart_items.quantity + EXCLUDED.quantity), updated_at = NOW()`,
            [targetCart.id, sourceCart.id]
          );
        } else if (sourceCart) {
          await client.query(
            'UPDATE carts SET user_id = $1, updated_at = NOW() WHERE id = $2',
            [target.id, sourceCart.id]
          );
        }

        const targetDefault = await client.query(
          'SELECT 1 FROM customer_addresses WHERE user_id = $1 AND is_default = TRUE LIMIT 1',
          [target.id]
        );
        if (targetDefault.rows[0]) {
          await client.query(
            'UPDATE customer_addresses SET is_default = FALSE, updated_at = NOW() WHERE user_id = $1 AND is_default = TRUE',
            [source.id]
          );
        }
        await client.query('UPDATE customer_addresses SET user_id = $1 WHERE user_id = $2', [target.id, source.id]);
        await client.query('UPDATE orders SET user_id = $1 WHERE user_id = $2', [target.id, source.id]);
        await client.query('UPDATE return_requests SET user_id = $1 WHERE user_id = $2', [target.id, source.id]);
        const duplicateReview = await client.query(
          `SELECT 1 FROM product_reviews source
           JOIN product_reviews target ON target.product_id = source.product_id AND target.user_id = $1
           WHERE source.user_id = $2 LIMIT 1`, [target.id, source.id]
        );
        if (duplicateReview.rows[0]) {
          throw Object.assign(new Error('Both accounts reviewed the same product. Contact support to merge them safely.'), { status: 409 });
        }
        await client.query(
          `INSERT INTO product_review_helpful (review_id, user_id, created_at)
           SELECT review_id, $1, created_at FROM product_review_helpful WHERE user_id = $2
           ON CONFLICT (review_id, user_id) DO NOTHING`, [target.id, source.id]
        );
        await client.query('DELETE FROM product_review_helpful WHERE user_id = $1', [source.id]);
        await client.query('UPDATE product_reviews SET user_id = $1, updated_at = NOW() WHERE user_id = $2', [target.id, source.id]);
        await client.query(
          `INSERT INTO credit_accounts (user_id, balance)
           SELECT $1, balance FROM credit_accounts WHERE user_id = $2
           ON CONFLICT (user_id) DO UPDATE
           SET balance = credit_accounts.balance + EXCLUDED.balance, updated_at = NOW()`,
          [target.id, source.id]
        );
        await client.query('UPDATE credit_transactions SET user_id = $1 WHERE user_id = $2', [target.id, source.id]);
        await client.query('DELETE FROM credit_accounts WHERE user_id = $1', [source.id]);
        await client.query('UPDATE analytics_sessions SET user_id = $1 WHERE user_id = $2', [target.id, source.id]);
        await client.query('UPDATE analytics_events SET user_id = $1 WHERE user_id = $2', [target.id, source.id]);

        // Remove the temporary phone-only identity after its owned data has
        // moved. Remaining inactive carts are intentionally discarded.
        await client.query('DELETE FROM users WHERE id = $1', [source.id]);
        await client.query(
          `UPDATE users
           SET phone = $1, phone_verified = TRUE, email = $2, email_verified = TRUE,
               firebase_uid = COALESCE($3, firebase_uid),
               profile_image = COALESCE(NULLIF($4, ''), profile_image),
               name = CASE
                 WHEN name IS NULL OR BTRIM(name) = '' OR name IN ('Customer', 'User')
                   THEN COALESCE(NULLIF($5, ''), 'User')
                 ELSE name
               END,
               last_login_at = NOW(), updated_at = NOW()
           WHERE id = $6`,
          [source.phone, email, uid, picture || null, name || null, target.id]
        );
        linkedId = target.id;
      }

      await client.query('COMMIT');
      return this.findById(linkedId);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  },
  async linkVerifiedEmailAccount(sourceId, email) {
    return this.linkVerifiedGoogleAccount(sourceId, { email, name: '', picture: '', uid: null });
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
