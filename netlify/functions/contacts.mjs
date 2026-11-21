// /api/contacts — fiche contact d'un client de facturation : plusieurs adresses e-mail, téléphone, adresse, note.
//
// Auth : session exigée avant tout le reste, rôle Administrateur.
//
// GET  ?nom=<client>     → { nom, contact, factures:n }   la fiche enregistrée, sinon les coordonnées lues sur ses factures
// POST { nom, emails:[], telephone, adresse, note }
//                        → enregistre la fiche et reporte l'adresse principale et le téléphone sur les factures du client
//
// Un client est identifié par le nom porté par ses factures. Ce nom figure sur des factures émises : il ne se modifie pas ici.
// Stockage : Netlify Blobs « fidi-contacts », clé c/<empreinte du nom>. Notion (base Factures) ne porte qu'une adresse par
// facture (« Email client », utilisée par les relances) : c'est la première de la liste, dite principale.

import crypto from "node:crypto";
import { DB, P, hasToken, queryDatabase, updatePage } from "./_notion.mjs";
import { authResp, currentUser } from "./_auth.mjs";
import { getNamedStore } from "./_blobs.mjs";

export const CONTACTS_STORE = "fidi-contacts";
export const EMAILS_MAX = 8;
const EMAIL_OK = /^[^\s@<>"',;]+@[^\s@<>"',;]+\.[a-z]{2,}$/i;
const texte = (v, max) => String(v == null ? "" : v).replace(/[\u0000-\u001f]/g, " ").trim().slice(0, max);
export const cleContact = (nom) => "c/" + crypto.createHash("sha1").update(texte(nom, 200).toLowerCase().replace(/\s+/g, " ")).digest("hex");

// Nettoie une fiche : { ok, erreur?, valeur? }. Pur, testé sans réseau.
export function assainirContact(b) {
  const nom = texte(b && b.nom, 200);
  if (nom.length < 2) return { ok: false, erreur: "Nom du client manquant." };
  const brut = Array.isArray(b.emails) ? b.emails : String(b.emails || "").split(/[\s,;]+/);
  const emails = [];
  for (const e of brut) {
    const a = texte(e, 120).toLowerCase();
    if (!a) continue;
    if (!EMAIL_OK.test(a)) return { ok: false, erreur: "Adresse e-mail invalide : " + a };
    if (!emails.includes(a)) emails.push(a);
  }
  if (emails.length > EMAILS_MAX) return { ok: false, erreur: `${EMAILS_MAX} adresses e-mail au plus.` };
  const telephone = texte(b.telephone, 30);
  if (telephone && !/^[+\d][\d\s().-]{5,}$/.test(telephone)) return { ok: false, erreur: "Numéro de téléphone invalide." };
  return { ok: true, valeur: { nom, emails, telephone, adresse: texte(b.adresse, 240), note: texte(b.note, 600) } };
}

async function facturesDe(nom) {
  const pages = [];
  let cursor;
  for (let i = 0; i < 3; i++) {
    const r = await queryDatabase(DB.facture, { filter: { property: "Client", rich_text: { equals: nom } }, page_size: 100, start_cursor: cursor });
    pages.push(...(r.results || []));
    if (!r.has_more) break;
    cursor = r.next_cursor;
  }
  return pages;
}

export const handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return authResp(200, {});
  if (!hasToken() || !process.env.JWT_SECRET) return authResp(503, { error: "Service non configuré." });

  const me = await currentUser(event);
  if (!me) return authResp(401, { error: "Connexion requise." });
  if (me.user.role !== "Administrateur") return authResp(403, { error: "Réservé aux administrateurs." });

  try {
    if (event.httpMethod === "GET") {
      const nom = texte((event.queryStringParameters || {}).nom, 200);
      if (nom.length < 2) return authResp(400, { error: "nom requis" });
      let fiche = null;
      try { fiche = await (await getNamedStore(event, CONTACTS_STORE)).get(cleContact(nom), { type: "json" }); }
      catch (e) { console.error("[contacts] lecture de la fiche impossible :", e.message); }
      const pages = await facturesDe(nom);
      if (!fiche) {
        // Pas encore de fiche : coordonnées relevées sur les factures du client.
        const emails = [], tels = [];
        for (const p of pages) {
          const e = String(p.properties?.["Email client"]?.email || "").toLowerCase(), t = p.properties?.["Téléphone client"]?.phone_number || "";
          if (e && !emails.includes(e)) emails.push(e);
          if (t && !tels.includes(t)) tels.push(t);
        }
        fiche = { nom, emails, telephone: tels[0] || "", adresse: "", note: "", provisoire: true };
      }
      return authResp(200, { nom, contact: fiche, factures: pages.length });
    }
    if (event.httpMethod !== "POST") return authResp(405, { error: "GET ou POST requis" });

    let b; try { b = JSON.parse(event.body || "{}"); } catch { return authResp(400, { error: "JSON invalide" }); }
    const v = assainirContact(b);
    if (!v.ok) return authResp(400, { error: v.erreur });
    const c = v.valeur;

    const store = await getNamedStore(event, CONTACTS_STORE);
    const fiche = { ...c, maj: new Date().toISOString(), par: { email: me.user.email, nom: me.user.nom || "" } };
    await store.setJSON(cleContact(c.nom), fiche);

    // Report sur les factures du client : adresse principale (celle des relances) et téléphone.
    const pages = await facturesDe(c.nom);
    let reportees = 0, echecs = 0;
    for (const p of pages) {
      const e = String(p.properties?.["Email client"]?.email || "").toLowerCase(), t = p.properties?.["Téléphone client"]?.phone_number || "";
      if (e === (c.emails[0] || "") && t === c.telephone) continue;
      try { await updatePage(p.id, { "Email client": P.email(c.emails[0] || null), "Téléphone client": { phone_number: c.telephone || null } }); reportees++; }
      catch (err) { echecs++; console.error("[contacts] facture non mise à jour :", err.message); }
    }
    return authResp(200, { ok: true, contact: fiche, factures: pages.length, reportees, echecs });
  } catch (e) {
    console.error("[contacts]", e.message);
    return authResp(e.status || 500, { error: e.message || "Erreur" });
  }
};
