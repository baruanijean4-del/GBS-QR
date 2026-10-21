# Nganda POS — Phase 1 : Schéma de données (Supabase / PostgreSQL)

## 1. Résumé des décisions et hypothèses

- **Le rôle est porté par une affectation** (`utilisateur + terrasse + rôle`) ; le rôle PROPRIETAIRE est une affectation d'organisation (`terrasse_id NULL`). La table `serveuses` du schéma initial est fusionnée dans `utilisateurs` + `affectations` (une serveuse = un utilisateur affecté SERVEUSE).
- **Montants en entiers** : CDF en francs, USD en centimes. Prix produits en CDF (V1) ; `prix_usd_centimes` et `taux_change` déjà prêts pour le multi-devises V3.
- **Client sans compte** : session anonyme Supabase (*anonymous sign-in*) → `auth.uid()` porte la session, ce qui permet RLS + Realtime sans backend pour le suivi. Le token QR opaque est validé par des fonctions `SECURITY DEFINER` ; la table `tables` et les identités du staff ne sont jamais exposées aux anonymes.
- **Toute écriture sensible passe par des fonctions RPC** (machine à états, stock, dépôts, facturation) ; les tables d'historique (`mouvements_stock`, `historique_prix`, `audit_log`) sont append-only, UPDATE/DELETE interdits à tous par trigger + REVOKE.
- **SaaS** : prix, remises (-15 % dès 3 terrasses, -25 % dès 5), annuel (10 mois payés) et frais d'installation sont **en base** (`plans`, `remises`) ; le montant facturé est toujours calculé côté serveur ; la validation des paiements mobile money est manuelle par super-admin (idempotente, webhook-ready via `webhook_id`).

## 2. Arborescence livrée

```
phase-1/
├── 01_schema.sql           -- Schéma complet : enums, 45 tables, RLS, fonctions, triggers, vues, realtime
├── 02_seed.sql             -- Plans (20/35/50 USD), remises, catégories de dépenses
├── 03_tests.sql            -- 26 suites de tests T01–T26 (assertions, s'arrête au 1er échec)
├── 00_harnais_local.sql    -- UNIQUEMENT local/CI : stub auth.* hors Supabase
└── LISEZMOI.md
```

### Contenu du schéma

| Bloc | Détail |
|---|---|
| Enums | rôles, statuts commande/session/dépôt/abonnement/paiement, types de mouvements… |
| Socle | `organisations`, `utilisateurs` (sans colonne rôle), `terrasses`, `affectations`, `invitations` |
| Opérationnel | `tables` (token QR opaque régénérable), `produits` (stock, réservé, disponible calculé), `table_serveuse` (un seul actif par table), `clients_session`, `commandes` (+ clé d'idempotence), `commande_lignes` (prix en snapshot) |
| Caisse | `sessions_service`, `depots` (écart calculé), `avis_serveuse`, `historique_client` |
| Stock/prix | `mouvements_stock`, `pertes_stock`, `demandes_stock`, `historique_prix` |
| Notifications | `push_tokens`, `notifications` (staff + client), `alertes`, `audit_log` (avec `role_actif`) |
| SaaS | `plans` (feature flags jsonb), `abonnements`, `factures` (numérotées), `paiements`, `remises`, `super_admins` |
| V2/V3 anticipées | fournisseurs, achats, consignes, ardoises, dépenses, inventaires, fidélité, promotions, taux de change, avances, commissions — **créées mais verrouillées en écriture** |
| Fonctions RLS | `est_proprietaire`, `a_role`, `roles_actifs`, `peut_modifier_stock_prix`, `plan_autorise`, `abonnement_permet_ecriture`, `est_super_admin` |
| Fonctions métier | inscription (chemin A), invitations (création/consommation/révocation), contexte QR, session client, `passer_commande` atomique, `confirmer_commande`, `marquer_servie`, annulations, session/dépôt, `ajuster_stock`, demandes de stock, paiement, `valider_paiement`, `changer_plan`, `prolonger_abonnement`, `cron_abonnements` |
| Triggers | machine à états, libération de stock, traçabilité prix/stock avec motif obligatoire, conflit SERVEUSE↔GERANT/RESPONSABLE, dernier propriétaire, immuabilité des historiques, alertes (stock bas, écart de caisse), notifications métier |
| Vues | `v_ventes_journalieres`, `v_ventes_hebdomadaires`, `v_performance_serveuses`, `v_depots_controle`, `v_stock_etat`, `v_mrr`, `v_impayes` (toutes `security_invoker`) |

## 3. Instructions d'exécution

### Sur Supabase (projet vierge)

1. SQL Editor → collez et exécutez `01_schema.sql` (un seul passage).
2. Exécutez `02_seed.sql`.
3. **Ne pas exécuter** `00_harnais_local.sql` (le schéma `auth` existe déjà).
4. Activez l'*anonymous sign-in* : Authentication → Sign In / Providers → *Anonymous Sign-Ins*.
5. Activez le cron quotidien (une fois) :
   ```sql
   create extension if not exists pg_cron;
   select cron.schedule('nganda-abonnements-quotidien', '15 4 * * *',
                        $$ select public.cron_abonnements(); $$);
   ```
6. Nommez le premier super-admin plateforme (après création de son compte) :
   ```sql
   insert into super_admins (utilisateur_id) values ('<uuid-utilisateur>');
   ```

### En local / CI (PostgreSQL 15+ standard)

```bash
psql -v ON_ERROR_STOP=1 -f 00_harnais_local.sql   -- stub auth + rôles
psql -v ON_ERROR_STOP=1 -f 01_schema.sql
psql -v ON_ERROR_STOP=1 -f 02_seed.sql
psql -v ON_ERROR_STOP=1 -f 03_tests.sql
```

## 4. Comment tester

`03_tests.sql` s'exécute par assertions et s'arrête au premier échec (`Txx ÉCHOUÉ : …`). Il couvre la matrice exigée :

- **T01–T04** : inscription (Propriétaire+Responsable+Gérant automatiques, essai 14 j), cycle complet des invitations (usage unique, expirée, révoquée, devinée), règles de cumul (Responsable+Gérant autorisé, Serveuse+Gérant refusé, dernier propriétaire irretirable), contexte QR + unicité d'assignation.
- **T05–T08** : commande atomique avec réservation de stock, idempotence hors-ligne (clé), refus de stock tout-ou-rien, « Servi » réservé à la serveuse assignée, machine à états verrouillée (même en SQL direct), annulation avec libération tracée.
- **T09–T10** : fin de service (montant attendu calculé), dépôt avec motif d'écart obligatoire, session clôturée immuable, nul ne valide son propre dépôt (fonction **et** trigger), alerte fraude au-delà du seuil avec notifications dédoublonnées pour les rôles cumulés.
- **T11–T14** : règle d'or du stock (fonction + trigger + motif obligatoire), types système inaccessibles, historique des prix avec `role_actif`, demandes du gérant (approbation = exécution tracée).
- **T15–T16** : un seul avis par commande servie ; historiques immuables.
- **T17–T20** : RLS — 403 gérant/serveuse sur prix/stock en appel direct, droits responsable, étanchéité inter-organisations, LECTURE_SEULE bloquée en base (client : « Service momentanément indisponible », export préservé).
- **T21–T25** : feature flags (essai = Pro), cron idempotent (ESSAI→EN_GRACE→LECTURE_SEULE→SUSPENDU + rappels J-7/3/1 dédupliqués), montants serveur (remises multi-terrasses, annuel 10/12, frais d'installation uniques), validation super-admin idempotente (pas de double crédit au rejeu), changement de plan (montée immédiate / descente à l'échéance), prolongation réservée.
- **T26** : vues de rapports et MRR.

Résultat obtenu sur PostgreSQL portable (validation réelle) : **26/26 OK, 0 erreur SQL**.

## 5. Points d'attention

1. **pgcrypto** : activée par `01_schema.sql` (`create extension if not exists`) — présente par défaut sur Supabase ; en local sans contrib, le harnais fournit des bouchons.
2. **Push FCM** : la base enregistre chaque notification (`notifications`) ; l'envoi FCM proprement dit est côté backend (Phase 2), qui écoute cette table et nettoie les tokens invalides.
3. **Heures calmes et rate limiting IP** : paramétrés en base (`terrasses.parametres`), appliqués par le backend/edge (Phase 2/3) — la base ne connaît pas l'IP.
4. **Désactivation d'une affectation** : les tokens push ne sont coupés que si l'utilisateur n'a plus *aucune* affectation active (sinon on couperait ses autres terrasses) ; le cloisonnement par terrasse fait le reste.
5. **Transfert de propriété** : la confirmation par mot de passe est une étape backend (Phase 2) ; la base garantit seulement « dernier propriétaire irretirable ».
6. **Tests RLS** : ils simulent le JWT via `request.jwt.claims` (méthode supportée par Supabase) ; en production PostgREST pose ce contexte automatiquement.
7. **Prochaine étape** : Phase 2 — backend Express (middlewares d'affectation et d'abonnement posant `nganda.utilisateur_id` / `nganda.role_actif`, endpoints REST documentés, FCM). Dites « continue ».
