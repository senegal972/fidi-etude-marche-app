# ADR — Architecture Decision Records

Trace écrite des décisions structurantes. Un fichier par décision, jamais réécrit — on ajoute des ADRs qui « supersede » les précédents plutôt que d'éditer l'historique.

## Format

`NNNN-<slug-kebab>.md` où `NNNN` est un compteur incrémental à 4 chiffres.

```markdown
# ADR NNNN — <titre court>

**Statut** : Proposed | Accepted | Superseded by ADR-NNNN | Deprecated
**Date** : YYYY-MM-DD
**Auteur** : <nom / session Claude>

## Contexte

Le problème posé, contraint par quoi.

## Décision

Ce qu'on choisit, en une phrase.

## Justification

Pourquoi ce choix bat les alternatives raisonnables. Nommer 2-3 alternatives évaluées.

## Conséquences

Ce qui devient plus facile, plus difficile, ou impossible à cause de cette décision.

## Références

- Fichiers modifiés / concernés
- PR / issue liée
- Documentation externe si pertinent
```

## Quand écrire un ADR

- Choix de librairie qui structure le projet (Netlify Functions vs. serveur classique, puppeteer vs. autre PDF, etc.).
- Contrat d'API interne stable (format d'échange entre `avis-valeur.js` et Netlify Functions).
- Décision produit qui contraint le code (« pas de valeur unique, seulement des fourchettes »).
- Trade-off performance vs. lisibilité qu'on prend consciemment.

## Quand ne PAS écrire un ADR

- Choix trivial (nommage de variable, style de code).
- Correction de bug — pas une décision, une réaction.
- Refactor qui ne change rien de visible côté produit.
