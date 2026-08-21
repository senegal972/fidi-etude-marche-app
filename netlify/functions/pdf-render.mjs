// Netlify Function — Rendu PDF serveur via Chromium serverless
// POST /api/pdf-render  body: { html, filename?, format?, margin?, landscape? }
// Renvoie un PDF binaire (application/pdf) → texte vectoriel copiable, images nettes.
// Solution robuste pour utilisateurs non techniques : plus de bugs html2pdf.js.

import chromium from "@sparticuz/chromium";
import puppeteer from "puppeteer-core";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function errResp(status, msg) {
  return {
    statusCode: status,
    headers: { ...CORS, "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify({ error: msg }),
  };
}

export const handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers: CORS, body: "" };
  if (event.httpMethod !== "POST") return errResp(405, "POST requis");

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
  try {
    browser = await puppeteer.launch({
      args: chromium.args,
      defaultViewport: chromium.defaultViewport,
      executablePath: await chromium.executablePath(),
      headless: chromium.headless,
    });
    const page = await browser.newPage();

    // Bloque requêtes externes lourdes (fonts déjà inline recommandé côté client)
    await page.setRequestInterception(true);
    page.on("request", (req) => {
      const t = req.resourceType();
      if (t === "media" || t === "websocket") req.abort();
      else req.continue();
    });

    await page.setContent(html, { waitUntil: "networkidle0", timeout: 20000 });
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
        ...CORS,
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="${filename}"`,
        "Cache-Control": "no-store",
      },
      body: Buffer.from(pdf).toString("base64"),
      isBase64Encoded: true,
    };
  } catch (e) {
    if (browser) { try { await browser.close(); } catch {} }
    return errResp(500, `Rendu PDF échoué : ${e.message}`);
  }
};
