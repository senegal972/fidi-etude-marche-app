// Netlify Function — Envoi email avec PDF en pièce jointe via Resend API
// POST /api/send-email  body: { to, subject, pdf_b64, filename, kind, titre }
//
// Prérequis :
//   1. Créer un compte sur resend.com (gratuit — 100 emails/jour)
//   2. Vérifier le domaine fidiconseil.com (ajouter les DNS records Resend)
//   3. Ajouter RESEND_API_KEY dans les variables Netlify
//   4. Optionnel : RESEND_FROM = "FIDI Conseil <contact@fidiconseil.com>"

const CORS = {
  "Content-Type": "application/json; charset=utf-8",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
};

function jsonResp(status, body) {
  return { statusCode: status, headers: CORS, body: JSON.stringify(body) };
}

function escHtml(s) {
  return String(s || "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

export const handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return jsonResp(200, {});
  if (event.httpMethod !== "POST") return jsonResp(405, { error: "POST requis" });

  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    return jsonResp(503, {
      error: "Envoi email non configuré. Ajoutez RESEND_API_KEY dans les variables Netlify.",
      not_configured: true,
    });
  }

  let b = {};
  try { b = JSON.parse(event.body || "{}"); }
  catch { return jsonResp(400, { error: "JSON invalide" }); }

  const to = (b.to || "").trim().toLowerCase();
  if (!to || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(to)) {
    return jsonResp(400, { error: "Adresse e-mail invalide : " + to });
  }

  const subject  = (b.subject  || "Document FIDI Conseil").slice(0, 200);
  const filename = (b.filename || "document.pdf").replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 100);
  const kind     = escHtml(b.kind  || "document");
  const titre    = escHtml(b.titre || "");
  const from     = process.env.RESEND_FROM || "FIDI Conseil <contact@fidiconseil.com>";

  // Lien de remise (page /l/<jeton>) : e-mail « avec bouton » plutôt que pièce jointe.
  let lien = String(b.lien || "").trim();
  if (lien && !/^https?:\/\//i.test(lien)) lien = "";
  const messagePerso = b.message ? escHtml(b.message) : "";

  const corps = lien
    ? `<p style="margin-top:0;">Bonjour,</p>
       ${messagePerso ? `<p>${messagePerso}</p>` : `<p>Votre ${kind}${titre ? " <strong>— " + titre + "</strong>" : ""} est disponible.</p>`}
       <p>Cliquez sur le bouton ci-dessous pour y accéder :</p>
       <p style="text-align:center;margin:26px 0;">
         <a href="${escHtml(lien)}" style="display:inline-block;background:#1a3a6e;color:#fff;text-decoration:none;padding:13px 30px;border-radius:8px;font-weight:700;font-size:15px;">Accéder à mes documents</a>
       </p>
       <p style="font-size:12px;color:#6c757d;">Si le bouton ne fonctionne pas, copiez ce lien dans votre navigateur :<br><a href="${escHtml(lien)}" style="color:#1a3a6e;word-break:break-all;">${escHtml(lien)}</a></p>`
    : `<p style="margin-top:0;">Bonjour,</p>
       <p>Veuillez trouver ci-joint ${kind}${titre ? " <strong>— " + titre + "</strong>" : ""}.</p>
       <p>Ce document a été généré par l'application FIDI · Étude de Marché.</p>`;

  const htmlBody = `
<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;color:#1a2233;">
  <div style="background:#1a3a6e;padding:20px 28px;border-radius:8px 8px 0 0;">
    <h2 style="color:#fff;margin:0;font-size:1.3rem;">FIDI Conseil</h2>
    <p style="color:#c5d5ea;margin:4px 0 0;font-size:.85rem;">Conseil en immobilier · Martinique</p>
  </div>
  <div style="padding:28px;border:1px solid #dee2e6;border-top:none;border-radius:0 0 8px 8px;background:#fff;">
    ${corps}
    <hr style="margin:20px 0;border:none;border-top:1px solid #dee2e6;">
    <p style="color:#6c757d;font-size:11px;margin:0;">
      FIDI Conseil · <a href="mailto:contact@fidiconseil.com" style="color:#1a3a6e;">contact@fidiconseil.com</a><br>
      Ce message a été envoyé automatiquement depuis l'application FIDI.
    </p>
  </div>
</div>`.trim();

  const payload = {
    from,
    to: [to],
    subject,
    html: htmlBody,
  };

  // Pièces jointes : tableau b.attachments [{ filename, content(base64) }]
  // Rétrocompat : b.pdf_b64 + b.filename (une seule pièce).
  const MAX_TOTAL = 20 * 1024 * 1024; // 20 Mo cumulés (limite Resend ~40 Mo)
  let atts = [];
  if (Array.isArray(b.attachments) && b.attachments.length) {
    atts = b.attachments
      .filter((a) => a && a.content)
      .map((a) => ({
        filename: String(a.filename || "piece-jointe").replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 120),
        content: a.content,
      }));
  } else if (b.pdf_b64) {
    atts = [{ filename, content: b.pdf_b64 }];
  }
  if (atts.length) {
    const totalBytes = atts.reduce((s, a) => s + Math.floor(a.content.length * 0.75), 0);
    if (totalBytes > MAX_TOTAL) {
      return jsonResp(413, { error: "Pièces jointes trop volumineuses (max 20 Mo au total)" });
    }
    payload.attachments = atts;
  }

  try {
    const resp = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    const result = await resp.json().catch(() => ({}));
    if (!resp.ok) {
      const msg = result.message || result.name || "Erreur Resend (" + resp.status + ")";
      return jsonResp(resp.status >= 500 ? 502 : resp.status, { error: msg, resend: result });
    }

    return jsonResp(200, { ok: true, id: result.id });
  } catch (e) {
    return jsonResp(500, { error: "Erreur réseau : " + e.message });
  }
};
