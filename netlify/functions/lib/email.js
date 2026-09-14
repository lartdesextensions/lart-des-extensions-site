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

// Notification interne pour le salon (utilisé pour les réservations payées en ligne)
async function sendConfirmationEmail(r) {
  return sendViaEmailJS('template_bae1d9m', buildTemplateParams(r));
}

// Confirmation envoyée à la cliente (À utiliser pour les RDV créés manuellement dans l'admin)
async function sendClientConfirmationEmail(r) {
  return sendViaEmailJS('template_ki0fg15', buildTemplateParams(r));
}

module.exports = { sendConfirmationEmail, sendClientConfirmationEmail };
