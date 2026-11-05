// Règle unique du débit à l'édition d'un document (étude ou avis), partagée par
// /api/pdf-render (PDF serveur) et /api/consume (impression navigateur, partage, facturation).
// Imprimer puis générer le PDF du même document ne coûte donc qu'un crédit.
//
// Un document est reconnu par sa clé, calculée par le navigateur. La gratuité de la ré-édition
// est donc forgeable : elle est bornée dans le temps et en nombre de rendus, et journalisée
// dans la base Notion « Éditions FIDI » (une ligne par document et par utilisateur).
// Voir docs/CONCEPTION-DEBIT-PDF.md.

import { DB, P, createPage, updatePage, queryDatabase, readNumber } from "./_notion.mjs";
import { findUserByEmail, isUnlimited, paywallOn } from "./_auth.mjs";

export const REEDITION_JOURS = 30;
export const REEDITION_RENDUS = 10;

const JOUR_MS = 24 * 3600 * 1000;
const CLE_VALIDE = /^[A-Za-z0-9._:-]{1,120}$/;

export function editionFacturable(user) {
  return paywallOn() && !isUnlimited(user);
}

// { kind, cle, ref } validé, ou null.
export function lireDoc(src) {
  if (!src || typeof src !== "object") return null;
  const kind = String(src.kind || "").toLowerCase();
  const cle = String(src.cle || "").trim();
  if ((kind !== "etude" && kind !== "avis") || !CLE_VALIDE.test(cle)) return null;
  return { kind, cle, ref: String(src.ref || "").trim().slice(0, 120) };
}

const titreDoc = (doc) => `${doc.kind}:${doc.cle}`;

async function trouverLigne(userPageId, titre) {
  const data = await queryDatabase(DB.editions, {
    filter: { and: [
      { property: "Clé", title: { equals: titre } },
      { property: "Utilisateur", relation: { contains: userPageId } },
    ] },
    page_size: 1,
  });
  return data.results?.[0] || null;
}

function droitOuvert(ligne, maintenant) {
  const p = ligne.properties || {};
  const debut = Date.parse(p["Débité le"]?.date?.start || "");
  if (!Number.isFinite(debut) || maintenant - debut > REEDITION_JOURS * JOUR_MS) return false;
  return (readNumber(p["Rendus"]) ?? 0) < REEDITION_RENDUS;
}

// Décide sans rien écrire : gratuit, à débiter ou refus (0 crédit).
// `doc` doit être valide dès que editionFacturable(user) est vrai.
export async function deciderEdition(found, doc, maintenant = Date.now()) {
  if (!paywallOn()) return { mode: "gratuit", raison: "peage_inactif" };
  if (isUnlimited(found.user)) return { mode: "gratuit", raison: "illimite" };

  const titre = titreDoc(doc);
  const ligne = await trouverLigne(found.page.id, titre);
  if (ligne && droitOuvert(ligne, maintenant)) return { mode: "gratuit", raison: "deja_edite", ligne };
  // Débit passé dont l'écriture au journal avait échoué : la dernière clé fait foi.
  if (!ligne && found.user.derniereRef === titre) return { mode: "gratuit", raison: "deja_edite", ligne: null };
  if (found.user.credits < 1) return { mode: "refus" };
  return { mode: "debit", ligne };
}

function proprietesLigne(found, doc, maintenantIso) {
  return {
    "Clé": P.title(titreDoc(doc)),
    "Utilisateur": P.relation([found.page.id]),
    "Email utilisateur": P.text(found.user.email),
    "Type": P.select(doc.kind),
    "Référence": P.text(doc.ref),
    "Débité le": P.date(maintenantIso),
    "Rendus": P.number(1),
  };
}

async function journaliserDebit(found, doc, ligne, maintenantIso) {
  if (ligne) {
    const deja = readNumber(ligne.properties?.["Crédits débités"]) ?? 0;
    await updatePage(ligne.id, {
      "Référence": P.text(doc.ref),
      "Débité le": P.date(maintenantIso),
      "Rendus": P.number(1),
      "Crédits débités": P.number(deja + 1),
    });
  } else {
    await createPage(DB.editions, { ...proprietesLigne(found, doc, maintenantIso), "Crédits débités": P.number(1) });
  }
}

// Exécute la décision. Lève une erreur .status = 402 si le solde relu ne suffit plus.
// Le journal ne fait jamais échouer une édition déjà payée : « Dernière réf éditée » prend le relais.
export async function enregistrerEdition(found, decision, doc, maintenant = Date.now()) {
  const maintenantIso = new Date(maintenant).toISOString();

  if (decision.mode === "gratuit") {
    if (decision.raison === "deja_edite") {
      try {
        if (decision.ligne) {
          const rendus = readNumber(decision.ligne.properties?.["Rendus"]) ?? 0;
          await updatePage(decision.ligne.id, { "Rendus": P.number(rendus + 1) });
        } else {
          await createPage(DB.editions, { ...proprietesLigne(found, doc, maintenantIso), "Crédits débités": P.number(1) });
        }
      } catch (e) {
        console.error("edition: journal non mis à jour", titreDoc(doc), e.message);
      }
    }
    return { facture: false, raison: decision.raison, credits: found.user.credits };
  }

  // Le rendu a pu durer : on relit le solde pour réduire la fenêtre entre requêtes simultanées.
  // Notion n'ayant pas d'écriture conditionnelle, elle ne peut pas être fermée tout à fait.
  const frais = await findUserByEmail(found.user.email);
  if (!frais || frais.user.credits < 1) {
    const e = new Error("Crédits épuisés. Rechargez pour éditer ce document.");
    e.status = 402;
    throw e;
  }
  const restants = frais.user.credits - 1;
  // Une seule écriture : solde, compteur d'essais et dernière clé changent ensemble.
  await updatePage(frais.page.id, {
    "Crédits": P.number(restants),
    "Recherches utilisées": P.number(0),
    "Dernière réf éditée": P.text(titreDoc(doc)),
  });

  try {
    await journaliserDebit(found, doc, decision.ligne, maintenantIso);
  } catch {
    try { await journaliserDebit(found, doc, decision.ligne, maintenantIso); }
    catch (e) { console.error("edition: débit non journalisé", titreDoc(doc), found.user.email, e.message); }
  }
  return { facture: true, credits: restants };
}
