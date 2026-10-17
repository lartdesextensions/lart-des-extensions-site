// Connexion admin vérifiée côté serveur.
// Le mot de passe reste dans la table settings mais n'est plus jamais
// renvoyé au navigateur. 5 erreurs => blocage 15 min pour cette adresse IP.
const crypto = require('crypto');
const { getDb } = require('./lib/turso');
const { createToken, isAdmin } = require('./lib/auth');

const MAX_ESSAIS = 5;
const BLOCAGE_MS = 15 * 60 * 1000;

function same(a, b) {
  const ha = crypto.createHash('sha256').update(String(a)).digest();
  const hb = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}

async function getSetting(db, key) {
  const r = await db.execute({ sql: 'SELECT value FROM settings WHERE key = ?', args: [key] });
  return r.rows[0] ? r.rows[0].value : null;
}
async function setSetting(db, key, value) {
  await db.execute({
    sql: 'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
    args: [key, value]
  });
}

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') return json({ error: 'Method Not Allowed' }, 405);
  try {
    const body = JSON.parse(event.body || '{}');
    const db = getDb();

    if (body.action === 'login') {
      const ip = (event.headers['x-nf-client-connection-ip'] || event.headers['client-ip'] || 'inconnu').slice(0, 64);
      const lockKey = 'auth_lock:' + ip;
      const lockRaw = await getSetting(db, lockKey);
      const lock = lockRaw ? JSON.parse(lockRaw) : { n: 0, until: 0 };
      if (lock.until && Date.now() < lock.until) {
        return json({ error: 'Trop d\'essais. Réessayez dans 15 minutes.' }, 429);
      }
      const stored = await getSetting(db, 'admin_password');
      if (stored && same(body.password || '', stored)) {
        if (lockRaw) await db.execute({ sql: 'DELETE FROM settings WHERE key = ?', args: [lockKey] });
        return json(createToken());
      }
      const n = (lock.until && Date.now() >= lock.until ? 0 : lock.n) + 1;
      await setSetting(db, lockKey, JSON.stringify({ n: n >= MAX_ESSAIS ? 0 : n, until: n >= MAX_ESSAIS ? Date.now() + BLOCAGE_MS : 0 }));
      return json({ error: 'Mot de passe incorrect.' }, 401);
    }

    if (body.action === 'verify') {
      return json({ ok: isAdmin(event) }, isAdmin(event) ? 200 : 401);
    }

    if (body.action === 'change') {
      if (!isAdmin(event)) return json({ error: 'Session expirée, reconnectez-vous.' }, 401);
      const stored = await getSetting(db, 'admin_password');
      if (!stored || !same(body.current || '', stored)) return json({ error: 'Mot de passe actuel incorrect.' }, 400);
      if (!body.next || String(body.next).length < 6) return json({ error: 'Le nouveau mot de passe doit contenir au moins 6 caractères.' }, 400);
      await setSetting(db, 'admin_password', String(body.next));
      return json({ ok: true });
    }

    return json({ error: 'Action inconnue' }, 400);
  } catch (err) {
    console.error('Erreur auth.js:', err);
    return json({ error: 'Erreur serveur' }, 500);
  }
};

function json(obj, statusCode = 200) {
  return { statusCode, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }, body: JSON.stringify(obj) };
}
