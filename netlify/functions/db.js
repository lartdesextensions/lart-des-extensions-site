const { getDb } = require('./lib/turso');
const { isAdmin } = require('./lib/auth');

// Tables autorisées et leurs colonnes (anti-injection : rien d'autre n'est accepté)
const TABLES = {
  reservations: ['id','prenom','nom','telephone','email','message','prestation_nom','date','heure','duree_min','prix','acompte','statut','acompte_rembourse','acompte_paye','montant_paye','type_paiement','payment_method','payment_id','created_at','groupe_id'],
  prestations: ['id','nom','prix','duree_min','actif','ordre','categorie','sous_categorie'],
  disponibilites: ['id','date','ferme','heure_debut','heure_fin'],
  indisponibilites: ['id','date','heure_debut','heure_fin','motif'],
  clients_bloques: ['id','email','telephone','raison','created_at'],
  clients: ['id','prenom','nom','telephone','email','notes','created_at','updated_at'],
  settings: ['key','value'],
  produits: ['id','nom','prix','actif','ordre'],
  ventes_produits: ['id','produit_nom','prix','quantite','date','reservation_id','prenom','nom','created_at']
};

const OPS = { eq: '=', neq: '!=', gte: '>=', lte: '<=', gt: '>', lt: '<' };

function checkTable(table) {
  if (!TABLES[table]) throw new Error('Table inconnue : ' + table);
  return TABLES[table];
}
function checkCols(table, obj) {
  const allowed = TABLES[table];
  for (const k of Object.keys(obj)) {
    if (!allowed.includes(k)) throw new Error(`Colonne non autorisée : ${table}.${k}`);
  }
}

// Les noms de colonnes des filtres et du tri sont vérifiés : ils étaient insérés
// tels quels dans la requête SQL.
function buildWhere(filters, allowedCols) {
  if (!filters || !filters.length) return { sql: '', args: [] };
  const parts = [];
  const args = [];
  for (const f of filters) {
    if (!OPS[f.op]) throw new Error('Opérateur non autorisé : ' + f.op);
    if (!allowedCols.includes(f.col)) throw new Error('Filtre non autorisé : ' + f.col);
    parts.push(`${f.col} ${OPS[f.op]} ?`);
    args.push(f.value);
  }
  return { sql: 'WHERE ' + parts.join(' AND '), args };
}

function buildOrder(order, allowedCols) {
  if (!order || !order.length) return '';
  return ' ORDER BY ' + order.map(o => {
    if (!allowedCols.includes(o.col)) throw new Error('Tri non autorisé : ' + o.col);
    return `${o.col} ${o.ascending === false ? 'DESC' : 'ASC'}`;
  }).join(', ');
}


// ── SÉCURITÉ ──
// Sans session admin valide, seules les lectures nécessaires à la page de
// réservation publique sont permises, avec des colonnes limitées.
const SETTINGS_SECRETS = k => k === 'admin_password' || String(k).startsWith('auth_');
const PUBLIC_RESA_COLS = ['id', 'date', 'heure', 'duree_min', 'statut', 'acompte_paye', 'created_at'];
const PUBLIC_INSERT_RESA = ['prenom','nom','email','telephone','message','prestation_nom','date','heure','duree_min','prix','acompte','groupe_id'];

function pick(row, cols) { const o = {}; cols.forEach(c => { if (row[c] !== undefined) o[c] = row[c]; }); return o; }

async function publicRequest(db, body) {
  const { table, action, filters, order, limit, single, payload } = body;
  const cols = TABLES[table];

  if (action === 'select' && ['disponibilites', 'indisponibilites', 'prestations', 'settings', 'reservations', 'clients_bloques'].includes(table)) {
    if (table === 'clients_bloques') {
      const f = (filters || [])[0];
      if (!f || filters.length !== 1 || f.op !== 'eq' || !['email', 'telephone'].includes(f.col) || !f.value) {
        return json({ error: 'Non autorisé' }, 401);
      }
    }
    const { sql: whereSql, args } = buildWhere(filters, cols);
    let sql = `SELECT * FROM ${table} ${whereSql}` + buildOrder(order, cols);
    if (limit) sql += ' LIMIT ' + Number(limit);
    let rows = (await db.execute({ sql, args })).rows;
    if (table === 'settings') rows = rows.filter(r => !SETTINGS_SECRETS(r.key));
    if (table === 'clients_bloques') rows = rows.map(r => ({ id: r.id }));
    if (table === 'reservations') {
      const byId = (filters || []).length === 1 && filters[0].col === 'id' && filters[0].op === 'eq';
      rows = rows.map(r => pick(r, byId ? PUBLIC_RESA_COLS.concat(['prenom']) : PUBLIC_RESA_COLS));
    }
    return json({ data: single ? (rows[0] || null) : rows });
  }

  if (action === 'insert' && table === 'reservations') {
    const rows = Array.isArray(payload) ? payload : [payload];
    const inserted = [];
    for (const raw of rows) {
      const row = pick(raw || {}, PUBLIC_INSERT_RESA);
      row.statut = 'en_attente';
      row.acompte_paye = 0;
      const keys = Object.keys(row);
      const sql = `INSERT INTO reservations (${keys.join(',')}) VALUES (${keys.map(() => '?').join(',')}) RETURNING *`;
      const r = (await db.execute({ sql, args: keys.map(k => row[k]) })).rows[0];
      inserted.push(pick(r, PUBLIC_RESA_COLS.concat(['prenom'])));
    }
    return json({ data: single ? inserted[0] : inserted });
  }

  return json({ error: 'Non autorisé' }, 401);
}

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  try {
    const body = JSON.parse(event.body);
    const { table, action, filters, order, limit, single, payload, onConflict } = body;
    const cols = checkTable(table);
    const db = getDb();

    if (!isAdmin(event)) return await publicRequest(db, body);

    // Le mot de passe et les compteurs de connexion ne passent jamais par ici
    if (table === 'settings' && action !== 'select') {
      const rows = Array.isArray(payload) ? payload : [payload];
      if (rows.some(r => r && SETTINGS_SECRETS(r.key)) || action === 'delete' || action === 'update') {
        return json({ error: 'Non autorisé' }, 403);
      }
    }

    if (action === 'select') {
      const { sql: whereSql, args } = buildWhere(filters, cols);
      let sql = `SELECT * FROM ${table} ${whereSql}`;
      sql += buildOrder(order, cols);
      if (limit) sql += ' LIMIT ' + Number(limit);
      const res = await db.execute({ sql, args });
      let rows = res.rows;
      if (table === 'settings') rows = rows.filter(r => !SETTINGS_SECRETS(r.key));
      return json({ data: single ? (rows[0] || null) : rows });
    }

    if (action === 'insert') {
      const rows = Array.isArray(payload) ? payload : [payload];
      let inserted = [];
      for (const row of rows) {
        checkCols(table, row);
        const keys = Object.keys(row);
        const sql = `INSERT INTO ${table} (${keys.join(',')}) VALUES (${keys.map(() => '?').join(',')}) RETURNING *`;
        const res = await db.execute({ sql, args: keys.map(k => row[k]) });
        inserted.push(res.rows[0]);
      }
      return json({ data: single ? inserted[0] : inserted });
    }

    if (action === 'update') {
      checkCols(table, payload);
      const keys = Object.keys(payload);
      const { sql: whereSql, args: whereArgs } = buildWhere(filters, cols);
      const sql = `UPDATE ${table} SET ${keys.map(k => `${k} = ?`).join(',')} ${whereSql} RETURNING *`;
      const res = await db.execute({ sql, args: [...keys.map(k => payload[k]), ...whereArgs] });
      return json({ data: single ? (res.rows[0] || null) : res.rows });
    }

    if (action === 'upsert') {
      const rows = Array.isArray(payload) ? payload : [payload];
      let out = [];
      for (const row of rows) {
        checkCols(table, row);
        const keys = Object.keys(row);
        const conflictCol = onConflict || 'id';
        if (!cols.includes(conflictCol)) throw new Error('Colonne de conflit non autorisée.');
        const updateCols = keys.filter(k => k !== conflictCol);
        const sql = `INSERT INTO ${table} (${keys.join(',')}) VALUES (${keys.map(() => '?').join(',')})
          ON CONFLICT(${conflictCol}) DO UPDATE SET ${updateCols.map(k => `${k} = excluded.${k}`).join(',')}
          RETURNING *`;
        const res = await db.execute({ sql, args: keys.map(k => row[k]) });
        out.push(res.rows[0]);
      }
      return json({ data: out });
    }

    if (action === 'delete') {
      const { sql: whereSql, args } = buildWhere(filters, cols);
      const sql = `DELETE FROM ${table} ${whereSql} RETURNING *`;
      const res = await db.execute({ sql, args });
      return json({ data: res.rows });
    }

    return json({ error: 'Action inconnue : ' + action }, 400);
  } catch (err) {
    console.error('Erreur db.js:', err);
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
