const { getDb } = require('./lib/turso');

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }
  const db = getDb();
  const log = [];
  try {
    await db.execute(`
      CREATE TABLE IF NOT EXISTS clients (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        prenom TEXT,
        nom TEXT,
        telephone TEXT,
        email TEXT,
        notes TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
      )
    `);
    log.push('✓ Table clients créée (ou déjà existante).');

    // Récupère les clientes déjà présentes dans les réservations existantes,
    // pour ne pas repartir de zéro
    const resv = await db.execute('SELECT DISTINCT prenom, nom, telephone, email FROM reservations WHERE email IS NOT NULL AND email != \'\'');
    let imported = 0;
    for (const r of resv.rows) {
      const existing = await db.execute({ sql: 'SELECT id FROM clients WHERE lower(email) = lower(?) LIMIT 1', args: [r.email] });
      if (existing.rows.length === 0) {
        await db.execute({
          sql: 'INSERT INTO clients (prenom, nom, telephone, email) VALUES (?, ?, ?, ?)',
          args: [r.prenom || '', r.nom || '', r.telephone || '', r.email || '']
        });
        imported++;
      }
    }
    log.push('✓ ' + imported + ' fiche(s) client importée(s) depuis les réservations existantes.');
    log.push('');
    log.push('Terminé.');
    return json({ log });
  } catch (err) {
    log.push('✗ ERREUR : ' + err.message);
    return json({ log, error: err.message }, 500);
  }
};

function json(obj, statusCode = 200) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(obj)
  };
}
