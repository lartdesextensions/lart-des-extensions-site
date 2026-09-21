const crypto = require('crypto');

// Clé de signature des sessions admin. On utilise ADMIN_TOKEN_SECRET si elle existe,
// sinon on dérive une clé de STRIPE_SECRET_KEY (déjà présente sur Netlify, jamais
// exposée au navigateur) : aucune nouvelle variable n'est nécessaire.
function signingKey() {
  const base = process.env.ADMIN_TOKEN_SECRET || process.env.STRIPE_SECRET_KEY;
  if (!base) throw new Error('Aucune clé de session configurée.');
  return crypto.createHash('sha256').update('lade-admin-session:' + base).digest();
}

function b64url(buf) {
  return Buffer.from(buf).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
}

const SESSION_DAYS = 30;

function signToken() {
  const exp = Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000;
  const payload = `v1.${exp}`;
  const sig = b64url(crypto.createHmac('sha256', signingKey()).update(payload).digest());
  return { token: `${payload}.${sig}`, exp };
}

function verifyToken(token) {
  if (!token || typeof token !== 'string') return false;
  const parts = token.split('.');
  if (parts.length !== 3 || parts[0] !== 'v1') return false;
  const exp = Number(parts[1]);
  if (!exp || Date.now() > exp) return false;
  const expected = b64url(crypto.createHmac('sha256', signingKey()).update(`v1.${exp}`).digest());
  const a = Buffer.from(parts[2]);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function isAdmin(event) {
  const h = (event.headers && (event.headers.authorization || event.headers.Authorization)) || '';
  const m = /^Bearer\s+(.+)$/i.exec(h);
  return m ? verifyToken(m[1].trim()) : false;
}

// ── Mots de passe ──
// Nouveau format stocké : scrypt$<sel>$<empreinte>. L'ancien format (texte en clair)
// reste accepté pour la connexion, puis est remplacé au premier changement.
function hashPassword(pwd) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(String(pwd), salt, 32);
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}

function checkPassword(entered, stored) {
  if (!stored) return false;
  if (stored.startsWith('scrypt$')) {
    const [, saltHex, hashHex] = stored.split('$');
    const hash = crypto.scryptSync(String(entered), Buffer.from(saltHex, 'hex'), 32);
    const expected = Buffer.from(hashHex, 'hex');
    return hash.length === expected.length && crypto.timingSafeEqual(hash, expected);
  }
  const a = Buffer.from(String(entered));
  const b = Buffer.from(String(stored));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// Mot de passe de démarrage, utilisé uniquement tant qu'aucun mot de passe n'a été
// enregistré. Il était visible dans le code public de l'admin : la connexion avec
// lui force donc un changement immédiat.
const BOOTSTRAP_PASSWORD = process.env.ADMIN_PASSWORD || 'Miamore10253!';

async function getStoredPassword(db) {
  const res = await db.execute({
    sql: "SELECT value FROM settings WHERE key = 'admin_password'",
    args: []
  });
  const row = res.rows[0];
  return row && row.value ? String(row.value) : null;
}

module.exports = {
  signToken, verifyToken, isAdmin,
  hashPassword, checkPassword, getStoredPassword, BOOTSTRAP_PASSWORD
};
