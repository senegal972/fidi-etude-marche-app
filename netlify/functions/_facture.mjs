// Helpers partagés facturation / page de remise.
import { DB, queryDatabase, readText, readNumber, readSelect, readCheckbox } from "./_notion.mjs";

// Lit une facture par son jeton de livraison (public, non devinable).
export async function findFactureByToken(token) {
  const t = String(token || "").trim();
  if (!t) return null;
  const data = await queryDatabase(DB.facture, {
    filter: { property: "Jeton livraison", rich_text: { equals: t } },
    page_size: 1,
  });
  return data.results?.[0] || null;
}

export function factureFromPage(pg) {
  const p = pg.properties || {};
  const statut = readSelect(p["Statut"]);
  const paiementRequis = readCheckbox(p["Paiement requis"]);
  const paye = statut === "Payée";
  return {
    id:              pg.id,
    numero:          readText(p["Numéro"]),
    type:            readSelect(p["Type"]),
    libelle:         readText(p["Libellé"]),
    client:          readText(p["Client"]),
    email:           (p["Email client"] && p["Email client"].email) || "",
    telephone:       (p["Téléphone client"] && p["Téléphone client"].phone_number) || "",
    adresse:         readText(p["Adresse bien"]),
    refDossier:      readText(p["Référence dossier"]),
    montant:         readNumber(p["Montant TTC"]),
    date:            (p["Date"] && p["Date"].date && p["Date"].date.start) || "",
    statut,
    paiementRequis,
    paye,
    lienDocument:    (p["Lien document"] && p["Lien document"].url) || "",
    jeton:           readText(p["Jeton livraison"]),
    // Le document (et la facture) ne sont délivrés que si le paiement n'est pas
    // requis, ou s'il a bien été encaissé.
    unlocked:        !paiementRequis || paye,
  };
}

// URL de la facture HTML imprimable (reconstruite depuis les champs stockés).
export function factureHtmlUrl(f, origin) {
  const params = new URLSearchParams({
    ref: f.numero || "",
    kind: f.type === "Avis de valeur" ? "avis" : "etude",
    client: f.client || "",
    email: f.email || "",
    commune: f.adresse || "",
    adresse: f.adresse || "",
    montant: String(f.montant || 0),
    date: f.date || "",
    libelle: f.libelle || "",
    prestRef: f.refDossier || "",
    acquittee: f.paye ? "1" : "0",
  });
  return `${origin}/api/facture-html?${params.toString()}`;
}

export function reqOrigin(event) {
  const h = event.headers || {};
  const host = h["x-forwarded-host"] || h.host;
  const proto = h["x-forwarded-proto"] || "https";
  return host ? `${proto}://${host}` : "";
}

// ─── Verrou suppression ───────────────────────────────────────────────────────
// Un dossier (avis ou étude) déjà ENVOYÉ ou PAYÉ ne doit jamais être supprimé.
// Source fiable : la base Factures (DB.facture), liée par « Référence dossier ».
// Statuts facture : Brouillon (ni envoyé) · À payer (envoyé, en attente) · Payée · Annulée.
// Verrouillé si une facture ACTIVE (À payer ou Payée) existe pour la référence.
function _refDossierOf(pg) {
  return (pg.properties?.["Référence dossier"]?.rich_text || []).map((t) => t.plain_text || "").join("").trim();
}
function _statutOf(pg) {
  return pg.properties?.["Statut"]?.select?.name || "";
}

// Vérifie une référence précise (guard serveur de suppression). Fail-closed : en cas
// d'erreur de requête, on verrouille (on ne supprime pas par défaut un dossier à risque).
export async function factureLockForRef(ref) {
  const t = String(ref || "").trim();
  if (!t) return { locked: false };
  try {
    const res = await queryDatabase(DB.facture, {
      filter: { property: "Référence dossier", rich_text: { equals: t } },
      page_size: 20,
    });
    const actifs = (res.results || []).map(_statutOf).filter((s) => s && s !== "Annulée" && s !== "Brouillon");
    const paye = actifs.includes("Payée");
    return { locked: actifs.length > 0, paye, raison: paye ? "payé" : (actifs.length ? "envoyé" : "") };
  } catch {
    return { locked: true, raison: "vérification facture impossible", error: true };
  }
}

// Carte { ref -> { locked, paye, raison } } pour annoter une liste (1 seule requête).
export async function factureLockMap(limit = 100) {
  const map = {};
  try {
    const res = await queryDatabase(DB.facture, {
      sorts: [{ property: "Date", direction: "descending" }],
      page_size: Math.min(limit, 100),
    });
    (res.results || []).forEach((pg) => {
      const ref = _refDossierOf(pg);
      const st = _statutOf(pg);
      if (!ref || st === "Annulée" || st === "Brouillon") return;
      const paye = st === "Payée";
      const prev = map[ref];
      map[ref] = { locked: true, paye: paye || !!(prev && prev.paye) };
      map[ref].raison = map[ref].paye ? "payé" : "envoyé";
    });
  } catch { /* best-effort : liste non verrouillée si la base facture est indisponible */ }
  return map;
}
