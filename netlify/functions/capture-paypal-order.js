const { createClient } = require('@supabase/supabase-js');

const PAYPAL_API = process.env.PAYPAL_API_BASE || 'https://api-m.paypal.com';
const MONTHS_FR = ['janvier','février','mars','avril','mai','juin','juillet','août','septembre','octobre','novembre','décembre'];

async function sendConfirmationEmail(r) {
  try {
    const [y, m, d] = r.date.split('-').map(Number);
    const dateLabel = `${d} ${MONTHS_FR[m - 1]} ${y}`;
    const payload = {
      service_id: 'service_8xq5hij',
      template_id: 'template_bae1d9m',
      user_id: 'pnSluawmsGb1F5d_i',
      template_params: {
        nom_cliente: `${r.prenom} ${r.nom}`,
        email_cliente: r.email,
        prestation: r.prestation_nom,
        total: r.prix,
        acompte: r.acompte,
        reste: r.prix - r.acompte,
        date_rdv: `${dateLabel} à ${r.heure}`,
        telephone: r.telephone
      }
    };
    if (process.env.EMAILJS_PRIVATE_KEY) {
      payload.accessToken = process.env.EMAILJS_PRIVATE_KEY;
    }
    const res = await fetch('https://api.emailjs.com/api/v1.0/email/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (!res.ok) {
      const text = await res.text();
      console.error('Erreur envoi email (PayPal):', text);
    }
  } catch (e) {
    console.error('Erreur envoi email (PayPal):', e);
  }
}

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

    const captureId =
      capture.purchase_units &&
      capture.purchase_units[0].payments.captures[0].id;

    const supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY
    );

    const { data: updated, error } = await supabase
      .from('reservations')
      .update({
        acompte_paye: true,
        payment_method: 'paypal',
        payment_id: captureId || orderID,
        statut: 'confirme'
      })
      .eq('id', reservationId)
      .select()
      .single();

    if (error) {
      console.error('Erreur mise à jour Supabase (PayPal):', error.message);
    } else if (updated) {
      await sendConfirmationEmail(updated);
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
