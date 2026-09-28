// FICHIER TEMPORAIRE — à supprimer du dépôt une fois la migration effectuée.
// Usage : https://lartdesextensions.fr/.netlify/functions/migrate-produits?confirm=oui
// Crée les tables nécessaires à la vente de produits (shampoing, pompe, etc.),
// visibles uniquement dans l'admin — jamais sur le site public.

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

  const requetes = [
    {
      nom: 'table produits',
      sql: `CREATE TABLE IF NOT EXISTS produits (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        nom TEXT NOT NULL,
        prix REAL NOT NULL,
        actif INTEGER DEFAULT 1,
        ordre INTEGER DEFAULT 0
      )`
    },
    {
      nom: 'table ventes_produits',
      sql: `CREATE TABLE IF NOT EXISTS ventes_produits (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        produit_nom TEXT NOT NULL,
        prix REAL NOT NULL,
        quantite INTEGER DEFAULT 1,
        date TEXT NOT NULL,
        reservation_id INTEGER,
        prenom TEXT,
        nom TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      )`
    }
  ];

  for (const r of requetes) {
    try {
      await db.execute(r.sql);
      journal.push(`✅ ${r.nom} : créée (ou déjà existante).`);
    } catch (e) {
      journal.push(`❌ Erreur sur ${r.nom} : ${e.message}`);
    }
  }

  journal.push('');
  journal.push('Migration terminée. Supprimez maintenant ce fichier du dépôt GitHub.');

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    body: journal.join('\n')
  };
};
