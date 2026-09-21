const { getDb } = require('./lib/turso');
const { signToken, checkPassword, getStoredPassword, BOOTSTRAP_PASSWORD } = require('./lib/auth');

function json(obj, statusCode = 200) {
  return { statusCode, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(obj) };
}

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method Not Allowed' };

  try {
    const { password } = JSON.parse(event.body || '{}');
    if (!password) return json({ error: 'Mot de passe requis.' }, 400);

    const db = getDb();
    const stored = await getStoredPassword(db);
    const reference = stored || BOOTSTRAP_PASSWORD;

    if (!checkPassword(password, reference)) {
      // Ralentit les tentatives en série
      await new Promise(r => setTimeout(r, 600));
      return json({ error: 'Mot de passe incorrect.' }, 401);
    }

    // Tout mot de passe non chiffré a pu être lu publiquement avant la sécurisation :
    // on exige donc un changement.
    const mustChange = !stored || !stored.startsWith('scrypt$');
    const { token, exp } = signToken();
    return json({ token, exp, mustChange });
  } catch (err) {
    console.error('Erreur admin-login:', err);
    return json({ error: 'Connexion impossible pour le moment.' }, 500);
  }
};
