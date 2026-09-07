// Netlify Function — Relance d'une facture impayée
// POST /api/facture/relance  body: { ref?, token?, envoyer_email? }
// Incrémente le compteur de relances + date de dernière relance sur la facture Notion.
// Optionnel : envoie un e-mail de rappel au client si envoyer_email=true et email présent.
// Réservé aux administrateurs.

import { DB, P, hasToken, updatePage, queryDatabase } from "./_notion.mjs";
import { authResp, currentUser } from "./_auth.mjs";
import { factureFromPage, reqOrigin } from "./_facture.mjs";

export const handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return authResp(200, {});
  if (event.httpMethod !== "POST") return authResp(405, { error: "POST requis" });
  if (!hasToken()) return authResp(503, { error: "Service non configuré." });
  if (!process.env.JWT_SECRET) return authResp(503, { error: "Auth non configurée." });

  const me = await currentUser(event);
  if (!me) return authResp(401, { error: "Connexion requise." });
  if (me.user.role !== "Administrateur") return authResp(403, { error: "Réservé aux administrateurs." });

  let b; try { b = JSON.parse(event.body || "{}"); } catch { return authResp(400, { error: "JSON invalide" }); }
  const ref = String(b.ref || "").trim();
  const token = String(b.token || "").trim();
  if (!ref && !token) return authResp(400, { error: "ref ou token requis" });

  try {
    const filter = ref
      ? { property: "Numéro", title: { equals: ref } }
      : { property: "Jeton livraison", rich_text: { equals: token } };
    const q = await queryDatabase(DB.facture, { filter, page_size: 1 });
    if (!q.results?.length) return authResp(404, { error: "Facture introuvable" });

    const page = q.results[0];
    const f = factureFromPage(page);
    if (f.statut === "Payée") return authResp(409, { error: "Facture déjà payée — pas de relance nécessaire.", statut: f.statut });
    if (f.statut === "Annulée") return authResp(409, { error: "Facture annulée — relance impossible.", statut: f.statut });

    const props = page.properties || {};
    const relancesActuelles = props["Relances"]?.number || 0;
    const nouvelleValeur = relancesActuelles + 1;
    const today = new Date().toISOString().slice(0, 10);

    await updatePage(page.id, {
      "Relances": P.number(nouvelleValeur),
      "Dernière relance": P.date(today),
    });

    // E-mail de rappel optionnel (si demandé + email client + endpoint send-email dispo)
    let emailEnvoye = false;
    if (b.envoyer_email && f.email) {
      try {
        const origin = reqOrigin(event);
        const lien = f.jeton ? `${origin}/l/${f.jeton}` : "";
        const r = await fetch(`${origin}/.netlify/functions/send-email`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "Cookie": event.headers.cookie || "" },
          body: JSON.stringify({
            to: f.email,
            subject: `Rappel — Facture ${f.numero} en attente de règlement`,
            html: `<p>Bonjour,</p><p>Sauf erreur de notre part, la facture <b>${f.numero}</b> d'un montant de <b>${f.montant} € TTC</b> reste à régler.</p>`
              + (lien ? `<p>Vous pouvez la consulter et la régler ici : <a href="${lien}">${lien}</a></p>` : "")
              + `<p>Nous vous remercions de votre règlement.</p><p>Cordialement,<br>OPTIMMO DOM</p>`,
          }),
        });
        emailEnvoye = r.ok;
      } catch { emailEnvoye = false; }
    }

    return authResp(200, {
      ok: true, ref: f.numero, relances: nouvelleValeur, derniere_relance: today, email_envoye: emailEnvoye,
    });
  } catch (e) {
    return authResp(e.status || 500, { error: e.message, notion: e.notion || null });
  }
};
