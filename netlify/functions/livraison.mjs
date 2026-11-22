// Netlify Function — Page de remise publique (mobile-first).
// GET /l/<jeton>  (redirigé) ou /api/livraison?token=<jeton>
//
// Le client ouvre ce lien : il voit le récapitulatif de la prestation. Si le
// paiement est requis et non réglé, il paie par carte/PayPal ; sinon (ou une
// fois payé) il télécharge la facture et le document (étude / avis).
import { hasToken } from "./_notion.mjs";
import { paypalConfigured, paypalClientId, paypalEnv } from "./_paypal.mjs";
import { findFactureByToken, factureFromPage, factureHtmlUrl, reqOrigin } from "./_facture.mjs";
import { getNamedStore } from "./_blobs.mjs";
import { ibanValide, bicValide } from "./marque.mjs";

// Coordonnées bancaires du virement : celles de la société émettrice, figées avec la facture (store « fidi-factures ») ;
// à défaut (facture antérieure, ou société sans IBAN), celles du déploiement : FIDI_VIREMENT_IBAN / _BIC / _TITULAIRE.
// Jamais d'IBAN en dur dans le code : le dépôt est public.
async function banqueDe(event, token) {
  try {
    const store = await getNamedStore(event, "fidi-factures");
    const detail = await store.get(String(token), { type: "json" });
    const b = detail && detail.emetteur && detail.emetteur.banque;
    const iban = ibanValide(b && b.iban);
    if (iban) return { iban, bic: bicValide(b.bic), titulaire: String(b.titulaire || "").slice(0, 80) };
  } catch (e) { /* stockage indisponible : repli sur les variables */ }
  const iban = ibanValide(process.env.FIDI_VIREMENT_IBAN);
  if (!iban) return null;
  return { iban, bic: bicValide(process.env.FIDI_VIREMENT_BIC), titulaire: String(process.env.FIDI_VIREMENT_TITULAIRE || "").slice(0, 80) };
}

function blocVirement(bq, f, bloquant) {
  if (!bq) return "";
  const iban4 = bq.iban.replace(/(.{4})/g, "$1 ").trim();
  const ligne = (k, v, copie) => `<div class="vr"><span class="k">${k}</span><span class="v">${esc(v)}</span>` +
    `<button type="button" class="cp" data-copie="${esc(copie || v)}" aria-label="Copier ${k.toLowerCase()}">Copier</button></div>`;
  return `<details class="vir" id="virement"><summary>Payer par virement bancaire</summary>
    <div class="vir-in">
      ${bq.titulaire ? ligne("Titulaire", bq.titulaire) : ""}
      ${ligne("IBAN", iban4, bq.iban)}
      ${bq.bic ? ligne("BIC", bq.bic) : ""}
      ${ligne("Montant", eur(f.montant) + " €", Number(f.montant || 0).toFixed(2))}
      ${ligne("Référence", f.numero)}
      <p class="aide">Indiquez la <b>référence</b> dans le libellé du virement : elle permet de rattacher votre paiement à la facture.
      ${bloquant ? "Vos documents seront accessibles sur cette page dès réception du virement (en général 1 à 2 jours ouvrés)."
                 : "Un virement est enregistré à sa réception, en général sous 1 à 2 jours ouvrés."}</p>
    </div></details>`;
}
// Documents remis : un seul bouton ouvre le document et la facture, chacun dans un nouvel onglet — la page du client reste
// ouverte (dans l'application installée, il n'y a pas de bouton « retour »). Apostrophes écrites \\' (gabarit JavaScript).
const SCRIPT_DOCS = `<script>
  document.addEventListener('click', function(e){
    var b = e.target.closest ? e.target.closest('#btnTout') : null; if(!b) return;
    var fac = b.getAttribute('data-fac'); if(!fac) return;
    var w = null; try { w = window.open(fac, '_blank'); } catch(_) {}
    var m = document.getElementById('docsMsg');
    if(m) m.innerHTML = w ? '' : '<div class="alert" style="background:#fff4d6;color:#8a6100">Votre navigateur n\\'a ouvert qu\\'un seul document. Ouvrez la facture avec le lien « facture » ci-dessous.</div>';
  });
</script>`;

// Bloc des documents remis. Même structure que docsHTML() du script de la page de paiement.
function blocDocuments(docUrl, facUrl, typeLabel, acquittee) {
  const t = esc(String(typeLabel || "document").toLowerCase());
  const facLib = acquittee ? "facture acquittée" : "facture";
  if (!docUrl) return `<a class="btn btn-dl" href="${esc(facUrl)}" target="_blank" rel="noopener" id="btnFac">🧾 Voir / imprimer la ${facLib}</a>`;
  return `<a class="btn btn-dl" href="${esc(docUrl)}" target="_blank" rel="noopener" id="btnTout" data-fac="${esc(facUrl)}">⬇︎ Ouvrir mes documents <small>(${t} + ${facLib})</small></a>
    <div id="docsMsg"></div>
    <p class="docs-liens">Ou séparément : <a href="${esc(docUrl)}" target="_blank" rel="noopener" id="btnDoc">${t}</a> · <a href="${esc(facUrl)}" target="_blank" rel="noopener" id="btnFac">${facLib}</a></p>`;
}

const SCRIPT_COPIE = `<script>
  document.addEventListener('click', function(e){
    var b = e.target.closest ? e.target.closest('[data-copie]') : null; if(!b) return;
    var t = b.getAttribute('data-copie');
    function fait(){ var o=b.textContent; b.textContent='Copié'; setTimeout(function(){ b.textContent=o; }, 1500); }
    if(navigator.clipboard && navigator.clipboard.writeText){ navigator.clipboard.writeText(t).then(fait, function(){}); }
    else { var a=document.createElement('textarea'); a.value=t; document.body.appendChild(a); a.select(); try{ document.execCommand('copy'); fait(); }catch(_){} a.remove(); }
  });
</script>`;

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
  .btn-pay{background:#e6b53d;color:#12294d}
  .aide{font-size:12.5px;color:#55606f;line-height:1.5;margin-top:12px}
  .aide b{color:#12294d}
  .lien{display:block;text-align:center;font-size:13px;color:#24508f;margin-top:14px}
  .vir{margin-top:16px;border:1px solid #dfe3e9;border-radius:10px;background:#f8fafc}
  .vir summary{cursor:pointer;padding:13px 14px;font-size:14px;font-weight:700;color:#12294d;list-style-position:inside}
  .vir-in{padding:0 14px 12px}
  .vr{display:flex;align-items:center;gap:8px;padding:8px 0;border-top:1px solid #e6eaf0;font-size:13.5px}
  .vr .k{flex:0 0 74px;color:#6a7686}
  .vr .v{flex:1 1 auto;min-width:0;font-weight:600;overflow-wrap:anywhere;font-variant-numeric:tabular-nums}
  .vr .cp{flex:0 0 auto;border:1px solid #c9d0da;background:#fff;color:#12294d;border-radius:8px;padding:7px 10px;font-size:12px;font-weight:600;cursor:pointer;min-height:36px}
  .btn-dl{background:#12294d;color:#fff}.btn-dl small{display:block;font-weight:500;font-size:12.5px;opacity:.85;margin-top:2px}.docs-liens{text-align:center;font-size:13.5px;color:#6a7686;margin:10px 0 0}.docs-liens a{color:#24508f;font-weight:600}.btn-fac{background:#fff;color:#12294d;border:2px solid #12294d}
  .muted{color:#8a94a3;font-size:12px;text-align:center;margin-top:14px;line-height:1.5}
  .foot{text-align:center;font-size:11px;color:#9aa3b0;padding:6px 0 20px}
  #ppwrap{margin-top:16px}
  .alert{border-radius:10px;padding:12px 14px;font-size:13.5px;margin-top:12px}
  .alert-ok{background:#dff5e3;color:#1c7a35}.alert-err{background:#fde4e4;color:#a12020}
  .spin{display:inline-block;width:16px;height:16px;border:2px solid #cbd5e3;border-top-color:#12294d;
        border-radius:50%;animation:sp .7s linear infinite;vertical-align:-3px;margin-right:6px}
  @keyframes sp{to{transform:rotate(360deg)}}
</style>${extraHead}</head><body><div class="wrap">${inner}
<div class="foot">FIDI Conseil · Cabinet conseil en immobilier · Martinique (972)</div>
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
  // Mode « forcer le paiement » : une relance ajoute ?pay=1 pour présenter le
  // bouton carte/PayPal même si la facture a été créée sans « paiement requis »
  // (envoi immédiat). Sans effet si la facture est déjà payée.
  let forcePay = String(q.pay || "") === "1" || String(q.pay || "") === "true";
  if (!forcePay && /[?&]pay=(1|true)\b/.test(event.rawUrl || "")) forcePay = true;

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

  // ── Cas 1 : débloqué (paiement non requis, ou déjà payé) ────────────────────
  // Exception : si une relance force le paiement (?pay=1) et que la facture n'est
  // PAS encore payée, on saute vers le bloc de paiement (Cas 2) pour présenter la CB.
  if (f.unlocked && !(forcePay && !f.paye)) {
    const statut = f.paye
      ? `<div class="center" style="margin-bottom:6px"><span class="badge b-ok">✓ Payée</span></div>`
      : "";
    // Facture émise mais pas encore réglée (paiement non exigé avant remise) : le client doit pouvoir la régler
    // depuis cette page — les messages d'envoi et de relance le lui annoncent.
    const du = !f.paye && f.montant > 0 && f.statut !== "Annulée" && f.statut !== "Brouillon";
    const aRegler = du && paypalConfigured();
    const virement = du ? blocVirement(await banqueDe(event, token), f, false) : "";
    const payBtn = aRegler
      ? `<a class="btn btn-pay" href="/l/${encodeURIComponent(token)}?pay=1" id="btnPayer">Régler cette facture en ligne · ${eur(f.montant)} €</a>
         <p class="muted" style="margin-top:6px">Carte bancaire (sans compte PayPal) ou compte PayPal.</p>`
      : "";
    const inner = `<div class="card"><div class="hd"><div class="logo">FIDI<span>.</span></div><div class="sub">Vos documents sont prêts</div></div>
      <div class="bd">${statut}${recap}
      <div style="margin-top:16px">${blocDocuments(f.lienDocument, factureHtmlUrl(f, origin), typeLabel, f.paye)}${payBtn}</div>${virement}
      <p class="muted">Documents fournis par FIDI Conseil. Conservez ce lien pour y accéder à nouveau.</p>
      </div></div>`;
    return { statusCode: 200, headers: HTML, body: page(inner + SCRIPT_DOCS + (virement ? SCRIPT_COPIE : "")) };
  }

  // ── Cas 2 : paiement requis, non réglé → bouton Payer ───────────────────────
  const canPay = paypalConfigured() && f.statut !== "Annulée";
  // Le script PayPal est chargé par la page (et non dans l'en-tête) pour pouvoir dire au client quoi faire
  // quand son navigateur le bloque (bloqueur de publicités, protection contre le pistage, réseau d'entreprise).
  const sdkUrl = canPay
    ? `https://www.paypal.com/sdk/js?client-id=${encodeURIComponent(paypalClientId())}&currency=EUR&intent=capture&enable-funding=card&locale=fr_FR`
    : "";
  const payBlock = canPay
    ? `<p class="center" style="color:#6a7686;font-size:13.5px;margin-top:6px">${f.unlocked ? "Réglez votre facture en ligne." : "Réglez pour recevoir votre document et la facture acquittée."}</p>
       <div id="inapp"></div>
       <div id="ppwrap"><p class="center muted" id="ppload"><span class="spin"></span>Chargement du paiement sécurisé…</p></div><div id="msg"></div>
       <p class="aide"><b>Carte bancaire</b> : aucun compte PayPal n'est nécessaire, choisissez le bouton « Carte bancaire ».
       Votre banque peut vous demander de confirmer le paiement dans son application.<br>
       <b>Compte PayPal</b> : choisissez le bouton « PayPal ».</p>`
    : `<div class="alert alert-err">${f.statut === "Annulée" ? "Cette facture a été annulée." : "Le paiement en ligne est momentanément indisponible. Contactez FIDI Conseil."}</div>`;
  const bq = f.statut !== "Annulée" ? await banqueDe(event, token) : null;
  const virement = blocVirement(bq, f, !f.unlocked);
  const retour = f.unlocked ? `<a class="lien" href="/l/${encodeURIComponent(token)}">← Revenir à mes documents</a>` : "";

  const inner = `<div class="card"><div class="hd"><div class="logo">FIDI<span>.</span></div><div class="sub" id="sousTitre">Règlement de votre facture</div></div>
    <div class="bd">
      <div class="center" style="margin-bottom:6px"><span class="badge b-wait" id="etatBadge">En attente de paiement</span></div>
      ${recap}
      <div id="zonePaiement"><div class="amount">${eur(f.montant)} €</div>
      ${payBlock}${virement}${retour}</div>
    </div></div>
    <div id="doneCard"></div>`;

  const script = canPay ? `<script>
    var TOKEN=${JSON.stringify(token)}, TYPE=${JSON.stringify(typeLabel)}, SDK=${JSON.stringify(sdkUrl)};
    function el(id){ return document.getElementById(id); }
    function esc(s){ return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
    function dire(html, cls){ var m=el('msg'); if(m) m.innerHTML = html ? '<div class="alert '+(cls||'')+'">'+html+'</div>' : ''; }
    function docsHTML(doc, fac){
      var t=esc(TYPE.toLowerCase());
      if(!doc) return fac ? '<a class="btn btn-dl" href="'+esc(fac)+'" target="_blank" rel="noopener" id="btnFac">🧾 Voir / imprimer la facture acquittée</a>' : '';
      return '<a class="btn btn-dl" href="'+esc(doc)+'" target="_blank" rel="noopener" id="btnTout" data-fac="'+esc(fac||'')+'">⬇︎ Ouvrir mes documents <small>('+t+' + facture acquittée)</small></a>'+
        '<div id="docsMsg"></div>'+
        (fac ? '<p class="docs-liens">Ou séparément : <a href="'+esc(doc)+'" target="_blank" rel="noopener" id="btnDoc">'+t+'</a> · <a href="'+esc(fac)+'" target="_blank" rel="noopener" id="btnFac">facture acquittée</a></p>' : '');
    }
    function reveal(d){
      // La page passe de « à régler » à « réglée » : plus de montant ni de consigne de paiement.
      var z=el('zonePaiement'); if(z) z.style.display='none';
      var bd=el('etatBadge'); if(bd){ bd.className='badge b-ok'; bd.textContent='✓ Payée'; }
      var st=el('sousTitre'); if(st) st.textContent='Vos documents sont prêts';
      var c=el('doneCard');
      c.innerHTML='<div class="card"><div class="bd"><div class="alert alert-ok">✓ Paiement confirmé. Merci !</div>'+docsHTML(d.document_url, d.facture_url)+
        '<p class="muted">Chaque document s\\'ouvre dans un nouvel onglet : cette page reste ouverte. PayPal vous envoie aussi son reçu par e-mail. Conservez ce lien pour retrouver vos documents.</p></div></div>';
      c.scrollIntoView({behavior:'smooth'});
    }
    // Navigateur intégré d'une application (Facebook, Messenger, Instagram…) : les fenêtres de paiement y sont souvent bloquées.
    if(/FBAN|FBAV|FB_IAB|Instagram|Messenger|TikTok|Snapchat/i.test(navigator.userAgent||'')){
      el('inapp').innerHTML='<div class="alert" style="background:#fff4d6;color:#8a6100">Vous lisez cette page à l\\'intérieur d\\'une application. Si le paiement ne s\\'ouvre pas, ouvrez ce lien dans votre navigateur habituel (menu ⋮ ou ⋯ puis « Ouvrir dans le navigateur »).</div>';
    }
    function bloque(){
      var w=el('ppwrap'); if(w) w.innerHTML='';
      dire('Le module de paiement n\\'a pas pu se charger. Causes fréquentes : un bloqueur de publicités, la protection contre le pistage du navigateur, ou un réseau qui filtre PayPal.<br><br>Désactivez le bloqueur pour cette page, ou ouvrez ce lien dans un autre navigateur ou sur votre téléphone, puis <a href="'+esc(location.href)+'">rechargez la page</a>. Si cela persiste, contactez-nous : nous vous proposerons un autre moyen de règlement.','alert-err');
    }
    function monter(){
      if(!window.paypal || !paypal.Buttons){ bloque(); return; }
      var l=el('ppload'); if(l) l.remove();
      paypal.Buttons({
        style:{layout:'vertical',label:'pay',height:48},
        onClick:function(){ dire(''); },
        createOrder:function(){
          return fetch('/api/facture/pay-create',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token:TOKEN})})
            .then(function(r){return r.json();}).then(function(d){
              if(d.paye){ location.href='/l/'+encodeURIComponent(TOKEN); throw new Error('deja-regle'); }
              if(!d.orderId){ var e=new Error(d.error||'Erreur'); e.pourClient=d.error; throw e; }
              return d.orderId; });
        },
        onApprove:function(data, actions){
          dire('<span class="spin"></span>Validation du paiement… ne fermez pas cette page.');
          return fetch('/api/facture/pay-capture',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token:TOKEN,orderId:data.orderID})})
            .then(function(r){return r.json();}).then(function(d){
              if(d.ok){ dire(''); el('ppwrap').style.display='none'; reveal(d); return; }
              dire(esc((d&&d.error)||'Le paiement n\\'a pas abouti. Réessayez.'), d.en_attente ? '' : 'alert-err');
              // Moyen de paiement refusé : PayPal rouvre le choix du moyen de paiement, sans tout recommencer.
              if(d.restart && actions && actions.restart){ return actions.restart(); }
            }).catch(function(){
              dire('La connexion a été interrompue pendant la validation. <a href="'+esc(location.href)+'">Rechargez la page</a> avant de payer de nouveau : si votre paiement est passé, vos documents s\\'afficheront.','alert-err');
            });
        },
        onCancel:function(){ dire('Paiement interrompu : rien n\\'a été débité. Vous pouvez reprendre quand vous voulez, par carte bancaire ou avec un compte PayPal.'); },
        onError:function(err){
          if(err && err.message==='deja-regle') return;
          dire(esc((err && err.pourClient) || 'Le paiement n\\'a pas pu démarrer ou a été interrompu. Rien n\\'a été débité tant que la confirmation ne s\\'affiche pas. Réessayez, ou choisissez l\\'autre bouton (carte bancaire / PayPal).'),'alert-err');
        }
      }).render('#ppwrap').catch(function(){ bloque(); });
    }
    (function(){
      var s=document.createElement('script'); s.src=SDK; s.onload=monter; s.onerror=bloque;
      document.head.appendChild(s);
      setTimeout(function(){ if(!window.paypal) bloque(); }, 20000);
    })();
  </script>` : "";

  return { statusCode: 200, headers: HTML, body: page(inner + script + SCRIPT_DOCS + (virement ? SCRIPT_COPIE : "")) };
};
