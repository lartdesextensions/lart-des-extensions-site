// Tâche automatique (toutes les heures, voir netlify.toml) : supprime les
// réservations abandonnées, c'est-à-dire commencées en ligne mais jamais
// payées, plus de 24 h après leur création.
//
// Ne touche JAMAIS :
//   - un RDV confirmé ou annulé (seul le statut "en_attente" est concerné)
//   - un RDV payé (acompte_paye ou montant_paye). Un paiement CB ou Scalapay
//     commencé puis abandonné laisse un payment_id sans paiement réel : ces
//     réservations sont nettoyées, sinon elles bloqueraient le créneau.
//   - une prestation dont une autre ligne du même RDV (groupe_id) est payée ou confirmée

const { getDb } = require('./lib/turso');

const CONDITIONS = `
  statut = 'en_attente'
  AND COALESCE(acompte_paye, 0) = 0
  AND COALESCE(montant_paye, 0) = 0
  AND created_at IS NOT NULL
  AND created_at < datetime('now', '-24 hours')
  AND (
    groupe_id IS NULL OR groupe_id = ''
    OR groupe_id NOT IN (
      SELECT groupe_id FROM reservations
      WHERE groupe_id IS NOT NULL AND groupe_id != ''
        AND (statut = 'confirme' OR COALESCE(acompte_paye, 0) = 1
             OR COALESCE(montant_paye, 0) > 0)
    )
  )`;

exports.handler = async function () {
  try {
    const db = getDb();
    const res = await db.execute(`DELETE FROM reservations WHERE ${CONDITIONS} RETURNING id, prenom, nom, date`);
    const rows = res.rows || [];
    if (rows.length) {
      console.log(`Nettoyage : ${rows.length} réservation(s) abandonnée(s) supprimée(s) :`,
        rows.map(r => `#${r.id} ${r.prenom} ${r.nom} (${r.date})`).join(', '));
    }
    return { statusCode: 200, body: JSON.stringify({ supprimees: rows.length }) };
  } catch (err) {
    console.error('Erreur nettoyage-reservations :', err);
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
