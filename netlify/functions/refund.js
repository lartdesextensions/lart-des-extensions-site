const Stripe = require('stripe');
const { getDb } = require('./lib/turso');

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  try {
    const { reservationId } = JSON.parse(event.body);
    if (!reservationId) {
      return json({ error: 'reservationId manquant' }, 400);
    }

    const db = getDb();
    const res = await db.execute({
      sql: 'SELECT * FROM reservations WHERE id = ?',
      args: [reservationId]
    });
    const r = res.rows[0];
    if (!r) return json({ error: 'Réservation introuvable' }, 404);

    if (!r.payment_id || r.payment_method !== 'stripe') {
      return json({ error: "Aucun paiement Stripe associé à cette réservation (paiement PayPal, espèces, ou non payée)." }, 400);
    }

    const stripe = Stripe(process.env.STRIPE_SECRET_KEY);
    const refund = await stripe.refunds.create({ payment_intent: r.payment_id });

    return json({ success: true, refund: { id: refund.id, status: refund.status } });
  } catch (err) {
    console.error('Erreur remboursement Stripe:', err);
    return json({ error: err.message }, 500);
  }
};

function json(obj, statusCode = 200) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(obj)
  };
}
