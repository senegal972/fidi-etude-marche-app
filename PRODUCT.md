# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Professionnels de l'immobilier de FIDI Conseil / Sextant France Immobilier (agents, conseillers, gérants d'agence) qui doivent produire un **avis de valeur** défendable pour un bien identifié par une adresse. Utilisé lors d'un rendez-vous d'estimation, en préparation d'un mandat, ou pour arbitrer une stratégie de prix. Non destiné à l'acquéreur final ni au grand public.

## Product Purpose

**FIDI · Étude de Marché Immobilier.** À partir d'une adresse française (métropole + DOM incluant les territoires hors DVF), l'outil produit une **fourchette de valeur bas / central / haut** en combinant trois méthodes indépendantes (Comparaison DVF+annonces, Sol+construction, Capitalisation multi-lots) et une **synthèse pondérée**. Il enrichit automatiquement l'analyse avec les données publiques disponibles (DVF pour les ventes, BDNB pour le bâti, BAN pour l'adressage, Géorisques pour les risques). Le succès se mesure à la vitesse à laquelle un pro passe d'une adresse froide à un avis chiffré défendable, et à la précision de la fourchette confrontée au prix réel de signature ex-post.

## Positioning

Ce n'est ni un simulateur grand public, ni un moteur d'estimation automatique de type Meilleurs Agents. C'est un **outil d'aide à la décision pour pro** qui expose **explicitement les hypothèses et les fourchettes** — jamais une valeur unique — et laisse le pro ajuster chaque paramètre (pondération des méthodes, coûts locaux, prime de rareté territoriale, marge de négociation). Le différenciateur : couverture native des **territoires hors DVF** (Saint-Barthélemy 977, Saint-Martin 978, Mayotte 976) où l'analyse bascule sur veille d'annonces + saisie manuelle, avec barèmes fiscaux territoriaux spécifiques.

## Operating Context

- **Cible géographique** : France entière, avec un accent DOM (Martinique, Guadeloupe, La Réunion, Guyane, Mayotte, Saint-Barthélemy, Saint-Martin). Les territoires 976/977/978 ont leur propre chemin faute de couverture DVF.
- **Sources de données publiques** : DVF (Demandes de Valeurs Foncières data.gouv.fr), BDNB (Base de Données Nationale des Bâtiments), BAN (Base Adresse Nationale), Géorisques.
- **Sortie** : rapport PDF A4 (via `rapport-a4.js` + `puppeteer-core` + `@sparticuz/chromium` côté Netlify Function). Extension navigateur pour capture d'annonces.
- **Déploiement** : Netlify. SPA statique (`index.html` monolithe) + Netlify Functions dans `netlify/`. Storage temporaire via `@netlify/blobs`.
- **Rituel** : le pro ouvre l'app avec une adresse, l'outil pré-remplit les données publiques, il ajuste les comparables et les pondérations, exporte le PDF, l'envoie au vendeur.
- **Test de non-régression canonique** : « Marigot AX 7 » (Saint-Barthélemy), synthèse attendue **4,70 / 5,30 / 6,00 M€** avec tolérance ±1 000 €.

## Capabilities and Constraints

**Capacités confirmées :**
- **Méthode 1 — Comparaison** : base SHON autorisée sinon surface habitable ; €/m² = P25 / médiane / P75 des comparables ajustés ; abattement configurable pour les prix affichés vs. DVF réels.
- **Méthode 2 — Sol + construction** : bâti neuf = SHON×coût + (SHOB−SHON)×annexes + forfait ; bâti déprécié via grille de vétusté ; charge foncière = médiane €/m² terrain × contenance ; **prime de rareté territoriale** (forte à Saint-Barth/Saint-Martin, faible en métropole).
- **Méthode 3 — Capitalisation multi-lots** : chaque lot en mode `annuel` ou `saisonnier` ; revenu brut − charges (gestion, vacance, forfait) = revenu net ; valeur = net / taux de cap ; rendement affiché au prix annonces et à la valeur retenue.
- **Synthèse** : moyenne pondérée séparée pour bas / central / haut ; pondération par défaut **40 / 20 / 40** modifiable ; arrondi commercial 50 k€ au-dessus de 1 M€, 1 k€ en dessous.
- **Stratégie de prix** : net vendeur = central × (1 + marge de nég 8,5 % par défaut) ; coût acquéreur complet (honoraires + TVA territoriale + droits de mutation + émoluments notaire).
- **Rapport PDF A4** exportable, extension navigateur pour capturer les annonces.

**Contraintes techniques :**
- Node.js **≥ 18** ; ESM (`"type": "module"`).
- Netlify Functions avec `@sparticuz/chromium` + `puppeteer-core` — headless Chrome dans un binary optimisé pour Netlify runtime.
- Pas de framework SPA : `index.html` monolithique (~438 KB) + JS vanilla (`avis-valeur.js`, `avis-methodes.js`, `rapport-a4.js`).
- `_avis_calcul.mjs` + son miroir `window.FidiAvisCalcV2` — **toute modification du moteur doit préserver le résultat Marigot AX 7**.
- Storage éphémère via `@netlify/blobs` (pas de base persistante).

**Terminologie interne** : *avis de valeur*, *SHON* (Surface Hors Œuvre Nette), *SHOB* (Surface Hors Œuvre Brute), *vétusté*, *charge foncière*, *prime de rareté*, *marge de négociation*, *net vendeur*, *FAI* (Frais d'Agence Inclus), *droits de mutation*, *émoluments notaire*, *lots annuels / saisonniers*, *taux de capitalisation*, *rendement brut*.

**Non-décidé, à ne pas fabriquer** :
- Barèmes territoriaux exacts hors DVF (Saint-Barth, Saint-Martin, Mayotte) sont marqués comme hypothèses à confirmer dans METHODOLOGIE.md.
- Pas de signature électronique du rapport intégrée.
- Pas d'authentification (l'app tourne en accès direct).

## Brand Commitments

- Publisher : **FIDI Conseil**. Position revendiquée : « aide à la décision — ni notaire, ni expert ». Tous les défauts (coûts, primes, taux, barèmes) sont **hypothèses à valider par le professionnel**.
- Rapports PDF A4 typographiés (`rapport-a4.js`) — style pro sobre, pas de vaporware.
- Direction esthétique : minimalisme utilitaire, densité de données assumée.

## Evidence on Hand

- **Fixture Marigot AX 7** (Saint-Barthélemy) : résultat attendu **4,70 / 5,30 / 6,00 M€** — référence de non-régression concrète.
- **METHODOLOGIE.md** publique dans le repo — décrit les 3 méthodes et le mécanisme de synthèse.
- **Extension navigateur** dans `extension/` pour capturer les annonces (SeLoger, LeBonCoin, etc.).
- **Tests automatisés** dans `tests/` (`node --test`) : `functions.test.mjs`, `annonces.test.mjs`, `avis-marigot.test.mjs`.
- **Absent, à ne pas fabriquer** : témoignages clients, retours d'usage terrain quantifiés, benchmark de précision vs. prix de signature réels.

## Product Principles

1. **Fourchette, pas valeur unique.** Toute sortie qui exhibe un seul chiffre régresse — le pro doit toujours voir bas/central/haut.
2. **Hypothèses lisibles, ajustables, jamais cachées.** Coûts, primes, taux et barèmes sont éditables et documentés dans METHODOLOGIE.md.
3. **Territoires hors DVF sont des citoyens de première classe.** Saint-Barth / Saint-Martin / Mayotte ne sont pas des cas dégradés d'une app métropolitaine ; leur chemin (annonces + saisie manuelle + barèmes locaux) est natif.
4. **Le moteur de calcul est sacré.** `_avis_calcul.mjs` + `window.FidiAvisCalcV2` : toute modif doit garder la fixture Marigot AX 7. La régression sur ce test bloque le merge.
5. **Aide à la décision, pas décision.** L'outil ne prononce pas de valeur ferme — il donne au pro les cartes pour la justifier.
