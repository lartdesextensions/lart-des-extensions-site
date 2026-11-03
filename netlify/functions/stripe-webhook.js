const Stripe = require('stripe');
const { getDb } = require('./lib/turso');
const { sendConfirmationEmail, sendClientConfirmationEmail } = require('./lib/email');

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

      // Montant réellement encaissé, tel que Stripe le confirme
      const montantPaye = session.amount_total ? session.amount_total / 100 : 0;

      const lookup = await db.execute({
        sql: 'SELECT prix, groupe_id, acompte_paye, payment_id FROM reservations WHERE id = ?',
        args: [reservationId]
      });
      const resa = lookup.rows[0];

      // Stripe renvoie parfois la même notification : si ce paiement est déjà
      // enregistré, on ne refait rien (évite les emails en double).
      if (resa && resa.acompte_paye && resa.payment_id && resa.payment_id === session.payment_intent) {
        return { statusCode: 200, body: JSON.stringify({ received: true, deja_traite: true }) };
      }
      let prix = resa ? Number(resa.prix) : 0;

      // Plusieurs prestations dans le même RDV (même groupe_id) : total du groupe
      let groupRows = null;
      if (resa && resa.groupe_id) {
        const grp = await db.execute({
          sql: "SELECT id, prix, prestation_nom FROM reservations WHERE groupe_id = ? AND statut != 'annule' ORDER BY heure",
          args: [resa.groupe_id]
        });
        groupRows = grp.rows || [];
        if (groupRows.length > 1) prix = groupRows.reduce((s, r) => s + (Number(r.prix) || 0), 0);
      }
      const typePaiement = (prix && montantPaye >= prix) ? 'total' : 'acompte';

      const updateRes = await db.execute({
        sql: `UPDATE reservations
              SET acompte_paye = ?, montant_paye = ?, type_paiement = ?,
                  payment_method = ?, payment_id = ?, statut = ?
              WHERE id = ? RETURNING *`,
        args: [1, montantPaye, typePaiement, 'stripe', session.payment_intent, 'confirme', reservationId]
      });
      const updated = updateRes.rows[0];

      // Les autres prestations du même RDV sont confirmées aussi
      if (updated && updated.groupe_id) {
        await db.execute({
          sql: `UPDATE reservations SET statut = 'confirme' WHERE groupe_id = ? AND id != ? AND statut != 'annule'`,
          args: [updated.groupe_id, updated.id]
        });
      }

      if (updated) {
        // Email : toutes les prestations du RDV et le total
        const forEmail = (groupRows && groupRows.length > 1)
          ? { ...updated, prestation_nom: groupRows.map(r => r.prestation_nom).join(' + '), prix }
          : updated;
        // Notification interne pour le salon
        await sendConfirmationEmail(forEmail);
        // Confirmation envoyée à la cliente
        if (updated.email) {
          await sendClientConfirmationEmail(forEmail);
        }
      } else {
        console.error('Réservation introuvable pour mise à jour Stripe:', reservationId);
      }
    }
  }

  return { statusCode: 200, body: JSON.stringify({ received: true }) };
};
