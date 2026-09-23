// FICHIER TEMPORAIRE — à supprimer du dépôt une fois l'import terminé.
// Usage : https://lartdesextensions.fr/.netlify/functions/import-clients?confirm=oui
// L'import se poursuit tout seul, par paquets de 100.

const { getDb } = require('./lib/turso');
const CLIENTS = require('./clients-data');

const PAQUET = 60;

function normTel(v) {
  const d = String(v || '').replace(/\D/g, '').replace(/^33/, '0');
  return d.length >= 9 ? d : '';
}
function normMail(v) {
  return String(v || '').trim().toLowerCase();
}
function cleNom(c) {
  return `${c.prenom || ''}|${c.nom || ''}`
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z|]/g, '');
}

// Les notes sont stockées en JSON. On fusionne sans jamais écraser l'existant.
function fusionNotes(existant, ajout) {
  const lire = (raw) => {
    if (!raw) return [];
    try {
      const v = JSON.parse(raw);
      if (Array.isArray(v)) return v;
    } catch (e) { /* ancienne note en texte simple */ }
    return [{ id: 'ancienne', type: 'technique', date: '', texte: String(raw) }];
  };
  const a = lire(existant), b = lire(ajout);
  const textes = new Set(a.map(n => String(n.texte).trim()));
  const nouvelles = b.filter(n => !textes.has(String(n.texte).trim()));
  if (!nouvelles.length) return null; // rien à ajouter
  return JSON.stringify(a.concat(nouvelles));
}

function page(titre, corps, suivante) {
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
${suivante ? `<meta http-equiv="refresh" content="1;url=${suivante}">` : ''}
<title>Import des clientes</title>
<style>body{font-family:-apple-system,sans-serif;max-width:640px;margin:40px auto;padding:0 20px;line-height:1.6;color:#1F1F1F}
h1{font-size:1.3rem}.b{height:10px;background:#eee;border-radius:5px;overflow:hidden;margin:14px 0}
.b>i{display:block;height:100%;background:#1F1F1F}code{background:#f4f4f4;padding:2px 6px;border-radius:4px}</style>
</head><body><h1>${titre}</h1>${corps}</body></html>`;
}

exports.handler = async function (event) {
  const q = event.queryStringParameters || {};
  if (q.confirm !== 'oui') {
    return { statusCode: 400, headers: { 'Content-Type': 'text/html; charset=utf-8' },
      body: page('Import des clientes', '<p>Ajoutez <code>?confirm=oui</code> à la fin de l’adresse pour lancer l’import.</p>') };
  }

  const debut = Math.max(parseInt(q.from || '0', 10) || 0, 0);
  const ajoutees0 = parseInt(q.a || '0', 10) || 0;
  const completees0 = parseInt(q.c || '0', 10) || 0;
  const ignorees0 = parseInt(q.i || '0', 10) || 0;

  try {
    const db = getDb();

    // Index des clientes déjà présentes sur le site
    const existants = await db.execute('SELECT id, prenom, nom, telephone, email, notes FROM clients');
    const parMail = new Map(), parTel = new Map(), parNom = new Map();
    for (const r of existants.rows) {
      const m = normMail(r.email), t = normTel(r.telephone);
      if (m && !parMail.has(m)) parMail.set(m, r);
      if (t && !parTel.has(t)) parTel.set(t, r);
      const n = cleNom(r);
      if (n !== '|' && !parNom.has(n)) parNom.set(n, r);
    }

    const lot = CLIENTS.slice(debut, debut + PAQUET);
    let ajoutees = 0, completees = 0, ignorees = 0;

    // Toutes les écritures du paquet partent en UN SEUL aller-retour : une par une,
    // la fonction dépassait les 10 secondes autorisées par Netlify et s'arrêtait
    // au milieu du paquet.
    const ecritures = [];

    for (const c of lot) {
      const mail = normMail(c.email), tel = normTel(c.telephone);
      const dejaLa = (mail && parMail.get(mail)) || (tel && parTel.get(tel))
        || (!mail && !tel && parNom.get(cleNom(c)));

      if (dejaLa) {
        const maj = {};
        if (!dejaLa.telephone && c.telephone) maj.telephone = c.telephone;
        if (!dejaLa.email && c.email) maj.email = c.email;
        if (!dejaLa.prenom && c.prenom) maj.prenom = c.prenom;
        if (!dejaLa.nom && c.nom) maj.nom = c.nom;
        if (c.notes) {
          const fusion = fusionNotes(dejaLa.notes, c.notes);
          if (fusion) maj.notes = fusion;
        }
        const cles = Object.keys(maj);
        if (cles.length) {
          ecritures.push({
            sql: `UPDATE clients SET ${cles.map(k => `${k} = ?`).join(',')} WHERE id = ?`,
            args: [...cles.map(k => maj[k]), dejaLa.id]
          });
          Object.assign(dejaLa, maj);
          completees++;
        } else {
          ignorees++;
        }
      } else {
        ecritures.push({
          sql: 'INSERT INTO clients (prenom, nom, telephone, email, notes) VALUES (?,?,?,?,?)',
          args: [c.prenom, c.nom, c.telephone, c.email, c.notes]
        });
        // On garde la trace tout de suite : deux fiches identiques dans le même
        // paquet ne doivent pas être insérées deux fois.
        if (mail) parMail.set(mail, { ...c });
        if (tel) parTel.set(tel, { ...c });
        parNom.set(cleNom(c), { ...c });
        ajoutees++;
      }
    }

    if (ecritures.length) {
      if (typeof db.batch === 'function') {
        await db.batch(ecritures, 'write');
      } else {
        for (const e of ecritures) await db.execute(e);
      }
    }

    const fait = debut + lot.length;
    const a = ajoutees0 + ajoutees, cpt = completees0 + completees, ig = ignorees0 + ignorees;
    const pct = Math.round((fait / CLIENTS.length) * 100);
    const resume = `<div class="b"><i style="width:${pct}%"></i></div>
      <p><strong>${fait} / ${CLIENTS.length}</strong> clientes traitées (${pct} %)</p>
      <ul><li>${a} ajoutées</li><li>${cpt} complétées (fiche déjà présente)</li><li>${ig} déjà à jour</li></ul>`;

    if (fait < CLIENTS.length) {
      const suivante = `/.netlify/functions/import-clients?confirm=oui&from=${fait}&a=${a}&c=${cpt}&i=${ig}`;
      return { statusCode: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' },
        body: page('Import en cours…', resume + '<p>Ne ferme pas cette page, la suite se lance toute seule.</p>', suivante) };
    }
    return { statusCode: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' },
      body: page('✅ Import terminé', resume + '<p>Tu peux maintenant supprimer <code>import-clients.js</code> et <code>clients-data.js</code> du dépôt GitHub.</p>') };

  } catch (err) {
    console.error('Erreur import-clients:', err);
    return { statusCode: 500, headers: { 'Content-Type': 'text/html; charset=utf-8' },
      body: page('❌ Erreur', `<p>${String(err.message)}</p><p>Aucune donnée n’est perdue : relance la même adresse avec <code>&from=${debut}</code> pour reprendre où ça s’est arrêté.</p>`) };
  }
};
