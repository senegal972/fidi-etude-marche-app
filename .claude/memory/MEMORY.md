# MEMORY — Mémoire de travail

Journal chronologique du projet. **Chaque agent Claude Code qui ouvre le repo lit ce fichier** pour retrouver où on en est sans que tu aies à ré-expliquer.

Structure : 4 sections, ordre inverse chronologique (le plus récent en tête). Ajoute une entrée quand tu prends une décision, quand tu apprends quelque chose de non trivial, ou en fin de session significative (`/handoff` de mattpocock-skills fait ça automatiquement).

---

## Décisions actives

Décisions structurantes en cours d'application. Chaque décision majeure a idéalement aussi un ADR dans `docs/adr/`.

- **2026-09-27** — Ossature mémoire installée : `PRODUCT.md` (vérité produit), `CONTEXT.md` (vocabulaire), `.claude/memory/MEMORY.md` (ce fichier), `docs/handoffs/`, `docs/adr/`. À tenir à jour à chaque session significative.

## Learnings

Découvertes qui ont coûté du temps et qu'il ne faut pas re-payer.

- **Fixture Marigot AX 7 (Saint-Barth)** — Résultat de non-régression **4,70 / 5,30 / 6,00 M€** tolérance ±1 000 €. Toute modif du moteur `_avis_calcul.mjs` doit passer ce test. Ne pas casser cette fixture pour un « refacto propre ».
- **Territoires hors DVF** (976, 977, 978) — DVF ne couvre PAS Mayotte / Saint-Barth / Saint-Martin. Chemin dédié : veille d'annonces + saisie manuelle + barèmes locaux. À ne pas traiter comme un cas dégradé.
- **JSX dans Netlify Functions** — impose `[functions] node_bundler = "esbuild"` dans `netlify.toml`. Sans ça, Netlify refuse.

## TODO

À faire, dans un ordre approximatif. Le premier `[ ]` de la liste est le prochain candidat.

- [ ] Confirmer les barèmes fiscaux territoriaux (Saint-Barth, Saint-Martin, Mayotte) — actuellement documentés comme hypothèses dans METHODOLOGIE.md.
- [ ] Ajouter un mécanisme d'auth sur l'app si un jour ouverture à des tiers externes à FIDI.
- [ ] Documenter précisément le format des annonces capturées par l'extension navigateur (structure, champs obligatoires).

## Handoffs

Notes de fin de session. Chaque handoff est aussi un fichier daté dans `docs/handoffs/YYYY-MM-DD-<slug>.md` — cette section n'en garde que l'index.

- 2026-09-27 — Installation de l'ossature mémoire → `docs/handoffs/2026-09-27-memory-architecture-init.md`

---

## Convention de mise à jour

**Format d'une entrée** :

```
- **YYYY-MM-DD** — Titre court. Contexte en une phrase. Ce qui a changé. Ce que ça implique pour la suite.
```

**Quand ajouter** :
- Décision structurante (choix de lib, refactor important, changement de contrat d'API) → **Décisions actives** + ADR dans `docs/adr/`.
- Découverte non-évidente qui a coûté du temps → **Learnings**.
- Nouvelle tâche à ne pas oublier → **TODO** (avec `[ ]`, coche quand fait).
- Fin de session significative → un fichier dans `docs/handoffs/` + une ligne d'index dans **Handoffs**.

**Quand purger** :
- Décisions actives qui deviennent tacitement acceptées et n'ont plus de trade-off ouvert → déplacer vers ADR.
- Learnings intégrés dans `CONTEXT.md` ou `PRODUCT.md` → supprimer d'ici.
- TODO faits depuis > 3 mois → supprimer.

Objectif : ce fichier tient sur un écran ou deux. Au-delà, il ne sert plus de mémoire de travail — c'est de l'archive à ranger dans les ADR.
