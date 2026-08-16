const { getDb } = require('./lib/turso');
const { sendConfirmationEmail } = require('./lib/email');

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  try {
    const { reservationId } = JSON.parse(event.body || '{}');
    if (!reservationId) {
      return json({ error: 'reservationId manquant' }, 400);
    }

    const db = getDb();
    const res = await db.execute({
      sql: 'SELECT * FROM reservations WHERE id = ?',
      args: [reservationId]
    });
    const reservation = res.rows[0];
    if (!reservation) {
      return json({ error: 'Réservation introuvable' }, 404);
    }
    if (!reservation.email) {
      return json({ error: 'Cette réservation n\'a pas d\'email renseigné' }, 400);
    }

    const result = await sendConfirmationEmail(reservation);
    if (!result.ok) {
      return json({ error: result.error || 'Échec de l\'envoi de l\'email' }, 500);
    }

    return json({ success: true });
  } catch (err) {
    console.error('Erreur send-confirmation.js:', err);
    return json({ error: err.message }, 500);
  }
};

function json(obj, statusCode = 200) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(obj)
  };
}
