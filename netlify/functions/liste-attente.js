// Inscription publique à la liste d'attente (page réservation).
// La cliente laisse prénom, nom, email, téléphone ; on mémorise la prestation,
// sa durée et les jours qui avaient déjà des créneaux libres à ce moment-là.
// La tâche automatique liste-attente-verif la prévient si un jour se libère.

const { getDb } = require('./lib/turso');
const { creneauxLibres, CREATE_LISTE_ATTENTE, dateParis } = require('./lib/creneaux');

const FENETRE_JOURS = 60;

function json(obj, statusCode = 200) {
  return { statusCode, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(obj) };
}
function txt(v, max) {
  return String(v == null ? '' : v).trim().slice(0, max);
}

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method Not Allowed' };
  try {
    const b = JSON.parse(event.body || '{}');
    const prenom = txt(b.prenom, 60);
    const nom = txt(b.nom, 60);
    const email = txt(b.email, 120).toLowerCase();
    const telephone = txt(b.telephone, 30);
    const prestation_nom = txt(b.prestation_nom, 300);
    const duree_min = Math.round(Number(b.duree_min));

    if (!prenom || !email || !telephone) return json({ error: 'Merci de remplir prénom, email et téléphone.' }, 400);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json({ error: 'Adresse email invalide.' }, 400);
    if (!(duree_min >= 15 && duree_min <= 720)) return json({ error: 'Prestation invalide.' }, 400);

    const db = getDb();
    await db.execute(CREATE_LISTE_ATTENTE);

    // Cliente bloquée : on ne l'inscrit pas (même règle que la réservation)
    const bloque = await db.execute({
      sql: 'SELECT id FROM clients_bloques WHERE lower(email) = ? OR (telephone IS NOT NULL AND telephone != \'\' AND replace(telephone,\' \',\'\') = ?) LIMIT 1',
      args: [email, telephone.replace(/\s/g, '')]
    });
    if (bloque.rows.length) return json({ error: 'Merci de contacter directement le salon au 07 80 96 38 23.' }, 403);

    // Déjà inscrite pour la même prestation : on ne crée pas de doublon
    const deja = await db.execute({
      sql: "SELECT id FROM liste_attente WHERE email = ? AND prestation_nom = ? AND statut = 'en_attente' LIMIT 1",
      args: [email, prestation_nom]
    });
    if (deja.rows.length) return json({ ok: true, deja: true });

    const libres = await creneauxLibres(db, duree_min, FENETRE_JOURS);
    const init = JSON.stringify({ fin: dateParis(FENETRE_JOURS), jours: Object.keys(libres) });

    await db.execute({
      sql: 'INSERT INTO liste_attente (prenom, nom, email, telephone, prestation_nom, duree_min, creneaux_init) VALUES (?,?,?,?,?,?,?)',
      args: [prenom, nom, email, telephone, prestation_nom, duree_min, init]
    });
    return json({ ok: true });
  } catch (err) {
    console.error('Erreur liste-attente :', err);
    return json({ error: 'Erreur, merci de réessayer.' }, 500);
  }
};
