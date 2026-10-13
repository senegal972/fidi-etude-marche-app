# Handoffs

Notes de fin de session Claude Code. Chaque fichier est un état des lieux pour l'agent suivant (ou pour toi dans 3 semaines).

## Format d'un handoff

`YYYY-MM-DD-<slug-kebab>.md`

Structure :

```markdown
# Handoff — <titre court>

**Date** : YYYY-MM-DD
**Session** : <lien claude.ai/code/session_… si disponible>
**Branche** : <nom de branche git>

## Où on s'est arrêté

Une à trois phrases : dernier point traité, dernier commit, état de la PR.

## Ce qui est fait

- Fait 1
- Fait 2

## Ce qui reste

- Reste 1 (avec fichiers/lignes concernés si applicable)
- Reste 2

## Contexte non-évident

Choses que le prochain agent ne devinera pas en lisant le code seul :
- Décisions prises qui contredisent l'apparence du code
- Fausses pistes déjà explorées et pourquoi elles ne marchent pas
- Dépendances externes en attente (ex: réponse d'un fournisseur, décision produit)

## Prochaine action recommandée

Une ligne concrète : « lancer `<commande>` », « ouvrir `<fichier>` », « poser telle question à Franck ».
```

## Comment générer un handoff sans écrire à la main

Skill mattpocock : `/handoff` — compacte la conversation courante en note structurée dans ce dossier. Utilise-le en fin de session significative.

## Comment consommer un handoff

En début de session, le premier réflexe : lire le handoff le plus récent dans ce dossier. `ls -t docs/handoffs/` liste par date décroissante.
