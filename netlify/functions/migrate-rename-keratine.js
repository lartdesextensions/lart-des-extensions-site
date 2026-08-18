const { getDb } = require('./lib/turso');

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }
  const db = getDb();
  const log = [];
  try {
    const res = await db.execute("SELECT id, nom FROM prestations WHERE nom LIKE 'Kératine entretien - %'");
    log.push(res.rows.length + ' prestation(s) trouvée(s) à renommer.\n');

    let updated = 0;
    for (const row of res.rows) {
      const newNom = row.nom.replace('Kératine entretien - ', 'Dépose + Nouvelle pose kératine - ');
      await db.execute({
        sql: 'UPDATE prestations SET nom = ?, sous_categorie = ? WHERE id = ?',
        args: [newNom, 'Dépose + Nouvelle pose', row.id]
      });
      updated++;
      log.push('✓ "' + row.nom + '" → "' + newNom + '"');
    }

    log.push('');
    log.push('Terminé : ' + updated + ' prestation(s) renommée(s).');
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
