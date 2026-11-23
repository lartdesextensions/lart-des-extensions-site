// Admin : envoie tout de suite à une cliente de la liste d'attente un email
// avec les prochaines dates disponibles pour sa prestation (même email que
// l'alerte automatique, envoyé depuis le site via Brevo).

const { getDb } = require('./lib/turso');
const { isAdmin } = require('./lib/auth');
const { creneauxLibres, datesSouhaitees, preparerListeAttente } = require('./lib/creneaux');
const { sendListeAttenteEmail } = require('./lib/email');

const FENETRE_JOURS = 90;
const NB_JOURS_MAX = 5;

function json(body, statusCode = 200) {
  return { statusCode, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
}

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method Not Allowed' };
  if (!isAdmin(event)) return json({ error: 'Session expirée, reconnectez-vous.' }, 401);
  try {
    const { id } = JSON.parse(event.body || '{}');
    if (!id) return json({ error: 'id manquant' }, 400);
    const db = getDb();
    await preparerListeAttente(db);
    const res = await db.execute({ sql: 'SELECT * FROM liste_attente WHERE id = ?', args: [id] });
    const e = res.rows[0];
    if (!e) return json({ error: 'Inscription introuvable.' }, 404);
    if (!e.email) return json({ error: "Pas d'adresse email pour cette cliente." }, 400);

    const libres = await creneauxLibres(db, Number(e.duree_min) || 60, FENETRE_JOURS);
    const choisies = datesSouhaitees(e);
    const jours = Object.keys(libres).filter(d => !choisies || choisies.includes(d)).sort();
    if (!jours.length) {
      return json({ error: choisies
        ? 'Aucune place libre sur les dates choisies par la cliente pour le moment.'
        : 'Aucune place libre pour cette prestation dans les 3 prochains mois.' }, 409);
    }
    const detail = jours.slice(0, NB_JOURS_MAX).map(d => ({ date: d, heures: libres[d] }));
    const envoi = await sendListeAttenteEmail(e, detail);
    if (!envoi.ok) return json({ error: "L'email n'a pas pu partir : " + (envoi.error || 'erreur inconnue') }, 502);

    await db.execute({
      sql: "UPDATE liste_attente SET statut = 'prevenue', email_envoye = 1, creneaux_trouves = ?, prevenue_at = datetime('now') WHERE id = ?",
      args: [JSON.stringify(detail), e.id]
    });
    return json({ ok: true, jours: detail });
  } catch (err) {
    console.error('Erreur liste-attente-envoyer :', err);
    return json({ error: err.message }, 500);
  }
};
