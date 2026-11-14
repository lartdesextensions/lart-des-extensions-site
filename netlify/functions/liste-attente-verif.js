// Tâche automatique (toutes les 15 minutes, voir netlify.toml) : pour chaque
// cliente en liste d'attente, regarde si un jour qui n'avait plus aucune place
// pour sa prestation (sa durée) a maintenant un créneau libre (annulation,
// « pas venue » supprimée, nouvelle ouverture, blocage retiré...).
// Si oui : email à la cliente, et elle passe en « prévenue » dans l'admin.
// Si l'email ne peut pas partir, elle passe en « à prévenir » pour que Jessie
// l'appelle ou lui écrive elle-même.

const { getDb } = require('./lib/turso');
const { creneauxLibres, joursLiberes, CREATE_LISTE_ATTENTE, dateParis } = require('./lib/creneaux');
const { sendListeAttenteEmail } = require('./lib/email');

exports.handler = async function () {
  try {
    const db = getDb();
    await db.execute(CREATE_LISTE_ATTENTE);
    // Les inscriptions de plus de 90 jours sans résultat sont archivées
    await db.execute("UPDATE liste_attente SET statut = 'expiree' WHERE statut = 'en_attente' AND created_at < datetime('now', '-90 days')");

    const res = await db.execute("SELECT * FROM liste_attente WHERE statut = 'en_attente'");
    const parDuree = {};
    let prevenues = 0;
    for (const e of res.rows) {
      const duree = Number(e.duree_min) || 60;
      if (!parDuree[duree]) parDuree[duree] = await creneauxLibres(db, duree, 60);
      const libres = parDuree[duree];
      // Remise en attente depuis l'admin : on repart du planning actuel, sans alerte
      if (!e.creneaux_init) {
        await db.execute({
          sql: 'UPDATE liste_attente SET creneaux_init = ? WHERE id = ?',
          args: [JSON.stringify({ fin: dateParis(60), jours: Object.keys(libres) }), e.id]
        });
        continue;
      }
      const jours = joursLiberes(e.creneaux_init, libres);
      if (!jours.length) continue;

      const detail = jours.slice(0, 5).map(d => ({ date: d, heures: libres[d] }));
      const envoi = await sendListeAttenteEmail(e, detail);
      await db.execute({
        sql: "UPDATE liste_attente SET statut = ?, email_envoye = ?, creneaux_trouves = ?, prevenue_at = datetime('now') WHERE id = ?",
        args: [envoi.ok ? 'prevenue' : 'a_prevenir', envoi.ok ? 1 : 0, JSON.stringify(detail), e.id]
      });
      prevenues++;
      console.log(`Liste d'attente #${e.id} ${e.prenom} : ${jours.length} jour(s) libéré(s), email ${envoi.ok ? 'envoyé' : 'NON envoyé'}`);
    }
    return { statusCode: 200, body: JSON.stringify({ verifiees: res.rows.length, prevenues }) };
  } catch (err) {
    console.error('Erreur liste-attente-verif :', err);
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
