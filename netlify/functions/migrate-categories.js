const { getDb } = require('./lib/turso');

// Règles de classification, basées sur la structure catégorie/sous-catégorie
// déjà utilisée dans prestations.html (cat-card / sub-btn)
const RULES = [
  [/^Diagnostic/, 'Diagnostic', null],
  [/^Nouvelle pose - /, 'Bandes Adhésives', 'Nouvelle pose'],
  [/^Dépose bandes - /, 'Bandes Adhésives', 'Dépose'],
  [/^Pose seule - /, 'Bandes Adhésives', 'Pose / Repose'],
  [/^Repose bandes - /, 'Bandes Adhésives', 'Pose / Repose'],
  [/^Entretien classique - /, 'Bandes Adhésives', 'Entretien'],
  [/^Entretien shampoing - /, 'Bandes Adhésives', 'Entretien'],
  [/^Kératine nouvelle pose - /, 'Kératine', 'Nouvelle pose'],
  [/^Dépose kératine salon - /, 'Kératine', 'Dépose'],
  [/^Dépose kératine externe - /, 'Kératine', 'Dépose'],
  [/^Kératine entretien - /, 'Kératine', 'Entretien'],
  [/^Tissage entretien shampoing - /, 'Tissage Californien', 'Entretien'],
  [/^Tissage entretien - /, 'Tissage Californien', 'Entretien'],
  [/^Tissage - /, 'Tissage Californien', 'Nouvelle pose'],
  [/^Dépose tissage salon - /, 'Tissage Californien', 'Dépose'],
  [/^Dépose tissage externe - /, 'Tissage Californien', 'Dépose'],
  [/^Lissage indien - /, 'Lissage', 'Lissage indien'],
  [/^Lissage tanin - /, 'Lissage', 'Lissage tanin'],
  [/^Coloration/, 'Coloration', null],
  [/^Balayage - /, 'Balayage & Ombré', 'Balayage Signature'],
  [/^Balayage /, 'Balayage & Ombré', 'Balayage Signature'],
  [/^Ombré Hair/, 'Balayage & Ombré', 'Ombré Hair'],
  [/^Shampoing Brushing/, 'Coupe & Coiffage', 'Shampoing & Brushing'],
  [/^Shampoing Patine/, 'Coupe & Coiffage', 'Shampoing & Patine'],
  [/^Shampoing Wavy/, 'Coupe & Coiffage', 'Coiffage Wavy'],
  [/^Wavy /, 'Coupe & Coiffage', 'Coiffage Wavy'],
  [/^Soin kératine/, 'Soins', 'Soin kératine'],
  [/^Soin botox/, 'Soins', 'Soin botox'],
  [/^Soin anti-fourches/, 'Soins', 'Anti-fourches'],
];

function classify(nom) {
  for (const [re, categorie, sous_categorie] of RULES) {
    if (re.test(nom)) return { categorie, sous_categorie };
  }
  return { categorie: 'Autre', sous_categorie: null };
}

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }
  const db = getDb();
  const log = [];
  try {
    try {
      await db.execute('ALTER TABLE prestations ADD COLUMN categorie TEXT');
      log.push('✓ Colonne categorie ajoutée.');
    } catch (e) {
      log.push('· categorie : ' + e.message + ' (probablement déjà présente, on continue)');
    }
    try {
      await db.execute('ALTER TABLE prestations ADD COLUMN sous_categorie TEXT');
      log.push('✓ Colonne sous_categorie ajoutée.');
    } catch (e) {
      log.push('· sous_categorie : ' + e.message + ' (probablement déjà présente, on continue)');
    }

    const res = await db.execute('SELECT id, nom FROM prestations');
    let updated = 0;
    for (const row of res.rows) {
      const { categorie, sous_categorie } = classify(row.nom);
      await db.execute({
        sql: 'UPDATE prestations SET categorie = ?, sous_categorie = ? WHERE id = ?',
        args: [categorie, sous_categorie, row.id]
      });
      updated++;
      log.push('✓ ' + row.nom + ' → ' + categorie + (sous_categorie ? ' / ' + sous_categorie : ''));
    }
    log.push('');
    log.push('Terminé : ' + updated + ' prestations classées.');
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
