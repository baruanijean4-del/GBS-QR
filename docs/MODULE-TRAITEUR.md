# MODULE TRAITEUR — MENU À PLUSIEURS COMPOSANTS

> Statut : **VALIDÉ par le propriétaire et IMPLANTÉ** (migration 0019,
> routeur `api/routers/traiteur.ts`, contrats `contracts/traiteur.ts`).
> Rappel permanent : **aucun montant visible du gérant, du chef et du
> magasinier** (API, PDF, exports, journaux, erreurs).

## 1. Concepts
- Un **MENU** est une liste de **COMPOSANTS** (plat, sauce,
  accompagnement, boisson…).
- Chaque composant est une **recette par personne**, **versionnée**,
  proposée par le **chef**, **validée par le propriétaire**.
- Chaque composant a une **quantité par personne** (défaut 1 ; peut
  être 0,5 ou 2).
- Un composant peut être un **produit acheté non cuisiné** (boisson) :
  en **pièces**, **sans taux de perte**.

## 2. Plan du jour
Plan = **menu + nombre de personnes** (+ répartition par options si
menu à choix — la somme des options = total des personnes) + **heure**
+ **entreprise**. Le plan multiplie CHAQUE composant par le nombre de
personnes.

## 3. Composition par contrat
Un composant peut être **absent pour une entreprise donnée** (contrat
sans boisson, par exemple) ; coût et quantités s'adaptent
automatiquement.

## 4. Calcul
- Addition par **INGRÉDIENT** sur tous les composants, en **unité de
  base entière** (mg, ml, pièces) — aucun arrondi intermédiaire ;
  **un seul arrondi à l'affichage**.
- **Bon de sortie du magasinier** : groupé par ingrédient (UNE seule
  ligne par produit, avec le **lot FEFO**), **sans aucun prix**.
- **Fiche de production du chef** : groupée par **composant**.

## 5. Coûts — propriétaire SEULEMENT
Coût par composant, coût par personne, coût du jour, marge par menu et
par contrat. Ces montants n'apparaissent nulle part ailleurs.

## 6. Versions
Modifier une recette de composant ou la composition d'un menu ne
change **jamais** les jours passés (les plans gardent la version
figée).

## 7. Sous-recettes (préparations intermédiaires stockées)
**NON implémenté en v1**, seulement prévu au schéma : un ingrédient de
recette pourra référencer une sous-recette (`sous_recette_id`) au lieu
d'un produit de stock.

## 7bis. Comptage à l'aveugle et écarts (décision)
- **Comptage à l'aveugle** : lors de l'inventaire, le magasinier (ou le
  gérant) saisit la quantité **physiquement comptée** SANS voir la
  quantité théorique attendue — l'écran de comptage n'affiche ni le
  stock calculé ni aucun montant. Cela interdit le comptage « aligné »
  sur le chiffre attendu.
- **Écarts en quantité** : l'écart (théorique − compté) est calculé par
  le serveur et affiché aux autres rôles **en quantité uniquement**
  (kg, L, pièces) — jamais en valeur. La **valeur monétaire de
  l'écart** (coût) est visible du **propriétaire seul**.
- Chaque comptage est journalisé (qui, quand, quel produit, quantité
  comptée) ; un écart au-delà du seuil de l'établissement déclenche
  l'alerte propriétaire existante.

## 8. Schéma proposé (NON appliqué)
- `traiteur_composants` (id, terrasseId, nom, kind PLAT | SAUCE |
  ACCOMPAGNEMENT | BOISSON, actif).
- `traiteur_recettes` (id, composantId, **version**, statut PROPOSEE |
  VALIDEE, proposePar, validePar, creeLe) — versionnée, jamais
  modifiée après validation.
- `traiteur_recette_lignes` (id, recetteId, produitId **ou**
  sousRecetteId *(v2, prévu — NULL en v1)*, quantiteParPersonneBase
  integer **en mg / ml / pièces**, tauxPertePct integer défaut 0 —
  0 pour les produits achetés non cuisinés).
- `traiteur_menus` (id, terrasseId, nom, prixPersonneUsdCentimes).
- `traiteur_menu_lignes` (id, menuId, composantId, qteParPersonne
  ×1000 entier — défaut 1000 = 1 ; 500 = 0,5 ; 2000 = 2).
- `traiteur_plans` (id, terrasseId, menuId, **menuVersion**,
  entreprise, nbPersonnes, heure, jour, repartitionOptions jsonb —
  somme = nbPersonnes).
- `traiteur_plan_exclusions` (planId, composantId) — composition par
  contrat (composant absent pour cette entreprise).
- `traiteur_bons_sortie` (id, planId, magasinierId, creeLe) +
  `traiteur_bon_lignes` (bonId, produitId, lotId FEFO,
  quantiteBase) — **sans aucun prix**.
- `traiteur_comptages` (id, terrasseId, produitId, comptePar,
  quantiteCompteeBase **saisie à l'aveugle**, quantiteTheoriqueBase
  *remplie par le serveur, jamais affichée au compteur*, creeLe) —
  l'écart = théorique − compté, en **quantité** pour gérant/chef/
  magasinier, en **valeur** pour le propriétaire seul.

## 9. Écrans par rôle (4 rôles)
- **Propriétaire** : validation des recettes, coûts (composant /
  personne / jour), marges par menu et par contrat, **valeur des
  écarts d'inventaire**. Lui SEUL voit un montant.
- **Chef** : propose les recettes (versions), reçoit la **fiche de
  production groupée par composant** — sans prix ; voit les écarts
  **en quantité** seulement.
- **Magasinier** : **bon de sortie groupé par ingrédient** (une ligne
  par produit, lot FEFO) — sans prix ; **comptage à l'aveugle** (la
  quantité théorique n'est jamais affichée) ; écarts **en quantité**
  seulement.
- **Gérant** : plans du jour (personnes, heure, entreprise) — sans
  prix ni coûts ; écarts **en quantité** seulement.

## 10. Tests de référence (à reproduire à l'implémentation)
**Menu poulet, 200 personnes** — sortie attendue :
| Ingrédient | Quantité | Détail |
|---|---|---|
| Poulet | 50 kg | plat |
| Riz | 30 kg | accompagnement |
| Huile | **30 L, une seule ligne** | plat 20 L + sauce 10 L (agrégation) |
| Tomate | 8 kg | sauce |
| Oignon | 6 kg | sauce |
| Eau | 200 pièces | boisson (non cuisinée, sans perte) |

Prix : poulet 4,30 $/kg, riz 1,20, huile 2,50/L, tomate 1,50,
oignon 1,00, eau 0,30/pièce.
- Coûts par personne : plat **1,325** (215/200 + 50/200),
  accompagnement **0,180**, sauce **0,215** (12+6+25 /200),
  boisson **0,300** → total **2,020 $**.
- Coût du jour : **404,00 $** ; à prix 3,00 $/personne → marge
  **196,00 $ (32,67 %)**.
- **Contrat sans boisson** : coût **344,00 $**.
- **Sel** : 200 personnes × 0,5 g × 2 composants = **200 g exacts**
  (unité de base mg : 500 × 200 × 2 = 200 000 mg — aucun arrondi
  intermédiaire).
