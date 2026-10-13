# Contexte — Vocabulaire partagé (ubiquitous language)

Glossaire de projet pour FIDI · Étude de Marché Immobilier. **Toute conversation, code, commit ou doc doit utiliser ces termes exacts** — c'est ce qui permet à un agent IA de comprendre en 20 tokens ce qui prendrait 200 mots avec un vocabulaire flou.

Mis à jour au fil des sessions (voir `.claude/memory/MEMORY.md`).

---

## Concepts métier

| Terme | Définition |
|---|---|
| **Avis de valeur** | Estimation professionnelle non-officielle produite par l'outil. Toujours sous forme de fourchette bas/central/haut. Ni expertise judiciaire, ni acte notarié. |
| **Fourchette** | Triplet `{ bas, central, haut }`. Chaque méthode produit sa fourchette ; la synthèse est une moyenne pondérée séparée sur chaque borne. |
| **Synthèse** | Résultat final : moyenne pondérée des 3 méthodes, calculée indépendamment sur bas / central / haut. Pondération par défaut **40 / 20 / 40** (comparaison / sol+construction / capitalisation). |
| **Arrondi commercial** | Au **50 000 €** au-dessus de 1 M€, au **1 000 €** en dessous. Appliqué uniquement à la synthèse et au net vendeur, jamais aux calculs intermédiaires. |

## Les 3 méthodes

| Méthode | Base | Sortie |
|---|---|---|
| **Comparaison** | SHON autorisée (sinon surface habitable) × €/m² comparables | P25 / médiane / P75 des comparables « inclus » après ajustements |
| **Sol + construction** | Charge foncière + bâti déprécié, × prime de rareté | Fourchette dépendant de la vétusté et de la prime territoriale |
| **Capitalisation multi-lots** | Revenu net / taux de capitalisation | Bas = taux haut, Haut = taux bas ; rendement affiché aux 2 prix |

## Surfaces

| Terme | Définition |
|---|---|
| **SHON** | Surface Hors Œuvre Nette — surface de plancher utilisée pour la comparaison et le calcul du coût de construction. |
| **SHOB** | Surface Hors Œuvre Brute — SHON + annexes non habitables. Différentiel `SHOB − SHON` = surface d'annexes. |
| **Contenance** | Surface totale du terrain (unité : m²). Base de la charge foncière. |

## Coûts et paramètres

| Terme | Définition |
|---|---|
| **Charge foncière** | Valeur du terrain nu = médiane des €/m² terrain des comparables × contenance, ou saisie manuelle en total €. |
| **Bâti neuf** | Coût de reconstruction à neuf = SHON × coût SHON + (SHOB − SHON) × coût annexes + forfaits (piscine / VRD / aménagements). |
| **Bâti déprécié** | Bâti neuf × (1 − vétusté). |
| **Vétusté** | Coefficient [0..1] issu de la grille d'état du bâtiment ou saisi directement. |
| **Prime de rareté** | Multiplicateur territorial appliqué à `(charge foncière + bâti déprécié)`. Forte à Saint-Barth et Saint-Martin, faible en métropole. |
| **Marge de négociation** | Écart entre net vendeur et valeur centrale visée. Défaut **8,5 %**. |
| **Taux de capitalisation** | Diviseur du revenu net pour la méthode 3. Bas → valeur basse, Haut → valeur haute. |
| **Rendement brut** | Revenu brut / prix. Affiché au prix des annonces et à la valeur retenue. |

## Lots (méthode capitalisation)

Chaque lot est `{ libelle, nombre, mode, loyerMensuel, semaines, prixSemaine }`.

| Mode | Revenu |
|---|---|
| **annuel** | `loyerMensuel × 12 × nombre` |
| **saisonnier** | `semaines × prixSemaine × nombre` |

## Charges (méthode capitalisation)

`charges = gestionSaisonnière% × revenuSaisonnier + vacance% × revenuAnnuel + forfait€/an`

## Stratégie de prix

| Terme | Formule / défaut |
|---|---|
| **Net vendeur** | Central × (1 + marge de négociation), arrondi 50 k€ |
| **Objectif de signature** | Central (valeur de la synthèse) |
| **Plancher** | Bas |
| **FAI** | Frais d'Agence Inclus = net vendeur + honoraires |
| **Droits de mutation** | Base = net vendeur si honoraires charge acquéreur, sinon FAI |
| **Émoluments notaire** | Barème réglementaire national |
| **TVA sur honoraires** | Selon territoire (0 % Saint-Barth, standard métropole/DOM classiques) |

## Territoires

| Zone | Code INSEE | Traitement |
|---|---|---|
| Métropole | 01-95 | DVF standard + BDNB + BAN + Géorisques |
| Guadeloupe | 971 | Idem métropole avec ajustements DOM |
| Martinique | 972 | Idem, terrain principal Sextant Martinique |
| Guyane | 973 | Idem |
| La Réunion | 974 | Idem |
| **Mayotte** | 976 | **Hors DVF** — bascule veille annonces + saisie manuelle |
| **Saint-Barthélemy** | 977 | **Hors DVF** — barèmes fiscaux spécifiques (pas de TVA ni taxe foncière pour résidents fiscaux) |
| **Saint-Martin** | 978 | **Hors DVF** — idem, prime de rareté forte |

## Sources de données publiques

| Sigle | Source | Ce qu'on y prend |
|---|---|---|
| **DVF** | data.gouv.fr | Ventes réelles (base des comparables métropole+DOM classiques) |
| **BDNB** | Base de Données Nationale des Bâtiments | Année de construction, surfaces bâties, DPE |
| **BAN** | Base Adresse Nationale | Géocodage, coordonnées, canonisation d'adresse |
| **Géorisques** | georisques.gouv.fr | Risques naturels et technologiques (inondation, sismique, industriel) |

## Composants techniques

| Composant | Rôle |
|---|---|
| **`_avis_calcul.mjs`** / **`window.FidiAvisCalcV2`** | Moteur de calcul canonique. Miroir client-side et side-server. Toute modif doit passer la fixture Marigot AX 7. |
| **`avis-valeur.js`** | Frontend principal de l'avis de valeur (SPA vanilla). |
| **`avis-methodes.js`** | Rendu et logique des 3 méthodes. |
| **`rapport-a4.js`** | Génération PDF A4 via puppeteer-core + @sparticuz/chromium. |
| **`guard-exit.js`** | Warn-before-leave sur données non sauvegardées. |
| **`netlify/functions/`** | Serverless functions (data.gouv fetch, PDF render, blob storage). |
| **`extension/`** | Extension navigateur pour capture d'annonces (SeLoger, LeBonCoin, etc.). |
| **`@netlify/blobs`** | Storage temporaire des états de session. |

## Fixture de non-régression

**Marigot AX 7** — Saint-Barthélemy. Résultat attendu **4,70 / 5,30 / 6,00 M€** avec tolérance **±1 000 €**. Test dans `tests/avis-marigot.test.mjs`. Toute modification du moteur qui casse cette fixture bloque le merge.

---

## Comment évoluer ce document

- Nouveau terme métier → l'ajouter ici **avant** de l'utiliser en code ou en commit.
- Changement de sémantique → mise à jour ici + ADR dans `docs/adr/`.
- Ce fichier est lu par tout agent Claude Code qui ouvre le repo — le tenir concis et sourcé.
