const Stripe = require('stripe');
const { getDb } = require('./lib/turso');
const { sendConfirmationEmail } = require('./lib/email');

exports.handler = async function (event) {
  const stripe = Stripe(process.env.STRIPE_SECRET_KEY);
  const sig = event.headers['stripe-signature'];
  let stripeEvent;

  try {
    stripeEvent = stripe.webhooks.constructEvent(
      event.body,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    console.error('Signature webhook Stripe invalide:', err.message);
    return { statusCode: 400, body: `Webhook Error: ${err.message}` };
  }

  if (stripeEvent.type === 'checkout.session.completed') {
    const session = stripeEvent.data.object;
    const reservationId = session.metadata && session.metadata.reservationId;

    if (reservationId) {
      const db = getDb();
      const updateRes = await db.execute({
        sql: `UPDATE reservations SET acompte_paye = ?, payment_method = ?, payment_id = ?, statut = ? WHERE id = ? RETURNING *`,
        args: [1, 'stripe', session.payment_intent, 'confirme', reservationId]
      });
      const updated = updateRes.rows[0];

      if (updated) {
        await sendConfirmationEmail(updated);
      } else {
        console.error('Réservation introuvable pour mise à jour Stripe:', reservationId);
      }
    }
  }

  return { statusCode: 200, body: JSON.stringify({ received: true }) };
};
