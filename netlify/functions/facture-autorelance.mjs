// Netlify Scheduled Function — Relance automatique des factures impayées.
// S'exécute une fois par jour (config.schedule). DÉSACTIVÉE par défaut : ne fait
// RIEN tant que AUTORELANCE_ENABLED=1 n'est pas défini dans les variables Netlify
// (garde-fou : évite d'envoyer des e-mails aux clients sans activation explicite).
//
// Variables d'environnement :
//   AUTORELANCE_ENABLED = "1"        → active l'envoi (sinon : simulation loggée seulement)
//   AUTORELANCE_JOURS   = "3,7,15"   → seuils (jours) des niveaux de relance 1/2/3 (défaut 3,7,15)
//   AUTORELANCE_MAX     = "3"        → nombre maximum de relances par facture (défaut 3)
//   RESEND_API_KEY / RESEND_FROM     → requis pour l'envoi (voir send-email.mjs)
//   URL                              → fourni par Netlify (origine du site, pour le lien /l/)
//
// Chaque relance envoie un e-mail avec le lien de paiement carte/PayPal (?pay=1),
// puis incrémente « Relances » et « Dernière relance » sur la facture Notion.

import { DB, queryDatabase, updatePage, ensureProperty, P, hasToken } from "./_notion.mjs";

export const config = { schedule: "@daily" };

function daysBetween(iso, now) {
  const d = new Date(iso);
  if (!isFinite(d.getTime())) return 0;
  return Math.floor((now - d.getTime()) / 86400000);
}

async function sendResend({ to, subject, lien, message }) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return { ok: false, error: "RESEND_API_KEY manquant" };
  const from = process.env.RESEND_FROM || "FIDI Conseil <contact@fidiconseil.com>";
  const esc = (s) => String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const html = `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;color:#1a2233;">
    <div style="background:#1a3a6e;padding:20px 28px;border-radius:8px 8px 0 0;"><h2 style="color:#fff;margin:0;font-size:1.3rem;">FIDI Conseil</h2></div>
    <div style="padding:28px;border:1px solid #dee2e6;border-top:none;border-radius:0 0 8px 8px;background:#fff;">
      <p>Bonjour,</p><p>${esc(message)}</p>
      <p style="text-align:center;margin:26px 0;"><a href="${esc(lien)}" style="display:inline-block;background:#1a3a6e;color:#fff;text-decoration:none;padding:13px 30px;border-radius:8px;font-weight:700;">Régler ma facture (carte / PayPal)</a></p>
      <p style="font-size:12px;color:#6c757d;">Si le bouton ne fonctionne pas : <a href="${esc(lien)}">${esc(lien)}</a></p>
    </div></div>`;
  try {
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from, to: [to], subject, html }),
    });
    const j = await r.json().catch(() => ({}));
    return r.ok ? { ok: true, id: j.id } : { ok: false, error: j.message || ("HTTP " + r.status) };
  } catch (e) { return { ok: false, error: e.message }; }
}

export const handler = async () => {
  const enabled = process.env.AUTORELANCE_ENABLED === "1";
  if (!hasToken()) return { statusCode: 200, body: "Notion non configuré — rien à faire." };

  const seuils = String(process.env.AUTORELANCE_JOURS || "3,7,15")
    .split(",").map((x) => parseInt(x.trim(), 10)).filter((n) => Number.isFinite(n) && n >= 0);
  const maxRelances = Math.max(1, parseInt(process.env.AUTORELANCE_MAX || "3", 10) || 3);
  const origin = (process.env.URL || process.env.DEPLOY_PRIME_URL || "").replace(/\/$/, "");
  const now = Date.now();

  const out = { enabled, seuils, maxRelances, examined: 0, relances: [], skipped: 0, errors: [] };

  try {
    await ensureProperty(DB.facture, "Relances", { number: {} });
    await ensureProperty(DB.facture, "Dernière relance", { date: {} });

    // Parcourt les factures non payées / non annulées.
    let cursor;
    for (let i = 0; i < 10; i++) {
      const res = await queryDatabase(DB.facture, {
        page_size: 100, start_cursor: cursor,
        filter: { and: [
          { property: "Statut", select: { does_not_equal: "Payée" } },
          { property: "Statut", select: { does_not_equal: "Annulée" } },
        ] },
      });
      for (const pg of (res.results || [])) {
        const p = pg.properties || {};
        const numero = (p["Numéro"]?.title || []).map((t) => t.plain_text).join("");
        const email = (p["Email client"] && p["Email client"].email) || "";
        const jeton = (p["Jeton livraison"]?.rich_text || []).map((t) => t.plain_text).join("");
        const montant = p["Montant TTC"]?.number || 0;
        const dateStart = p["Date"]?.date?.start || "";
        const relances = p["Relances"]?.number || 0;
        const derniere = p["Dernière relance"]?.date?.start || "";
        out.examined++;
        if (!email || !jeton || !dateStart || !(montant > 0)) { out.skipped++; continue; }
        if (relances >= maxRelances) { out.skipped++; continue; }

        const age = daysBetween(dateStart, now);
        // Niveau cible = nombre de seuils atteints par l'âge de la facture.
        const niveauCible = seuils.filter((s) => age >= s).length;
        if (relances >= niveauCible) { out.skipped++; continue; }
        // Anti-spam : au moins 1 jour depuis la dernière relance.
        if (derniere && daysBetween(derniere, now) < 1) { out.skipped++; continue; }

        const lien = origin ? `${origin}/l/${jeton}?pay=1` : "";
        const niveau = relances + 1;
        const subject = `Rappel ${niveau} — Facture ${numero} en attente de règlement`;
        const message = `Sauf erreur de notre part, la facture ${numero} d'un montant de ${montant} € TTC reste à régler (relance ${niveau}/${maxRelances}). Vous pouvez la régler en ligne par carte ou PayPal.`;

        if (!enabled) { out.relances.push({ numero, email, niveau, age, sent: false, simulation: true }); continue; }
        if (!lien) { out.skipped++; continue; }

        const sent = await sendResend({ to: email, subject, lien, message });
        if (sent.ok) {
          try {
            await updatePage(pg.id, {
              "Relances": P.number(niveau),
              "Dernière relance": P.date(new Date().toISOString().slice(0, 10)),
            });
            out.relances.push({ numero, email, niveau, age, sent: true });
          } catch (e) { out.errors.push({ numero, error: "maj Notion: " + e.message }); }
        } else {
          out.errors.push({ numero, error: sent.error });
        }
      }
      if (!res.has_more) break;
      cursor = res.next_cursor;
    }
  } catch (e) {
    out.errors.push({ fatal: e.message });
  }

  console.log("[autorelance]", JSON.stringify(out));
  return { statusCode: 200, body: JSON.stringify(out) };
};
