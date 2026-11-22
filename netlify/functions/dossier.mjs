// GET /api/dossier?t=<jeton>[&part=doc] — le dossier du client en UN SEUL PDF : la facture, puis le document (étude, avis de valeur).
//
// Public, clé = jeton de remise (non devinable), mêmes conditions que la page /l/<jeton> : rien n'est servi tant que le
// paiement exigé n'est pas encaissé.
//
// • Le document est le PDF déposé par /api/pdf-share (store « fidi-shared », effacé après 7 jours). À la première lecture il est
//   copié dans « fidi-dossiers » (clé doc/<jeton>), sans limite de durée : le lien du client reste valable.
// • La facture est rendue en PDF par Chromium à partir de la même page que /api/facture-html (aucune seconde mise en page).
// • Le PDF fusionné est gardé dans « fidi-dossiers » (clé tout/<jeton>/<p|n>, p = acquittée) : Chromium ne tourne qu'une fois.
// • part=doc : le document seul, depuis la copie durable.
// En cas d'échec (document expiré, rendu impossible, fichier trop lourd) : page d'explication avec les liens séparés.

import { PDFDocument } from "pdf-lib";
import { hasToken } from "./_notion.mjs";
import { findFactureByToken, factureFromPage, factureHtmlUrl, reqOrigin, idPartage, fusionPossible, dossierUrl } from "./_facture.mjs";
import { getNamedStore, getShareStore } from "./_blobs.mjs";
import { handler as factureHtml } from "./facture-html.mjs";

export const DOSSIERS_STORE = "fidi-dossiers";
const TTL_PARTAGE_MS = 7 * 24 * 3600 * 1000;
// Une fonction ne renvoie pas plus de 6 Mo, base64 compris : au-delà, pas de fichier unique.
export const MAX_OCTETS = 4.3 * 1024 * 1024;
const BUDGET_MS = 21000;

const esc = (s) => String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export { idPartage, fusionPossible, dossierUrl };

function pageInfo(status, titre, message, liens) {
  return { statusCode: status, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
    body: `<!doctype html><html lang="fr"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(titre)}</title>` +
      `<div style="font-family:system-ui,sans-serif;max-width:480px;margin:60px auto;padding:0 18px;text-align:center;color:#334">` +
      `<h2 style="color:#12294d">${esc(titre)}</h2><p>${message}</p>` +
      (liens || []).map((l) => `<p><a href="${esc(l.url)}" style="display:block;padding:13px;border-radius:10px;background:#12294d;color:#fff;text-decoration:none;font-weight:700">${esc(l.libelle)}</a></p>`).join("") +
      `</div></html>` };
}
const pdfResp = (b64, nom) => ({ statusCode: 200, isBase64Encoded: true, body: b64,
  headers: { "Content-Type": "application/pdf", "Content-Disposition": `inline; filename="${nom}"`, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } });
const nomFichier = (f, suffixe) => (String(f.numero || "dossier").replace(/[^A-Za-z0-9_-]+/g, "_").slice(0, 60) || "dossier") + suffixe + ".pdf";

// Document du client en base64 : copie durable, sinon dépôt de partage (alors recopié).
export async function lireDocument(event, f, jeton, dossiers) {
  try { const d = await dossiers.get("doc/" + jeton, { type: "text" }); if (d) return d; } catch { /* lecture suivante */ }
  const id = idPartage(f.lienDocument);
  if (!id) return "";
  const partage = await getShareStore(event);
  const r = await partage.getWithMetadata(id, { type: "text" });
  if (!r || !r.data) return "";
  if (r.metadata && r.metadata.ts && Date.now() - r.metadata.ts > TTL_PARTAGE_MS) return "";
  try { await dossiers.set("doc/" + jeton, r.data); } catch (e) { console.error("[dossier] copie durable impossible :", e.message); }
  return r.data;
}

// Facture puis document, dans un seul PDF.
export async function fusionner(factureOctets, documentOctets) {
  const sortie = await PDFDocument.create();
  for (const octets of [factureOctets, documentOctets]) {
    const src = await PDFDocument.load(octets, { ignoreEncryption: true });
    (await sortie.copyPages(src, src.getPageIndices())).forEach((p) => sortie.addPage(p));
  }
  return Buffer.from(await sortie.save());
}

async function rendreFacture(html, echeance) {
  const { rendrePdf } = await import("./pdf-render.mjs");
  return rendrePdf({ html, format: "A4", landscape: false, margin: { top: "12mm", bottom: "12mm", left: "10mm", right: "10mm" }, echeance });
}

export const handler = (event) => traiter(event, rendreFacture);

// `rendre(html, echeance)` est injecté pour que les tests n'aient pas à lancer Chromium.
export async function traiter(event, rendre) {
  const debut = Date.now();
  if (event.httpMethod !== "GET") return pageInfo(405, "Lien indisponible", "Ouvrez ce lien dans votre navigateur.");
  if (!hasToken()) return pageInfo(503, "Service indisponible", "Réessayez dans quelques minutes.");
  const q = event.queryStringParameters || {};
  const jeton = String(q.t || "").trim();
  if (!/^[A-Za-z0-9_-]{6,80}$/.test(jeton)) return pageInfo(400, "Lien incomplet", "Ce lien n'est pas valable.");

  let f;
  try { const pg = await findFactureByToken(jeton); if (!pg) return pageInfo(404, "Lien introuvable", "Ce lien n'existe pas ou n'est plus valable."); f = factureFromPage(pg); }
  catch (e) { console.error("[dossier] facture illisible :", e.message); return pageInfo(503, "Service indisponible", "Réessayez dans quelques minutes."); }

  const origin = reqOrigin(event);
  const pageClient = `${origin}/l/${encodeURIComponent(jeton)}`;
  if (!f.unlocked) return pageInfo(403, "Règlement attendu", "Vos documents seront disponibles dès le règlement de la facture.", [{ url: pageClient, libelle: "Régler la facture" }]);
  if (f.statut === "Annulée") return pageInfo(410, "Facture annulée", "Cette facture a été annulée.");

  const urlFacture = factureHtmlUrl(f, origin);
  const separes = [{ url: urlFacture, libelle: "Ouvrir la facture" }, { url: pageClient, libelle: "Retour à mes documents" }];
  const echec = (pourquoi) => pageInfo(200, "Dossier en un seul fichier indisponible", esc(pourquoi) + " Vos documents restent accessibles séparément.", separes);

  let dossiers;
  try { dossiers = await getNamedStore(event, DOSSIERS_STORE); }
  catch (e) { console.error("[dossier] stockage indisponible :", e.message); return echec("Le stockage ne répond pas pour le moment."); }

  let doc64 = "";
  try { doc64 = await lireDocument(event, f, jeton, dossiers); }
  catch (e) { console.error("[dossier] document illisible :", e.message); }

  if (q.part === "doc") {
    if (doc64) return pdfResp(doc64, nomFichier(f, "_document"));
    if (/^https?:\/\//i.test(f.lienDocument)) return { statusCode: 302, headers: { Location: f.lienDocument, "Cache-Control": "no-store" }, body: "" };
    return pageInfo(404, "Document indisponible", "Ce document n'est plus disponible. Contactez-nous pour le recevoir à nouveau.", [{ url: pageClient, libelle: "Retour à mes documents" }]);
  }

  if (!doc64) return echec("Le document n'est plus disponible en ligne.");
  const cle = `tout/${jeton}/${f.paye ? "p" : "n"}`;
  try { const deja = await dossiers.get(cle, { type: "text" }); if (deja) return pdfResp(deja, nomFichier(f, "_dossier")); } catch { /* on le refait */ }

  let fusion;
  try {
    const r = await factureHtml({ httpMethod: "GET", headers: event.headers || {}, blobs: event.blobs,
      queryStringParameters: Object.fromEntries(new URL(urlFacture).searchParams) });
    if (r.statusCode !== 200 || !r.body) throw new Error("facture non rendue (" + r.statusCode + ")");
    const facturePdf = await rendre(r.body, debut + BUDGET_MS);
    fusion = await fusionner(facturePdf, Buffer.from(doc64, "base64"));
  } catch (e) {
    console.error("[dossier] fusion impossible :", e.message);
    return echec("La préparation du fichier unique n'a pas abouti.");
  }
  if (fusion.length > MAX_OCTETS) return echec("Le dossier est trop volumineux pour être réuni en un seul fichier.");
  const b64 = fusion.toString("base64");
  try { await dossiers.set(cle, b64); } catch (e) { console.error("[dossier] mise en réserve impossible :", e.message); }
  return pdfResp(b64, nomFichier(f, "_dossier"));
}
