// Sessions admin signées côté serveur (HMAC). Le secret est dérivé du token
// Turso, qui n'existe que sur le serveur Netlify : impossible de fabriquer
// une session valide sans le connaître.
const crypto = require('crypto');

const SESSION_MS = 30 * 24 * 60 * 60 * 1000; // 30 jours (iPhone)

function secret() {
  const base = process.env.ADMIN_SESSION_SECRET || process.env.TURSO_AUTH_TOKEN || '';
  if (!base) throw new Error('Secret de session manquant');
  return crypto.createHash('sha256').update('lart-admin-session:' + base).digest();
}

function b64url(buf) {
  return Buffer.from(buf).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
}

function createToken() {
  const exp = Date.now() + SESSION_MS;
  const payload = b64url(JSON.stringify({ exp }));
  const sig = b64url(crypto.createHmac('sha256', secret()).update(payload).digest());
  return { token: payload + '.' + sig, exp };
}

function verifyToken(token) {
  if (!token || typeof token !== 'string' || !token.includes('.')) return false;
  const [payload, sig] = token.split('.');
  const expected = b64url(crypto.createHmac('sha256', secret()).update(payload).digest());
  const a = Buffer.from(sig || ''), b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return false;
  try {
    const { exp } = JSON.parse(Buffer.from(payload.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString());
    return typeof exp === 'number' && Date.now() < exp;
  } catch (e) { return false; }
}

function isAdmin(event) {
  const h = event.headers || {};
  const auth = h.authorization || h.Authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  try { return verifyToken(token); } catch (e) { return false; }
}

module.exports = { createToken, verifyToken, isAdmin };
