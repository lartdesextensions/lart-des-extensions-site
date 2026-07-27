// Retourne les clés PUBLIQUES (sûres à exposer côté client) au site.
// Les clés secrètes ne transitent jamais par ici.
exports.handler = async function () {
  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      stripePublishableKey: process.env.STRIPE_PUBLISHABLE_KEY || '',
      paypalClientId: process.env.PAYPAL_CLIENT_ID || ''
    })
  };
};
