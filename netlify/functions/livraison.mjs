// Netlify Function — Page de remise publique (mobile-first).
// GET /l/<jeton>  (redirigé) ou /api/livraison?token=<jeton>
//
// Le client ouvre ce lien : il voit le récapitulatif de la prestation. Si le
// paiement est requis et non réglé, il paie par carte/PayPal ; sinon (ou une
// fois payé) il télécharge la facture et le document (étude / avis).
import { hasToken } from "./_notion.mjs";
import { paypalConfigured, paypalClientId, paypalEnv } from "./_paypal.mjs";
import { findFactureByToken, factureFromPage, factureHtmlUrl, reqOrigin } from "./_facture.mjs";

const HTML = { "Content-Type": "text/html; charset=utf-8", "Access-Control-Allow-Origin": "*" };
const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const eur = (n) => Number(n || 0).toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function page(inner, extraHead = "") {
  return `<!DOCTYPE html><html lang="fr"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="robots" content="noindex,nofollow">
<title>FIDI Conseil — Remise de document</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:'Segoe UI',system-ui,Arial,sans-serif;background:#eef1f6;color:#1a2233;
       min-height:100vh;padding:16px;display:flex;justify-content:center}
  .wrap{width:100%;max-width:460px}
  .card{background:#fff;border-radius:16px;box-shadow:0 6px 24px rgba(20,40,80,.12);overflow:hidden;margin-bottom:16px}
  .hd{background:linear-gradient(135deg,#12294d,#24508f);color:#fff;padding:22px 22px 18px}
  .hd .logo{font-size:22px;font-weight:800;letter-spacing:-.5px}
  .hd .logo span{color:#e6b53d}
  .hd .sub{font-size:12px;opacity:.8;margin-top:2px}
  .bd{padding:22px}
  .line{display:flex;justify-content:space-between;gap:12px;padding:9px 0;border-bottom:1px solid #eef1f5;font-size:14px}
  .line:last-child{border-bottom:none}
  .line .k{color:#6a7686}
  .line .v{font-weight:600;text-align:right}
  .amount{font-size:30px;font-weight:800;color:#12294d;text-align:center;margin:14px 0 4px}
  .badge{display:inline-block;padding:4px 12px;border-radius:20px;font-size:12px;font-weight:700}
  .b-wait{background:#fff4d6;color:#8a6100}.b-ok{background:#dff5e3;color:#1c7a35}
  .center{text-align:center}
  .btn{display:block;width:100%;text-align:center;padding:14px;border-radius:10px;border:none;
       font-size:15px;font-weight:700;cursor:pointer;text-decoration:none;margin-top:10px}
  .btn-dl{background:#12294d;color:#fff}.btn-fac{background:#fff;color:#12294d;border:2px solid #12294d}
  .muted{color:#8a94a3;font-size:12px;text-align:center;margin-top:14px;line-height:1.5}
  .foot{text-align:center;font-size:11px;color:#9aa3b0;padding:6px 0 20px}
  #ppwrap{margin-top:16px}
  .alert{border-radius:10px;padding:12px 14px;font-size:13.5px;margin-top:12px}
  .alert-ok{background:#dff5e3;color:#1c7a35}.alert-err{background:#fde4e4;color:#a12020}
  .spin{display:inline-block;width:16px;height:16px;border:2px solid #cbd5e3;border-top-color:#12294d;
        border-radius:50%;animation:sp .7s linear infinite;vertical-align:-3px;margin-right:6px}
  @keyframes sp{to{transform:rotate(360deg)}}
</style>${extraHead}</head><body><div class="wrap">${inner}
<div class="foot">FIDI Conseil · Cabinet conseil en immobilier · Martinique (972)<br>contact@fidiconseil.com</div>
</div></body></html>`;
}

export const handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers: HTML, body: "" };
  const q = event.queryStringParameters || {};
  let token = String(q.token || "").trim();
  if (!token) {
    // Lien court /l/<jeton> : le jeton est dans le chemin (la réécriture ne
    // transmet pas toujours le paramètre de requête). On cherche dans le chemin
    // ET dans l'URL brute (selon le mode d'invocation Netlify).
    const m = `${event.rawUrl || ""} ${event.path || ""}`.match(/\/l\/([^/?#\s]+)/);
    if (m) { try { token = decodeURIComponent(m[1]).trim(); } catch { token = m[1].trim(); } }
  }
  const origin = reqOrigin(event);

  const shell = (msg) => ({ statusCode: 200, headers: HTML, body: page(
    `<div class="card"><div class="hd"><div class="logo">FIDI<span>.</span></div><div class="sub">Cabinet conseil en immobilier</div></div>
     <div class="bd center"><p style="color:#6a7686;font-size:14px">${msg}</p></div></div>`) });

  if (!hasToken()) return shell("Service momentanément indisponible.");
  if (!token) return shell("Lien invalide : aucun jeton fourni.");

  let f;
  try {
    const pg = await findFactureByToken(token);
    if (!pg) return shell("Ce lien n'est plus valide ou la facture est introuvable.");
    f = factureFromPage(pg);
  } catch (e) {
    return shell("Erreur de chargement. Réessayez dans un instant.");
  }

  const typeLabel = f.type || "Prestation";
  const recap = `
    <div class="line"><span class="k">Facture</span><span class="v">${esc(f.numero)}</span></div>
    <div class="line"><span class="k">Prestation</span><span class="v">${esc(f.libelle || typeLabel)}</span></div>
    ${f.client ? `<div class="line"><span class="k">Client</span><span class="v">${esc(f.client)}</span></div>` : ""}
    <div class="line"><span class="k">Montant TTC</span><span class="v">${eur(f.montant)} €</span></div>`;

  const docBtn = f.lienDocument
    ? `<a class="btn btn-dl" href="${esc(f.lienDocument)}" id="btnDoc"><span>⬇︎</span> Télécharger ${esc(typeLabel.toLowerCase())}</a>`
    : "";
  const facBtn = `<a class="btn btn-fac" href="${esc(factureHtmlUrl(f, origin))}" target="_blank" id="btnFac">🧾 Voir / imprimer la facture</a>`;

  // ── Cas 1 : débloqué (paiement non requis, ou déjà payé) ────────────────────
  if (f.unlocked) {
    const statut = f.paye
      ? `<div class="center" style="margin-bottom:6px"><span class="badge b-ok">✓ Payée</span></div>`
      : "";
    const inner = `<div class="card"><div class="hd"><div class="logo">FIDI<span>.</span></div><div class="sub">Vos documents sont prêts</div></div>
      <div class="bd">${statut}${recap}
      <div style="margin-top:16px">${docBtn}${facBtn}</div>
      <p class="muted">Documents fournis par FIDI Conseil. Conservez ce lien pour y accéder à nouveau.</p>
      </div></div>`;
    return { statusCode: 200, headers: HTML, body: page(inner) };
  }

  // ── Cas 2 : paiement requis, non réglé → bouton Payer ───────────────────────
  const canPay = paypalConfigured();
  const payHead = canPay
    ? `<script src="https://www.paypal.com/sdk/js?client-id=${encodeURIComponent(paypalClientId())}&currency=EUR&intent=capture&enable-funding=card"></script>`
    : "";
  const payBlock = canPay
    ? `<p class="center" style="color:#6a7686;font-size:13.5px;margin-top:6px">Réglez pour recevoir votre document et la facture acquittée.</p>
       <div id="ppwrap"></div><div id="msg"></div>`
    : `<div class="alert alert-err">Le paiement en ligne est momentanément indisponible. Contactez FIDI Conseil.</div>`;

  const inner = `<div class="card"><div class="hd"><div class="logo">FIDI<span>.</span></div><div class="sub">Règlement de votre facture</div></div>
    <div class="bd">
      <div class="center" style="margin-bottom:6px"><span class="badge b-wait">En attente de paiement</span></div>
      ${recap}
      <div class="amount">${eur(f.montant)} €</div>
      ${payBlock}
    </div></div>
    <div id="doneCard"></div>`;

  const script = `<script>
    var TOKEN=${JSON.stringify(token)}, TYPE=${JSON.stringify(typeLabel)};
    function reveal(d){
      var c=document.getElementById('doneCard');
      var doc = d.document_url ? '<a class="btn btn-dl" href="'+d.document_url+'">⬇︎ Télécharger '+TYPE.toLowerCase()+'</a>' : '';
      var fac = d.facture_url ? '<a class="btn btn-fac" target="_blank" href="'+d.facture_url+'">🧾 Voir / imprimer la facture acquittée</a>' : '';
      c.innerHTML='<div class="card"><div class="bd"><div class="alert alert-ok">✓ Paiement confirmé. Merci !</div>'+doc+fac+
        '<p class="muted">Conservez ce lien pour retrouver vos documents.</p></div></div>';
      c.scrollIntoView({behavior:'smooth'});
    }
    if(window.paypal){
      paypal.Buttons({
        style:{layout:'vertical',label:'pay',height:44},
        createOrder:function(){
          return fetch('/api/facture/pay-create',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token:TOKEN})})
            .then(function(r){return r.json();}).then(function(d){ if(!d.orderId) throw new Error(d.error||'Erreur'); return d.orderId; });
        },
        onApprove:function(data){
          var m=document.getElementById('msg'); if(m) m.innerHTML='<div class="alert"><span class="spin"></span>Validation du paiement…</div>';
          return fetch('/api/facture/pay-capture',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token:TOKEN,orderId:data.orderID})})
            .then(function(r){return r.json();}).then(function(d){
              if(m) m.innerHTML='';
              if(d.ok){ document.getElementById('ppwrap').style.display='none'; reveal(d); }
              else { if(m) m.innerHTML='<div class="alert alert-err">'+((d&&d.error)||'Paiement non finalisé')+'</div>'; }
            });
        },
        onError:function(err){ var m=document.getElementById('msg'); if(m) m.innerHTML='<div class="alert alert-err">Erreur de paiement. Réessayez.</div>'; }
      }).render('#ppwrap');
    }
  </script>`;

  return { statusCode: 200, headers: HTML, body: page(inner + script, payHead) };
};
