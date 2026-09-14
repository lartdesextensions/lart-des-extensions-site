const Stripe = require('stripe');
const { getDb } = require('./lib/turso');

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  try {
    const stripe = Stripe(process.env.STRIPE_SECRET_KEY);
    const { reservationId, paymentType, customerEmail, siteUrl } = JSON.parse(event.body);

    if (!reservationId) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Paramètres manquants.' }) };
    }

    // Le montant n'est JAMAIS repris du navigateur : il est recalculé depuis la base.
    const type = paymentType === 'total' ? 'total' : 'acompte';
    const db = getDb();
    const lookup = await db.execute({
      sql: 'SELECT prix, prestation_nom FROM reservations WHERE id = ?',
      args: [reservationId]
    });
    const reservation = lookup.rows[0];
    if (!reservation) {
      return { statusCode: 404, body: JSON.stringify({ error: 'Réservation introuvable.' }) };
    }

    const prix = Number(reservation.prix);
    if (!prix || prix <= 0) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Prix de la prestation invalide.' }) };
    }
    const amount = type === 'total' ? prix : Math.round(prix * 0.35);

    const libelle = type === 'total'
      ? `Prestation — ${reservation.prestation_nom}`
      : `Acompte réservation — ${reservation.prestation_nom}`;

    const base = siteUrl || process.env.URL || '';

    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      payment_method_types: ['card'],
      customer_email: customerEmail || undefined,
      line_items: [{
        price_data: {
          currency: 'eur',
          product_data: { name: libelle },
          unit_amount: Math.round(amount * 100)
        },
        quantity: 1
      }],
      metadata: { reservationId: String(reservationId), paymentType: type },
      success_url: `${base}/reservation.html?payment=success&provider=stripe&rdv=${reservationId}`,
      cancel_url: `${base}/reservation.html?payment=cancel&rdv=${reservationId}`
    });

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: session.url })
    };
  } catch (err) {
    console.error('Erreur create-checkout:', err);
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
