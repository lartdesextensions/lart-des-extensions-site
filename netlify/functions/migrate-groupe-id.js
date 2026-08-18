const { getDb } = require('./lib/turso');

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }
  const db = getDb();
  const log = [];
  try {
    try {
      await db.execute('ALTER TABLE reservations ADD COLUMN groupe_id TEXT');
      log.push('✓ Colonne groupe_id ajoutée à la table reservations.');
    } catch (e) {
      log.push('· groupe_id : ' + e.message + ' (probablement déjà présente, on continue)');
    }
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
