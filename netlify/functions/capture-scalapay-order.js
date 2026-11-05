const { getDb } = require('./lib/turso');
const { sendConfirmationEmail, sendClientConfirmationEmail } = require('./lib/email');
const scalapay = require('./lib/scalapay');

const SCALAPAY_API = scalapay.apiUrl();

// Appelée quand la cliente revient de Scalapay : encaisse la commande, puis
// confirme le(s) rendez-vous et envoie les emails (comme le webhook Stripe).
exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  try {
    const { reservationId } = JSON.parse(event.body);
    if (!reservationId) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Paramètres manquants.' }) };
    }

    const db = getDb();
    const lookup = await db.execute({
      sql: 'SELECT * FROM reservations WHERE id = ?',
      args: [reservationId]
    });
    const reservation = lookup.rows[0];
    if (!reservation) {
      return { statusCode: 404, body: JSON.stringify({ error: 'Réservation introuvable.' }) };
    }

    // Déjà encaissée (rechargement de la page, double appel) : rien à refaire.
    if (reservation.acompte_paye) {
      return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ success: true, already: true }) };
    }

    // Le jeton vient de la base (enregistré à la création de la commande), pas du navigateur.
    const token = reservation.payment_id;
    if (!token) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Aucune commande Scalapay pour cette réservation.' }) };
    }

    // Vérifie d'abord l'état de la commande (recommandé par Scalapay).
    const statusRes = await fetch(`${SCALAPAY_API}/v2/payments/${encodeURIComponent(token)}`, {
      method: 'GET',
      headers: scalapay.headers()
    });
    const order = await statusRes.json().catch(() => ({}));
    const statut = String(order.status || '').toLowerCase();
    console.log('Scalapay statut commande', token, statusRes.status, statut);
    if (!statusRes.ok) {
      console.error('Erreur Scalapay GET order:', statusRes.status, JSON.stringify(order));
      return { statusCode: 402, body: JSON.stringify({ error: 'Commande Scalapay introuvable ou non validée.' }) };
    }

    // Déjà encaissée côté Scalapay : on ne recapture pas.
    if (statut !== 'charged') {
      const res = await fetch(`${SCALAPAY_API}/v2/payments/capture`, {
        method: 'POST',
        headers: scalapay.headers({ 'Idempotency-Key': `capture-${reservationId}-${token}` }),
        body: JSON.stringify({ token, merchantReference: `rdv-${reservationId}` })
      });
      const capture = await res.json().catch(() => ({}));
      if (!res.ok) {
        console.error('Erreur Scalapay capture:', res.status, JSON.stringify(capture));
        return { statusCode: 402, body: JSON.stringify({ error: capture.message || 'Paiement Scalapay non abouti.' }) };
      }
      console.log('Scalapay capture OK', token, JSON.stringify(capture));
    }

    // Total du rendez-vous (toutes les prestations du groupe)
    let prix = Number(reservation.prix) || 0;
    let groupRows = null;
    if (reservation.groupe_id) {
      const groupLookup = await db.execute({
        sql: 'SELECT prix, prestation_nom FROM reservations WHERE groupe_id = ?',
        args: [reservation.groupe_id]
      });
      groupRows = groupLookup.rows || [];
      if (groupRows.length > 1) prix = groupRows.reduce((s, r) => s + (Number(r.prix) || 0), 0);
    }

    const updateRes = await db.execute({
      sql: `UPDATE reservations
            SET acompte_paye = ?, montant_paye = ?, type_paiement = ?,
                payment_method = ?, payment_id = ?, statut = ?
            WHERE id = ? RETURNING *`,
      args: [1, prix, 'total', 'scalapay', token, 'confirme', reservationId]
    });
    const updated = updateRes.rows[0];

    if (updated && updated.groupe_id) {
      await db.execute({
        sql: `UPDATE reservations SET statut = 'confirme' WHERE groupe_id = ? AND id != ?`,
        args: [updated.groupe_id, updated.id]
      });
    }

    if (updated) {
      const forEmail = (groupRows && groupRows.length > 1)
        ? { ...updated, prestation_nom: groupRows.map(r => r.prestation_nom).join(' + '), prix }
        : updated;
      await sendConfirmationEmail(forEmail);
      if (updated.email) {
        await sendClientConfirmationEmail(forEmail);
      }
    }

    return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ success: true }) };
  } catch (err) {
    console.error('Erreur capture-scalapay-order:', err);
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
