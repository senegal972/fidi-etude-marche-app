# Méthodologie — Avis de valeur v2 (fourchette bas / central / haut)

> Document d'aide à la décision. Ni notaire ni expert. Toutes les valeurs par défaut (coûts, primes,
> taux, barèmes territoriaux) sont des **hypothèses à valider** par le professionnel.

Chaque méthode produit une **fourchette** (bas / central / haut), et non une valeur unique. La synthèse
est une moyenne pondérée calculée **séparément** sur chacune des trois bornes.

## 1. Comparaison
- Base : **SHON autorisée** si elle est renseignée (onglet Cadastre), sinon la surface habitable.
- €/m² bas / central / haut = **P25 / médiane / P75** des comparables « inclus » (après ajustements),
  ou saisie manuelle.
- Les annonces relevées en ligne sont des **prix affichés** (≠ prix de vente réalisés DVF) : elles
  servent d'ordre de grandeur et peuvent faire l'objet d'un **abattement** via l'ajustement de chaque
  comparable (ex. −5 à −12 % pour tenir compte de la marge de négociation).

## 2. Sol + construction
- Bâti neuf = `SHON × coût SHON + (SHOB − SHON) × coût annexes + forfait` (piscine / VRD / aménagements).
- Bâti déprécié = bâti neuf × (1 − vétusté). La vétusté vient de la grille d'état ou d'une saisie directe.
- Charge foncière (totaux €) = médiane des €/m² **terrain** des comparables × contenance, ou saisie manuelle.
- Valeur = **(charge foncière + bâti déprécié) × (1 + prime de rareté)**. La prime de rareté (bas/central/haut)
  dépend du **profil du territoire** (forte pour Saint-Barthélemy et Saint-Martin, faible en métropole).

## 3. Capitalisation multi-lots
- `data.lots[]` = `{ libelle, nombre, mode: 'annuel' | 'saisonnier', loyerMensuel, semaines, prixSemaine }`.
  Migration : un ancien loyer unique devient un lot « annuel » unique.
- Revenu brut = loyers annuels (mensuel × 12) + revenus saisonniers (semaines × prix/semaine).
- Charges = `gestion saisonnière % × revenu saisonnier + vacance % × revenu annuel + forfait charges (€/an)`.
- Revenu net = revenu brut − charges.
- Valeur = **revenu net / taux de capitalisation**. Taux bas → valeur basse ; taux haut → valeur haute.
- On affiche aussi le **rendement brut** au prix affiché des annonces et à la valeur retenue.

## 4. Synthèse
- Moyenne pondérée séparée pour bas, central et haut. Pondérations éditables ; défaut **40 / 20 / 40**
  (comparaison / sol+construction / capitalisation) quand les trois méthodes sont actives.
- Arrondi commercial : au **50 000 €** au-dessus de 1 M€, au **1 000 €** en dessous.

## Stratégie de prix & coût acquéreur
- Prix de présentation net vendeur = central × (1 + **marge de négociation**, 8,5 % par défaut), arrondi 50 000 €.
- Objectif de signature = central ; plancher = bas.
- Coût global acquéreur : net vendeur, honoraires (%, charge acquéreur ou vendeur), **TVA sur honoraires
  selon le territoire**, prix FAI, droits de mutation (base = net vendeur si honoraires acquéreur), émoluments
  notaire, coût total.

## Territoires hors DVF
DVF ne couvre pas Saint-Barthélemy (977), Saint-Martin (978) ni Mayotte (976). Sur ces territoires,
l'analyse s'appuie sur la **veille d'annonces** et la saisie manuelle plutôt que sur les ventes DVF ;
les barèmes fiscaux sont spécifiques (par ex. pas de TVA ni de taxe foncière pour les résidents fiscaux
de la Collectivité de Saint-Barthélemy). Ces paramètres restent **à confirmer**.

## Fixture de non-régression — « Marigot AX 7 » (Saint-Barthélemy)
Entrées et résultats attendus dans `tests/avis-marigot.test.mjs` : synthèse **4,70 / 5,30 / 6,00 M€**
(tolérance 1 000 €). Toute modification du moteur (`_avis_calcul.mjs` et son miroir `window.FidiAvisCalcV2`)
doit conserver ce résultat.
