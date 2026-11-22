// Netlify Function — Rendu PDF serveur via Chromium serverless
// POST /api/pdf-render  body: { html, doc: { kind, cle, ref }, filename?, format?, margin?, landscape? }
// Renvoie un PDF binaire (application/pdf) → texte vectoriel copiable, images nettes.
// Solution robuste pour utilisateurs non techniques : plus de bugs html2pdf.js.
//
// Session obligatoire, vérifiée avant tout traitement. Les appels viennent de l'application
// (même origine, cookie fidi_session envoyé d'office) : pas d'en-têtes CORS.
// Chromium lui-même appelle sans cookie : les images internes passent par /api/img-proxy, public.
//
// Acte facturé (_edition.mjs) : le débit a lieu ICI, après un rendu réussi. Pas de PDF sans
// débit réussi ou droit de ré-édition ; un rendu échoué ne coûte rien, rien à rembourser.
// Résultat lisible par le navigateur dans X-Fidi-Facture et X-Fidi-Credits.

import chromium from "@sparticuz/chromium";
import puppeteer from "puppeteer-core";
import { currentUser } from "./_auth.mjs";
import { installRequestGuard, waitForImages, hardenedArgs } from "./_pdf-guard.mjs";
import { deciderEdition, editionFacturable, enregistrerEdition, lireDoc } from "./_edition.mjs";

// La fonction est coupée à 26 s (netlify.toml) : le rendu s'arrête avant pour laisser au débit
// le temps de s'écrire.
const BUDGET_RENDU_MS = 22000;

function errResp(status, msg, extra = {}) {
  return {
    statusCode: status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify({ error: msg, ...extra }),
  };
}

export const handler = (event) => traiter(event, rendrePdf);

// `rendre` est injecté pour que les tests vérifient le débit sans lancer Chromium.
export async function traiter(event, rendre) {
  const debut = Date.now();
  if (event.httpMethod !== "POST") return errResp(405, "POST requis");

  let moi;
  try { moi = await currentUser(event); }
  catch { return errResp(503, "Vérification de session indisponible. Réessayez."); }
  if (!moi) return errResp(401, "Connexion requise.", { need_auth: true });

  let body;
  try { body = JSON.parse(event.body || "{}"); }
  catch { return errResp(400, "JSON invalide"); }

  const html = String(body.html || "").trim();
  if (!html) return errResp(400, "html requis");
  if (html.length > 5_000_000) return errResp(413, "HTML > 5 Mo — trop volumineux");

  const doc = lireDoc(body.doc);
  if (editionFacturable(moi.user) && !doc) return errResp(400, "Document non identifié. Rechargez la page puis réessayez.");

  let decision;
  try { decision = await deciderEdition(moi, doc); }
  catch (e) {
    console.error("pdf-render: décision", e.message);
    return errResp(503, "Vérification du solde indisponible. Réessayez.");
  }
  // Avant Chromium : un compte sans crédit ne consomme pas de rendu.
  if (decision.mode === "refus") return errResp(402, "Crédits épuisés. Rechargez pour éditer ce document.", { need_credits: true });

  const filename = String(body.filename || "avis-fidi.pdf").replace(/[^a-zA-Z0-9._-]/g, "_");
  const options = {
    html,
    format: String(body.format || "A4"),
    landscape: !!body.landscape,
    margin: body.margin || { top: "12mm", bottom: "16mm", left: "12mm", right: "12mm" },
    echeance: debut + BUDGET_RENDU_MS,
  };

  let pdf;
  try { pdf = await rendre(options); }
  catch (e) {
    console.error("pdf-render", e.message);
    return errResp(500, "Rendu PDF échoué.");
  }

  let res;
  try { res = await enregistrerEdition(moi, decision, doc); }
  catch (e) {
    if (e.status === 402) return errResp(402, e.message, { need_credits: true });
    console.error("pdf-render: débit", e.message);
    return errResp(503, "Débit du crédit impossible, aucun crédit n'a été retiré. Réessayez.");
  }

  return {
    statusCode: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${filename}"`,
      "Cache-Control": "no-store",
      "X-Fidi-Facture": res.facture ? "1" : "0",
      "X-Fidi-Credits": String(res.credits),
    },
    body: Buffer.from(pdf).toString("base64"),
    isBase64Encoded: true,
  };
}

export async function rendrePdf({ html, format, landscape, margin, echeance }) {
  const restant = (plafond) => Math.min(plafond, Math.max(1000, echeance - Date.now()));
  let browser;
  try {
    const execPath = await chromium.executablePath();
    if (!execPath) throw new Error("chromium.executablePath() returned empty — @sparticuz/chromium bundle absent du deploy");
    browser = await puppeteer.launch({
      args: hardenedArgs([...chromium.args, "--no-sandbox", "--disable-setuid-sandbox"]),
      defaultViewport: chromium.defaultViewport,
      executablePath: execPath,
      headless: chromium.headless,
    });
    const page = await browser.newPage();

    // JavaScript coupé, ni fichiers locaux ni adresses internes, y compris après redirection.
    await installRequestGuard(page);

    await page.setContent(html, { waitUntil: "networkidle0", timeout: restant(20000) });
    // Attend explicitement fin de chargement de chaque <img> (Chromium ne considère pas
    // toujours les <img> à src distant comme réseau bloquant → PDF sans images).
    await waitForImages(page, restant(8000));
    await page.emulateMediaType("print");

    return await page.pdf({
      format,
      landscape,
      margin,
      printBackground: true,
      preferCSSPageSize: true,
      timeout: restant(22000),
    });
  } finally {
    if (browser) { try { await browser.close(); } catch {} }
  }
}
