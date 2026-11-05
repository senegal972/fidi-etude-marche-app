# Débit de crédit du PDF serveur — note de conception

État : **implémenté le 2026-11-04 (version 1.6.3), à vérifier en conditions réelles avant de poser `PAYWALL_ENABLED=true`.** Choix retenus : les propositions D1 à D5 du § 6. Base « Éditions FIDI » créée (`4edc84d5778f48608935e5e7cdfc43be`, valeur par défaut de `DB.editions`). Le filtrage réseau de Chromium (Lot 2) a été livré par la session voisine.

**Avant d'activer le péage, sur un contexte hors production :**

1. **Donner à l'intégration Notion de la production l'accès à « Éditions FIDI ».** Non vérifiable depuis le poste : le jeton de `.env.notion` est une autre intégration, qui ne voit pas non plus « Utilisateurs FIDI ». Sans cet accès, tout PDF d'un compte facturable répond 503.
2. Générer un vrai PDF avec un compte de test : débit, ré-édition gratuite, 0 crédit, ligne dans le journal.
3. Mesurer la durée du rendu avec les écritures Notion (5 appels pour un débit, 300 à 660 ms par lecture mesurés depuis le poste, écritures non mesurées) face aux 4 s laissées après l'échéance de rendu de 22 s.
4. Essayer Ctrl+P : la règle CSS est présente dans la page, mais l'aperçu d'impression n'a pas été vu.
5. Ajouter les bases FIDI à `BASES_NOTION` de `sauvegarde-locale.mjs` (projet REA) : ni « Utilisateurs FIDI » ni « Paiements » n'y figurent, et « Éditions FIDI » non plus.

## 1. Conclusion

**Recommandation : débiter dans `pdf-render.mjs`, après un rendu réussi** (option B). Le jeton d'édition et la génération côté serveur ne sont pas retenus.

- Plus aucun PDF serveur sans crédit ou sans droit de ré-édition : l'appel direct à `/api/pdf-render` ne contourne plus rien.
- Un rendu échoué ne débite rien : il n'y a aucun remboursement à gérer.
- Le document lui-même restera copiable : ses données sont dans le navigateur avant tout paiement. Seul un changement du modèle commercial fermerait ce point (§ 5).

**Corriger d'abord les fuites sans technique.** Elles coûtent plus que l'appel direct à l'API, car un utilisateur ordinaire y passe sans le vouloir (§ 2.1). Le plafond déjà en place côté serveur limite l'enjeu : 1 crédit minimum pour 5 analyses d'étude (§ 2.3).

## 2. Constats dans le code

### 2.1 Sans aucune technique (bouton ou raccourci)

| Chemin | Effet | Où |
|---|---|---|
| **Partager un avis** | Le PDF est généré sans débit : `doPartager` n'appelle pas `consume`, contrairement à `partagerEtude` | `avis-valeur.js:3979`, `index.html:6190` |
| **Ctrl+P sur l'écran de l'étude** | Le `@media print` imprime `#results-panel` sans débit | `index.html:195` |
| **Plusieurs études, même jour, même commune, même destinataire** | La réf vaut jour + destinataire + code INSEE, sans adresse ni parcelle. Seule la première est facturée si elles s'enchaînent | `index.html:1789`, `consume.mjs:31` |
| **Secours « Imprimer » de la fenêtre de partage** | Pour l'avis, `fidiPrintExact` imprime sans aucun débit (pour l'étude, le débit a déjà eu lieu à l'ouverture de la fenêtre) | `index.html:6228` |
| **Facturer & envoyer** | L'étude ou l'avis est converti en PDF (html2pdf) et hébergé, sans débit | `index.html:5654`, `5908` |
| **PDF du module d'implantation, récapitulatif** | Fenêtre séparée avec `window.print`, sans débit | `index.html:5219`, `5288` |

Deux défauts jouent en sens inverse, contre le client :

- `Dernière réf éditée` ne garde qu'une réf. Éditer A, puis B, puis A facture A deux fois.
- La réf d'étude contient le jour. Ré-éditer le lendemain coûte un crédit, alors que le code annonce la ré-édition gratuite.

Autre effet de cette réf : elle sert aussi de clé à `notion-save` (`index.html:2301`, recherche par `Référence`). Deux études du même jour, de la même commune et du même destinataire s'écrasent donc dans Notion. Ce point dépasse le péage et mérite une vérification à part.

### 2.2 Avec un peu de technique (console, curl)

- `POST /api/pdf-render` directement, avec n'importe quel HTML : c'est le sujet de départ.
- `FidiRapport.print()` dans la console, ou redéfinition de `Compte.consume`.
- **La réf est choisie par le client et le HTML aussi.** Une fois la réf X payée, tout `consume` avec X est gratuit, quel que soit le contenu rendu. Toute solution garde ce défaut tant que le navigateur fournit le HTML ; on ne peut que le borner (§ 4.3).

### 2.3 Ce qui tient déjà côté serveur

`analyse.mjs:700-711` plafonne les recherches : au-delà du quota (5 par défaut), il faut éditer, donc payer, pour relancer, et à 0 crédit c'est un refus 402. La ré-édition gratuite ne remet pas le compteur à zéro. Pour un usage de l'étude via `/api/analyse`, **même en contournant tout le PDF, le crédit reste dû toutes les 5 analyses**. Le manque à gagner maximal est donc de 1 à 5 sur ce parcours. `Quota recherches` est réglable par compte, et c'est le levier serveur le plus direct.

Ce plancher a deux limites :

- Il ne couvre pas l'avis : `avis-de-valeur.mjs` n'appelle pas `currentUser` et l'avis se compose dans le navigateur.
- Il ne couvre que `/api/analyse` : `transactions.mjs`, `cadastre.mjs` et `notion-get.mjs` ne vérifient aucune session.

## 3. Comparaison

| Critère | A. Jeton signé par `consume` | **B. Débit dans `pdf-render`** | C. Génération serveur depuis la réf |
|---|---|---|---|
| Appel direct à `pdf-render` fermé | Oui | **Oui** | Oui |
| Rendu de contenu arbitraire | Oui, pendant la durée du jeton | Oui, borné par le plafond | Non |
| Rendu échoué | Débit déjà fait : remboursement à gérer côté serveur | **Rien à rembourser** | Rien à rembourser |
| Usage unique | Exige un registre partagé en plus de la signature | Sans objet | Sans objet |
| Ctrl+P, copie de l'écran | Restent possibles | Restent possibles | Restent possibles, sauf si l'écran masque les données |
| Latence ajoutée au rendu | Aucune | Lectures et écritures Notion (à mesurer) | Très élevée |
| Ampleur | Moyenne | **Faible à moyenne** | Très élevée |

**A — pourquoi non.** Le jeton garde deux appels séparés, donc un état intermédiaire « payé, pas rendu ». Un jeton simplement signé se rejoue jusqu'à expiration, et son usage unique demande un registre. Or les Blobs installés (8.2.0) n'offrent pas d'écriture conditionnelle (`main.d.ts` sans `onlyIf`). Son seul avantage est d'éviter Notion pendant le rendu.

**C — pourquoi non.** `rapport-a4.js` n'est pas portable tel quel :

- il lit 8 variables globales (`__fidiData`, `__fidiGpu`, `__fidiTrans`, `__fidiCtx`, `__fidiLoyers`, `__fidiDaafOnf`, `__fidiAleas`, `__extraParcFeatures`) ;
- il clone des blocs de l'écran (`cloneBloc`), dont le contenu vient d'appels faits par le navigateur ;
- il décide des modules avec `getClientRects` (règle « affiché et coché ») ;
- l'avis contient des saisies de l'utilisateur.

Rejouer l'application dans Chromium ne tiendrait pas dans les 26 s de la fonction. Une copie envoyée par le navigateur ne prouverait rien, puisque le client l'écrirait lui-même. Surtout, C ne ferme rien tant que l'écran montre les résultats avant paiement. Sa valeur n'existe qu'avec le changement de modèle du § 5.

## 4. Conception recommandée

### 4.1 Séquence de `pdf-render`

```
POST /api/pdf-render { html, filename, doc: { kind, cle, ref } }

1. Session (chantier voisin, voir § 7)             → 401 sinon
2. Valider doc.kind et doc.cle                     → 400 si péage actif et champ absent
3. Décider, sans écrire :
     péage inactif ou compte illimité              → gratuit
     droit de ré-édition sur (kind, cle)           → gratuit
     crédits < 1                                   → 402 AVANT de lancer Chromium
     sinon                                         → à débiter
4. Rendre le PDF (échec → 500, aucun débit)
5. Si à débiter : relire le solde, puis débiter    → 402 si plus de crédit, 503 si Notion échoue
     aucun PDF n'est rendu au client sans débit réussi
6. Répondre le PDF avec X-Fidi-Facture et X-Fidi-Credits
```

Toute la logique va dans un module `_edition.mjs` (`deciderEdition`, `enregistrerEdition`), utilisé aussi par `consume.mjs`. Les deux portes appliquent alors la même règle : imprimer puis générer le PDF du même document ne coûte qu'un crédit.

`consume` écrit aujourd'hui en deux fois (`setCredits` puis `startNewCycle`). `enregistrerEdition` regroupe solde, compteur et dernière clé dans un seul `updatePage`.

### 4.2 Budget de temps

Le rendu peut déjà dépasser les 26 s de la fonction : 20 s pour `setContent`, puis jusqu'à 8 s pour les images. Il faut lui donner une échéance interne, par exemple 22 s, pour garder le temps du débit. **Les durées réelles de Notion et de Chromium n'ont pas été mesurées** : c'est la première chose à vérifier à l'implémentation.

### 4.3 Gratuité de la ré-édition

Une **clé de document** dédiée à la facturation remplace la réf :

- Étude : empreinte de adresse, type, lat, lon, parcelles et destinataire. On reprend la logique de `etudeKeyOf` (`avis-valeur.js:770`) et on la complète. Le jour disparaît, et une même étude adressée à deux destinataires reste deux documents, comme aujourd'hui.
- Avis : la référence stable existante.
- La réf visible et la clé Notion ne changent pas : les PDF et les enregistrements existants restent intacts.

Les éditions sont notées dans une **nouvelle base Notion « Éditions FIDI »** : utilisateur, kind, clé, réf, date du débit, nombre de rendus. Cela règle le cas A, B, A et fournit l'historique annoncé dans « Mon solde » (`ETUDE-COMPTES-MONETISATION.md`) ainsi qu'un journal pour repérer les abus. `Dernière réf éditée` reste comme accès rapide et comme secours si l'écriture dans le journal échoue.

La clé étant calculée par le navigateur, la gratuité reste forgeable. Lier le droit à une empreinte du HTML ne marche pas : changer une note ou un module change le HTML, et la correction d'une coquille deviendrait payante. On borne donc le droit : **fenêtre de 30 jours et 10 rendus par document** (proposition, voir D1). Un crédit vaut alors au plus 10 PDF, même pour un utilisateur qui triche.

### 4.4 Échecs et remboursement

| Cas | Résultat |
|---|---|
| Rendu échoué ou fonction coupée avant le débit | Aucun débit, le client passe au secours |
| Secours après échec | `exportPdf`, puis `confirmPrint` et `consume` : un seul débit, pour un document obtenu |
| Débit réussi, réponse perdue en route | Nouvel essai gratuit (ré-édition) |
| Échec Notion au débit | 503 sans PDF : on refuse plutôt que de donner gratuitement |
| Débit réussi, journal en échec | PDF rendu ; `Dernière réf éditée` couvre la ré-édition immédiate ; erreur tracée |
| Impression navigateur annulée après `consume` | Pas de remboursement ; ré-impression gratuite grâce à la ré-édition |
| Erreur à corriger à la main | Crédit par l'admin, avec `adminCredit` qui existe déjà |

**Aucune route de remboursement appelable par le navigateur** : il suffirait de débiter, imprimer, puis se faire rembourser pour obtenir tout gratuitement.

**Risque accepté : les requêtes simultanées.** Notion n'a pas d'écriture conditionnelle. Deux rendus parallèles sur des documents différents peuvent passer avec un seul crédit. La relecture à l'étape 5 réduit la fenêtre sans la fermer, et ce cas demande un script délibéré. Le journal le rendrait visible. La fermer exigerait un verrou externe ; à reconsidérer seulement si le journal montre des abus. Une version récente de `@netlify/blobs` pourrait l'offrir, mais je ne l'ai pas vérifié, et la dernière exige Node ≥ 22.12.

### 4.5 Appelants

| Appelant | Changement |
|---|---|
| `genererPdfServeur` (`index.html:1929`) | Retirer `consume`, envoyer `doc`. **402 traité à part** : ouvrir la recharge, ne pas basculer sur le secours d'impression (aujourd'hui tout `!r.ok` y bascule). Mettre à jour la pastille via `X-Fidi-Credits` et `Compte.setCredits` |
| `doExportPdfServer` (`avis-valeur.js:4143`) | Mêmes changements. Le secours `doExportPdf` garde son `consume` |
| `fidiAutoPdfFile` (`index.html:6190`) | Transmettre `doc` depuis `opts`. Ajouter des champs dédiés : `opts.kind` contient aujourd'hui un libellé (« Étude de marché »). Remonter 402 distinctement de l'échec |
| `partagerEtude` (`index.html:5500`) | Garder la confirmation, retirer `consume` : le rendu débite |
| `doPartager` (`avis-valeur.js:3979`) | Ajouter la même confirmation (voir D2) |
| `fidiPrintExact` (`index.html:6228`) | Ajouter `consume` : c'est le secours du partage |
| `confirmPrint`, `doExportPdf` | Inchangés sauf l'envoi de la clé à `consume` |
| `showShareModal` (`index.html:6389`) | Aucun appelant trouvé hors de sa définition : à supprimer ou à doter de `doc` |

Le cookie de session part déjà avec ces `fetch`, qui sont sur la même origine. `SameSite=Lax` empêche un autre site de déclencher un débit par POST.

## 5. Limite à assumer

Ce projet vend l'édition, et l'écran montre le résultat avant paiement. Tant que c'est le cas, une capture, la copie du DOM ou le JSON de `/api/analyse` restent possibles. La cible réaliste :

- le chemin normal est toujours facturé, et le chemin serveur l'est sans exception ;
- `Ctrl+P` n'imprime plus l'écran : `@media print` masque tout hors des modes d'impression, avec un message renvoyant au bouton, et seulement pour un compte soumis au péage (classe posée sur `body`) ;
- le reste demande un effort délibéré, et le quota borne le gain.

Pour fermer vraiment : aperçu partiel à l'écran, données complètes après paiement, et rapport généré côté serveur (option C). C'est un changement de produit qui supprime l'essai gratuit tel qu'il existe. **Je ne le recommande pas à ce stade.**

## 6. Décisions à prendre

- **D1 — Ré-édition :** fenêtre de 30 jours et 10 rendus par document ? *Proposé : oui.*
- **D2 — Partage d'un avis :** payant comme celui d'une étude, avec la même confirmation ? *Proposé : oui. Changement visible pour les utilisateurs.*
- **D3 — Facturer & envoyer :** débiter ou non ? *Proposé : même règle, le document livré au client est l'acte facturé. Le bouton est-il réservé au personnel FIDI ? `facture.mjs` le dit en commentaire, mais ne vérifie qu'une session.*
- **D4 — PDF d'implantation et récapitulatif :** *Décidé par l'utilisateur le 2026-11-04 : gratuits si l'étude est déjà payée, sinon 1 crédit, qui paie aussi l'étude.* Même clé de document que l'étude (`etudeDoc`), via `/api/consume` avec `extrait: true`. Un extrait n'use pas les 10 rendus et reste gratuit tant que la fenêtre de 30 jours est ouverte. Limite : la clé venant du navigateur, une clé forgée donne des extraits sans plafond de rendus pendant 30 jours.
- **D5 — Base « Éditions FIDI » :** création d'accord ? Elle demande une variable `NOTION_DB_EDITIONS`. Je n'ai pas vérifié si `sauvegarde-locale.mjs` l'inclura automatiquement ; à contrôler pour la règle de copie locale.

## 7. Plan si accepté

1. **Lot 0, fuites sans technique :** clé de document, `doPartager`, `fidiPrintExact`, Ctrl+P, et D3 selon réponse.
2. **Lot 1, débit serveur :** base Éditions, `_edition.mjs`, `pdf-render`, `consume`, trois appelants, tests.
3. **Lot 2, facultatif :** filtrer les requêtes sortantes de Chromium. Il charge du HTML fourni par le client, et seuls `media` et `websocket` sont bloqués (`pdf-render.mjs:55-58`), d'où un risque de requêtes vers des adresses internes. Risque déduit du code, exploitation non testée.

**Dépendance :** la session voisine « protéger api pdf-share » ajoute la session à `pdf-render.mjs`. Attendre que son travail soit posé pour éviter un conflit sur ce fichier.

**Tests :**

- unitaires sur `_edition.mjs`, Notion simulé : péage inactif, illimité, 1er débit, ré-édition, A-B-A, plafond, fenêtre échue, 0 crédit, échec Notion ;
- sur `pdf-render` : 401, 402 sans lancement de Chromium, échec de rendu sans débit ;
- de bout en bout : avec `PAYWALL_ENABLED=true` **hors production** et un compte de test. Le remote `app` déploie la prod : pas de push sans accord, et un contexte de test à définir (la variable du péage est propre au site).

**Avant d'activer le péage :** Lot 0 et Lot 1 livrés, Notion mesuré, et `/api/analyse` testé sur le compteur de quota.
