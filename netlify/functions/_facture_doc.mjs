// Rendu HTML d'une facture détaillée (plusieurs lignes, remise, TVA, échéance, mentions légales).
// Utilisé par facture-html.mjs : facture enregistrée (GET ?t=<jeton>) et aperçu avant création (POST).
// Les factures antérieures, sans détail enregistré, gardent leur rendu d'origine.

import { calculerFacture } from "./_facture_calc.mjs";

const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const eur = (n) => Number(n || 0).toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " €";
const qte = (n) => Number(n || 0).toLocaleString("fr-FR", { maximumFractionDigits: 2 });
const dateFr = (iso) => {
  if (!iso) return "";
  const d = new Date(iso + (String(iso).length === 10 ? "T12:00:00" : ""));
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" });
};
const hexOk = (h) => typeof h === "string" && /^#[0-9a-f]{6}$/i.test(h);
const logoOk = (l) => typeof l === "string" && /^data:image\/(png|jpeg|webp|svg\+xml);/.test(l);

// Champs que l'aperçu signale en clair quand ils manquent (mentions obligatoires d'une facture).
export function mentionsManquantes(emetteur) {
  const e = emetteur || {}, co = e.coordonnees || {}, fa = e.facturation || {};
  const manque = [];
  if (!(co.raisonSociale || e.enseigne)) manque.push("raison sociale");
  if (!co.adresse) manque.push("adresse de l'émetteur");
  if (!fa.siren) manque.push("SIREN / SIRET");
  if (!fa.regimeTva) manque.push("régime de TVA");
  return manque;
}

// data : { numero, date, echeance, client:{ nom, email, telephone, adresse }, bien, refDossier,
//          facture:{ lignes, mode, prixSaisis, remise, tva }, notes, emetteur, acquittee, apercu }
export function renderFactureHTML(data) {
  const d = data || {};
  const e = d.emetteur || {}, co = e.coordonnees || {}, fa = e.facturation || {}, bq = e.banque || {};
  const c = d.client || {};
  const calc = calculerFacture(d.facture || {});
  const t = calc.totaux;
  const coul = hexOk(e.couleurs && e.couleurs.principale) ? e.couleurs.principale : "#1a3a6e";
  const nomEmetteur = co.raisonSociale || e.enseigne || "";
  const heures = calc.mode === "heures";
  const colQ = heures ? "Heures" : "Qté";
  const colPU = (heures ? "Taux horaire" : "Prix unitaire") + " HT";
  const manque = d.apercu ? mentionsManquantes(e) : [];

  const idEmetteur = [
    nomEmetteur && `<strong>${esc(nomEmetteur)}</strong>`,
    [fa.formeJuridique, fa.capital && `au capital de ${fa.capital}`].filter(Boolean).map(esc).join(" "),
    co.adresse && esc(co.adresse),
    fa.siren && `SIREN / SIRET : ${esc(fa.siren)}`,
    fa.registre && esc(fa.registre),
    fa.tvaIntra && `TVA intracommunautaire : ${esc(fa.tvaIntra)}`,
    [co.telephone, co.email].filter(Boolean).map(esc).join(" · "),
  ].filter(Boolean).join("<br>");

  // Avoir : mêmes lignes que la facture annulée, montants en négatif ; ni échéance, ni coordonnées de règlement.
  const av = d.avoir && typeof d.avoir === "object" ? d.avoir : null;
  const sg = (v) => (av ? "− " : "") + eur(v);

  const lignesHtml = calc.lignes.map((l) => `
    <tr>
      <td><div class="des">${esc(l.designation)}</div>${l.description ? `<div class="desc">${esc(l.description).replace(/\n/g, "<br>")}</div>` : ""}</td>
      <td class="num">${calc.mode === "montant" ? "1" : qte(l.quantite)}</td>
      <td class="num">${sg(l.prixUnitaireHT)}</td>
      <td class="num">${sg(l.montantHT)}</td>
    </tr>`).join("") || `<tr><td colspan="4" class="vide">Aucun article</td></tr>`;

  const htAvantRemise = t.htAvantRemise, remiseHT = t.remiseHT; // cohérents au centime (voir _facture_calc.mjs)
  const lignesTotaux = [
    t.remise > 0 && `<tr><td colspan="3">Sous-total HT</td><td class="num">${sg(htAvantRemise)}</td></tr>`,
    t.remise > 0 && `<tr><td colspan="3">${calc.remise && calc.remise.nature === "acompte"
      ? "Acompte déjà versé" + (calc.remise.reference ? ` (facture n° ${esc(calc.remise.reference)})` : "")
      : "Remise" + (calc.remise && calc.remise.type === "pct" ? ` (${qte(calc.remise.valeur)} %)` : "")}</td><td class="num">${av ? "" : "− "}${eur(remiseHT)}</td></tr>`,
    `<tr><td colspan="3">Total HT</td><td class="num">${sg(t.ht)}</td></tr>`,
    calc.tva.regime === "assujetti"
      ? `<tr><td colspan="3">TVA ${qte(calc.tva.taux)} %</td><td class="num">${sg(t.tva)}</td></tr>`
      : `<tr><td colspan="3">TVA non applicable, art. 293 B du CGI</td><td class="num">0,00 €</td></tr>`,
    `<tr class="ttc"><td colspan="3">${av ? "Total TTC de l'avoir" : "Total TTC"}</td><td class="num">${sg(t.ttc)}</td></tr>`,
  ].filter(Boolean).join("");

  const mentionTva = calc.tva.regime === "assujetti"
    ? (Math.abs(calc.tva.taux - 8.5) < 0.001 ? "TVA au taux de 8,5 % applicable dans les départements d'outre-mer (art. 296 du CGI). " : "")
    : "TVA non applicable, article 293 B du CGI. ";
  const echeanceTxt = d.echeance && d.echeance !== d.date ? `le ${dateFr(d.echeance)}` : "à réception de la facture";

  return `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Facture ${esc(d.numero || "")}</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: 'Segoe UI', Arial, sans-serif; font-size: 12.5px; color: #222; background: #fff; padding: 36px; }
  @page { size: A4; margin: 14mm 12mm; }
  @media print { body { padding: 0; -webkit-print-color-adjust: exact; print-color-adjust: exact; } .no-print { display: none !important; }
    tr, .bloc { break-inside: avoid; page-break-inside: avoid; } thead { display: table-header-group; } }
  .hd { display: flex; justify-content: space-between; align-items: flex-start; gap: 24px; margin-bottom: 26px; }
  .logo img { max-height: 64px; max-width: 220px; object-fit: contain; }
  .logo .nom { font-size: 22px; font-weight: 800; color: ${coul}; letter-spacing: -.4px; }
  .em { text-align: right; font-size: 11.5px; line-height: 1.55; color: #444; }
  h1 { font-size: 24px; color: ${coul}; margin-bottom: 4px; }
  .num-fac { font-size: 13px; color: #555; margin-bottom: 22px; }
  .paid { display: inline-block; margin-left: 10px; padding: 3px 12px; border: 2px solid #1c7a35; color: #1c7a35; border-radius: 6px; font-weight: 800; font-size: 12px; transform: rotate(-4deg); }
  .apercu { background: #fff7e6; border: 1px solid #f0c36d; color: #7a4b00; border-radius: 8px; padding: 8px 12px; font-size: 11.5px; margin-bottom: 18px; }
  .meta { display: flex; gap: 16px; margin-bottom: 22px; }
  .bloc { flex: 1; border: 1px solid #dce3ec; border-radius: 8px; padding: 12px 14px; line-height: 1.55; }
  .bloc h4 { font-size: 9.5px; text-transform: uppercase; letter-spacing: .8px; color: #888; margin-bottom: 6px; }
  .bloc strong { color: ${coul}; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 18px; }
  thead tr { background: ${coul}; color: #fff; }
  th { padding: 9px 12px; text-align: left; font-size: 11.5px; font-weight: 600; }
  th.num, td.num { text-align: right; white-space: nowrap; }
  tbody tr { border-bottom: 1px solid #eee; }
  tbody td { padding: 10px 12px; vertical-align: top; }
  .des { font-weight: 600; } .desc { color: #666; font-size: 11.5px; margin-top: 3px; }
  .vide { color: #999; text-align: center; }
  .totaux { width: 55%; margin-left: auto; }
  .totaux td { padding: 6px 12px; } .totaux tr.ttc td { background: #f4f6fa; font-weight: 800; font-size: 15px; color: ${coul}; border-top: 2px solid ${coul}; }
  .notes { border-left: 3px solid ${coul}; background: #f8fafc; padding: 10px 14px; margin: 6px 0 18px; font-size: 12px; white-space: pre-line; }
  .legal { font-size: 10.5px; color: #666; line-height: 1.6; border-top: 1px solid #eee; padding-top: 12px; }
  .btn-print { display: block; margin: 0 auto 20px; padding: 10px 26px; background: ${coul}; color: #fff; border: none; border-radius: 6px; font-size: 14px; cursor: pointer; }
  .virement{margin-top:14px;padding:10px 12px;border:1px solid #d5dbe4;border-radius:6px;font-size:11.5px;line-height:1.6;page-break-inside:avoid}
</style>
</head>
<body>
${d.apercu ? "" : `<button class="btn-print no-print" onclick="window.print()">🖨️ Imprimer / Enregistrer en PDF</button>`}
${manque.length ? `<div class="apercu no-print">Aperçu — mentions obligatoires à compléter dans « Mise en page → Facturation » : ${esc(manque.join(", "))}.</div>` : ""}
<div class="hd">
  <div class="logo">${logoOk(e.logo) ? `<img src="${esc(e.logo)}" alt="${esc(nomEmetteur)}">` : `<div class="nom">${esc(e.enseigne || nomEmetteur)}</div>`}</div>
  <div class="em">${idEmetteur}</div>
</div>

<h1>${av ? "Avoir" : "Facture"}${d.acquittee && !av ? '<span class="paid">✓ PAYÉE</span>' : ""}</h1>
<div class="num-fac">N° <strong>${esc(d.numero || "attribué à la création")}</strong></div>

<div class="meta">
  <div class="bloc">
    <h4>${av ? "Client" : "Facturé à"}</h4>
    <strong>${esc(c.nom) || "(client à compléter)"}</strong>
    ${c.adresse ? `<br>${esc(c.adresse)}` : ""}${c.email ? `<br>${esc(c.email)}` : ""}${c.telephone ? `<br>${esc(c.telephone)}` : ""}
  </div>
  <div class="bloc">
    <h4>Détails</h4>
    Date d'émission : <strong>${esc(dateFr(d.date))}</strong><br>
    ${av ? `Annule la facture n° <strong>${esc(av.de || "")}</strong>${av.dateFacture ? " du " + esc(dateFr(av.dateFacture)) : ""}`
         : `Échéance : <strong>${d.echeance && d.echeance !== d.date ? esc(dateFr(d.echeance)) : "à réception"}</strong>`}
    ${d.bien ? `<br>Bien : ${esc(d.bien)}` : ""}${d.refDossier ? `<br>Réf. prestation : ${esc(d.refDossier)}` : ""}
  </div>
</div>

<table>
  <thead><tr><th style="width:55%">Désignation</th><th class="num">${colQ}</th><th class="num">${colPU}</th><th class="num">Montant HT</th></tr></thead>
  <tbody>${lignesHtml}</tbody>
</table>
<table class="totaux"><tbody>${lignesTotaux}</tbody></table>

${av ? `<div class="notes">Avoir annulant la facture n° ${esc(av.de || "")}${av.dateFacture ? " du " + esc(dateFr(av.dateFacture)) : ""}.${av.motif ? "\nMotif : " + esc(av.motif) : ""}${av.remboursement ? "\nRemboursement : " + esc(av.remboursement) + "." : ""}</div>`
     : d.notes ? `<div class="notes">${esc(d.notes)}</div>` : ""}

${bq.iban && !d.acquittee && !av ? `<div class="virement"><strong>Règlement par virement</strong><br>
  Titulaire : ${esc(bq.titulaire || nomEmetteur)}<br>IBAN : ${esc(bq.iban.replace(/(.{4})/g, "$1 ").trim())}${bq.bic ? `<br>BIC : ${esc(bq.bic)}` : ""}
  <br>Référence à indiquer : ${esc(d.numero || "")}</div>` : ""}

<div class="legal">
  ${av ? esc(mentionTva) : `${esc(mentionTva)}Règlement ${esc(echeanceTxt)}. Pas d'escompte pour paiement anticipé.<br>
  ${fa.conditions ? esc(fa.conditions) + "<br>" : ""}
  En cas de retard de paiement : pénalités au taux de trois fois le taux d'intérêt légal (art. L441-10 du Code de commerce)
  et, pour les clients professionnels, indemnité forfaitaire pour frais de recouvrement de 40 € (art. D441-5 du Code de commerce).`}
  ${co.mentions ? "<br>" + esc(co.mentions) : ""}
</div>
</body>
</html>`;
}
