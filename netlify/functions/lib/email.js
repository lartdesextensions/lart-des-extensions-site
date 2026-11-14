const MONTHS_FR = ['janvier','février','mars','avril','mai','juin','juillet','août','septembre','octobre','novembre','décembre'];

function buildTemplateParams(r) {
  const [y, m, d] = r.date.split('-').map(Number);
  const dateLabel = `${d} ${MONTHS_FR[m - 1]} ${y}`;

  const prix = Number(r.prix) || 0;
  // Montant réellement encaissé en ligne : montant_paye si la colonne est remplie,
  // sinon on retombe sur l'acompte (réservations antérieures et RDV créés à la main).
  const encaisse = Number(r.montant_paye) > 0 ? Number(r.montant_paye) : (Number(r.acompte) || 0);
  const reste = Math.max(prix - encaisse, 0);
  const toutPaye = reste === 0 && encaisse > 0;

  return {
    nom_cliente: `${r.prenom} ${r.nom}`,
    name: `${r.prenom} ${r.nom}`,
    email_cliente: r.email,
    prestation: r.prestation_nom,
    total: prix,
    acompte: encaisse,          // conservé pour les templates existants
    montant_paye: encaisse,
    reste: reste,
    date_rdv: `${dateLabel} à ${r.heure}`,
    heure_rdv: r.heure,
    telephone: r.telephone,
    telephone_cliente: r.telephone,
    type_paiement: toutPaye ? 'Totalité' : 'Acompte',
    // Phrase prête à l'emploi : à insérer telle quelle dans les templates EmailJS
    mention_solde: toutPaye
      ? 'Votre prestation est intégralement réglée. Rien à prévoir le jour du rendez-vous.'
      : `Un solde de ${reste} € sera à régler sur place le jour du rendez-vous, en espèces ou par PayPal.`
  };
}

async function sendViaEmailJS(templateId, templateParams) {
  try {
    const payload = {
      service_id: 'service_8xq5hij',
      template_id: templateId,
      user_id: 'pnSluawmsGb1F5d_i',
      template_params: templateParams
    };
    if (process.env.EMAILJS_PRIVATE_KEY) {
      payload.accessToken = process.env.EMAILJS_PRIVATE_KEY;
    }
    const res = await fetch('https://api.emailjs.com/api/v1.0/email/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (!res.ok) {
      const text = await res.text();
      console.error('Erreur envoi email (' + templateId + '):', text);
      return { ok: false, error: text };
    }
    return { ok: true };
  } catch (e) {
    console.error('Erreur envoi email (' + templateId + '):', e);
    return { ok: false, error: e.message };
  }
}

// ── ENVOI DEPUIS L'ADRESSE DU SALON (Brevo) ──
// Tant que la variable Netlify BREVO_API_KEY n'existe pas, rien ne change :
// les emails continuent de partir par EmailJS. Dès qu'elle est ajoutée (et le
// domaine lartdesextensions.fr validé chez Brevo), ils partent depuis
// EMAIL_FROM (par défaut contact@lartdesextensions.fr), ce qui évite les spams.
const SALON_NOM = "L'Art des Extensions";
const SALON_TEL = '07 80 96 38 23';
const SITE = 'https://lartdesextensions.fr';
// Boîte qui reçoit les réservations (comme dans EmailJS)
const EMAIL_SALON = process.env.EMAIL_SALON || 'rdv.lartdesextensions@gmail.com';

function esc(v) {
  return String(v == null ? '' : v)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// Mise en page reprise à l'identique des modèles EmailJS (même style, même texte).
function cadreEmailJS(contenu) {
  return `<div style="font-family: system-ui, sans-serif, Arial; font-size: 12px;">
<div style="margin-top: 20px; padding: 15px 0; border-width: 1px 0; border-style: dashed; border-color: lightgrey;">
<table role="presentation"><tbody><tr><td style="vertical-align: top;">
<div style="padding: 6px 10px; margin: 0 10px; background-color: aliceblue; border-radius: 5px; font-size: 26px; display: inline-block;" role="img">&#128100;</div>
${contenu}
</td></tr></tbody></table>
</div>
</div>`;
}

// Copie du modèle EmailJS template_ki0fg15 (confirmation envoyée à la cliente)
function emailCliente(p) {
  const html = cadreEmailJS(`<p>Bonjour ${esc(p.nom_cliente)},</p>
<p>✨ Votre rendez-vous est confirmé !</p>
<p>💇 Prestation(s) : ${esc(p.prestation)}<br>📅 Date : ${esc(p.date_rdv)}<br>🕐 Heure : ${esc(p.heure_rdv)}</p>
<p>💶 Montant total : ${esc(p.total)} €<br>✅ Déjà réglé en ligne : ${esc(p.montant_paye)} €<br>💰 Reste à payer sur place le jour du RDV : ${esc(p.reste)} €<br>💵 Paiement accepté : Espèces ou PayPal</p>
<p>📍 Adresse du salon :<br>L'Art des Extensions<br>15 rue du Fond du Guichet<br>91400 Orsay</p>
<p>🧴 La veille au soir ou le jour même, lavez vos cheveux deux fois avec un shampoing sans silicone et sans huiles. Il est important qu'ils ne soient pas gras pour la pose.</p>
<p>⚠️ Évitez absolument les masques et après-shampoings. Séchez-les bien et lissez-les avant votre venue.</p>
<p>🚆 Accès : RER B – Gare Le Guichet (10 min à pied)</p>
<p>🚗 Parking : Au fond de l'impasse, 2e portillon noir à droite (pancarte indiquée)</p>
<p>❌ Les accompagnateurs et enfants ne sont pas acceptés.</p>
<p>🕐 Merci d'arriver à l'heure exacte de votre rendez-vous. Un retard de 15 minutes maximum est toléré. Au-delà, la prestation risque d'être annulée et l'acompte perdu.</p>
<p>&nbsp;</p>
<p>À très bientôt !<br>L'Art des Extensions</p>`);
  return { subject: "Confirmation de votre réservation - L'Art des Extensions", html };
}

// Copie du modèle EmailJS template_bae1d9m (notification « Nouvelle réservation » pour le salon)
function emailSalon(p) {
  const html = cadreEmailJS(`<p>Nouvelle réservation reçue !</p>
<p>Cliente : ${esc(p.nom_cliente)}<br>Email : ${esc(p.email_cliente)}<br>Prestation(s) : ${esc(p.prestation)}<br>Total : ${esc(p.total)} €<br>Payé en ligne : ${esc(p.montant_paye)} € (${esc(p.type_paiement)})
Reste à encaisser : ${esc(p.reste)} €
<br>Téléphone : ${esc(p.telephone_cliente)}<br>Date du RDV : ${esc(p.date_rdv)}<br>Heure du RDV : ${esc(p.heure_rdv)}</p>`);
  return { subject: `Nouvelle réservation - ${p.prestation}`, html };
}

async function sendViaBrevo(to, toName, contenu, replyTo, senderName) {
  try {
    const from = process.env.EMAIL_FROM || 'contact@lartdesextensions.fr';
    const body = {
      sender: { name: senderName || SALON_NOM, email: from },
      to: [{ email: to, name: toName || undefined }],
      subject: contenu.subject,
      htmlContent: contenu.html
    };
    if (replyTo) body.replyTo = { email: replyTo };
    const res = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'api-key': process.env.BREVO_API_KEY },
      body: JSON.stringify(body)
    });
    if (!res.ok) {
      const text = await res.text();
      console.error('Erreur envoi Brevo:', text);
      return { ok: false, error: text };
    }
    return { ok: true };
  } catch (e) {
    console.error('Erreur envoi Brevo:', e);
    return { ok: false, error: e.message };
  }
}

// Notification interne pour le salon (utilisé pour les réservations payées en ligne)
async function sendConfirmationEmail(r) {
  const p = buildTemplateParams(r);
  if (process.env.BREVO_API_KEY) {
    // Même destinataire que le modèle EmailJS ; expéditeur affiché = nom de la cliente
    const res = await sendViaBrevo(EMAIL_SALON, SALON_NOM, emailSalon(p), r.email || null, p.nom_cliente);
    if (res.ok) return res;
    console.error('Brevo en échec, envoi de secours par EmailJS');
  }
  return sendViaEmailJS('template_bae1d9m', p);
}

// Confirmation envoyée à la cliente
async function sendClientConfirmationEmail(r) {
  const p = buildTemplateParams(r);
  if (process.env.BREVO_API_KEY && r.email) {
    const res = await sendViaBrevo(r.email, `${r.prenom} ${r.nom}`, emailCliente(p), EMAIL_SALON);
    if (res.ok) return res;
    console.error('Brevo en échec, envoi de secours par EmailJS');
  }
  return sendViaEmailJS('template_ki0fg15', p);
}

// ── LISTE D'ATTENTE : un créneau s'est libéré ──
// Envoi par Brevo si BREVO_API_KEY existe, sinon par le modèle EmailJS indiqué
// dans la variable Netlify EMAILJS_TEMPLATE_ATTENTE. Sans aucun des deux, rien
// n'est envoyé : la cliente apparaît « à prévenir » dans l'admin.
function libelleDate(dateStr) {
  const JOURS = ['dimanche','lundi','mardi','mercredi','jeudi','vendredi','samedi'];
  const [y, m, d] = dateStr.split('-').map(Number);
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return `${JOURS[dow]} ${d} ${MONTHS_FR[m - 1]}`;
}

async function sendListeAttenteEmail(e, jours) {
  // jours : [{ date: 'AAAA-MM-JJ', heures: ['10:00', ...] }]
  const lignesTxt = jours.map(j => `${libelleDate(j.date)} : ${j.heures.slice(0, 6).join(', ')}`);
  const lien = `${SITE}/prestations.html`;
  if (process.env.BREVO_API_KEY) {
    const html = cadreEmailJS(`<p>Bonjour ${esc(e.prenom)},</p>
<p>✨ Bonne nouvelle : une place s'est libérée !</p>
<p>💇 Prestation(s) : ${esc(e.prestation_nom || '')}</p>
<p>📅 Disponibilités :<br>${jours.map(j => esc(libelleDate(j.date)) + ' : ' + esc(j.heures.slice(0, 6).join(', '))).join('<br>')}</p>
<p>👉 Réservez vite sur <a href="${lien}">lartdesextensions.fr</a>, les créneaux partent rapidement.</p>
<p>&nbsp;</p>
<p>À très bientôt !<br>L'Art des Extensions</p>`);
    const res = await sendViaBrevo(e.email, `${e.prenom} ${e.nom || ''}`.trim(), { subject: "Une place s'est libérée - L'Art des Extensions", html }, EMAIL_SALON);
    if (res.ok) return res;
  }
  if (process.env.EMAILJS_TEMPLATE_ATTENTE) {
    return sendViaEmailJS(process.env.EMAILJS_TEMPLATE_ATTENTE, {
      name: `${e.prenom} ${e.nom || ''}`.trim(),
      prenom: e.prenom,
      email_cliente: e.email,
      to_email: e.email,
      prestation: e.prestation_nom || '',
      creneaux: lignesTxt.join('\n'),
      lien_reservation: lien
    });
  }
  return { ok: false, error: 'Aucun envoi configuré' };
}

module.exports = { sendConfirmationEmail, sendClientConfirmationEmail, sendListeAttenteEmail };
