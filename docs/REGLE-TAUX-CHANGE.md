# RÈGLE — TAUX DE CHANGE USD/FC PAR ÉTABLISSEMENT

> Statut : **APPLIQUÉE SUR BRANCHE NEON DE TEST** (migration 0016,
> `db/migrations/0016_taux-change.sql`) — en attente de validation
> pour la base principale. Logique pure + tests : `contracts/taux.ts`,
> `src/__tests__/taux.test.ts`, `api/__tests__/taux-api.test.ts`.
> Ne touche ni à `espaces` ni à la tarification des abonnements.

## 1. Taux facultatif, propre à chaque établissement
- `terrasses.taux_usd_cdf` (FC pour 1 USD) — **NULL = établissement
  sans taux** : il fonctionne dans une seule devise, le bouton FC/$
  est masqué et **aucune conversion implicite** n'a lieu.
- **Une seule colonne de taux** : l'ancienne `taux_change` (NOT NULL,
  défaut 2800) est **renommée** `taux_usd_cdf` et devient NULLABLE
  (DROP NOT NULL + DROP DEFAULT). Le RENAME conserve les valeurs —
  aucune configuration ni aucune vente n'est réécrite.
- Jamais de taux global plateforme.
- Nouvel établissement : **NULL par défaut** (mono-devise) ; le
  propriétaire/gérant fixe le taux ensuite.

## 2. Droits
- Modification : **propriétaire et gérant de CET établissement
  uniquement** — contrôle côté serveur (`exigerGerantOuProprio`
  vérifie l'affectation sur l'établissement demandé : un gérant
  d'un autre établissement est refusé et journalisé).
- Tous les autres rôles : **lecture seule** (`taux.voir`).
- Journal : `TAUX_MODIFIE` dans `audit_log` (qui, quand,
  ancien → nouveau) — table **non modifiable** (aucun endpoint
  d'écriture, vérifié par revue de code).

## 3. Taux figé à la vente
- Chaque ligne de vente enregistre `taux_usd_cdf` au moment de sa
  création : **commande** (validation client), **token billard**
  (achat guichet ou comptoir), **nuitée** (check-in).
- Un changement de taux ne modifie **jamais** les lignes existantes
  ni les notes ouvertes — seulement les nouvelles.

## 4. Alertes et bornes (anti-erreur, anti-abus)
- Saisie : `taux > 0`, entier, `≤ taux_plafond_cdf` (défaut 10 000 FC,
  par établissement) — bloque les fautes de frappe.
- **Alerte propriétaire** si :
  - variation > `taux_alerte_variation_pct` % d'un coup (défaut 5 %)
    → `TAUX_VARIATION` ;
  - ou plus de `taux_alerte_max_par_jour` changements le même jour
    (défaut 3) → `TAUX_FREQUENCE`.

## 5. Caisse et rapports — jamais de mélange
- Caisse du jour **séparée par devise** : une colonne FC, une colonne
  $ — jamais d'addition FC + $.
- « Équivalent » converti = **affichage seulement**, calculé au taux
  de chaque vente (pas au taux du jour) — `equivalentAffichageCdf`.
- Rapports consolidés (propriétaire multi-établissements) : totaux
  **par devise**, taux de chaque établissement indiqué à côté.

## 6. Client et affichage
- Le client voit **le taux appliqué à côté du bouton de devise**
  (« 1 $ = 2 800 FC » — `libelleTauxClient`), masqué si
  l'établissement n'a pas de taux.
- Côté propriétaire : le chip taux du pilotage et l'équivalent FC de
  l'abonnement sont **masqués quand le taux est NULL**.

## 7. Plan pour les ventes existantes
- Les lignes antérieures gardent `taux_usd_cdf = NULL` → « taux
  d'époque (avant règle) » ; **aucune conversion rétroactive**.
- Les commandes ont déjà `total_cdf` ET `total_usd` (saisis, jamais
  convertis) : la séparation par devise est déjà garantie pour
  l'historique ; la colonne figée documente le taux à partir de
  l'activation.
- Établissements existants : leur taux (2800) est **conservé** par le
  rename — aucun changement de comportement sans action explicite.

## 8. Endpoints (livrés)
- `taux.voir({ terrasseId })` — tout membre (lecture) : taux + seuils.
- `taux.modifier({ terrasseId, tauxUsdCdf })` — proprio/gérant de
  l'établissement ; bornes + journal TAUX_MODIFIE + alertes.
  `null` = retour en mono-devise. Valeur identique = aucune écriture.
- Figeage : `tauxCourantDb()` lu à la création des commandes, tokens
  (guichet et comptoir) et séjours.

## 9. Tests
- **Purs** : bornes de saisie (0, négatif, plafond), variation %
  (alerte à +7,1 % / silence à +4 % avec seuil 5 %), compteur de
  fréquence/jour, établissement sans taux (mono-devise), équivalent
  affiché au taux de la vente.
- **API** (`taux-api.test.ts`) : droits par rôle (serveuse refusée,
  gérant OK, proprio OK, **gérant d'un autre établissement refusé**),
  bornes, valeur identique sans écriture, taux figé sur
  commande/token/nuitée puis **inchangé après modification**,
  historique audit_log (avant/après/qui), alertes variation et
  fréquence, établissement sans taux (vente figée NULL, première
  fixation sans alerte, retour mono-devise journalisé).
