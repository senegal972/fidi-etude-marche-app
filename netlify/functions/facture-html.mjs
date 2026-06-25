// Netlify Function — Facture HTML imprimable
// GET /api/facture-html?ref=FIDI-FAC-2026-001&kind=avis&...
// Retourne un document HTML complet prêt pour window.print() ou iframe impression.

const CORS_HEADERS = {
  "Content-Type": "text/html; charset=utf-8",
  "Access-Control-Allow-Origin": "*",
};

function esc(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function fmt(n) {
  return Number(n).toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtDate(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  return d.toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" });
}

export const handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers: CORS_HEADERS, body: "" };

  const q = event.queryStringParameters || {};
  const ref      = q.ref      || "FIDI-FAC-????-???";
  const kind     = q.kind     || "avis";
  const client   = q.client   || "";
  const email    = q.email    || "";
  const adresse  = q.adresse  || "";
  const commune  = q.commune  || "";
  const montant  = parseFloat(q.montant) || (kind === "avis" ? 250 : 450);
  const date     = q.date     || new Date().toISOString().slice(0, 10);
  const libelle  = q.libelle  || (kind === "avis"
    ? `Avis de valeur immobilier — ${adresse || commune || ""}`
    : `Étude de marché immobilier — ${commune || ""}`);
  const echeance = new Date(new Date(date).getTime() + 30 * 86400000).toISOString().slice(0, 10);

  const html = `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="utf-8">
<title>Facture ${esc(ref)}</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: 'Segoe UI', Arial, sans-serif; font-size: 13px; color: #222; background: #fff; padding: 40px; }
  @media print { body { padding: 0; } .no-print { display: none !important; } }
  .fac-header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 36px; }
  .fac-logo { font-size: 22px; font-weight: 800; color: #1a3a6e; letter-spacing: -.5px; }
  .fac-logo span { color: #c0392b; }
  .fac-logo-sub { font-size: 11px; color: #666; margin-top: 2px; }
  .fac-emetteur { text-align: right; font-size: 12px; line-height: 1.6; color: #444; }
  .fac-title { font-size: 26px; font-weight: 700; color: #1a3a6e; text-align: center; margin-bottom: 28px; }
  .fac-meta { display: flex; justify-content: space-between; margin-bottom: 28px; gap: 20px; }
  .fac-box { flex: 1; border: 1px solid #dce3ec; border-radius: 8px; padding: 14px 16px; }
  .fac-box h4 { font-size: 10px; text-transform: uppercase; letter-spacing: .8px; color: #888; margin-bottom: 8px; }
  .fac-box p { font-size: 13px; line-height: 1.6; }
  .fac-box strong { color: #1a3a6e; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 28px; }
  thead tr { background: #1a3a6e; color: #fff; }
  thead th { padding: 10px 14px; text-align: left; font-size: 12px; font-weight: 600; }
  tbody tr { border-bottom: 1px solid #eee; }
  tbody td { padding: 12px 14px; font-size: 13px; }
  tbody td:last-child { text-align: right; font-weight: 600; }
  tfoot tr { background: #f4f6fa; }
  tfoot td { padding: 10px 14px; font-weight: 700; font-size: 14px; }
  tfoot td:last-child { text-align: right; color: #1a3a6e; font-size: 16px; }
  .fac-note { font-size: 11px; color: #777; line-height: 1.6; border-top: 1px solid #eee; padding-top: 16px; margin-bottom: 20px; }
  .fac-footer { text-align: center; font-size: 11px; color: #aaa; margin-top: 20px; }
  .btn-print { display: block; margin: 20px auto; padding: 10px 28px; background: #1a3a6e; color: #fff; border: none; border-radius: 6px; font-size: 14px; cursor: pointer; }
</style>
</head>
<body>
<button class="btn-print no-print" onclick="window.print()">🖨️ Imprimer / Enregistrer en PDF</button>

<div class="fac-header">
  <div>
    <div class="fac-logo">FIDI<span>.</span></div>
    <div class="fac-logo-sub">FIDI Conseil — Cabinet conseil en immobilier</div>
  </div>
  <div class="fac-emetteur">
    <strong>FIDI Conseil</strong><br>
    Franck FIDI — Mandataire en immobilier<br>
    contact@fidiconseil.com<br>
    Martinique (972)
  </div>
</div>

<div class="fac-title">FACTURE N° ${esc(ref)}</div>

<div class="fac-meta">
  <div class="fac-box">
    <h4>Facturé à</h4>
    <p><strong>${esc(client) || "(client à compléter)"}</strong><br>
    ${esc(email)}</p>
  </div>
  <div class="fac-box">
    <h4>Détails</h4>
    <p>Date : <strong>${fmtDate(date)}</strong><br>
    Échéance : <strong>${fmtDate(echeance)}</strong><br>
    Réf. prestation : ${esc(q.prestRef || "")}</p>
  </div>
</div>

<table>
  <thead>
    <tr>
      <th style="width:60%">Désignation</th>
      <th>Qté</th>
      <th>Prix unitaire HT</th>
      <th>Montant HT</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td>${esc(libelle)}</td>
      <td>1</td>
      <td>${fmt(montant)} €</td>
      <td>${fmt(montant)} €</td>
    </tr>
  </tbody>
  <tfoot>
    <tr><td colspan="3">Sous-total HT</td><td>${fmt(montant)} €</td></tr>
    <tr><td colspan="3">TVA (0 % — auto-entrepreneur)</td><td>0,00 €</td></tr>
    <tr><td colspan="3"><strong>TOTAL TTC</strong></td><td><strong>${fmt(montant)} €</strong></td></tr>
  </tfoot>
</table>

<div class="fac-note">
  TVA non applicable, article 293 B du CGI (auto-entrepreneur). — Paiement par virement ou chèque à l'ordre de FIDI Conseil.<br>
  En cas de retard de paiement, des pénalités de 3× le taux d'intérêt légal seront appliquées (art. L441-6 C.com.). Indemnité forfaitaire : 40 €.
</div>

<div class="fac-footer">FIDI Conseil · Martinique (972) · contact@fidiconseil.com · SIRET : (à compléter)</div>

</body>
</html>`;

  return { statusCode: 200, headers: CORS_HEADERS, body: html };
};
