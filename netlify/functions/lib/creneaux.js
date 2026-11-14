// Calcul des créneaux libres côté serveur, avec exactement les mêmes règles que
// le calendrier de reservation.html (horaires de la semaine, fermetures et
// ouvertures exceptionnelles, réservations payées, blocages horaires).
// Utilisé par la liste d'attente.

function timeToMin(t) {
  const [h, m] = String(t).split(':').map(Number);
  return h * 60 + (m || 0);
}
function isTrue(v) {
  return v === true || v === 1 || v === '1' || v === 'true';
}
function isWeekdayClosed(map, dow) {
  const v = map[`hours_${dow}_ferme`];
  if (v === undefined) return dow === 0;
  return isTrue(v);
}
function findAvail(list, dateStr) {
  const rows = (list || []).filter(a => a.date === dateStr);
  return rows.find(a => isTrue(a.ferme)) || rows[0];
}
function isDayClosed(weekly, dow, avail) {
  if (avail && isTrue(avail.ferme)) return true;
  if (isWeekdayClosed(weekly, dow)) return !(avail && avail.heure_debut && avail.heure_fin);
  return false;
}

function computeDaySlots(dow, weekly, avail, bookings, dureeMin) {
  let startMin = 9 * 60, endMin = 17 * 60;
  const defStart = weekly[`hours_${dow}_start`];
  const defEnd = weekly[`hours_${dow}_end`];
  if (defStart) startMin = timeToMin(defStart);
  if (defEnd) endMin = timeToMin(defEnd);
  if (avail && avail.heure_debut) startMin = timeToMin(avail.heure_debut);
  if (avail && avail.heure_fin) endMin = timeToMin(avail.heure_fin);

  const slotTimes = new Set();
  for (let t = startMin; t < endMin; t += 30) slotTimes.add(t);
  bookings.forEach(b => {
    const end = timeToMin(b.heure) + b.duree_min;
    if (end >= startMin && end < endMin) slotTimes.add(end);
  });

  const libres = [];
  Array.from(slotTimes).sort((a, b) => a - b).forEach(sStart => {
    const sEnd = sStart + dureeMin;
    if (sEnd > endMin) return;
    const conflict = bookings.some(b => {
      const bStart = timeToMin(b.heure);
      return sStart < bStart + b.duree_min && sEnd > bStart;
    });
    if (!conflict) libres.push(`${String(Math.floor(sStart / 60)).padStart(2, '0')}:${String(sStart % 60).padStart(2, '0')}`);
  });
  return libres;
}

// Date du jour à Paris au format AAAA-MM-JJ (+ décalage en jours)
function dateParis(decalageJours) {
  const d = new Date(Date.now() + (decalageJours || 0) * 86400000);
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}

// Renvoie { 'AAAA-MM-JJ': ['10:00', '10:30', ...] } pour chaque jour qui a au
// moins un créneau libre pour cette durée, de demain jusqu'à `jours` jours.
async function creneauxLibres(db, dureeMin, jours) {
  jours = jours || 60;
  const debut = dateParis(1);
  const fin = dateParis(jours);

  const [settings, dispos, rdvs, blocages] = await Promise.all([
    db.execute('SELECT key, value FROM settings'),
    db.execute({ sql: 'SELECT * FROM disponibilites WHERE date >= ? AND date <= ?', args: [debut, fin] }),
    db.execute({ sql: "SELECT date, heure, duree_min, statut, acompte_paye, montant_paye FROM reservations WHERE date >= ? AND date <= ? AND statut != 'annule'", args: [debut, fin] }),
    db.execute({ sql: 'SELECT date, heure_debut, heure_fin FROM indisponibilites WHERE date >= ? AND date <= ?', args: [debut, fin] })
  ]);

  const weekly = {};
  settings.rows.forEach(s => { weekly[s.key] = s.value; });

  const occupe = {};
  rdvs.rows.forEach(r => {
    // Réservation non payée : ne bloque jamais le créneau (même règle que le site)
    if (r.statut === 'en_attente' && !isTrue(r.acompte_paye) && !(Number(r.montant_paye) > 0)) return;
    (occupe[r.date] = occupe[r.date] || []).push({ heure: r.heure, duree_min: Number(r.duree_min) || 0 });
  });
  blocages.rows.forEach(b => {
    (occupe[b.date] = occupe[b.date] || []).push({ heure: b.heure_debut, duree_min: timeToMin(b.heure_fin) - timeToMin(b.heure_debut) });
  });

  const out = {};
  for (let i = 1; i <= jours; i++) {
    const dateStr = dateParis(i);
    const [y, m, d] = dateStr.split('-').map(Number);
    const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
    const avail = findAvail(dispos.rows, dateStr);
    if (isDayClosed(weekly, dow, avail)) continue;
    const libres = computeDaySlots(dow, weekly, avail, occupe[dateStr] || [], Number(dureeMin) || 60);
    if (libres.length) out[dateStr] = libres;
  }
  return out;
}

const CREATE_LISTE_ATTENTE = `CREATE TABLE IF NOT EXISTS liste_attente (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  prenom TEXT NOT NULL, nom TEXT, email TEXT NOT NULL, telephone TEXT,
  prestation_nom TEXT, duree_min INTEGER NOT NULL,
  creneaux_init TEXT, creneaux_trouves TEXT,
  statut TEXT DEFAULT 'en_attente', email_envoye INTEGER DEFAULT 0,
  prevenue_at TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP)`;

// Jours qui n'avaient AUCUN créneau libre à l'inscription et en ont un maintenant.
// Les jours ajoutés au-delà de la fenêtre d'origine ne comptent pas (sinon chaque
// nouveau jour du calendrier déclencherait une fausse alerte).
function joursLiberes(init, maintenant) {
  let ref = {};
  try { ref = JSON.parse(init || '{}'); } catch (e) { ref = {}; }
  const deja = new Set(ref.jours || []);
  const fin = ref.fin || '9999-12-31';
  return Object.keys(maintenant).filter(d => d <= fin && !deja.has(d)).sort();
}

module.exports = { creneauxLibres, joursLiberes, CREATE_LISTE_ATTENTE, dateParis };
