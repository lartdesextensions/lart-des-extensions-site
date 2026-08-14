const Stripe = require('stripe');
const https = require('https');
const { getDb } = require('./lib/turso');

const MONTHS_FR = ['janvier','février','mars','avril','mai','juin','juillet','août','septembre','octobre','novembre','décembre'];

function postJson(hostname, path, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req = https.request(
      {
        hostname,
        path,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(data)
        }
      },
      (res) => {
        let responseBody = '';
        res.on('data', (chunk) => { responseBody += chunk; });
        res.on('end', () => {
          resolve({ statusCode: res.statusCode, body: responseBody });
        });
      }
    );
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

async function sendEmail(templateId, templateParams) {
  try {
    const payload = {
      service_id: 'service_8xq5hij',
      template_id: templateId,
      user_id: 'pnSluawmsGb1F5d_i',
      template_params: templateParams
    };
    if (process.env.EMAILJS_PRIVATE_KEY) {
      payload.accessToken = process.env.EMAILJS_PRIVATE_KEY;
    }
    const res = await postJson('api.emailjs.com', '/api/v1.0/email/send', payload);
    if (res.statusCode < 200 || res.statusCode >= 300) {
      console.error(`Erreur envoi email (${templateId}): [${res.statusCode}]`, res.body);
    } else {
      console.log(`Email envoyé avec succès (${templateId})`);
    }
  } catch (e) {
    console.error(`Erreur envoi email (${templateId}):`, e);
  }
}

async function sendConfirmationEmails(r) {
  const [y, m, d] = r.date.split('-').map(Number);
  const dateLabel = `${d} ${MONTHS_FR[m - 1]} ${y}`;

  const commonParams = {
    nom_cliente: `${r.prenom} ${r.nom}`,
    email_cliente: r.email,
    prestation: r.prestation_nom,
    total: r.prix,
    acompte: r.acompte,
    reste: r.prix - r.acompte,
    date_rdv: dateLabel,
    heure_rdv: r.heure,
    telephone_cliente: r.telephone
  };

  // Email pour elle-même (notification interne)
  await sendEmail('template_bae1d9m', commonParams);

  // Email pour la cliente (confirmation de réservation)
  await sendEmail('template_ki0fg15', commonParams);
}

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
        await sendConfirmationEmails(updated);
      } else {
        console.error('Réservation introuvable pour mise à jour Stripe:', reservationId);
      }
    }
  }

  return { statusCode: 200, body: JSON.stringify({ received: true }) };
};
