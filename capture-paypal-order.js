const { getDb } = require('./lib/turso');
const { sendConfirmationEmail, sendClientConfirmationEmail } = require('./lib/email');

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
    const { orderID, reservationId } = JSON.parse(event.body);
    if (!orderID || !reservationId) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Paramètres manquants.' }) };
    }

    const accessToken = await getAccessToken();

    const res = await fetch(`${PAYPAL_API}/v2/checkout/orders/${orderID}/capture`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      }
    });
    const capture = await res.json();
    if (!res.ok) throw new Error(capture.message || 'Erreur capture PayPal');

    const unit = capture.purchase_units && capture.purchase_units[0];
    const captureObj = unit && unit.payments && unit.payments.captures && unit.payments.captures[0];
    const captureId = captureObj ? captureObj.id : orderID;

    // Montant réellement encaissé, tel que PayPal le confirme (jamais celui annoncé par le navigateur)
    const montantPaye = captureObj && captureObj.amount
      ? Number(captureObj.amount.value)
      : 0;

    const db = getDb();
    const lookup = await db.execute({
      sql: 'SELECT prix FROM reservations WHERE id = ?',
      args: [reservationId]
    });
    const prix = lookup.rows[0] ? Number(lookup.rows[0].prix) : 0;
    const typePaiement = (prix && montantPaye >= prix) ? 'total' : 'acompte';

    const updateRes = await db.execute({
      sql: `UPDATE reservations
            SET acompte_paye = ?, montant_paye = ?, type_paiement = ?,
                payment_method = ?, payment_id = ?, statut = ?
            WHERE id = ? RETURNING *`,
      args: [1, montantPaye, typePaiement, 'paypal', captureId, 'confirme', reservationId]
    });
    const updated = updateRes.rows[0];

    if (updated) {
      // Notification interne pour le salon
      await sendConfirmationEmail(updated);
      // Confirmation envoyée à la cliente (manquait jusqu'ici pour les paiements PayPal)
      if (updated.email) {
        await sendClientConfirmationEmail(updated);
      }
    } else {
      console.error('Réservation introuvable pour mise à jour PayPal:', reservationId);
    }

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ success: true })
    };
  } catch (err) {
    console.error('Erreur capture-paypal-order:', err);
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
