const { pool } = require('../config/db');
const { getTransporter } = require('../config/mailer');

function money(value) {
  return `INR ${Number(value).toFixed(2)}`;
}

async function sendOrderConfirmation(orderId) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [orderId]);

    const { rows } = await client.query(
      `SELECT o.*, u.name AS customer_name, u.email AS customer_email,
              oa.full_name, oa.phone, oa.address_line1, oa.address_line2,
              oa.landmark, oa.city, oa.state, oa.postal_code, oa.country
       FROM orders o
       JOIN users u ON u.id = o.user_id
       LEFT JOIN order_addresses oa ON oa.order_id = o.id
       WHERE o.id = $1 AND o.payment_status = 'paid'
       FOR UPDATE OF o`,
      [orderId]
    );
    const order = rows[0];
    if (!order || order.confirmation_email_sent_at || !order.customer_email) {
      await client.query('COMMIT');
      return false;
    }

    const items = await client.query(
      `SELECT product_name, size, color, quantity, unit_price, total_price
       FROM order_items WHERE order_id = $1 ORDER BY created_at`,
      [orderId]
    );
    const itemLines = items.rows.map((item) => {
      const options = [item.size, item.color].filter(Boolean).join(' / ');
      return `${item.product_name}${options ? ` (${options})` : ''} x ${item.quantity} - ${money(item.total_price)}`;
    });
    const addressLines = [
      order.full_name,
      order.phone,
      order.address_line1,
      order.address_line2,
      order.landmark,
      [order.city, order.state, order.postal_code].filter(Boolean).join(', '),
      order.country
    ].filter(Boolean);

    const { transporter, config } = getTransporter();
    await transporter.sendMail({
      from: config.from,
      to: order.customer_email,
      subject: `Payment confirmed - ${order.order_number}`,
      text: [
        `Hello ${order.customer_name || order.full_name || 'Customer'},`,
        '',
        `Your payment for Monk Hagen order ${order.order_number} is confirmed.`,
        '',
        ...itemLines,
        '',
        `Amount paid: ${money(order.total_amount)}`,
        '',
        'Shipping address:',
        ...addressLines,
        '',
        'Thank you for shopping with Monk Hagen.'
      ].join('\n')
    });

    await client.query(
      `UPDATE orders SET confirmation_email_sent_at = NOW(), updated_at = NOW() WHERE id = $1`,
      [orderId]
    );
    await client.query('COMMIT');
    return true;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('Order confirmation email failed:', {
      code: error.code || null,
      message: error.message || 'Email delivery failed.'
    });
    return false;
  } finally {
    client.release();
  }
}

module.exports = { sendOrderConfirmation };
