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

function esc(v) {
  return String(v == null ? '' : v)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function ligne(label, valeur) {
  return `<tr><td style="padding:6px 0;color:#8A7560;font-size:13px;width:150px;vertical-align:top;">${esc(label)}</td>`
       + `<td style="padding:6px 0;color:#1F1F1F;font-size:14px;font-weight:600;">${valeur}</td></tr>`;
}

function gabarit(titre, intro, lignes, apres) {
  return `<!DOCTYPE html><html lang="fr"><body style="margin:0;background:#FAF8F5;font-family:Helvetica,Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#FAF8F5;padding:24px 12px;"><tr><td align="center">
<table width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border:1px solid #DDD0C0;border-radius:12px;">
<tr><td style="padding:26px 28px 6px;text-align:center;font-family:Georgia,serif;font-size:22px;color:#1F1F1F;letter-spacing:1px;">${SALON_NOM}</td></tr>
<tr><td style="padding:0 28px;text-align:center;font-size:12px;color:#8A7560;letter-spacing:2px;text-transform:uppercase;">${esc(titre)}</td></tr>
<tr><td style="padding:22px 28px 8px;font-size:14px;line-height:1.6;color:#1F1F1F;">${intro}</td></tr>
<tr><td style="padding:4px 28px 8px;"><table width="100%" cellpadding="0" cellspacing="0" style="border-top:1px solid #F0EBE3;border-bottom:1px solid #F0EBE3;">${lignes.join('')}</table></td></tr>
<tr><td style="padding:12px 28px 26px;font-size:13px;line-height:1.6;color:#6B5744;">${apres}</td></tr>
</table>
<p style="font-size:11px;color:#B59F88;margin:14px 0 0;">${SALON_NOM} · Orsay · ${SALON_TEL} · <a href="${SITE}" style="color:#B59F88;">lartdesextensions.fr</a></p>
</td></tr></table></body></html>`;
}

function emailCliente(p) {
  const prestations = String(p.prestation).split(' + ').map(esc).join('<br>');
  const html = gabarit(
    'Confirmation de rendez-vous',
    `Bonjour ${esc(String(p.nom_cliente).split(' ')[0])},<br><br>Votre rendez-vous est bien confirmé. Voici le récapitulatif :`,
    [
      ligne('Date', esc(p.date_rdv)),
      ligne('Prestation(s)', prestations),
      ligne('Total', esc(p.total) + ' €'),
      ligne('Déjà réglé', esc(p.montant_paye) + ' €'),
      ligne('Reste à régler', esc(p.reste) + ' €')
    ],
    `${esc(p.mention_solde)}<br><br>Le salon reçoit uniquement sur rendez-vous. Pour toute question ou modification, contactez-nous au ${SALON_TEL}.<br><br>À très bientôt,<br>Jessie`
  );
  return { subject: `Votre rendez-vous du ${p.date_rdv} est confirmé`, html };
}

function emailSalon(p) {
  const prestations = String(p.prestation).split(' + ').map(esc).join('<br>');
  const html = gabarit(
    'Nouvelle réservation',
    `Nouvelle réservation en ligne de <strong>${esc(p.nom_cliente)}</strong>.`,
    [
      ligne('Date', esc(p.date_rdv)),
      ligne('Prestation(s)', prestations),
      ligne('Total', esc(p.total) + ' €'),
      ligne('Payé en ligne', `${esc(p.montant_paye)} € (${esc(p.type_paiement)})`),
      ligne('Reste au salon', esc(p.reste) + ' €'),
      ligne('Téléphone', esc(p.telephone_cliente || '—')),
      ligne('Email', esc(p.email_cliente || '—'))
    ],
    ''
  );
  return { subject: `Nouveau RDV : ${p.nom_cliente} — ${p.date_rdv}`, html };
}

async function sendViaBrevo(to, toName, contenu, replyTo) {
  try {
    const from = process.env.EMAIL_FROM || 'contact@lartdesextensions.fr';
    const body = {
      sender: { name: SALON_NOM, email: from },
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
    const res = await sendViaBrevo(process.env.EMAIL_SALON || 'lartdesextensions@gmail.com', SALON_NOM, emailSalon(p), r.email || null);
    if (res.ok) return res;
    console.error('Brevo en échec, envoi de secours par EmailJS');
  }
  return sendViaEmailJS('template_bae1d9m', p);
}

// Confirmation envoyée à la cliente
async function sendClientConfirmationEmail(r) {
  const p = buildTemplateParams(r);
  if (process.env.BREVO_API_KEY && r.email) {
    const res = await sendViaBrevo(r.email, `${r.prenom} ${r.nom}`, emailCliente(p), process.env.EMAIL_SALON || 'lartdesextensions@gmail.com');
    if (res.ok) return res;
    console.error('Brevo en échec, envoi de secours par EmailJS');
  }
  return sendViaEmailJS('template_ki0fg15', p);
}

module.exports = { sendConfirmationEmail, sendClientConfirmationEmail };
