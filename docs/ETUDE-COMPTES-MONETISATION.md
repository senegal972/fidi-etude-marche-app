# Étude préalable — Comptes collaborateurs, monétisation & administration

**FIDI · Étude de Marché** — proposition avant développement · 17/07/2026

---

## 1. Ce que tu as demandé

1. **Partager l'outil aux collaborateurs** avec une **gestion administrateur** (tu crées les comptes).
2. **Participation financière** des collaborateurs : bouton **Connexion / Compte** ouvrant une interface dédiée à l'**identité**, l'**abonnement** ou l'**utilisation au coup par coup**.
3. **Administration de la tarification** : modifier les prix, **créer des offres**.
4. Paiement **PayPal et carte bancaire**.

## 2. État des lieux (ce qui existe déjà)

| Élément | État |
|---|---|
| Netlify Identity activé + inscription « invite only » | ✅ fait (cette session) |
| Variables `PAYWALL_ENABLED`, `START_CREDITS`, `COST_ETUDE`, `NOTION_DB_USERS` | ✅ posées |
| Base Notion « Utilisateurs FIDI » (Email, Nom, Identity ID, Rôle, Statut, Crédits) | ✅ créée |
| Code du péage (`/api/moncompte`, `_users.mjs`, débit dans `/api/analyse`) | ❌ **absent du dépôt** (décrit dans SETUP-COMPTES-LOT1.md mais jamais poussé) |
| Stack complète **auth JWT + PayPal** (register/login/me/logout, orders, subscriptions, webhook signé, plans 29/79/149 €, one-shot 9-29 €) | ✅ **déjà écrite et testée (125 tests)** dans le dépôt `fidi-etude-marche` (Espace Partenaires Optimmo Dom) |

**Point d'attention majeur** : Netlify Identity est **officiellement déprécié** (maintenu pour la sécurité uniquement, plus aucune évolution ni support). Il fonctionne encore et aucune migration n'est imposée, mais **construire un système de paiement pérenne dessus serait une erreur**. Netlify recommande Auth0 ou Supabase Auth.

## 3. Benchmark — ce qui se pratique le mieux (recherche web, juil. 2026)

- Le modèle **hybride** (abonnement + consommation) est devenu **le modèle dominant** du SaaS B2B : ~37-41 % d'adoption, en forte croissance, là où l'abonnement pur recule.
- Les **crédits prépayés** sont l'innovation pricing qui monte (+126 % d'adoption en un an) : simples à comprendre, ils unifient plusieurs actions facturables et donnent une dépense prévisible.
- L'abonnement **pur** affiche un churn ~2,3× supérieur aux modèles hybrides/usage.
- Pour une **petite équipe** : rester **simple et prévisible** — 3 offres maximum, pas d'usine à gaz de facturation.
- **PayPal** : les paiements **one-shot** (Orders API) acceptent la **carte bancaire sans compte PayPal** (guest checkout) ; les **abonnements** (Subscriptions API) nécessitent en pratique un compte PayPal. → Il faut **les deux** : packs de crédits par CB pour tous, abonnement pour les réguliers.

### Modèle recommandé pour FIDI

**Hybride simple à 3 étages** :
1. **Au coup par coup** : packs de crédits (ex. 5 études = X €, 20 études = Y €) — payables **CB sans compte PayPal**. 1 étude réussie = 1 crédit (une adresse introuvable ne coûte rien).
2. **Abonnement mensuel** (ex. Solo / Cabinet) : quota d'études par mois + report limité, via PayPal Subscriptions.
3. **Crédits offerts** à la création de compte (`START_CREDITS=3`) pour l'essai.

Les montants exacts restent **ta décision** — et justement, ils seront **éditables par toi** sans redéploiement (voir §6).

## 4. Architecture — 3 options

| | Option A — **JWT maison + Notion** (recommandée) | Option B — Netlify Identity (Lot 1 tel quel) | Option C — Auth0 / Supabase |
|---|---|---|---|
| Authentification | Fonctions `auth-*` **déjà écrites** (JWT HMAC, scrypt, anti brute-force) portées depuis `fidi-etude-marche` | GoTrue Netlify (déprécié) | Service externe |
| Comptes | Base Notion « Utilisateurs FIDI » (source de vérité) | Identity + Notion en double | Dashboard externe + sync |
| Création par l'admin | ✅ écran admin dans l'app | ⚠️ dashboard Netlify uniquement | ⚠️ dashboard externe |
| Pérennité | ✅ ton code, zéro dépendance | ❌ produit en fin de vie | ✅ mais dépendance + coût |
| Coût | 0 € | 0 € | 0 € puis payant |
| Effort | Moyen (portage + adaptation Notion) | Faible | Élevé |

**Recommandation : Option A.** Tu possèdes déjà 90 % du code (éprouvé, 125 tests), il s'aligne sur ta règle « une information = un champ » (utilisateurs dans Notion, visibles et éditables), l'admin crée les comptes **dans l'app** (pas dans un dashboard tiers), et aucune fondation dépréciée. L'Identity « invite only » déjà activé reste en place comme verrou du site pendant la transition, puis sera désactivé.

## 5. Parcours utilisateur proposé

**Bouton « Connexion / Mon compte »** (en-tête) → modale à onglets :

1. **Identité** — e-mail, nom, mot de passe (changement), rôle affiché.
2. **Mon solde** — crédits restants (pastille dans l'en-tête), historique des 10 dernières études débitées.
3. **Abonnement** — offre active, date de renouvellement, bouton s'abonner/résilier (PayPal).
4. **Acheter des crédits** — les packs actifs (définis par toi), paiement **PayPal ou CB sans compte**.

**Verrou** : « Lancer l'analyse » exige d'être connecté ; à 0 crédit et sans abonnement → renvoi vers l'onglet 4. Tant que `PAYWALL_ENABLED=false`, tout reste en accès libre (interrupteur inchangé).

## 6. Console d'administration (rôle Administrateur)

Onglet **Admin** visible pour toi seul :

- **Comptes** : créer un collaborateur (e-mail + nom → mot de passe provisoire envoyé), activer/désactiver, créditer/débiter manuellement, changer le rôle.
- **Tarifs & offres** : créer/modifier/désactiver une offre (nom, type pack/abonnement, prix, crédits, description) — **sans redéploiement**.
- **Paiements** : journal des transactions (qui, quoi, quand, combien, statut PayPal).

### Nouvelles bases Notion (règle « une information = un champ »)

**« Tarifs & Offres »** : Nom (Titre) · Type (Sélection : Pack / Abonnement) · Prix € (Nombre) · Crédits inclus (Nombre) · Périodicité (Sélection : Unique / Mensuel) · Description (Texte) · Active (Case à cocher) · ID plan PayPal (Texte) · Ordre d'affichage (Nombre)

**« Paiements »** : Référence (Titre) · Utilisateur (Relation → Utilisateurs FIDI) · Offre (Relation → Tarifs & Offres) · Montant € (Nombre) · Crédits ajoutés (Nombre) · Moyen (Sélection : PayPal / Carte) · Statut (Sélection : Payé / Remboursé / Échec) · ID transaction PayPal (Texte) · Date (Date)

**« Utilisateurs FIDI »** (extension) : + Mot de passe (hash scrypt, Texte) · Abonnement actif (Relation → Tarifs & Offres) · Renouvellement le (Date) · ID abonnement PayPal (Texte) · Dernière connexion (Date)

## 7. Plan de réalisation par lots

| Lot | Contenu | Dépend de toi |
|---|---|---|
| **A — Comptes & péage** | Portage `auth-*` (JWT+scrypt) sur l'app, utilisateurs dans Notion, modale Connexion/Mon compte (onglets 1-2), verrou + débit 1 étude = 1 crédit, crédits offerts | Partager la base Notion avec l'intégration |
| **B — Console admin** | Onglet Admin : comptes, crédit manuel, bases « Tarifs & Offres » + « Paiements », édition des offres | Décider la grille tarifaire initiale |
| **C — Packs au coup par coup** | PayPal Orders + **CB sans compte**, crédit automatique du solde, journal Paiements | Compte PayPal Business + clés API |
| **D — Abonnements** | PayPal Subscriptions + webhook signé (renouvellement → recharge auto), résiliation | Créer les plans dans PayPal (je peux le scripter) |

Chaque lot est **livrable et utilisable indépendamment** ; `PAYWALL_ENABLED` reste l'interrupteur général (retour arrière en 1 variable).

## 8. Sécurité & conformité

- Mots de passe **scrypt**, JWT HttpOnly + SameSite, anti brute-force (5 essais/15 min) — déjà dans la stack portée.
- **Webhook PayPal signé** (vérification `PAYPAL_WEBHOOK_ID`) : le crédit n'est ajouté que sur notification vérifiée, jamais sur le retour navigateur.
- Débit **côté serveur uniquement**, relecture du solde avant soustraction.
- À prévoir côté FIDI : CGV/CGU, mentions tarifaires TTC, facture (la base « Factures » existe déjà), TVA selon ton régime.

## 9. Décisions à prendre avant le Lot A

1. **Valides-tu l'option A** (JWT maison + Notion) ?
2. **Grille initiale** : prix des packs (5/20 études ?) et des abonnements (Solo/Cabinet ?) — modifiable ensuite dans l'admin.
3. PayPal : compte **Business** prêt ? (sandbox d'abord, production ensuite).

---

*Sources : Netlify (dépréciation Identity, reco Auth0/Supabase) · PayPal (guest checkout CB, Subscriptions) · benchmarks pricing SaaS 2025-2026 (Flexprice, SaaS Factor, Userpilot, Schematic, Meteroid).*
