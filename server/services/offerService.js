const FIRST_PREPAID_CODE = 'MONKHAGEN10';
const FIRST_PREPAID_PERCENT = 10;

function validPaise(value) {
  return Number.isSafeInteger(value) && value >= 0;
}

async function firstPrepaidOffer(db, userId, subtotalPaise) {
  if (!validPaise(subtotalPaise)) throw new Error('Offer subtotal is invalid.');
  const { rows } = await db.query(
    `SELECT EXISTS (
       SELECT 1 FROM orders
       WHERE user_id = $1
         AND (payment_method = 'cod'
           OR payment_status IN ('paid','refunded','partially_refunded'))
     ) AS has_order`,
    [userId]
  );
  const eligible = !Boolean(rows[0]?.has_order);
  const discountPaise = eligible
    ? Math.min(subtotalPaise, Math.round(subtotalPaise * FIRST_PREPAID_PERCENT / 100))
    : 0;
  return {
    code: FIRST_PREPAID_CODE,
    discountPercent: FIRST_PREPAID_PERCENT,
    eligible,
    discountPaise,
    totalPaise: subtotalPaise - discountPaise
  };
}

function publicOffer(offer) {
  return {
    code: offer.code,
    discountPercent: offer.discountPercent,
    eligible: offer.eligible,
    eligibilityVerified: true,
    discountAmount: offer.discountPaise / 100,
    totalAmount: offer.totalPaise / 100
  };
}

module.exports = { firstPrepaidOffer, publicOffer, FIRST_PREPAID_CODE, FIRST_PREPAID_PERCENT };
