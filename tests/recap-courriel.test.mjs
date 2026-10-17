// Régression — l'e-mail du récapitulatif ne passe plus par un « mailto: » seul.
// Cause constatée le 2026-10-17 : un lien mailto: est confié au gestionnaire du poste (ici le webmail Orange enregistré dans
// le profil Chrome, alors que l'utilisateur travaille avec Gmail). Le récapitulatif propose donc la messagerie au clic
// (Gmail, Outlook, Yahoo, application du poste, copie) et mémorise le choix sous la clé des relances (fidi:mail:service).
// La fonction vit dans index.html : elle est extraite et exécutée ici avec un faux document.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const html = fs.readFileSync(new URL("../index.html", import.meta.url), "utf8");

function extraire(nom) {
  const debut = html.indexOf(`function ${nom}(`);
  assert.ok(debut >= 0, `${nom} introuvable dans index.html`);
  let niveau = 0;
  for (let k = html.indexOf("{", debut); k < html.length; k++) {
    if (html[k] === "{") niveau++;
    else if (html[k] === "}" && --niveau === 0) return html.slice(debut, k + 1);
  }
  throw new Error(`accolade non fermée : ${nom}`);
}

function monde({ memorise = "" } = {}) {
  const ouvertures = [];
  const copies = [];
  const stockage = new Map(memorise ? [["fidi:mail:service", memorise]] : []);
  const fabrique = (tag) => ({
    tag, style: { cssText: "" }, children: [], parentNode: null, onclick: null, textContent: "", className: "", href: undefined,
    appendChild(e) { e.parentNode = this; this.children.push(e); return e; },
    insertBefore(e, ref) {
      e.parentNode = this;
      const i = ref ? this.children.indexOf(ref) : -1;
      if (i >= 0) this.children.splice(i, 0, e); else this.children.push(e);
      return e;
    },
    get nextSibling() { return this.parentNode.children[this.parentNode.children.indexOf(this) + 1] ?? null; },
  });
  const barre = fabrique("div");
  const elements = { rcWa: barre.appendChild(fabrique("a")), rcMail: barre.appendChild(fabrique("a")) };
  return {
    ouvertures, copies, stockage, elements, barre,
    document: { getElementById: (id) => elements[id] ?? null, createElement: fabrique },
    localStorage: { getItem: (k) => stockage.get(k) ?? null, setItem: (k, v) => { stockage.set(k, v); } },
    window: { open: (u, cible, options) => { ouvertures.push({ u, cible, options }); }, location: { href: "" } },
    navigator: { clipboard: { writeText: (t) => { copies.push(t); } } },
  };
}

function lancer(m, texte, sujet) {
  const init = new Function(
    "document", "localStorage", "window", "navigator",
    `${extraire("recapPopupInit")}; return recapPopupInit;`
  )(m.document, m.localStorage, m.window, m.navigator);
  init(texte, sujet);
  return m.barre.children.find((e) => e.tag === "span"); // la rangée de choix
}

const TEXTE = "Estimation : 5,3 M€ & plus\nLigne 2 ?x=1#fin";
const SUJET = "Étude de marché — Récapitulatif";
const bouton = (choix, libelle) => choix.children.find((b) => b.textContent === libelle);

test("WhatsApp : lien wa.me avec le texte encodé", () => {
  const m = monde();
  lancer(m, TEXTE, SUJET);
  assert.equal(m.elements.rcWa.href, `https://wa.me/?text=${encodeURIComponent(TEXTE)}`);
});

test("le bouton E-mail n'a plus de lien mailto: ; il déroule le choix de messagerie", () => {
  const m = monde();
  const choix = lancer(m, TEXTE, SUJET);
  assert.equal(m.elements.rcMail.href, undefined);
  assert.equal(choix.style.cssText.includes("display:none"), true);
  m.elements.rcMail.onclick();
  assert.equal(choix.style.display, "inline-flex");
  m.elements.rcMail.onclick();
  assert.equal(choix.style.display, "none");
  assert.deepEqual(choix.children.map((b) => b.textContent), ["Gmail", "Outlook", "Yahoo", "App par défaut", "Copier le texte"]);
  assert.equal(m.ouvertures.length, 0, "rien ne s'ouvre avant le choix");
});

test("Gmail, Outlook, Yahoo : adresse de composition avec objet et texte, choix mémorisé", () => {
  const attendu = {
    Gmail: ["gmail", "https://mail.google.com/mail/?view=cm&fs=1&su="],
    Outlook: ["outlook", "https://outlook.live.com/mail/0/deeplink/compose?subject="],
    Yahoo: ["yahoo", "https://compose.mail.yahoo.com/?subject="],
  };
  for (const [libelle, [service, debut]] of Object.entries(attendu)) {
    const m = monde();
    const choix = lancer(m, TEXTE, SUJET);
    bouton(choix, libelle).onclick();
    assert.equal(m.ouvertures.length, 1, libelle);
    const { u, cible, options } = m.ouvertures[0];
    assert.ok(u.startsWith(debut), `${libelle} : ${u}`);
    assert.ok(u.includes(`${encodeURIComponent(SUJET)}&body=${encodeURIComponent(TEXTE)}`), libelle);
    assert.equal(cible, "_blank");
    assert.equal(options, "noopener");
    assert.equal(m.stockage.get("fidi:mail:service"), service);
  }
});

test("App par défaut : le seul cas où mailto: est utilisé, par choix explicite", () => {
  const m = monde();
  const choix = lancer(m, TEXTE, SUJET);
  bouton(choix, "App par défaut").onclick();
  assert.ok(m.window.location.href.startsWith("mailto:?subject="));
  assert.equal(m.ouvertures.length, 0);
  assert.equal(m.stockage.get("fidi:mail:service"), "default");
});

test("Copier le texte : copie sans rien ouvrir ni mémoriser", () => {
  const m = monde();
  const choix = lancer(m, TEXTE, SUJET);
  const b = bouton(choix, "Copier le texte");
  b.onclick();
  assert.deepEqual(m.copies, [TEXTE]);
  assert.equal(b.textContent, "Copié ✓");
  assert.equal(m.ouvertures.length, 0);
  assert.equal(m.stockage.has("fidi:mail:service"), false);
});

test("le choix déjà mémorisé (relances de factures) est mis en évidence", () => {
  const m = monde({ memorise: "outlook" });
  const choix = lancer(m, TEXTE, SUJET);
  assert.ok(bouton(choix, "Outlook").style.cssText.includes("outline"));
  assert.ok(!bouton(choix, "Gmail").style.cssText.includes("outline"));
});

test("garde-fou : aucun mailto: seul dans index.html, hors les cas voulus", () => {
  const autorises = [
    /<a href="mailto:\$\{m\.courriel\}">/,                       // affichage de l'adresse d'un contact
    /default:\s+return 'mailto:'\+t\+/,                          // emailComposeUrl : « app par défaut », choix explicite
    /else\s+url = 'mailto:'\+to\+/,                              // factOpenWebmail : idem
    /return 'mailto:\?subject=' \+ su/,                          // recapPopupInit : idem
  ];
  const intrus = html.split(/\r?\n/)
    .map((ligne, i) => ({ ligne, n: i + 1 }))
    .filter(({ ligne }) => ligne.includes("mailto:") && !ligne.trim().startsWith("//") && !autorises.some((re) => re.test(ligne)));
  assert.deepEqual(intrus.map((x) => `${x.n}: ${x.ligne.trim().slice(0, 100)}`), []);
});
