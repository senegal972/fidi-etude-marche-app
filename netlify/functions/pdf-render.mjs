// Netlify Function — Rendu PDF serveur via Chromium serverless
// POST /api/pdf-render  body: { html, filename?, format?, margin?, landscape? }
// Renvoie un PDF binaire (application/pdf) → texte vectoriel copiable, images nettes.
// Solution robuste pour utilisateurs non techniques : plus de bugs html2pdf.js.
//
// Session obligatoire, vérifiée avant tout traitement. Les appels viennent de l'application
// (même origine, cookie fidi_session envoyé d'office) : pas d'en-têtes CORS.
// Chromium lui-même appelle sans cookie : les images internes passent par /api/img-proxy, public.

import chromium from "@sparticuz/chromium";
import puppeteer from "puppeteer-core";
import { currentUser } from "./_auth.mjs";
import { installRequestGuard, waitForImages, hardenedArgs } from "./_pdf-guard.mjs";

function errResp(status, msg, extra = {}) {
  return {
    statusCode: status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify({ error: msg, ...extra }),
  };
}

export const handler = async (event) => {
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

  const filename = String(body.filename || "avis-fidi.pdf").replace(/[^a-zA-Z0-9._-]/g, "_");
  const format = String(body.format || "A4");
  const landscape = !!body.landscape;
  const margin = body.margin || { top: "12mm", bottom: "16mm", left: "12mm", right: "12mm" };

  let browser;
  let execPath;
  try {
    execPath = await chromium.executablePath();
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

    await page.setContent(html, { waitUntil: "networkidle0", timeout: 20000 });
    // Attend explicitement fin de chargement de chaque <img> (Chromium ne considère pas
    // toujours les <img> à src distant comme réseau bloquant → PDF sans images).
    await waitForImages(page);
    await page.emulateMediaType("print");

    const pdf = await page.pdf({
      format,
      landscape,
      margin,
      printBackground: true,
      preferCSSPageSize: true,
    });

    await browser.close();
    browser = null;

    return {
      statusCode: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="${filename}"`,
        "Cache-Control": "no-store",
      },
      body: Buffer.from(pdf).toString("base64"),
      isBase64Encoded: true,
    };
  } catch (e) {
    if (browser) { try { await browser.close(); } catch {} }
    console.error("pdf-render", e.message, "execPath=" + (execPath || "(non résolu)"));
    return errResp(500, "Rendu PDF échoué.");
  }
};
