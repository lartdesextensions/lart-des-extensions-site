const { getDb } = require('./lib/turso');

// Clé secrète : uniquement dans les variables d'environnement Netlify (SCALAPAY_API_KEY).
// Jamais dans le code ni dans un fichier du dépôt.
const SCALAPAY_API = process.env.SCALAPAY_API_URL || 'https://api.scalapay.com';

// Scalapay exige que la formule demandée corresponde au contrat marchand.
// On essaie les formules dans cet ordre et on garde la première acceptée.
// Pour en imposer une seule : variable Netlify SCALAPAY_PRODUCTS (ex. "pay-in-4").
const PRODUCTS = (process.env.SCALAPAY_PRODUCTS || 'pay-in-3,pay-in-4')
  .split(',').map((p) => p.trim()).filter(Boolean);

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  try {
    if (!process.env.SCALAPAY_API_KEY) {
      return { statusCode: 500, body: JSON.stringify({ error: 'Scalapay non configuré.' }) };
    }

    const { reservationId, siteUrl } = JSON.parse(event.body);
    if (!reservationId) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Paramètres manquants.' }) };
    }

    const db = getDb();
    const lookup = await db.execute({
      sql: 'SELECT * FROM reservations WHERE id = ?',
      args: [reservationId]
    });
    const reservation = lookup.rows[0];
    if (!reservation) {
      return { statusCode: 404, body: JSON.stringify({ error: 'Réservation introuvable.' }) };
    }
    if (reservation.acompte_paye) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Cette réservation est déjà payée.' }) };
    }

    // Le montant n'est JAMAIS repris du navigateur : recalculé depuis la base.
    // Avec Scalapay, la cliente règle toujours la totalité (étalée en plusieurs fois).
    let rows = [reservation];
    if (reservation.groupe_id) {
      const groupLookup = await db.execute({
        sql: 'SELECT * FROM reservations WHERE groupe_id = ? ORDER BY heure',
        args: [reservation.groupe_id]
      });
      if ((groupLookup.rows || []).length > 1) rows = groupLookup.rows;
    }
    const total = rows.reduce((s, r) => s + (Number(r.prix) || 0), 0);
    if (!total || total <= 0) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Prix de la prestation invalide.' }) };
    }

    const base = siteUrl || process.env.URL || '';
    const money = (n) => ({ amount: Number(n).toFixed(2), currency: 'EUR' });

    const body = {
      totalAmount: money(total),
      consumer: {
        givenNames: reservation.prenom || '-',
        surname: reservation.nom || '-',
        email: reservation.email || '',
        phoneNumber: reservation.telephone || ''
      },
      shipping: {
        name: `${reservation.prenom || ''} ${reservation.nom || ''}`.trim() || 'Cliente',
        line1: "L'Art des Extensions",
        suburb: 'Orsay',
        postcode: '91400',
        countryCode: 'FR'
      },
      items: rows.map((r, i) => ({
        name: r.prestation_nom || 'Prestation',
        category: 'services',
        sku: `rdv-${reservationId}-${i + 1}`,
        quantity: 1,
        price: money(r.prix)
      })),
      merchant: {
        redirectConfirmUrl: `${base}/reservation.html?payment=success&provider=scalapay&rdv=${reservationId}`,
        redirectCancelUrl: `${base}/reservation.html?payment=cancel&rdv=${reservationId}`
      },
      merchantReference: `rdv-${reservationId}`,
      type: 'online'
    };

    // Une tentative par formule : on s'arrête à la première que Scalapay accepte.
    let res, data, product;
    for (product of PRODUCTS) {
      res = await fetch(`${SCALAPAY_API}/v2/orders`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${process.env.SCALAPAY_API_KEY}`,
          'Content-Type': 'application/json',
          Accept: 'application/json'
        },
        body: JSON.stringify({ ...body, product })
      });
      data = await res.json().catch(() => ({}));
      if (res.ok && data.checkoutUrl && data.token) break;
      console.error(`Erreur Scalapay create order (${product}):`, res.status, JSON.stringify(data));
      // Seul le refus de formule justifie d'essayer la suivante.
      if (!/product_not_supported/i.test(JSON.stringify(data))) break;
    }

    if (!res.ok || !data.checkoutUrl || !data.token) {
      const refusFormule = /product_not_supported/i.test(JSON.stringify(data));
      return {
        statusCode: 502,
        body: JSON.stringify({
          error: `Scalapay (${res.status}) : ` + (data.message || JSON.stringify(data) || 'commande refusée') +
            (refusFormule ? ` [formules essayées : ${PRODUCTS.join(', ')}]` : '')
        })
      };
    }
    console.log('Scalapay : commande créée avec la formule', product);

    // On garde le jeton de la commande côté serveur : c'est lui (et non ce que
    // renvoie le navigateur) qui servira à encaisser au retour de la cliente.
    await db.execute({
      sql: 'UPDATE reservations SET payment_id = ? WHERE id = ?',
      args: [data.token, reservationId]
    });

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: data.checkoutUrl })
    };
  } catch (err) {
    console.error('Erreur create-scalapay-order:', err);
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
