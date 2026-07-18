// Netlify Function — Console admin (comptes). POST /api/admin/users { action, ... }
// Réservé au rôle Administrateur.
import { DB, queryDatabase, updatePage, P, hasToken } from "./_notion.mjs";
import { authResp, currentUser, createUser, setCredits, userFromPage } from "./_auth.mjs";

function genPassword() {
  return Math.random().toString(36).slice(2, 8) + Math.random().toString(36).slice(2, 6).toUpperCase();
}

export const handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return authResp(200, {});
  if (event.httpMethod !== "POST") return authResp(405, { error: "POST requis" });
  if (!process.env.JWT_SECRET) return authResp(503, { error: "Authentification non configurée." });
  if (!hasToken()) return authResp(503, { error: "Notion non configuré." });

  const me = await currentUser(event);
  if (!me) return authResp(401, { error: "Connexion requise." });
  if (me.user.role !== "Administrateur") return authResp(403, { error: "Réservé aux administrateurs." });

  let b; try { b = JSON.parse(event.body || "{}"); } catch { return authResp(400, { error: "Corps JSON invalide" }); }
  const action = String(b.action || "").toLowerCase();

  try {
    if (action === "list") {
      const data = await queryDatabase(DB.users, { page_size: 100 });
      const users = (data.results || []).map((pg) => {
        const u = userFromPage(pg);
        return { email: u.email, nom: u.nom, role: u.role, statut: u.statut, credits: u.credits };
      });
      return authResp(200, { ok: true, users });
    }

    // Les autres actions ciblent un utilisateur par e-mail.
    const email = String(b.email || "").trim().toLowerCase();
    if (!email) return authResp(400, { error: "email requis" });

    if (action === "create") {
      const existing = await queryDatabase(DB.users, {
        filter: { property: "Email", title: { equals: email } }, page_size: 1,
      });
      if (existing.results?.length) return authResp(409, { error: "Un compte existe déjà pour cet e-mail." });
      const password = b.password ? String(b.password) : genPassword();
      const role = b.role === "Administrateur" ? "Administrateur" : "Collaborateur";
      const credits = Number.isFinite(+b.credits) ? +b.credits : undefined;
      await createUser({ email, nom: b.nom || "", password, role, ...(credits != null ? { credits } : {}) });
      return authResp(200, { ok: true, created: email, temp_password: b.password ? undefined : password });
    }

    // Recherche de la page cible pour les mises à jour.
    const found = await queryDatabase(DB.users, {
      filter: { property: "Email", title: { equals: email } }, page_size: 1,
    });
    const page = found.results?.[0];
    if (!page) return authResp(404, { error: "Utilisateur introuvable." });

    if (action === "set_credits") {
      const v = parseInt(b.credits);
      if (!Number.isFinite(v)) return authResp(400, { error: "credits (nombre) requis" });
      await setCredits(page.id, v);
      return authResp(200, { ok: true, email, credits: Math.max(0, v) });
    }
    if (action === "add_credits") {
      const cur = userFromPage(page).credits;
      const v = parseInt(b.credits) || 0;
      await setCredits(page.id, cur + v);
      return authResp(200, { ok: true, email, credits: Math.max(0, cur + v) });
    }
    if (action === "set_status") {
      const s = b.statut === "Désactivé" ? "Désactivé" : "Actif";
      await updatePage(page.id, { "Statut": P.select(s) });
      return authResp(200, { ok: true, email, statut: s });
    }
    if (action === "set_role") {
      const r = b.role === "Administrateur" ? "Administrateur" : "Collaborateur";
      await updatePage(page.id, { "Rôle": P.select(r) });
      return authResp(200, { ok: true, email, role: r });
    }

    return authResp(400, { error: "Action inconnue : " + action });
  } catch (e) {
    return authResp(e.status || 500, { error: e.message });
  }
};
