const Stripe = require('stripe');

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  try {
    const stripe = Stripe(process.env.STRIPE_SECRET_KEY);
    const { reservationId, amount, description, customerEmail, siteUrl } = JSON.parse(event.body);

    if (!reservationId || !amount || amount <= 0) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Paramètres manquants ou invalides.' }) };
    }

    const base = siteUrl || process.env.URL || '';

    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      payment_method_types: ['card'],
      customer_email: customerEmail || undefined,
      line_items: [{
        price_data: {
          currency: 'eur',
          product_data: { name: `Acompte réservation — ${description || 'L\'Art des Extensions'}` },
          unit_amount: Math.round(amount * 100)
        },
        quantity: 1
      }],
      metadata: { reservationId: String(reservationId) },
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
