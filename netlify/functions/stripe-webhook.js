const Stripe = require('stripe');
const { createClient } = require('@supabase/supabase-js');

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
      console.error('Erreur envoi email (Stripe):', text);
    }
  } catch (e) {
    console.error('Erreur envoi email (Stripe):', e);
  }
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
      const supabase = createClient(
        process.env.SUPABASE_URL,
        process.env.SUPABASE_SERVICE_ROLE_KEY
      );

      const { data: updated, error } = await supabase
        .from('reservations')
        .update({
          acompte_paye: true,
          payment_method: 'stripe',
          payment_id: session.payment_intent,
          statut: 'confirme'
        })
        .eq('id', reservationId)
        .select()
        .single();

      if (error) {
        console.error('Erreur mise à jour Supabase (Stripe):', error.message);
      } else if (updated) {
        await sendConfirmationEmail(updated);
      }
    }
  }

  return { statusCode: 200, body: JSON.stringify({ received: true }) };
};
