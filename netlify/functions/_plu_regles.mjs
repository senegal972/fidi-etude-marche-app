// Lecture des règles d'une zone dans le texte d'un règlement écrit de PLU.
// Logique pure (aucun réseau) : reçoit le texte page par page, renvoie les règles
// trouvées avec leur CITATION et leur PAGE pour que l'utilisateur puisse vérifier.
//
// Principe de prudence : les règlements sont rédigés très différemment d'une commune
// à l'autre. Une règle n'est renvoyée que si elle se rattache à la zone demandée ;
// plusieurs valeurs possibles ou un autre secteur = null, jamais une valeur devinée.

const NOMBRES = {
  un: 1, une: 1, deux: 2, trois: 3, quatre: 4, cinq: 5, six: 6, sept: 7, huit: 8, neuf: 9, dix: 10,
  onze: 11, douze: 12, treize: 13, quatorze: 14, quinze: 15, seize: 16, vingt: 20, trente: 30,
};
const NUM = "(\\d+(?:[.,]\\d+)?|un|une|deux|trois|quatre|cinq|six|sept|huit|neuf|dix|onze|douze|treize|quatorze|quinze|seize|vingt|trente)";

function toNumber(s) {
  const t = String(s).toLowerCase();
  if (t in NOMBRES) return NOMBRES[t];
  const n = parseFloat(t.replace(",", "."));
  return Number.isFinite(n) ? n : null;
}
function escRe(s) { return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }

// Hiérarchie du code : UGf1 → UGf → UG (une règle de secteur vaut pour ses sous-secteurs).
export function zoneCandidates(zone) {
  const out = [];
  let z = String(zone || "").trim();
  if (!z) return out;
  out.push(z);
  const sansChiffre = z.replace(/[-_ ]?\d+[a-z]?$/i, "");
  if (sansChiffre && sansChiffre !== z) { out.push(sansChiffre); z = sansChiffre; }
  const sansMinuscules = z.replace(/[a-zéè]+$/, "");
  if (sansMinuscules && sansMinuscules !== z) { out.push(sansMinuscules); z = sansMinuscules; }
  const sansSuffixe = z.replace(/\d+[a-z]*$/i, "");
  if (sansSuffixe && sansSuffixe !== z && !out.includes(sansSuffixe)) { out.push(sansSuffixe); z = sansSuffixe; }
  // Famille (UC → U, AUH → AU) : pour les règlements dont les articles sont communs.
  const famille = /^AU/i.test(z) ? z.slice(0, 2) : z.slice(0, 1);
  if (famille && famille !== z && !out.includes(famille)) out.push(famille);
  return out;
}
function codeRe(code, flags = "i") { return new RegExp("(?<![A-Za-zÀ-ÿ0-9])" + escRe(code) + "(?![A-Za-zÀ-ÿ0-9])", flags); }

// Assemble les pages en un texte unique + index de début de page.
export function joinPages(pages) {
  const starts = [];
  let text = "";
  (pages || []).forEach((p) => {
    starts.push(text.length);
    text += String(p || "").replace(/\s+/g, " ") + " ";
  });
  return { text, starts };
}
function pageAt(starts, idx) {
  let lo = 0, hi = starts.length - 1, r = 0;
  while (lo <= hi) { const m = (lo + hi) >> 1; if (starts[m] <= idx) { r = m; lo = m + 1; } else hi = m - 1; }
  return r + 1;
}

// Plage du texte consacrée à la zone (chapitre). Sans chapitre identifié : null.
function chapterRange(text, zone) {
  const cands = zoneCandidates(zone);
  for (let i = 0; i < cands.length; i++) {
    const c = escRe(cands[i]);
    // « applicables à la zone UG », « ZONE UG », « ARTICLE UG5 », « Article UA 6 », « Art U3 ».
    const re = new RegExp(String.raw`(?:applicables?\s+(?:à|a|aux)\s+(?:la\s+|les\s+)?zones?\s+${c}(?![A-Za-zÀ-ÿ0-9])|ZONE\s+${c}(?![A-Za-zÀ-ÿ0-9])|(?:Article|ARTICLE|Art\.?)\s+${c}(?:\s*[.\-–]?\s*\d+)(?![A-Za-zÀ-ÿ0-9]))`, "g");
    const hits = [];
    let m;
    while ((m = re.exec(text))) hits.push(m.index);
    if (hits.length < 3) continue;
    // Groupes séparés de moins de 9 000 car. : le plus fourni est le chapitre de la zone.
    // Le plus ÉTENDU l'emporte : un sommaire compte beaucoup d'occurrences sur peu de texte.
    let best = null, cur = { start: hits[0], end: hits[0], n: 1 };
    const span = (g) => g.end - g.start;
    for (let k = 1; k < hits.length; k++) {
      if (hits[k] - cur.end < 9000) { cur.end = hits[k]; cur.n++; }
      else { if (!best || span(cur) > span(best)) best = cur; cur = { start: hits[k], end: hits[k], n: 1 }; }
    }
    if (!best || span(cur) > span(best)) best = cur;
    if (best.n >= 3) return { start: best.start, end: Math.min(text.length, best.end + 9000), code: cands[i] };
  }
  return null;
}

const TITRES = {
  voie: /implantation[^.:]{0,70}(?:voies?|emprises? publiques?|alignement)/gi,
  limites: /implantation[^.:]{0,70}limites?\s+(?:s[ée]paratives?|de propri)/gi,
  entre: /implantation[^.:]{0,70}(?:les unes? par rapport|m[êe]me (?:propri[ée]t[ée]|unit[ée] fonci[èe]re|terrain))/gi,
  emprise: /emprise au sol/gi,
  hauteur: /\d\s*[\/.)]\s*(?:la\s+)?hauteur|hauteur\s+(?:maximale\s+)?des\s+constructions|(?:article|art\.?)\s+[A-Za-z]{1,6}[\s.\-]*\d+\s*[-–:.]?\s*(?:la\s+)?hauteur/gi,
};
const FIN_SEGMENT = /implantation[^.:]{0,70}(?:voies?|emprises? publiques?|limites?\s+(?:s[ée]par|de propri)|les unes? par rapport|m[êe]me (?:propri|unit|terrain))|\d\s*\/\s*emprise au sol|(?:article|art\.)\s+[A-Z]{1,5}[a-z]*\s*[.\-]?\s*\d+|\d\s*\/\s*hauteur/gi;

// Segments de texte commençant à un titre, jusqu'au titre suivant (borne 3 500 car.).
function segments(text, range, reTitre) {
  const out = [];
  const re = new RegExp(reTitre.source, "gi");
  re.lastIndex = range.start;
  let m;
  while ((m = re.exec(text)) && m.index < range.end) {
    const from = m.index;
    const fin = new RegExp(FIN_SEGMENT.source, "gi");
    fin.lastIndex = from + m[0].length;
    const f = fin.exec(text);
    const to = Math.min(f ? f.index : from + 3500, from + 3500);
    out.push({ from, to, s: text.slice(from, to) });
  }
  return out;
}

const MARQUEUR_SECTEUR = /(?:(?:[Aa]u sein|[Dd]ans|[Pp]our|[Ee]n)\s+(?:du|les?|la|l.)?\s*(?:seuls?\s+|autres\s+)?)?(?:[Ss]ous-[Ss]ecteurs?|[Ss]ecteurs?|[Zz]ones?|SECTEURS?)\s+(?:en\s+)?((?:[A-Z][A-Za-z0-9-]*)(?:(?:\s*,\s*|\s+et\s+|\s+ou\s+)[A-Z][A-Za-z0-9-]*)*)|(?:^|[\s:;.])En\s+((?:[A-Z]{1,3}[A-Za-z0-9-]*)(?:(?:\s*,\s*|\s+et\s+|\s+ou\s+)[A-Z]{1,3}[A-Za-z0-9-]*)*)/g;

// Isole dans un segment la partie qui s'applique à la zone. Sans marqueur de secteur,
// le segment est une règle générale. Marqueurs présents sans notre zone : non applicable.
function pieceForZone(seg, zone) {
  const cands = zoneCandidates(zone).map((c) => c.toLowerCase());
  const marks = [];
  const re = new RegExp(MARQUEUR_SECTEUR.source, "g");
  let m;
  while ((m = re.exec(seg))) {
    // Titre courant de page (« Dispositions applicables à la zone UG ») : pas un secteur.
    if (/applicables?\s+(?:à|a|aux)\s+(?:la\s+|les\s+)?$/i.test(seg.slice(Math.max(0, m.index - 30), m.index))) continue;
    const liste = (m[1] || m[2] || "").split(/\s*,\s*|\s+et\s+|\s+ou\s+/).map((x) => x.trim().toLowerCase()).filter(Boolean);
    if (liste.length) marks.push({ idx: m.index, end: m.index + m[0].length, liste });
  }
  if (!marks.length) return { texte: seg, offset: 0, portee: "zone" };
  // Du code le plus précis au plus large : UGf1 avant UGf avant UG.
  for (const c of cands) {
    const i = marks.findIndex((x) => x.liste.includes(c));
    if (i >= 0) {
      const to = i + 1 < marks.length ? marks[i + 1].idx : seg.length;
      return { texte: seg.slice(marks[i].idx, to), offset: marks[i].idx, portee: "secteur" };
    }
  }
  // Texte placé AVANT le premier marqueur = règle générale du chapitre (si chiffrée).
  const avant = seg.slice(0, marks[0].idx);
  if (/\d|m[èe]tre/.test(avant.replace(/^[^.]*/, ""))) return { texte: avant, offset: 0, portee: "zone" };
  return null;
}

function extraitAutour(texte, i, len = 240) {
  const from = Math.max(0, i - 60);
  return (from > 0 ? "…" : "") + texte.slice(from, from + len).trim() + "…";
}

// Distance de recul dans un passage. Ignore les hauteurs (« n'excède pas 3 mètres en limite »).
const EXCEPTIONS = /r[èe]gles?\s+particuli[èe]res?|dispositions?\s+particuli[èe]res?|cas\s+particuliers?|une\s+implantation\s+diff[ée]rente|des\s+implantations\s+autres/i;
function parseRecul(texte) {
  const res = { m: null, en_limite: false, formule: null, reference: null, maximum: false, idx: -1 };
  const coupe = texte.search(EXCEPTIONS);
  const general = coupe > 40 ? texte.slice(0, coupe) : texte;
  const clean = general.replace(/hauteur[^.;]{0,60}?(?:n.exc[èe]de|inf[ée]rieure?|sup[ée]rieure?)[^.;]{0,30}?\d+(?:[.,]\d+)?\s*m(?:[èe]tres?)?/gi, (s) => " ".repeat(s.length));
  const motifs = [
    new RegExp("(?:recul|retrait|distance|marge)[^.;:]{0,90}?(?:minimale?|minimum|au moins|inf[ée]rieure?\\s+[àa]|[ée]gale?\\s+[àa]|de|d.|[àa])\\s+" + NUM + "\\s*(?:m\\b|m[èe]tres?)", "i"),
    new RegExp("(?:au moins|au minimum|minimum)\\s+(?:[àa]\\s+)?" + NUM + "\\s*(?:m\\b|m[èe]tres?)[^.;]{0,60}?(?:limite|alignement|voie|emprise)", "i"),
    new RegExp(NUM + "\\s*(?:m\\b|m[èe]tres?)\\s+(?:minimum|au moins)[^.;]{0,60}?(?:limite|alignement|voie|emprise)", "i"),
    new RegExp("sans\\s+[êe]tre\\s+inf[ée]rieure?\\s+[àa]\\s+" + NUM + "\\s*(?:m\\b|m[èe]tres?)", "i"),
  ];
  const trouves = [];
  // Liste par type de voie (« 10 m de la RN2 ; 5 m des autres voies ») : la règle courante.
  const courante = clean.match(new RegExp(NUM + String.raw`\s*(?:m\b|m[èe]tres?)\s+(?:de\s+l.alignement\s+)?(?:des|aux)\s+autres\s+voies`, "i"));
  if (courante) trouves.push({ v: toNumber(courante[1]), i: courante.index });
  else for (const re of motifs) { const m = clean.match(re); if (m) trouves.push({ v: toNumber(m[1]), i: m.index }); }
  if (trouves.length) {
    trouves.sort((a, b) => a.i - b.i);
    res.m = trouves[0].v; res.idx = trouves[0].i;
    // « en retrait de 5 mètres maximum » est un plafond, pas un recul minimal.
    if (new RegExp(NUM + String.raw`\s*(?:m\b|m[èe]tres?)\s+maximum`, "i").test(clean.slice(res.idx, res.idx + 140))) { res.maximum = true; res.m = null; }
  }
  if (/soit\s+(?:en|sur)\s+(?:les?\s+)?limites?|peu[tv]e?n?t?\s+(?:[êe]tre\s+)?implant[ée]e?s?\s+(?:en|sur)\s+(?:les?\s+)?limites?|[àa]\s+l.alignement\s+(?:ou|soit)|soit\s+[àa]\s+l.alignement|sur\s+(?:les|la|une)\s+limites?\s+s[ée]parative/i.test(clean)) res.en_limite = true;
  if (/H(?:et)?\s*\/\s*2|divis[ée]e?\s+par\s+deux|moiti[ée]\s+de\s+la\s+hauteur/i.test(clean)) res.formule = "H/2";
  if (/axe\s+de\s+la\s+voie|axe\s+des\s+voies/i.test(clean)) res.reference = "axe de la voie";
  if (res.idx < 0 && (res.en_limite || res.formule)) res.idx = 0;
  return res;
}

function regleRecul(text, starts, range, zone, reTitre) {
  const segs = segments(text, range, reTitre);
  for (const seg of segs) {
    const piece = pieceForZone(seg.s, zone);
    if (!piece) continue;
    const r = parseRecul(piece.texte);
    if (r.m == null && !r.en_limite && !r.formule) continue;
    return {
      m: r.m,
      en_limite: r.en_limite,
      formule: r.formule,
      reference: r.reference,
      maximum: r.maximum,
      portee: piece.portee,
      citation: extraitAutour(piece.texte, Math.max(0, r.idx), 320),
      page: pageAt(starts, seg.from + piece.offset + Math.max(0, r.idx)),
    };
  }
  return null;
}

// Emprise au sol : forme rédigée (« limitée à 30 % ») ou tableau (« UH4 et AUH4 30 % »).
function regleEmprise(text, starts, range, zone) {
  const segs = segments(text, range, TITRES.emprise);
  const vus = [];
  const cands = zoneCandidates(zone).map((c) => c.toLowerCase());
  for (const seg of segs) {
    // « …sous-secteur UGf2, l'emprise au sol… » : la mention appartient au secteur qui précède.
    const avant = text.slice(Math.max(range.start, seg.from - 90), seg.from);
    const marques = [...avant.matchAll(new RegExp(MARQUEUR_SECTEUR.source, "g"))];
    const dernier = marques[marques.length - 1];
    if (dernier && !/[.:;]\s*\S*\s*$/.test(avant.slice(dernier.index + dernier[0].length))) {
      const liste = (dernier[1] || dernier[2] || "").split(/\s*,\s*|\s+et\s+|\s+ou\s+/).map((x) => x.trim().toLowerCase());
      if (!liste.some((x) => cands.includes(x))) continue;
    }
    const fen = text.slice(seg.from, seg.from + 700);
    const redige = /emprise au sol[^.]{0,140}?(?:limit[ée]+e?|ne\s+(?:peut|doit)[^.]{0,40}?(?:exc[ée]der|d[ée]passer)|maximale?\s+(?:est\s+)?(?:fix[ée]e\s+)?(?:[àa]|de)|est\s+(?:fix[ée]e\s+)?[àa])[^.%]{0,40}?(\d+(?:[.,]\d+)?)\s*%/i;
    const piece = pieceForZone(fen, zone);
    if (piece) {
      const m = piece.texte.match(redige);
      if (m) vus.push({ pct: parseFloat(m[1].replace(",", ".")), portee: piece.portee, citation: extraitAutour(piece.texte, m.index, 280), page: pageAt(starts, seg.from + piece.offset + m.index) });
    }
    if (/non\s+r[èée]glement[ée]e?|n.est\s+pas\s+r[èée]glement[ée]e?|il\s+n.est\s+pas\s+fix[ée]\s+de\s+r[èe]gle/i.test(fen.slice(0, 180)) && !vus.length && !/%/.test(fen.slice(0, 180))) {
      return { pct: null, non_reglemente: true, portee: "zone", citation: extraitAutour(fen, 0, 200), page: pageAt(starts, seg.from) };
    }
  }
  if (vus.length) {
    const secteur = vus.filter((v) => v.portee === "secteur");
    const liste = secteur.length ? secteur : vus;
    const valeurs = [...new Set(liste.map((v) => v.pct))];
    if (valeurs.length === 1) return liste[0];
    return { pct: null, ambigu: true, valeurs, portee: liste[0].portee, citation: liste[0].citation, page: liste[0].page };
  }
  return null;
}

// Tableau : le code de zone précède le pourcentage, éventuellement avec un quartier.
function regleEmpriseTableau(text, starts, zone) {
  const cands = zoneCandidates(zone);
  for (const c of cands) {
    const re = new RegExp("(?<![A-Za-zÀ-ÿ0-9])" + escRe(c) + "(?![A-Za-zÀ-ÿ0-9])[^%.;]{0,90}?(\\d{1,3})\\s*%", "g");
    const heads = [];
    let h;
    const reHead = /(?:zones?|secteurs?)\s+emprise au sol|emprise au sol[^.]{0,120}tableau/gi;
    while ((h = reHead.exec(text))) heads.push(h.index);
    const hits = [];
    let m;
    while ((m = re.exec(text))) {
      if (heads.some((x) => m.index > x && m.index - x < 700)) {
        hits.push({ pct: parseFloat(m[1]), idx: m.index, cite: text.slice(Math.max(0, m.index - 40), m.index + 90) });
      }
    }
    if (hits.length) {
      const valeurs = [...new Set(hits.map((x) => x.pct))];
      if (valeurs.length === 1) return { pct: valeurs[0], portee: "secteur", citation: "…" + hits[0].cite + "…", page: pageAt(starts, hits[0].idx) };
      return { pct: null, ambigu: true, valeurs, portee: "secteur", citation: "…" + hits[0].cite + "…", page: pageAt(starts, hits[0].idx) };
    }
  }
  return null;
}

// Hauteur : hauteur à l'égout et/ou totale/faîtage, ou gabarit R+n, dans la partie de la zone.
function regleHauteur(text, starts, range, zone) {
  const segs = segments(text, range, TITRES.hauteur);
  const metres = String.raw`(\d+(?:[.,]\d+)?)\s*m(?:[èe]tres?)?(?![²2a-zA-Z])`;
  const reEg = new RegExp("(?:hauteur\\s+(?:[àa]\\s+)?l?.?[ée]gout|[ée]gout\\s+du\\s+toit)[^.;]{0,70}?" + metres, "i");
  const reTot = new RegExp("(?:hauteur\\s+(?:totale|maximale|absolue)|fa[iî]tage)[^.;]{0,70}?" + metres, "i");
  const reR = /R\s*\+\s*(\d+)/i;
  for (const seg of segs) {
    const fen = text.slice(seg.from, seg.from + 2600);
    const piece = pieceForZone(fen, zone);
    if (!piece) continue;
    // Limite la partie au secteur pour ne pas lire la règle du secteur suivant.
    const coupe = piece.texte.search(EXCEPTIONS);
    const t = (coupe > 40 ? piece.texte.slice(0, coupe) : piece.texte)
      .replace(/[^.;]*(?:cl[ôo]ture|annexe|mur\s+bahut|muret)[^.;]*[.;]/gi, (x) => " ".repeat(x.length));
    const eg = t.match(reEg), tot = t.match(reTot), r = t.match(reR);
    if (!eg && !tot && !r) continue;
    const parts = [];
    if (eg) parts.push("égout " + eg[1].replace(",", ".") + " m");
    if (tot) parts.push("total " + tot[1].replace(",", ".") + " m");
    if (r) parts.push("R+" + r[1]);
    const idx = Math.min(...[eg, tot, r].filter(Boolean).map((x) => x.index));
    return {
      txt: parts.join(" / "),
      egout_m: eg ? parseFloat(eg[1].replace(",", ".")) : null,
      total_m: tot ? parseFloat(tot[1].replace(",", ".")) : null,
      r_plus: r ? parseInt(r[1], 10) : null,
      portee: piece.portee,
      citation: extraitAutour(t, idx, 280),
      page: pageAt(starts, seg.from + piece.offset + idx),
    };
  }
  return null;
}

function regleStationnement(text, starts, range) {
  const re = /(?:(?:\d+(?:[.,]\d+)?|une?)\s+(?:place|aire|emplacement)s?(?:\s+de\s+stationnement)?\s+(?:par|pour)\s+(?:chaque\s+)?(?:logement|tranche|\d+\s*m))/i;
  const t = text.slice(range.start, range.end);
  const m = t.match(re);
  if (!m) return null;
  return { citation: extraitAutour(t, m.index, 240), page: pageAt(starts, range.start + m.index) };
}

function reglePleineTerre(text, starts, range, zone) {
  const t = text.slice(range.start, range.end);
  // Tableau par code : « UDa 30% UDb 40% » sous un titre d'espaces verts.
  for (const c of zoneCandidates(zone)) {
    const reCode = new RegExp("(?:pleine\\s+terre|espaces?\\s+verts?)[^.]{0,200}?(?<![A-Za-zÀ-ÿ0-9])" + escRe(c) + "\\s+(\\d{1,3})\\s*%", "i");
    const mc = t.match(reCode);
    if (mc) return { pct: parseFloat(mc[1]), citation: extraitAutour(t, mc.index, 240), page: pageAt(starts, range.start + mc.index) };
  }
  // Pas de « % » intermédiaire : « limitée à 70 %…, 30 % en pleine terre » doit donner 30.
  const reA = /(\d{1,3})\s*%(?:(?!%)[^.;]){0,70}?(?:pleine\s+terre|espaces?\s+verts?|non\s+imperm[ée]abilis)/i;
  const reB = /(?:pleine\s+terre|espaces?\s+verts?)[^.;]{0,60}?(?:minimum|au moins|d.au moins)\s+(?:de\s+)?(\d{1,3})\s*%/i;
  const m = t.match(reA) || t.match(reB);
  if (!m) return null;
  // Tableau à plusieurs colonnes de % : lecture non fiable sans le code de zone.
  if ((t.slice(Math.max(0, m.index - 60), m.index + 60).match(/%/g) || []).length > 2) return null;
  return { pct: parseFloat(m[1]), citation: extraitAutour(t, m.index, 240), page: pageAt(starts, range.start + m.index) };
}

export function parseZoneRules(pages, zone) {
  const { text, starts } = joinPages(pages);
  const range = chapterRange(text, zone);
  const scope = range || { start: 0, end: text.length, code: null };
  const empriseSeg = range ? regleEmprise(text, starts, scope, zone) : null;
  const emprise = (empriseSeg && (empriseSeg.pct != null || empriseSeg.non_reglemente)) ? empriseSeg
    : (regleEmpriseTableau(text, starts, zone) || empriseSeg);
  return {
    chapitre: range ? range.code : null,
    emprise,
    hauteur: range ? regleHauteur(text, starts, scope, zone) : null,
    recul_voie: range ? regleRecul(text, starts, scope, zone, TITRES.voie) : null,
    recul_limites: range ? regleRecul(text, starts, scope, zone, TITRES.limites) : null,
    entre_batiments: range ? regleRecul(text, starts, scope, zone, TITRES.entre) : null,
    stationnement: range ? regleStationnement(text, starts, scope) : null,
    pleine_terre: range ? reglePleineTerre(text, starts, scope, zone) : null,
  };
}
