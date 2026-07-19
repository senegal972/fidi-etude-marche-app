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
