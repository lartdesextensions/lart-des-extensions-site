// FICHIER TEMPORAIRE — à supprimer du dépôt une fois la migration effectuée.
// Usage : https://lartdesextensions.fr/.netlify/functions/migrate-split-anciens-rdv?confirm=oui
//
// Sépare en plusieurs lignes (reliées par un groupe_id, comme dans l'admin)
// les anciennes réservations prises en ligne AVANT la correction du panier,
// qui avaient fusionné plusieurs prestations en une seule ligne du type :
//   "Nouvelle pose - 50 bandes injectées (475 €) + Balayage Courts (210 €)"
//
// Ne touche que les lignes qui :
//   - contiennent " + " dans prestation_nom (signe qu'elles sont fusionnées)
//   - n'ont pas déjà de groupe_id
//   - peuvent être découpées de façon fiable (chaque morceau se termine par
//     "(XX €)" et la somme des prix retrouvés correspond exactement au prix
//     total enregistré) — sinon la ligne est laissée telle quelle et listée
//     dans "ignorées" pour une correction manuelle.
//
// La durée totale (seule connue, le détail par prestation n'a jamais été
// enregistré pour ces anciennes lignes) est répartie au prorata du prix de
// chaque prestation, arrondie à la minute — c'est une estimation raisonnable,
// modifiable ensuite à la main dans l'admin si besoin.

const { getDb } = require('./lib/turso');

function parseSegments(nom, prixTotal) {
  const parts = nom.split(' + ').map(s => s.trim()).filter(Boolean);
  if (parts.length < 2) return null;

  const segments = [];
  for (const part of parts) {
    const m = part.match(/^(.*?)\s*\((\d+(?:[.,]\d+)?)\s*€\)\s*$/);
    if (!m) return null;
    const segNom = m[1].trim();
    const segPrix = Number(m[2].replace(',', '.'));
    if (!segNom || isNaN(segPrix)) return null;
    segments.push({ nom: segNom, prix: segPrix });
  }

  const somme = segments.reduce((s, seg) => s + seg.prix, 0);
  // Tolérance d'arrondi de 0,01 € (les prix ne sont jamais qu'en euros entiers
  // ou avec centimes ici, donc un vrai écart indique un texte non fiable).
  if (Math.abs(somme - Number(prixTotal)) > 0.01) return null;

  return segments;
}

function repartirDuree(segments, dureeTotale) {
  const totalPrix = segments.reduce((s, seg) => s + seg.prix, 0);
  if (!totalPrix || !dureeTotale) return segments.map(() => 0);
  let allouee = 0;
  const durees = segments.map((seg, i) => {
    if (i === segments.length - 1) return Math.max(dureeTotale - allouee, 0);
    const d = Math.round((seg.prix / totalPrix) * dureeTotale);
    allouee += d;
    return d;
  });
  return durees;
}

function timeToMin(t) {
  const [h, m] = String(t).split(':').map(Number);
  return h * 60 + m;
}
function minToTime(min) {
  const h = String(Math.floor(min / 60)).padStart(2, '0');
  const m = String(min % 60).padStart(2, '0');
  return `${h}:${m}`;
}

exports.handler = async function (event) {
  const confirm = event.queryStringParameters && event.queryStringParameters.confirm;
  if (confirm !== 'oui') {
    return {
      statusCode: 400,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
      body: 'Ajoutez ?confirm=oui à la fin de l’adresse pour lancer la migration.'
    };
  }

  const db = getDb();
  const journal = [];
  let corrigees = 0;
  let ignorees = 0;

  const res = await db.execute(
    `SELECT * FROM reservations WHERE prestation_nom LIKE '% + %' AND (groupe_id IS NULL OR groupe_id = '')`
  );
  const rows = res.rows || [];
  journal.push(`${rows.length} réservation(s) fusionnée(s) trouvée(s) à examiner.`);
  journal.push('');

  for (const r of rows) {
    const segments = parseSegments(r.prestation_nom, r.prix);
    if (!segments) {
      ignorees++;
      journal.push(`⚠️ Ignorée (id ${r.id}, ${r.date} ${r.heure}, ${r.prenom} ${r.nom}) : "${r.prestation_nom}" — texte non reconnu ou total incohérent. À corriger à la main si besoin.`);
      continue;
    }

    const durees = repartirDuree(segments, Number(r.duree_min) || 0);
    const groupeId = 'g_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8) + '_' + r.id;

    try {
      // La ligne existante devient la 1ère prestation (garde acompte/paiement/statut)
      await db.execute({
        sql: `UPDATE reservations SET prestation_nom = ?, prix = ?, duree_min = ?, groupe_id = ? WHERE id = ?`,
        args: [segments[0].nom, segments[0].prix, durees[0], groupeId, r.id]
      });

      // Les prestations suivantes deviennent de nouvelles lignes, enchaînées
      // dans le temps, sans acompte propre (déjà porté par la 1ère ligne).
      let cursorMin = timeToMin(r.heure) + durees[0];
      for (let i = 1; i < segments.length; i++) {
        await db.execute({
          sql: `INSERT INTO reservations
                (prenom, nom, telephone, email, message, prestation_nom, date, heure, duree_min, prix,
                 acompte, statut, acompte_paye, montant_paye, type_paiement, payment_method, payment_id, groupe_id)
                VALUES (?, ?, ?, ?, '', ?, ?, ?, ?, ?, 0, ?, 0, 0, ?, ?, ?, ?)`,
          args: [
            r.prenom, r.nom, r.telephone, r.email,
            segments[i].nom, r.date, minToTime(cursorMin), durees[i], segments[i].prix,
            r.statut, r.type_paiement || null, r.payment_method || null, r.payment_id || null, groupeId
          ]
        });
        cursorMin += durees[i];
      }

      corrigees++;
      journal.push(`✅ Corrigée (id ${r.id}, ${r.date} ${r.heure}, ${r.prenom} ${r.nom}) : ${segments.map(s => `${s.nom} (${s.prix} €)`).join(' / ')}`);
    } catch (e) {
      ignorees++;
      journal.push(`❌ Erreur sur id ${r.id} : ${e.message}`);
    }
  }

  journal.push('');
  journal.push(`Terminé : ${corrigees} réservation(s) séparée(s), ${ignorees} ignorée(s)/en erreur.`);
  journal.push('Vous pouvez relancer cette page sans risque : les réservations déjà séparées (groupe_id présent) ne sont plus reprises.');
  journal.push('Une fois satisfaite du résultat, supprimez ce fichier du dépôt GitHub.');

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    body: journal.join('\n')
  };
};
