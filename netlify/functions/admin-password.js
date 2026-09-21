const { getDb } = require('./lib/turso');
const { isAdmin, checkPassword, hashPassword, getStoredPassword, BOOTSTRAP_PASSWORD } = require('./lib/auth');

function json(obj, statusCode = 200) {
  return { statusCode, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(obj) };
}

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method Not Allowed' };
  if (!isAdmin(event)) return json({ error: 'Session expirée, reconnectez-vous.' }, 401);

  try {
    const { current, next } = JSON.parse(event.body || '{}');
    if (!current || !next) return json({ error: 'Champs manquants.' }, 400);
    if (String(next).length < 8) return json({ error: 'Le nouveau mot de passe doit contenir au moins 8 caractères.' }, 400);

    const db = getDb();
    const stored = await getStoredPassword(db);
    if (!checkPassword(current, stored || BOOTSTRAP_PASSWORD)) {
      await new Promise(r => setTimeout(r, 600));
      return json({ error: 'Mot de passe actuel incorrect.' }, 401);
    }
    if (String(next) === String(BOOTSTRAP_PASSWORD)) {
      return json({ error: 'Choisissez un mot de passe différent de l’ancien mot de passe par défaut.' }, 400);
    }

    await db.execute({
      sql: `INSERT INTO settings (key, value) VALUES ('admin_password', ?)
            ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      args: [hashPassword(next)]
    });
    return json({ success: true });
  } catch (err) {
    console.error('Erreur admin-password:', err);
    return json({ error: 'Changement impossible pour le moment.' }, 500);
  }
};
