// Grille des prix officielle, lue directement dans prestations.html (la page
// où les clientes remplissent leur panier). Le serveur vérifie avec elle que
// le prix enregistré pour une réservation n'a pas été modifié dans le
// navigateur avant d'envoyer la cliente vers le paiement.

let cache = null;
let cacheAt = 0;
const CACHE_MS = 10 * 60 * 1000; // 10 minutes

function decode(s) {
  return s
    .replace(/\\u([0-9a-fA-F]{4})/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/\\'/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&');
}

async function chargerCatalogue() {
  if (cache && Date.now() - cacheAt < CACHE_MS) return cache;
  const base = process.env.URL || 'https://lartdesextensions.fr';
  const res = await fetch(base + '/prestations.html?v=' + Date.now());
  if (!res.ok) throw new Error('prestations.html illisible (' + res.status + ')');
  const html = await res.text();

  const map = {};
  const re = /(?:addToCart|toggleSupplement)\((?:this,\s*)?'((?:[^'\\]|\\.)*)',\s*([\d.]+)/g;
  let m;
  while ((m = re.exec(html))) {
    map[decode(m[1]).trim()] = Number(m[2]);
  }
  if (Object.keys(map).length < 20) throw new Error('Grille des prix incomplète');
  cache = map;
  cacheAt = Date.now();
  return map;
}

// Découpe un nom de prestation en morceaux { nom, prix } :
//   "Entretien classique - 50 bandes"                 → 1 morceau, prix inconnu
//   "Balayage - Demi-tête (100 €)"                    → 1 morceau, prix 100
//   "A (120 €) + Dépose + Nouvelle pose kératine - 70 (281 €)" → 2 morceaux
function decouper(nom) {
  const s = String(nom || '').trim();
  const re = /(.+?)\s*\((\d+(?:[.,]\d+)?)\s*€\)\s*(?:\+\s*|$)/g;
  const out = [];
  let m, fin = 0;
  while ((m = re.exec(s))) {
    out.push({ nom: m[1].trim(), prix: Number(m[2].replace(',', '.')) });
    fin = re.lastIndex;
  }
  if (!out.length || fin < s.length) return [{ nom: s, prix: null }];
  return out;
}

// Vérifie un ensemble de lignes de réservation (une ou plusieurs prestations).
// Renvoie { ok: true } ou { ok: false, raison }.
// Si la grille ne peut pas être lue, on laisse passer (le salon ne doit jamais
// être bloqué par une panne de lecture) mais on le signale dans les logs.
async function verifierPrix(rows) {
  let map;
  try {
    map = await chargerCatalogue();
  } catch (e) {
    console.error('Vérification des prix impossible :', e.message);
    return { ok: true, nonVerifie: true };
  }

  for (const r of rows) {
    const morceaux = decouper(r.prestation_nom);
    let attendu = 0;
    for (const p of morceaux) {
      if (!(p.nom in map)) {
        return { ok: false, raison: `Prestation inconnue : « ${p.nom} »` };
      }
      if (p.prix !== null && p.prix !== map[p.nom]) {
        return { ok: false, raison: `Prix modifié pour « ${p.nom} »` };
      }
      attendu += map[p.nom];
    }
    if (Math.abs(attendu - (Number(r.prix) || 0)) > 0.01) {
      return { ok: false, raison: `Prix incorrect pour « ${r.prestation_nom} » (${r.prix} € au lieu de ${attendu} €)` };
    }
  }
  return { ok: true };
}

module.exports = { verifierPrix, chargerCatalogue, decouper };
