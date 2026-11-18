// Tâche automatique (toutes les 15 minutes, voir netlify.toml) : pour chaque
// cliente en liste d'attente, regarde si une place s'est libérée sur les dates
// qu'elle a choisies (ou sur n'importe quelle date si elle n'en a pas choisi).
//
// Une cliente reste suivie après un premier email : elle est prévenue à chaque
// nouvelle place, jusqu'à ce qu'elle réserve, se désinscrive, que ses dates
// soient passées ou que Jessie la marque « traitée ».
// Si l'email ne peut pas partir, elle passe en « à prévenir » pour que Jessie
// l'appelle ou lui écrive elle-même.

const { getDb } = require('./lib/turso');
const {
  creneauxLibres, joursLiberes, photoPlanning, datesSouhaitees, lireJson,
  preparerListeAttente, dateParis
} = require('./lib/creneaux');
const { sendListeAttenteEmail } = require('./lib/email');

const FENETRE_JOURS = 90;
// Pas plus d'un email toutes les 3 h à la même cliente : les places libérées
// entre-temps sont annoncées dans l'email suivant.
const DELAI_ENTRE_EMAILS_MS = 3 * 60 * 60 * 1000;

function emailRecent(e) {
  if (!e.prevenue_at) return false;
  const t = new Date(String(e.prevenue_at).replace(' ', 'T') + 'Z').getTime();
  return Date.now() - t < DELAI_ENTRE_EMAILS_MS;
}

exports.handler = async function () {
  try {
    const db = getDb();
    await preparerListeAttente(db);
    // Les inscriptions de plus de 90 jours sont archivées
    await db.execute("UPDATE liste_attente SET statut = 'expiree' WHERE statut IN ('en_attente','prevenue') AND created_at < datetime('now', '-90 days')");

    const res = await db.execute("SELECT * FROM liste_attente WHERE statut IN ('en_attente','prevenue')");

    // Dernier RDV payé ou confirmé à venir de chaque cliente
    const rdv = await db.execute({
      sql: `SELECT lower(email) AS email, MAX(datetime(created_at)) AS cree FROM reservations
            WHERE date >= ? AND statut != 'annule' AND email IS NOT NULL
              AND (statut = 'confirme' OR COALESCE(acompte_paye, 0) = 1 OR COALESCE(montant_paye, 0) > 0)
            GROUP BY lower(email)`,
      args: [dateParis(0)]
    });
    const rdvPar = {};
    rdv.rows.forEach(r => { rdvPar[r.email] = r.cree; });

    const parDuree = {};
    let prevenues = 0;
    for (const e of res.rows) {
      // Elle a réservé depuis son inscription : plus besoin de la prévenir
      const cree = rdvPar[String(e.email).toLowerCase()];
      if (cree && cree > String(e.created_at)) {
        await db.execute({ sql: "UPDATE liste_attente SET statut = 'traitee' WHERE id = ?", args: [e.id] });
        continue;
      }
      // Toutes ses dates sont passées
      const choisies = datesSouhaitees(e);
      if (choisies && choisies.every(d => d <= dateParis(0))) {
        await db.execute({ sql: "UPDATE liste_attente SET statut = 'expiree' WHERE id = ?", args: [e.id] });
        continue;
      }

      const duree = Number(e.duree_min) || 60;
      if (!parDuree[duree]) parDuree[duree] = await creneauxLibres(db, duree, FENETRE_JOURS);
      const libres = parDuree[duree];
      const photo = photoPlanning(libres, FENETRE_JOURS);
      const ref = lireJson(e.creneaux_init, {});

      // Remise en attente depuis l'admin, ou cliente déjà prévenue avant cette
      // version : on repart du planning actuel, sans alerte
      if (!e.creneaux_init || (e.statut === 'prevenue' && !ref.v)) {
        await db.execute({ sql: 'UPDATE liste_attente SET creneaux_init = ? WHERE id = ?', args: [photo, e.id] });
        continue;
      }

      const jours = joursLiberes(e, libres);
      if (!jours.length) {
        // Rien de neuf : on met la photo à jour. Un jour redevenu complet pourra
        // ainsi déclencher une alerte s'il se libère à nouveau.
        if (photo !== e.creneaux_init) {
          await db.execute({ sql: 'UPDATE liste_attente SET creneaux_init = ? WHERE id = ?', args: [photo, e.id] });
        }
        continue;
      }
      if (emailRecent(e)) {
        // Email trop récent : on garde ces jours pour le prochain envoi
        const encore = JSON.stringify({ v: 2, fin: ref.fin, jours: (ref.jours || []).filter(d => libres[d]) });
        if (encore !== e.creneaux_init) {
          await db.execute({ sql: 'UPDATE liste_attente SET creneaux_init = ? WHERE id = ?', args: [encore, e.id] });
        }
        continue;
      }

      const detail = jours.slice(0, 5).map(d => ({ date: d, heures: libres[d] }));
      const envoi = await sendListeAttenteEmail(e, detail);
      await db.execute({
        sql: "UPDATE liste_attente SET statut = ?, email_envoye = ?, creneaux_trouves = ?, creneaux_init = ?, prevenue_at = datetime('now') WHERE id = ?",
        args: [envoi.ok ? 'prevenue' : 'a_prevenir', envoi.ok ? 1 : 0, JSON.stringify(detail), photo, e.id]
      });
      prevenues++;
      console.log(`Liste d'attente #${e.id} : ${jours.length} jour(s) libéré(s), email ${envoi.ok ? 'envoyé' : 'NON envoyé'}`);
    }
    return { statusCode: 200, body: JSON.stringify({ verifiees: res.rows.length, prevenues }) };
  } catch (err) {
    console.error('Erreur liste-attente-verif :', err);
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
