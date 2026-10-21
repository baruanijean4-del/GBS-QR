-- ============================================================================
-- NGANDA POS — PHASE 1 : DONNÉES INITIALES (SEED)
-- À exécuter APRÈS 01_schema.sql. Idempotent (on conflict do nothing/update).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- PLANS (prix, limites et feature flags EN BASE — jamais en dur dans le code)
-- ---------------------------------------------------------------------------
insert into public.plans (code, nom, prix_usd_centimes, mois_factures_annuel,
                          frais_installation_usd_centimes, max_comptes_staff, fonctionnalites, ordre)
values
  ('ESSENTIEL', 'Essentiel', 2000, 10, 5000, 15, '{
     "commande_qr": true, "stock": true, "prix": true, "depots": true,
     "alertes_fraude": true, "dashboard": true, "rapports": true,
     "push": true, "hors_ligne": true,
     "consignes": false, "ardoise": false, "achats": false, "marges": false,
     "depenses": false, "inventaire": false,
     "crm": false, "fidelite": false, "promotions": false,
     "multi_devises": false, "commissions": false, "export_comptable": false
   }'::jsonb, 1),
  ('PRO', 'Pro', 3500, 10, 5000, 30, '{
     "commande_qr": true, "stock": true, "prix": true, "depots": true,
     "alertes_fraude": true, "dashboard": true, "rapports": true,
     "push": true, "hors_ligne": true,
     "consignes": true, "ardoise": true, "achats": true, "marges": true,
     "depenses": true, "inventaire": true,
     "crm": false, "fidelite": false, "promotions": false,
     "multi_devises": false, "commissions": false, "export_comptable": false
   }'::jsonb, 2),
  ('BUSINESS', 'Business', 5000, 10, 5000, 100, '{
     "commande_qr": true, "stock": true, "prix": true, "depots": true,
     "alertes_fraude": true, "dashboard": true, "rapports": true,
     "push": true, "hors_ligne": true,
     "consignes": true, "ardoise": true, "achats": true, "marges": true,
     "depenses": true, "inventaire": true,
     "crm": true, "fidelite": true, "promotions": true,
     "multi_devises": true, "commissions": true, "export_comptable": true
   }'::jsonb, 3)
on conflict (code) do update
  set prix_usd_centimes = excluded.prix_usd_centimes,
      mois_factures_annuel = excluded.mois_factures_annuel,
      frais_installation_usd_centimes = excluded.frais_installation_usd_centimes,
      max_comptes_staff = excluded.max_comptes_staff,
      fonctionnalites = excluded.fonctionnalites,
      ordre = excluded.ordre;

-- ---------------------------------------------------------------------------
-- REMISES (paliers multi-terrasses ; l'annuel = plans.mois_factures_annuel)
-- ---------------------------------------------------------------------------
insert into public.remises (code, description, type, valeur, condition_min_terrasses)
values
  ('MULTI_3', '-15 % dès 3 terrasses', 'POURCENTAGE', 15, 3),
  ('MULTI_5', '-25 % dès 5 terrasses', 'POURCENTAGE', 25, 5)
on conflict (code) do update
  set valeur = excluded.valeur, condition_min_terrasses = excluded.condition_min_terrasses;

-- ---------------------------------------------------------------------------
-- CATÉGORIES DE DÉPENSES PAR DÉFAUT (plateforme, V2)
-- ---------------------------------------------------------------------------
insert into public.categories_depense (organisation_id, nom)
select null, c.nom
from (values ('Électricité'), ('Glace'), ('Musique'), ('Sécurité'), ('Salaires'), ('Loyer'), ('Autre')) as c(nom)
where not exists (
  select 1 from public.categories_depense cd
  where cd.organisation_id is null and cd.nom = c.nom
);

-- ---------------------------------------------------------------------------
-- DÉMO OPTIONNELLE (décommenter en développement, JAMAIS en production)
-- Nécessite un utilisateur Auth existant : créez-le dans
-- Authentication → Users, puis remplacez l'UUID ci-dessous.
-- ---------------------------------------------------------------------------
-- do $$
-- declare
--   v_demo uuid := '00000000-0000-0000-0000-000000000001';  -- UUID de l'utilisateur Auth démo
-- begin
--   perform set_config('nganda.utilisateur_id', v_demo::text, true);
--   perform finaliser_inscription_etablissement(
--     'Démo Nganda', 'Terrasse du Centre', 'Av. Kasa-Vubu, Lubumbashi', 8, true);
--   -- Produits de démonstration
--   insert into produits (terrasse_id, nom, categorie, prix_cdf, stock, seuil_alerte)
--     select t.id, p.nom, p.categorie, p.prix, 100, 12
--     from terrasses t,
--          (values ('Primus', 'Bières', 3000), ('Skol', 'Bières', 3000),
--                  ('Coca-Cola', 'Sodas', 2000), ('Fanta', 'Sodas', 2000),
--                  ('Eau Viju', 'Eaux', 1500)) as p(nom, categorie, prix)
--     where t.slug like 'terrasse-du-centre%';
-- end $$;
