const { getDb } = require('./lib/turso');

const SCHEMA = [
`CREATE TABLE IF NOT EXISTS prestations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nom TEXT NOT NULL,
  prix REAL NOT NULL,
  duree_min INTEGER NOT NULL,
  actif INTEGER NOT NULL DEFAULT 1,
  ordre INTEGER NOT NULL DEFAULT 0
)`,
`CREATE TABLE IF NOT EXISTS reservations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  prenom TEXT NOT NULL,
  nom TEXT NOT NULL,
  telephone TEXT,
  email TEXT,
  message TEXT,
  prestation_nom TEXT NOT NULL,
  date TEXT NOT NULL,
  heure TEXT NOT NULL,
  duree_min INTEGER,
  prix REAL,
  acompte REAL,
  statut TEXT NOT NULL DEFAULT 'confirme',
  acompte_rembourse INTEGER DEFAULT 0,
  acompte_paye INTEGER DEFAULT 0,
  payment_method TEXT,
  payment_id TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
)`,
`CREATE TABLE IF NOT EXISTS disponibilites (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date TEXT NOT NULL UNIQUE,
  ferme INTEGER NOT NULL DEFAULT 0,
  heure_debut TEXT,
  heure_fin TEXT
)`,
`CREATE TABLE IF NOT EXISTS indisponibilites (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date TEXT NOT NULL,
  heure_debut TEXT NOT NULL,
  heure_fin TEXT NOT NULL,
  motif TEXT
)`,
`CREATE TABLE IF NOT EXISTS clients_bloques (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT,
  telephone TEXT,
  raison TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
)`,
`CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT
)`,
`CREATE INDEX IF NOT EXISTS idx_reservations_date ON reservations(date)`,
`CREATE INDEX IF NOT EXISTS idx_indisponibilites_date ON indisponibilites(date)`
];

exports.handler = async function (event) {
  const confirm = event.queryStringParameters && event.queryStringParameters.confirm;

  if (confirm !== 'oui') {
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
      body: 'Pour lancer la création des tables, ouvre cette même URL en ajoutant ?confirm=oui à la fin.'
    };
  }

  try {
    const db = getDb();
    for (const sql of SCHEMA) {
      await db.execute(sql);
    }
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
      body: 'Les 6 tables ont été créées avec succès dans Turso. Tu peux maintenant supprimer ce fichier setup-db.js.'
    };
  } catch (err) {
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
      body: 'Erreur : ' + err.message
    };
  }
};
