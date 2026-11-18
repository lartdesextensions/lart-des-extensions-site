// Inscription publique à la liste d'attente (page réservation).
// La cliente laisse ses coordonnées et les dates qui l'intéressent ; on mémorise
// la prestation, sa durée et les jours qui ont déjà des créneaux libres.
// La tâche automatique liste-attente-verif la prévient si une place se libère.
// Le lien « Ne plus recevoir ces alertes » des emails arrive aussi ici (?stop=).

const { getDb } = require('./lib/turso');
const { creneauxLibres, photoPlanning, preparerListeAttente, jetonStop, dateParis } = require('./lib/creneaux');

const FENETRE_JOURS = 90;
const MAX_DATES = 15;

function json(obj, statusCode = 200) {
  return { statusCode, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(obj) };
}
function txt(v, max) {
  return String(v == null ? '' : v).trim().slice(0, max);
}

function page(titre, contenu) {
  return {
    statusCode: 200,
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
    body: `<!DOCTYPE html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${titre}</title></head>
<body style="font-family:system-ui,Arial,sans-serif;background:#FAF8F5;color:#1F1F1F;text-align:center;padding:60px 24px;">
<h1 style="font-size:1.4rem;font-weight:600;">${titre}</h1>${contenu}</body></html>`
  };
}

// Désinscription en deux temps : la page s'ouvre (GET), la cliente confirme (POST).
// Les antivirus de messagerie ouvrent les liens : un simple clic ne suffit donc pas.
async function desinscription(event) {
  const q = event.queryStringParameters || {};
  const id = Number(q.stop);
  const db = getDb();
  const res = Number.isInteger(id)
    ? await db.execute({ sql: 'SELECT id, email FROM liste_attente WHERE id = ?', args: [id] })
    : { rows: [] };
  const e = res.rows[0];
  if (!e || q.t !== jetonStop(e.id, e.email)) return page('Lien invalide', '<p>Ce lien ne fonctionne plus.</p>');
  if (event.httpMethod === 'POST') {
    await db.execute({ sql: "UPDATE liste_attente SET statut = 'desinscrite' WHERE id = ?", args: [e.id] });
    return page("C'est fait", "<p>Vous ne recevrez plus d'alertes de liste d'attente.</p>");
  }
  const action = `?stop=${e.id}&t=${encodeURIComponent(q.t)}`;
  return page("Ne plus recevoir ces alertes ?", `<form method="POST" action="${action}"><button style="background:#1F1F1F;color:#fff;border:0;border-radius:10px;padding:14px 22px;font-size:1rem;font-weight:600;cursor:pointer;">Confirmer</button></form>`);
}

exports.handler = async function (event) {
  if (event.queryStringParameters && event.queryStringParameters.stop) {
    try { return await desinscription(event); } catch (err) {
      console.error('Erreur désinscription :', err);
      return page('Erreur', '<p>Merci de réessayer.</p>');
    }
  }
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method Not Allowed' };
  try {
    const b = JSON.parse(event.body || '{}');
    const prenom = txt(b.prenom, 60);
    const nom = txt(b.nom, 60);
    const email = txt(b.email, 120).toLowerCase();
    const telephone = txt(b.telephone, 30);
    const prestation_nom = txt(b.prestation_nom, 300);
    const duree_min = Math.round(Number(b.duree_min));

    if (!prenom || !email || !telephone) return json({ error: 'Merci de remplir prénom, email et téléphone.' }, 400);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json({ error: 'Adresse email invalide.' }, 400);
    if (!(duree_min >= 15 && duree_min <= 720)) return json({ error: 'Prestation invalide.' }, 400);

    // Dates choisies : aucune = toutes les dates l'intéressent
    const dates = Array.from(new Set(Array.isArray(b.dates) ? b.dates.map(String) : [])).sort();
    const debut = dateParis(1), fin = dateParis(FENETRE_JOURS);
    if (dates.length > MAX_DATES) return json({ error: `${MAX_DATES} dates maximum.` }, 400);
    if (dates.some(d => !/^\d{4}-\d{2}-\d{2}$/.test(d) || d < debut || d > fin)) return json({ error: 'Date invalide.' }, 400);
    const datesJson = dates.length ? JSON.stringify(dates) : null;

    const db = getDb();
    await preparerListeAttente(db);

    // Cliente bloquée : on ne l'inscrit pas (même règle que la réservation)
    const bloque = await db.execute({
      sql: 'SELECT id FROM clients_bloques WHERE lower(email) = ? OR (telephone IS NOT NULL AND telephone != \'\' AND replace(telephone,\' \',\'\') = ?) LIMIT 1',
      args: [email, telephone.replace(/\s/g, '')]
    });
    if (bloque.rows.length) return json({ error: 'Merci de contacter directement le salon au 07 80 96 38 23.' }, 403);

    const libres = await creneauxLibres(db, duree_min, FENETRE_JOURS);
    const init = photoPlanning(libres, FENETRE_JOURS);

    // Déjà inscrite pour la même prestation : on remplace ses dates, sans doublon
    const deja = await db.execute({
      sql: "SELECT id FROM liste_attente WHERE email = ? AND prestation_nom = ? AND statut IN ('en_attente','prevenue') LIMIT 1",
      args: [email, prestation_nom]
    });
    if (deja.rows.length) {
      await db.execute({
        sql: 'UPDATE liste_attente SET dates_souhaitees = ?, creneaux_init = ? WHERE id = ?',
        args: [datesJson, init, deja.rows[0].id]
      });
      return json({ ok: true, deja: true });
    }

    await db.execute({
      sql: 'INSERT INTO liste_attente (prenom, nom, email, telephone, prestation_nom, duree_min, creneaux_init, dates_souhaitees) VALUES (?,?,?,?,?,?,?,?)',
      args: [prenom, nom, email, telephone, prestation_nom, duree_min, init, datesJson]
    });
    return json({ ok: true });
  } catch (err) {
    console.error('Erreur liste-attente :', err);
    return json({ error: 'Erreur, merci de réessayer.' }, 500);
  }
};
