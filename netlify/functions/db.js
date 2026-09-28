const { getDb } = require('./lib/turso');

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

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  try {
    const body = JSON.parse(event.body);
    const { table, action, filters, order, limit, single, payload, onConflict } = body;
    const cols = checkTable(table);
    const db = getDb();

    if (action === 'select') {
      const { sql: whereSql, args } = buildWhere(filters, cols);
      let sql = `SELECT * FROM ${table} ${whereSql}`;
      sql += buildOrder(order, cols);
      if (limit) sql += ' LIMIT ' + Number(limit);
      const res = await db.execute({ sql, args });
      const rows = res.rows;
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
