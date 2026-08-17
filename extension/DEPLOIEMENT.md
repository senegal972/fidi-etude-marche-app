# Déploiement de l'extension FIDI ACM pour vos collaborateurs

3 options selon le nombre d'utilisateurs et le niveau de contrôle voulu.

---

## OPTION 1 — Chrome Web Store (RECOMMANDÉ)

**Pour qui** : tous vos collaborateurs, clients payants, plusieurs postes.

**Bénéfices** :
- Installation en **1 clic** depuis un lien
- **Mises à jour automatiques** sans action utilisateur
- Fonctionne sur **Chrome, Edge, Brave, Opera** (moteurs Chromium)
- Mode **Unlisted** : accessible seulement via lien direct, pas indexé

**Coût** : 5 USD (frais uniques compte développeur Google, à vie)

### Publication (une seule fois)

1. **Compte développeur** : https://chrome.google.com/webstore/devconsole/ → connexion Google → payer les 5 USD
2. **Emballer l'extension** :
   ```bash
   cd extension
   zip -r fidi-acm.zip . -x "*.md" -x "*.git*"
   ```
   (ou clic droit sur le dossier `extension/` → Envoyer vers → Dossier compressé)
3. **Nouvelle extension** dans la console développeur → uploader `fidi-acm.zip`
4. Remplir la fiche : nom, description, catégorie « Productivité », captures d'écran, icônes (voir plus bas)
5. **Visibilité** : cocher **Unlisted** (accessible via lien direct, non listé publiquement)
6. **Soumettre pour examen** — validation Google en 1-3 jours (unlisted plus rapide)
7. Récupérer le **lien du store** : `https://chrome.google.com/webstore/detail/XXXXXXX`

### Distribution à vos collaborateurs

Envoyez-leur simplement le lien + les 3 lignes :
> 1. Cliquez sur ce lien : `https://chrome.google.com/webstore/detail/XXXXXXX`
> 2. Bouton **Ajouter à Chrome** → **Ajouter l'extension**
> 3. Cliquez sur l'icône FIDI dans la barre → URL = `https://fidi-etude-marche-app.netlify.app` → Token = celui que je vous ai communiqué → Enregistrer

### Mise à jour

Push une nouvelle version → bump `manifest.json` (ex `1.2.0` → `1.3.0`) → re-upload le zip → Google déploie en quelques heures → tous vos utilisateurs reçoivent la mise à jour automatiquement.

---

## OPTION 2 — Politique d'entreprise (parc géré)

**Pour qui** : postes Windows en domaine Active Directory, MDM (Microsoft Intune, Google Workspace).

**Bénéfices** : install forcée, aucune action utilisateur.

**Prérequis** : postes gérés par une politique centralisée.

### Étapes

1. Publier l'extension sur le Chrome Web Store en Unlisted (voir Option 1)
2. Récupérer l'**ID extension** (32 caractères après `/detail/` dans l'URL du store)
3. Sur les postes clients, définir la clé de registre Windows :
   ```
   HKLM\Software\Policies\Google\Chrome\ExtensionInstallForcelist
   1 = "<ID-EXTENSION>;https://clients2.google.com/service/update2/crx"
   ```
   Ou via GPO/Intune : **Google Chrome > Extensions > Configurer la liste d'extensions à installer de force**

À l'ouverture de Chrome, l'extension s'installe seule. Impossible pour l'utilisateur de la désactiver.

---

## OPTION 3 — Distribution manuelle (mode dev)

**Pour qui** : 1-2 testeurs seulement.

**Limite** : Chrome désactive automatiquement les extensions installées hors store à chaque redémarrage → notification agaçante. À réserver aux essais.

### Étapes

1. Envoie le dossier `extension/` (zippé) à ton collaborateur
2. Il extrait le zip
3. `chrome://extensions/` → active **Mode développeur** → **Charger l'extension non empaquetée** → sélectionne le dossier

---

## Icônes requises pour Web Store

À placer dans `extension/icons/` :

- `icon-16.png` (16×16 px)
- `icon-48.png` (48×48 px)
- `icon-128.png` (128×128 px)

Puis ajouter dans `manifest.json` :

```json
"icons": {
  "16": "icons/icon-16.png",
  "48": "icons/icon-48.png",
  "128": "icons/icon-128.png"
}
```

Design simple : fond bleu marine (`#1a3a6e`), lettre **F** blanche gras, coin arrondi.

---

## Captures d'écran requises

Chrome Web Store demande **au moins 1 capture d'écran 1280×800 ou 640×400**.

Suggestion :
- Capture d'écran d'une fiche SeLoger avec le bouton bleu visible en bas à droite
- Capture d'écran de FIDI section Comparables avec la liste des annonces importées

---

## Ma recommandation

**Option 1 (Chrome Web Store Unlisted)** pour votre cas d'usage : distribuez le lien à vos collaborateurs et clients, mise à jour automatique, aucun blocage Chrome, professionnel.

Coût : 5 USD une fois, ~1 semaine pour publication initiale.
