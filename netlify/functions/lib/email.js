const MONTHS_FR = ['janvier','février','mars','avril','mai','juin','juillet','août','septembre','octobre','novembre','décembre'];

function buildTemplateParams(r) {
  const [y, m, d] = r.date.split('-').map(Number);
  const dateLabel = `${d} ${MONTHS_FR[m - 1]} ${y}`;
  return {
    nom_cliente: `${r.prenom} ${r.nom}`,
    name: `${r.prenom} ${r.nom}`,
    email_cliente: r.email,
    prestation: r.prestation_nom,
    total: r.prix,
    acompte: r.acompte,
    reste: r.prix - r.acompte,
    date_rdv: `${dateLabel} à ${r.heure}`,
    heure_rdv: r.heure,
    telephone: r.telephone,
    telephone_cliente: r.telephone
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

// Notification interne pour le salon (utilisé pour les réservations payées en ligne)
async function sendConfirmationEmail(r) {
  return sendViaEmailJS('template_bae1d9m', buildTemplateParams(r));
}

// Confirmation envoyée à la cliente (À utiliser pour les RDV créés manuellement dans l'admin)
async function sendClientConfirmationEmail(r) {
  return sendViaEmailJS('template_ki0fg15', buildTemplateParams(r));
}

module.exports = { sendConfirmationEmail, sendClientConfirmationEmail };
