# Handoff — Installation de l'ossature mémoire

**Date** : 2026-09-27
**Session** : https://claude.ai/code/session_01LLp1zSoCbr6RiBeHxQ8VRC
**Branche** : `claude/memory-architecture`

## Où on s'est arrêté

Franck a exprimé le besoin d'une architecture mémoire persistante pour ne plus redemander sans cesse les mêmes choses à Claude Code sur ses projets. Installation faite sur `fidi-etude-marche-app` — c'est le pilote, à répliquer ensuite sur les autres projets (analyse-capacite, futurs projets).

## Ce qui est fait

- **`PRODUCT.md`** créé à la racine — vérité produit (users = pros FIDI, purpose = avis de valeur en fourchette, positioning = aide à la décision, capacités et contraintes, 5 principes produit dont la sanctuarisation de la fixture Marigot AX 7).
- **`CONTEXT.md`** créé à la racine — glossaire complet du projet (avis de valeur, SHON/SHOB, 3 méthodes, territoires DVF vs. hors DVF, composants techniques, fixture de non-régression).
- **`.claude/memory/MEMORY.md`** créé — journal de travail 4 sections (Décisions actives, Learnings, TODO, Handoffs) avec convention de mise à jour et de purge.
- **`docs/handoffs/README.md`** créé — convention pour les notes de fin de session.
- **`docs/handoffs/2026-09-27-memory-architecture-init.md`** — ce fichier.
- **`docs/adr/`** créé (dossier vide, prêt pour les ADR).

## Ce qui reste

- **Répliquer l'ossature sur `analyse-capacite`** : `PRODUCT.md` existe déjà (via PR #2, `claude/impeccable-init`), mais il manque `CONTEXT.md`, `.claude/memory/MEMORY.md`, `docs/handoffs/`.
- **Ajouter une section dans `CLAUDE.md`** du repo qui pointe vers cette ossature — pour que tout agent qui ouvre le repo la charge automatiquement.
- **Confirmer les barèmes fiscaux territoriaux** (Saint-Barth, Saint-Martin, Mayotte) — actuellement marqués comme hypothèses dans METHODOLOGIE.md et référencés comme TODO dans MEMORY.md.

## Contexte non-évident

- **Le repo n'a PAS de framework SPA** — `index.html` est monolithique (~438 KB) + JS vanilla. Ne pas proposer React/Vue/Svelte sans discussion préalable.
- **Puppeteer via `@sparticuz/chromium`** — c'est un binary Chrome spécial optimisé pour Netlify Functions. Pas de remplacement par un puppeteer standard.
- **La fixture Marigot AX 7** est le test canonique — 4,70 / 5,30 / 6,00 M€ tolérance ±1 000 €. Tout refacto du moteur `_avis_calcul.mjs` doit passer `npm run test:marigot`.
- **Doublure moteur** : `_avis_calcul.mjs` (module ESM côté serveur) ET `window.FidiAvisCalcV2` (côté navigateur). Les deux doivent rester synchrones.

## Prochaine action recommandée

1. Ouvrir la PR sur `claude/memory-architecture` et la merger.
2. Répliquer la même ossature sur `analyse-capacite` (au moins `CONTEXT.md` + `.claude/memory/MEMORY.md`).
3. En début de prochaine session sur ce repo, lire ce handoff en premier + `MEMORY.md`.
