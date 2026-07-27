const PAYPAL_API = process.env.PAYPAL_API_BASE || 'https://api-m.paypal.com';

async function getAccessToken() {
  const auth = Buffer.from(
    `${process.env.PAYPAL_CLIENT_ID}:${process.env.PAYPAL_CLIENT_SECRET}`
  ).toString('base64');

  const res = await fetch(`${PAYPAL_API}/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${auth}`,
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: 'grant_type=client_credentials'
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error_description || 'Erreur authentification PayPal');
  return data.access_token;
}

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  try {
    const { reservationId, amount, description } = JSON.parse(event.body);
    if (!reservationId || !amount || amount <= 0) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Paramètres manquants ou invalides.' }) };
    }

    const accessToken = await getAccessToken();

    const res = await fetch(`${PAYPAL_API}/v2/checkout/orders`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        intent: 'CAPTURE',
        purchase_units: [{
          custom_id: String(reservationId),
          description: `Acompte réservation — ${description || "L'Art des Extensions"}`,
          amount: { currency_code: 'EUR', value: amount.toFixed(2) }
        }]
      })
    });
    const order = await res.json();
    if (!res.ok) throw new Error(order.message || 'Erreur création commande PayPal');

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: order.id })
    };
  } catch (err) {
    console.error('Erreur create-paypal-order:', err);
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
