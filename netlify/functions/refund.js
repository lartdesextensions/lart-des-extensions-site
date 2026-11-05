const Stripe = require('stripe');
const { getDb } = require('./lib/turso');
const { isAdmin } = require('./lib/auth');
const scalapay = require('./lib/scalapay');

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }
  if (!isAdmin(event)) {
    return { statusCode: 401, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Session expirée, reconnectez-vous.' }) };
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

    if (r.payment_id && r.payment_method === 'scalapay') {
      // Remboursement de la totalité encaissée via Scalapay
      const montant = Number(r.montant_paye) || Number(r.prix) || 0;
      if (!montant) return json({ error: 'Montant à rembourser introuvable.' }, 400);
      const sp = await fetch(`${scalapay.apiUrl()}/v2/payments/${encodeURIComponent(r.payment_id)}/refund`, {
        method: 'POST',
        headers: scalapay.headers({ 'Idempotency-Key': `refund-${reservationId}-${r.payment_id}` }),
        body: JSON.stringify({
          refundAmount: { amount: montant.toFixed(2), currency: 'EUR' },
          merchantRefundReference: `remb-rdv-${reservationId}`
        })
      });
      const data = await sp.json().catch(() => ({}));
      if (!sp.ok) {
        console.error('Erreur remboursement Scalapay:', sp.status, JSON.stringify(data));
        return json({ error: 'Scalapay : ' + (data.message || 'remboursement refusé') }, 502);
      }
      return json({ success: true, refund: { id: data.refundToken || data.token || r.payment_id, status: 'refunded' } });
    }

    if (!r.payment_id || r.payment_method !== 'stripe') {
      return json({ error: "Aucun paiement Stripe ou Scalapay associé à cette réservation (espèces, PayPal ou non payée)." }, 400);
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
