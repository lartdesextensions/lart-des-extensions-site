// FICHIER TEMPORAIRE — à supprimer du dépôt une fois la migration effectuée.
// Usage : https://lartdesextensions.fr/.netlify/functions/migrate-db?confirm=oui

const { getDb } = require('./lib/turso');

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

  // ALTER TABLE échoue si la colonne existe déjà : on ignore cette erreur,
  // la fonction peut donc être relancée sans danger.
  const colonnes = [
    { nom: 'montant_paye', sql: 'ALTER TABLE reservations ADD COLUMN montant_paye REAL DEFAULT 0' },
    { nom: 'type_paiement', sql: "ALTER TABLE reservations ADD COLUMN type_paiement TEXT DEFAULT 'acompte'" }
  ];

  for (const c of colonnes) {
    try {
      await db.execute(c.sql);
      journal.push(`✅ Colonne ${c.nom} ajoutée.`);
    } catch (e) {
      if (/duplicate column/i.test(e.message)) {
        journal.push(`ℹ️ Colonne ${c.nom} déjà présente, rien à faire.`);
      } else {
        journal.push(`❌ Erreur sur ${c.nom} : ${e.message}`);
      }
    }
  }

  try {
    const res = await db.execute(
      `UPDATE reservations
       SET montant_paye = acompte, type_paiement = 'acompte'
       WHERE acompte_paye = 1 AND (montant_paye IS NULL OR montant_paye = 0)`
    );
    journal.push(`✅ ${res.rowsAffected} réservation(s) déjà payée(s) mise(s) à jour.`);
  } catch (e) {
    journal.push(`❌ Erreur mise à jour : ${e.message}`);
  }

  journal.push('');
  journal.push('Migration terminée. Supprimez maintenant ce fichier du dépôt GitHub.');

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    body: journal.join('\n')
  };
};
