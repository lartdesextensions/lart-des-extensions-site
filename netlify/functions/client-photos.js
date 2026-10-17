// Photos de suivi des fiches clientes, stockées dans Netlify Blobs
// (inclus gratuitement, privé : uniquement accessible via cette fonction,
// et seulement avec une session admin valide).
const { getStore, connectLambda } = require('@netlify/blobs');
const { isAdmin } = require('./lib/auth');

const MAX_OCTETS = 4 * 1024 * 1024; // 4 Mo par photo (déjà compressée côté navigateur)

function store() {
  return getStore({ name: 'photos-clientes', consistency: 'strong' });
}
async function readMeta(s, clientId) {
  const m = await s.get('meta/' + clientId, { type: 'json' });
  return Array.isArray(m) ? m : [];
}

exports.handler = async function (event) {
  connectLambda(event);
  if (!isAdmin(event)) return json({ error: 'Session expirée, reconnectez-vous.' }, 401);
  const s = store();

  try {
    if (event.httpMethod === 'GET') {
      const q = event.queryStringParameters || {};
      const clientId = String(q.client || ''), id = String(q.id || '');
      if (!/^\d+$/.test(clientId) || !/^[a-z0-9]+$/.test(id)) return json({ error: 'Paramètres invalides' }, 400);
      const buf = await s.get(`img/${clientId}/${id}`, { type: 'arrayBuffer' });
      if (!buf) return json({ error: 'Photo introuvable' }, 404);
      return {
        statusCode: 200,
        headers: { 'Content-Type': 'image/jpeg', 'Cache-Control': 'private, max-age=86400' },
        body: Buffer.from(buf).toString('base64'),
        isBase64Encoded: true
      };
    }

    if (event.httpMethod !== 'POST') return json({ error: 'Method Not Allowed' }, 405);
    const body = JSON.parse(event.body || '{}');
    const clientId = String(body.clientId || '');
    if (!/^\d+$/.test(clientId)) return json({ error: 'Cliente invalide' }, 400);

    if (body.action === 'list') {
      return json({ data: await readMeta(s, clientId) });
    }

    if (body.action === 'upload') {
      const m = /^data:image\/jpeg;base64,([A-Za-z0-9+/=]+)$/.exec(body.image || '');
      if (!m) return json({ error: 'Image invalide' }, 400);
      const buf = Buffer.from(m[1], 'base64');
      if (buf.length > MAX_OCTETS) return json({ error: 'Photo trop lourde' }, 400);
      const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
      await s.set(`img/${clientId}/${id}`, buf);
      const meta = await readMeta(s, clientId);
      const item = { id, date: String(body.date || '').slice(0, 10), note: String(body.note || '').slice(0, 300) };
      meta.push(item);
      await s.setJSON('meta/' + clientId, meta);
      return json({ data: item });
    }

    if (body.action === 'delete') {
      const id = String(body.id || '');
      if (!/^[a-z0-9]+$/.test(id)) return json({ error: 'Photo invalide' }, 400);
      await s.delete(`img/${clientId}/${id}`);
      const meta = (await readMeta(s, clientId)).filter(p => p.id !== id);
      await s.setJSON('meta/' + clientId, meta);
      return json({ ok: true });
    }

    if (body.action === 'deleteAll') {
      const meta = await readMeta(s, clientId);
      for (const p of meta) await s.delete(`img/${clientId}/${p.id}`);
      await s.delete('meta/' + clientId);
      return json({ ok: true });
    }

    return json({ error: 'Action inconnue' }, 400);
  } catch (err) {
    console.error('Erreur client-photos.js:', err);
    return json({ error: err.message }, 500);
  }
};

function json(obj, statusCode = 200) {
  return { statusCode, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }, body: JSON.stringify(obj) };
}
