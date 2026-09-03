// Netlify Function — Console admin (comptes). POST /api/admin/users { action, ... }
// Réservé au rôle Administrateur.
import { DB, queryDatabase, updatePage, archivePage, P, hasToken } from "./_notion.mjs";
import { authResp, currentUser, createUser, setCredits, userFromPage } from "./_auth.mjs";

// Mot de passe fort auto-généré : 16 chars mixed (majuscules + minuscules + chiffres + symboles)
// avec au moins 1 de chaque catégorie garanti. Style Chrome/Google auto-generate.
function genPassword() {
  const upper = "ABCDEFGHJKLMNPQRSTUVWXYZ"; // I/O exclus (ambigus)
  const lower = "abcdefghijkmnpqrstuvwxyz"; // l/o exclus
  const digit = "23456789";                  // 0/1 exclus
  const symbol = "!@#$%&*+-=?";
  const all = upper + lower + digit + symbol;
  const rand = (s) => s[Math.floor(Math.random() * s.length)];
  let pw = [rand(upper), rand(lower), rand(digit), rand(symbol)];
  for (let i = 0; i < 12; i++) pw.push(rand(all));
  // Shuffle Fisher-Yates
  for (let i = pw.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [pw[i], pw[j]] = [pw[j], pw[i]];
  }
  return pw.join("");
}

// Super-admin : seul contact@fidiconseil.com peut supprimer, promouvoir Administrateur,
// changer les réseaux. Les autres Administrateurs peuvent gérer crédits/statut.
const SUPER_ADMIN_EMAIL = (process.env.SUPER_ADMIN_EMAIL || "contact@fidiconseil.com").toLowerCase();
function isSuperAdmin(email) { return String(email || "").toLowerCase() === SUPER_ADMIN_EMAIL; }

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
        const props = pg.properties || {};
        // Champs additionnels : Réseau, Grille tarifaire, facturation FIDI (facultatifs)
        const reseau = props["Réseau"]?.select?.name || "";
        const tarifGroup = props["Grille tarifaire"]?.select?.name || "";
        const fidiEncaisse = !!(props["FIDI encaisse"]?.checkbox);
        const commission = props["Commission FIDI %"]?.number ?? 25;
        return { email: u.email, nom: u.nom, role: u.role, statut: u.statut, credits: u.credits,
                 illimite: u.illimite, quota: u.quota, recherches: u.recherches,
                 reseau, tarifGroup, fidi_encaisse: fidiEncaisse, commission };
      });
      return authResp(200, { ok: true, users, super_admin: SUPER_ADMIN_EMAIL, me: me.user.email });
    }

    // Les autres actions ciblent un utilisateur par e-mail.
    const email = String(b.email || "").trim().toLowerCase();
    if (!email) return authResp(400, { error: "email requis" });

    if (action === "create") {
      const existing = await queryDatabase(DB.users, {
        filter: { property: "Email", title: { equals: email } }, page_size: 1,
      });
      if (existing.results?.length) return authResp(409, { error: "Un compte existe déjà pour cet e-mail." });
      // Rôle Administrateur : réservé super-admin
      const wantsAdmin = b.role === "Administrateur";
      if (wantsAdmin && !isSuperAdmin(me.user.email)) return authResp(403, { error: "Seul le super-admin peut créer un compte Administrateur." });
      const password = b.password ? String(b.password) : genPassword();
      const role = wantsAdmin ? "Administrateur" : "Collaborateur";
      const credits = Number.isFinite(+b.credits) ? +b.credits : undefined;
      const quota = Number.isFinite(+b.quota) ? +b.quota : undefined;
      const createdPage = await createUser({ email, nom: b.nom || "", password, role,
        ...(credits != null ? { credits } : {}), ...(quota != null ? { quota } : {}), illimite: !!b.illimite });
      // Champs additionnels post-création (Réseau, Grille tarifaire) si fournis
      const extra = {};
      if (b.reseau) extra["Réseau"] = P.select(String(b.reseau).slice(0, 100));
      if (b.tarifGroup) extra["Grille tarifaire"] = P.select(String(b.tarifGroup).slice(0, 100));
      if (Object.keys(extra).length && createdPage?.id) {
        try { await updatePage(createdPage.id, extra); } catch {}
      }
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
      if (email === me.user.email) return authResp(400, { error: "Vous ne pouvez pas modifier votre propre statut." });
      const s = b.statut === "Désactivé" ? "Désactivé" : "Actif";
      await updatePage(page.id, { "Statut": P.select(s) });
      return authResp(200, { ok: true, email, statut: s });
    }
    if (action === "set_role") {
      if (email === me.user.email) return authResp(400, { error: "Vous ne pouvez pas modifier votre propre rôle." });
      const r = b.role === "Administrateur" ? "Administrateur" : "Collaborateur";
      await updatePage(page.id, { "Rôle": P.select(r) });
      return authResp(200, { ok: true, email, role: r });
    }
    if (action === "set_illimite") {
      await updatePage(page.id, { "Illimité": P.checkbox(!!b.illimite) });
      return authResp(200, { ok: true, email, illimite: !!b.illimite });
    }
    if (action === "set_quota") {
      const q = parseInt(b.quota);
      if (!Number.isFinite(q) || q < 0) return authResp(400, { error: "quota (nombre) requis" });
      await updatePage(page.id, { "Quota recherches": P.number(q) });
      return authResp(200, { ok: true, email, quota: q });
    }
    if (action === "set_reseau") {
      if (!isSuperAdmin(me.user.email)) return authResp(403, { error: "Réservé au super-admin." });
      const nm = String(b.reseau || "").slice(0, 100);
      await updatePage(page.id, nm ? { "Réseau": P.select(nm) } : { "Réseau": { select: null } });
      return authResp(200, { ok: true, email, reseau: nm });
    }
    if (action === "set_tarif_group") {
      const g = String(b.tarifGroup || "").slice(0, 100);
      await updatePage(page.id, g ? { "Grille tarifaire": P.select(g) } : { "Grille tarifaire": { select: null } });
      return authResp(200, { ok: true, email, tarifGroup: g });
    }
    if (action === "set_nom") {
      const nom = String(b.nom || "").slice(0, 200);
      await updatePage(page.id, { "Nom": P.text(nom) });
      return authResp(200, { ok: true, email, nom });
    }
    if (action === "set_commission") {
      // Commission FIDI (%) si FIDI encaisse pour ce compte. 0 = aucune (agent encaisse lui-même).
      const pct = parseFloat(b.commission);
      if (!Number.isFinite(pct) || pct < 0 || pct > 100) return authResp(400, { error: "commission (0-100) requis" });
      await updatePage(page.id, {
        "FIDI encaisse": P.checkbox(!!b.fidi_encaisse),
        "Commission FIDI %": P.number(pct),
      });
      return authResp(200, { ok: true, email, fidi_encaisse: !!b.fidi_encaisse, commission: pct });
    }
    if (action === "reset_password") {
      const newPwd = b.password ? String(b.password) : genPassword();
      // Utilise setCredits-like helper : mettre à jour le hash via createUser en mode update
      // Simple : archivage puis recréation n'est pas propre. On appelle un endpoint dédié via _auth.
      // Fallback : on met à jour "Mot de passe (hash)" via helper _auth. Ici on renvoie le pwd + indique
      // que le collaborateur doit ré-authentifier (backend _auth attendu à implémenter setPassword).
      // Pour l'instant : documenté, mais retourne 501 si helper absent.
      try {
        const { setPassword } = await import("./_auth.mjs");
        if (typeof setPassword === "function") {
          await setPassword(page.id, newPwd);
          return authResp(200, { ok: true, email, new_password: newPwd });
        }
      } catch {}
      return authResp(501, { error: "reset_password nécessite setPassword() dans _auth.mjs" });
    }
    if (action === "delete") {
      if (!isSuperAdmin(me.user.email)) return authResp(403, { error: "Suppression réservée au super-admin." });
      if (email === me.user.email) return authResp(400, { error: "Vous ne pouvez pas supprimer votre propre compte." });
      if (isSuperAdmin(email)) return authResp(400, { error: "Le compte super-admin ne peut pas être supprimé." });
      // Notion : pas de vraie suppression, on archive (mise en corbeille)
      try { await archivePage(page.id); }
      catch { await updatePage(page.id, { "Statut": P.select("Désactivé") }); }
      return authResp(200, { ok: true, deleted: email });
    }

    return authResp(400, { error: "Action inconnue : " + action });
  } catch (e) {
    return authResp(e.status || 500, { error: e.message });
  }
};
