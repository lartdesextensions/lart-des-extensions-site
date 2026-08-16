const MONTHS_FR = ['janvier','février','mars','avril','mai','juin','juillet','août','septembre','octobre','novembre','décembre'];

async function sendConfirmationEmail(r) {
  try {
    const [y, m, d] = r.date.split('-').map(Number);
    const dateLabel = `${d} ${MONTHS_FR[m - 1]} ${y}`;
    const payload = {
      service_id: 'service_8xq5hij',
      template_id: 'template_bae1d9m',
      user_id: 'pnSluawmsGb1F5d_i',
      template_params: {
        nom_cliente: `${r.prenom} ${r.nom}`,
        email_cliente: r.email,
        prestation: r.prestation_nom,
        total: r.prix,
        acompte: r.acompte,
        reste: r.prix - r.acompte,
        date_rdv: `${dateLabel} à ${r.heure}`,
        heure_rdv: r.heure,
        telephone: r.telephone,
        telephone_cliente: r.telephone
      }
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
      console.error('Erreur envoi email:', text);
      return { ok: false, error: text };
    }
    return { ok: true };
  } catch (e) {
    console.error('Erreur envoi email:', e);
    return { ok: false, error: e.message };
  }
}

module.exports = { sendConfirmationEmail };
