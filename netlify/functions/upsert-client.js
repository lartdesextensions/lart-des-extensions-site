const { getDb } = require('./lib/turso');

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }
  try {
    const { prenom, nom, telephone, email } = JSON.parse(event.body || '{}');
    const db = getDb();
    let existing = null;

    if (email) {
      const r = await db.execute({ sql: 'SELECT * FROM clients WHERE lower(email) = lower(?) LIMIT 1', args: [email] });
      existing = r.rows[0] || null;
    }
    if (!existing && telephone) {
      const r = await db.execute({ sql: 'SELECT * FROM clients WHERE telephone = ? LIMIT 1', args: [telephone] });
      existing = r.rows[0] || null;
    }

    if (existing) {
      await db.execute({
        sql: `UPDATE clients SET
                prenom = CASE WHEN ? != '' THEN ? ELSE prenom END,
                nom = CASE WHEN ? != '' THEN ? ELSE nom END,
                telephone = CASE WHEN ? != '' THEN ? ELSE telephone END,
                email = CASE WHEN ? != '' THEN ? ELSE email END,
                updated_at = CURRENT_TIMESTAMP
              WHERE id = ?`,
        args: [
          prenom || '', prenom || '',
          nom || '', nom || '',
          telephone || '', telephone || '',
          email || '', email || '',
          existing.id
        ]
      });
      return json({ id: existing.id, created: false });
    }

    const res = await db.execute({
      sql: `INSERT INTO clients (prenom, nom, telephone, email) VALUES (?, ?, ?, ?) RETURNING *`,
      args: [prenom || '', nom || '', telephone || '', email || '']
    });
    return json({ id: res.rows[0].id, created: true });
  } catch (err) {
    console.error('Erreur upsert-client.js:', err);
    return json({ error: err.message }, 500);
  }
};

function json(obj, statusCode = 200) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(obj)
  };
}
