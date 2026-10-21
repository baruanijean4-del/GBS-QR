-- ============================================================================
-- NGANDA POS — PHASE 1 : TESTS SQL
-- À exécuter APRÈS 01_schema.sql et 02_seed.sql, sur une base de TEST.
--   psql -v ON_ERROR_STOP=1 -f 03_tests.sql
-- Tout est vérifié par assertions : le script s'arrête au premier échec.
-- Les blocs RLS simulent un JWT via request.jwt.claims (éditeur SQL Supabase).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 0. FIXTURES : utilisateurs de test (schéma auth de Supabase)
-- ---------------------------------------------------------------------------
insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                        email_confirmed_at, raw_user_meta_data, created_at, updated_at)
values
  ('aaaaaaaa-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'marie@test.cd', crypt('test1234', gen_salt('bf')),
   now(), '{"nom":"Marie Ilunga"}', now(), now()),
  ('bbbbbbbb-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'paul.gerant@test.cd', crypt('test1234', gen_salt('bf')),
   now(), '{"nom":"Paul Mutombo"}', now(), now()),
  ('cccccccc-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'lea.serveuse@test.cd', crypt('test1234', gen_salt('bf')),
   now(), '{"nom":"Léa Kabongo"}', now(), now()),
  ('dddddddd-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'rosa.autre@test.cd', crypt('test1234', gen_salt('bf')),
   now(), '{"nom":"Rosa AutreOrg"}', now(), now()),
  ('eeeeeeee-0000-0000-0000-000000000005', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'admin@nganda.cd', crypt('test1234', gen_salt('bf')),
   now(), '{"nom":"Super Admin"}', now(), now()),
  ('ffffffff-0000-0000-0000-000000000006', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', null, null,
   now(), '{"nom":"Jean K."}', now(), now())          -- client en session anonyme
on conflict (id) do nothing;

-- Table de passage pour les identifiants générés.
-- Table RÉELLE (pas temporaire) : les blocs de test RLS changent de rôle
-- (SET ROLE authenticated) et perdraient l'accès à une table temporaire.
create table if not exists public.t_ids (cle text primary key, val text);
grant select on public.t_ids to authenticated, anon;
delete from public.t_ids;

-- Marie crée son établissement : Propriétaire + Responsable (+ Gérant) automatiques
select set_config('nganda.utilisateur_id', 'aaaaaaaa-0000-0000-0000-000000000001', false);
with r as (select finaliser_inscription_etablissement('Org Marie', 'Terrasse A', 'Lubumbashi', 5, true) as j)
insert into t_ids (cle, val)
  select 'orgA', j ->> 'organisation_id' from r
  union all select 'terA', j ->> 'terrasse_id' from r;

-- Rosa crée SON organisation (pour les tests d'étanchéité)
select set_config('nganda.utilisateur_id', 'dddddddd-0000-0000-0000-000000000004', false);
with r as (select finaliser_inscription_etablissement('Org Rosa', 'Terrasse Z', 'Kolwezi', 3, false) as j)
insert into t_ids (cle, val)
  select 'orgB', j ->> 'organisation_id' from r
  union all select 'terB', j ->> 'terrasse_id' from r;
select set_config('nganda.utilisateur_id', 'aaaaaaaa-0000-0000-0000-000000000001', false);

-- Produits de test
insert into produits (terrasse_id, nom, categorie, prix_cdf, stock, seuil_alerte)
  select (select val::uuid from t_ids where cle = 'terA'), p.nom, p.cat, p.prix, p.stock, p.seuil
  from (values ('Primus','Bières',3000,50,10), ('Coca','Sodas',2000,5,10), ('Fanta','Sodas',1500,0,0))
       as p(nom, cat, prix, stock, seuil);
insert into t_ids select 'prod_' || nom, id::text from produits
  where terrasse_id = (select val::uuid from t_ids where cle = 'terA');
insert into t_ids select 'table1', id::text from tables
  where terrasse_id = (select val::uuid from t_ids where cle = 'terA') and numero = 1;

-- ---------------------------------------------------------------------------
-- T01 — Inscription : Propriétaire + Responsable + Gérant automatiques,
--        essai 14 jours démarré, rôle forcé ignoré par construction
-- ---------------------------------------------------------------------------
do $$
begin
  if (select count(*) from affectations
      where utilisateur_id = 'aaaaaaaa-0000-0000-0000-000000000001' and statut = 'ACTIVE') <> 3 then
    raise exception 'T01 ÉCHOUÉ : affectations automatiques incorrectes';
  end if;
  if not exists (select 1 from abonnements
                 where terrasse_id = (select val::uuid from t_ids where cle = 'terA')
                   and statut = 'ESSAI' and essai_fin = current_date + 14) then
    raise exception 'T01 ÉCHOUÉ : essai de 14 jours non démarré';
  end if;
  if (select count(*) from tables
      where terrasse_id = (select val::uuid from t_ids where cle = 'terA')) <> 5 then
    raise exception 'T01 ÉCHOUÉ : tables non créées';
  end if;
  raise notice 'T01 OK : inscription établissement (rôles auto + essai 14 j)';
end $$;

-- ---------------------------------------------------------------------------
-- T02 — Invitations : création, consommation, usage unique, expiration, révocation
-- ---------------------------------------------------------------------------
-- Marie (Responsable de A) crée toutes les invitations de test
select set_config('nganda.utilisateur_id', 'aaaaaaaa-0000-0000-0000-000000000001', false);
insert into t_ids select 'inv_gerant',
  (creer_invitation((select val::uuid from t_ids where cle='terA'), 'GERANT', 'Paul')).code;
insert into t_ids select 'inv_expire',
  (creer_invitation((select val::uuid from t_ids where cle='terA'), 'SERVEUSE', 'Expirée')).code;
insert into t_ids select 'inv_revoquee',
  (creer_invitation((select val::uuid from t_ids where cle='terA'), 'SERVEUSE', 'Révoquée')).code;
insert into t_ids select 'inv_serveuse',
  (creer_invitation((select val::uuid from t_ids where cle='terA'), 'SERVEUSE', 'Léa')).code;

-- Une invitation périmée, une révoquée
update invitations set expire_le = now() - interval '1 hour'
  where code = (select val from t_ids where cle='inv_expire');
select revoquer_invitation((select id from invitations
  where code = (select val from t_ids where cle='inv_revoquee')));

-- Un GÉRANT ne peut PAS créer d'invitation (matrice des permissions)
select set_config('nganda.utilisateur_id', 'bbbbbbbb-0000-0000-0000-000000000002', false);
do $$
begin
  begin
    perform creer_invitation((select val::uuid from t_ids where cle='terA'), 'SERVEUSE', 'Nope');
    raise exception 'T02 ÉCHOUÉ : un gérant a créé une invitation';
  exception when others then
    if sqlerrm like 'T02%' then raise; end if;
  end;
end $$;

-- Paul consomme le code : affectation GERANT créée sans choisir son rôle
select consommer_invitation((select val from t_ids where cle = 'inv_gerant'));

do $$
begin
  if not exists (select 1 from affectations
                 where utilisateur_id = 'bbbbbbbb-0000-0000-0000-000000000002'
                   and role = 'GERANT' and statut = 'ACTIVE'
                   and terrasse_id = (select val::uuid from t_ids where cle = 'terA')) then
    raise exception 'T02 ÉCHOUÉ : affectation GERANT non créée par invitation';
  end if;

  -- Code déjà utilisé → refusé
  begin
    perform consommer_invitation((select val from t_ids where cle = 'inv_gerant'));
    raise exception 'T02 ÉCHOUÉ : invitation déjà utilisée acceptée';
  exception when others then
    if sqlerrm like 'T02%' then raise; end if;
  end;

  -- Code expiré → refusé (le statut EXPIREE est matérialisé par le cron,
  -- car le refus annule la transaction de consommation)
  begin
    perform consommer_invitation((select val from t_ids where cle = 'inv_expire'));
    raise exception 'T02 ÉCHOUÉ : invitation expirée acceptée';
  exception when others then
    if sqlerrm like 'T02%' then raise; end if;
  end;
  perform cron_abonnements();
  if not exists (select 1 from invitations
                 where code = (select val from t_ids where cle = 'inv_expire')
                   and statut = 'EXPIREE') then
    raise exception 'T02 ÉCHOUÉ : invitation expirée non marquée par le cron';
  end if;

  -- Code révoqué → refusé
  begin
    perform consommer_invitation((select val from t_ids where cle = 'inv_revoquee'));
    raise exception 'T02 ÉCHOUÉ : invitation révoquée acceptée';
  exception when others then
    if sqlerrm like 'T02%' then raise; end if;
  end;

  -- Code deviné → message générique (anti-énumération)
  begin
    perform consommer_invitation('XXXX9999');
    raise exception 'T02 ÉCHOUÉ : code inexistant accepté';
  exception when others then
    if sqlerrm like 'T02%' then raise; end if;
  end;
  raise notice 'T02 OK : cycle de vie des invitations';
end $$;

-- Léa rejoint comme SERVEUSE via une invitation valide
select set_config('nganda.utilisateur_id', 'cccccccc-0000-0000-0000-000000000003', false);
select consommer_invitation((select val from t_ids where cle = 'inv_serveuse'));
select set_config('nganda.utilisateur_id', 'aaaaaaaa-0000-0000-0000-000000000001', false);

-- ---------------------------------------------------------------------------
-- T03 — Cumuls : Responsable+Gérant AUTORISÉ ; Serveuse+Gérant INTERDIT ;
--        dernier Propriétaire IRRETIRABLE
-- ---------------------------------------------------------------------------
do $$
begin
  -- Marie cumule RESPONSABLE + GERANT sur la terrasse A : doit exister
  if not exists (select 1 from affectations
                 where utilisateur_id = 'aaaaaaaa-0000-0000-0000-000000000001'
                   and terrasse_id = (select val::uuid from t_ids where cle='terA')
                   and role = 'GERANT' and statut = 'ACTIVE') then
    raise exception 'T03 ÉCHOUÉ : cumul Responsable+Gérant refusé à tort';
  end if;

  -- Léa (serveuse A) + GERANT sur A : interdit
  begin
    insert into affectations (utilisateur_id, organisation_id, terrasse_id, role)
      values ('cccccccc-0000-0000-0000-000000000003',
              (select val::uuid from t_ids where cle='orgA'),
              (select val::uuid from t_ids where cle='terA'), 'GERANT');
    raise exception 'T03 ÉCHOUÉ : cumul SERVEUSE+GERANT accepté';
  exception when others then
    if sqlerrm like 'T03%' then raise; end if;
  end;

  -- Retrait du dernier propriétaire : interdit
  begin
    update affectations set statut = 'DESACTIVEE'
      where utilisateur_id = 'aaaaaaaa-0000-0000-0000-000000000001' and role = 'PROPRIETAIRE';
    raise exception 'T03 ÉCHOUÉ : dernier propriétaire retiré';
  exception when others then
    if sqlerrm like 'T03%' then raise; end if;
  end;
  raise notice 'T03 OK : règles de cumul et dernier propriétaire';
end $$;

-- ---------------------------------------------------------------------------
-- T04 — QR : contexte de table via token opaque ; Léa assignée à la table 1
-- ---------------------------------------------------------------------------
insert into table_serveuse (terrasse_id, table_id, serveuse_id, assigne_par)
  values ((select val::uuid from t_ids where cle='terA'),
          (select val::uuid from t_ids where cle='table1'),
          'cccccccc-0000-0000-0000-000000000003',
          'aaaaaaaa-0000-0000-0000-000000000001');

do $$
declare v_ctx jsonb;
begin
  v_ctx := obtenir_contexte_table((select token_qr from tables where id = (select val::uuid from t_ids where cle='table1')));
  if v_ctx -> 'serveuse' ->> 'nom' is distinct from 'Léa Kabongo' then
    raise exception 'T04 ÉCHOUÉ : serveuse non retournée par le contexte QR';
  end if;

  -- Un seul lien actif par table
  begin
    insert into table_serveuse (terrasse_id, table_id, serveuse_id)
      values ((select val::uuid from t_ids where cle='terA'),
              (select val::uuid from t_ids where cle='table1'),
              'cccccccc-0000-0000-0000-000000000003');
    raise exception 'T04 ÉCHOUÉ : deux assignations actives sur la même table';
  exception when others then
    if sqlerrm like 'T04%' then raise; end if;
  end;
  raise notice 'T04 OK : contexte QR + unicité de l''assignation';
end $$;

-- ---------------------------------------------------------------------------
-- T05 — Commande client : passage atomique, réservation de stock, idempotence
-- ---------------------------------------------------------------------------
-- Le client est en session ANONYME Supabase : on simule son JWT.
select set_config('request.jwt.claims', '{"sub":"ffffffff-0000-0000-0000-000000000006"}', false);
select creer_session_client((select token_qr from tables where id = (select val::uuid from t_ids where cle='table1')), 'Jean K.');

insert into t_ids
  select 'cmd1', passer_commande('cle-test-1',
    jsonb_build_array(jsonb_build_object('produit_id', (select val from t_ids where cle='prod_Primus'), 'quantite', 2))
  ) ->> 'commande_id';

do $$
begin
  if not exists (select 1 from commandes where id = (select val::uuid from t_ids where cle='cmd1')
                 and statut = 'CONFIRMEE' and montant_total_cdf = 6000
                 and serveuse_id = 'cccccccc-0000-0000-0000-000000000003') then
    raise exception 'T05 ÉCHOUÉ : commande non confirmée / serveuse non assignée';
  end if;
  if (select stock_reserve from produits where id = (select val::uuid from t_ids where cle='prod_Primus')) <> 2 then
    raise exception 'T05 ÉCHOUÉ : stock non réservé';
  end if;
  if not exists (select 1 from mouvements_stock where type = 'RESERVATION'
                 and reference_id = (select val::uuid from t_ids where cle='cmd1')) then
    raise exception 'T05 ÉCHOUÉ : mouvement RESERVATION manquant';
  end if;
  if not exists (select 1 from notifications where type = 'COMMANDE_CONFIRMEE'
                 and utilisateur_id = 'cccccccc-0000-0000-0000-000000000003') then
    raise exception 'T05 ÉCHOUÉ : notification serveuse manquante';
  end if;
  -- Rejeu hors-ligne avec la même clé : pas de doublon
  if (passer_commande('cle-test-1',
        jsonb_build_array(jsonb_build_object('produit_id', (select val from t_ids where cle='prod_Primus'), 'quantite', 2))
      ) ->> 'commande_id')::uuid <> (select val::uuid from t_ids where cle='cmd1') then
    raise exception 'T05 ÉCHOUÉ : idempotence de la clé';
  end if;
  if (select stock_reserve from produits where id = (select val::uuid from t_ids where cle='prod_Primus')) <> 2 then
    raise exception 'T05 ÉCHOUÉ : rejeu hors-ligne a re-réservé du stock';
  end if;
  raise notice 'T05 OK : commande atomique + réservation + idempotence';
end $$;

-- Stock insuffisant → REFUSEE_STOCK (tout ou rien)
insert into t_ids
  select 'cmd2', passer_commande('cle-test-2',
    jsonb_build_array(jsonb_build_object('produit_id', (select val from t_ids where cle='prod_Coca'), 'quantite', 10))
  ) ->> 'commande_id';

do $$
begin
  if not exists (select 1 from commandes where id = (select val::uuid from t_ids where cle='cmd2')
                 and statut = 'REFUSEE_STOCK') then
    raise exception 'T06 ÉCHOUÉ : commande sans stock non refusée';
  end if;
  if (select stock_reserve from produits where id = (select val::uuid from t_ids where cle='prod_Coca')) <> 0 then
    raise exception 'T06 ÉCHOUÉ : réservation partielle interdite';
  end if;
  if not exists (select 1 from notifications where type = 'COMMANDE_REFUSEE_STOCK'
                 and client_session_id is not null) then
    raise exception 'T06 ÉCHOUÉ : client non notifié du refus';
  end if;
  raise notice 'T06 OK : refus de stock atomique + notifications';
end $$;

-- ---------------------------------------------------------------------------
-- T07 — Service : seule la serveuse assignée marque « Servi » ;
--        stock décrémenté, machine à états verrouillée, historique client
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims', '{}', false);

-- Une 2e commande confirmée pour les tests d'autorisation
select set_config('request.jwt.claims', '{"sub":"ffffffff-0000-0000-0000-000000000006"}', false);
insert into t_ids
  select 'cmd3', passer_commande('cle-test-3',
    jsonb_build_array(jsonb_build_object('produit_id', (select val from t_ids where cle='prod_Primus'), 'quantite', 1))
  ) ->> 'commande_id';
select set_config('request.jwt.claims', '{}', false);

-- Paul (GÉRANT) ne peut pas marquer « Servi »
select set_config('nganda.utilisateur_id', 'bbbbbbbb-0000-0000-0000-000000000002', false);
do $$
begin
  begin
    perform marquer_servie((select val::uuid from t_ids where cle='cmd3'));
    raise exception 'T07 ÉCHOUÉ : un gérant a marqué « Servi »';
  exception when others then
    if sqlerrm like 'T07%' then raise; end if;
  end;
end $$;

-- Léa ouvre sa session et sert
select set_config('nganda.utilisateur_id', 'cccccccc-0000-0000-0000-000000000003', false);
insert into t_ids select 'session1',
  (ouvrir_session((select val::uuid from t_ids where cle='terA'))).id::text;
select marquer_servie((select val::uuid from t_ids where cle='cmd1'));
select marquer_servie((select val::uuid from t_ids where cle='cmd3'));

do $$
begin
  if (select stock from produits where id = (select val::uuid from t_ids where cle='prod_Primus')) <> 47
     or (select stock_reserve from produits where id = (select val::uuid from t_ids where cle='prod_Primus')) <> 0 then
    raise exception 'T07 ÉCHOUÉ : stock/réservation incohérents après service (47 / 0 attendus)';
  end if;
  if (select count(*) from mouvements_stock where type = 'VENTE') <> 2 then
    raise exception 'T07 ÉCHOUÉ : mouvements VENTE manquants';
  end if;
  if not exists (select 1 from historique_client
                 where terrasse_id = (select val::uuid from t_ids where cle='terA')
                   and identifiant = 'nom:jean k.' and visites = 2 and depense_total_cdf = 9000) then
    raise exception 'T07 ÉCHOUÉ : historique client incorrect';
  end if;
  -- Idempotence : servir une commande déjà servie ne fait rien
  perform marquer_servie((select val::uuid from t_ids where cle='cmd1'));
  if (select stock from produits where id = (select val::uuid from t_ids where cle='prod_Primus')) <> 47 then
    raise exception 'T07 ÉCHOUÉ : double « Servi » a re-décrémenté le stock';
  end if;
  -- Machine à états : retour en arrière interdit, même en SQL direct
  begin
    update commandes set statut = 'EN_ATTENTE' where id = (select val::uuid from t_ids where cle='cmd1');
    raise exception 'T07 ÉCHOUÉ : transition SERVIE → EN_ATTENTE acceptée';
  exception when others then
    if sqlerrm like 'T07%' then raise; end if;
  end;
  -- Annulation après service : interdite
  begin
    perform annuler_commande((select val::uuid from t_ids where cle='cmd1'), 'test');
    raise exception 'T07 ÉCHOUÉ : annulation après service acceptée';
  exception when others then
    if sqlerrm like 'T07%' then raise; end if;
  end;
  raise notice 'T07 OK : service, stock, machine à états, historique client';
end $$;

-- ---------------------------------------------------------------------------
-- T08 — Annulation avec libération du stock réservé
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub":"ffffffff-0000-0000-0000-000000000006"}', false);
insert into t_ids
  select 'cmd4', passer_commande('cle-test-4',
    jsonb_build_array(jsonb_build_object('produit_id', (select val from t_ids where cle='prod_Primus'), 'quantite', 3))
  ) ->> 'commande_id';
select set_config('request.jwt.claims', '{}', false);

do $$
begin
  if (select stock_reserve from produits where id = (select val::uuid from t_ids where cle='prod_Primus')) <> 3 then
    raise exception 'T08 ÉCHOUÉ : réservation avant annulation';
  end if;
end $$;

-- Annulation sans motif : refusée
select set_config('nganda.utilisateur_id', 'bbbbbbbb-0000-0000-0000-000000000002', false);
do $$
begin
  begin
    perform annuler_commande((select val::uuid from t_ids where cle='cmd4'), null);
    raise exception 'T08 ÉCHOUÉ : annulation sans motif acceptée';
  exception when others then
    if sqlerrm like 'T08%' then raise; end if;
  end;
end $$;

-- Annulation par le gérant avec motif : stock libéré et tracé
select annuler_commande((select val::uuid from t_ids where cle='cmd4'), 'Client parti');

do $$
begin
  if (select stock_reserve from produits where id = (select val::uuid from t_ids where cle='prod_Primus')) <> 0 then
    raise exception 'T08 ÉCHOUÉ : stock réservé non libéré';
  end if;
  if not exists (select 1 from mouvements_stock where type = 'LIBERATION'
                 and reference_id = (select val::uuid from t_ids where cle='cmd4')) then
    raise exception 'T08 ÉCHOUÉ : mouvement LIBERATION manquant';
  end if;
  raise notice 'T08 OK : annulation + libération du stock réservé';
end $$;

-- ---------------------------------------------------------------------------
-- T09 — Fin de service, dépôt, écart, validation ; nul ne valide son dépôt
-- ---------------------------------------------------------------------------
select set_config('nganda.utilisateur_id', 'cccccccc-0000-0000-0000-000000000003', false);
select cloturer_session((select val::uuid from t_ids where cle='session1'));

do $$
begin
  -- attendu = 6000 (cmd1) + 3000 (cmd3) = 9000
  if (select montant_attendu_cdf from sessions_service
      where id = (select val::uuid from t_ids where cle='session1')) <> 9000 then
    raise exception 'T09 ÉCHOUÉ : montant attendu incorrect';
  end if;
  -- Écart sans motif : refusé
  begin
    perform declarer_depot((select val::uuid from t_ids where cle='session1'), 8000, null);
    raise exception 'T09 ÉCHOUÉ : écart sans motif accepté';
  exception when others then
    if sqlerrm like 'T09%' then raise; end if;
  end;
end $$;

insert into t_ids select 'depot1',
  (declarer_depot((select val::uuid from t_ids where cle='session1'), 8000, 'Manque de monnaie')).id::text;

do $$
begin
  if (select ecart_cdf from depots where id = (select val::uuid from t_ids where cle='depot1')) <> -1000 then
    raise exception 'T09 ÉCHOUÉ : calcul d''écart incorrect';
  end if;
  -- Seuil 10 000 FC : écart de 1 000 → PAS d'alerte fraude
  if exists (select 1 from alertes where type = 'ECART_CAISSE'
             and reference_id = (select val::uuid from t_ids where cle='depot1')) then
    raise exception 'T09 ÉCHOUÉ : alerte fraude sous le seuil';
  end if;
  -- Session clôturée : immuable
  begin
    update sessions_service set montant_attendu_cdf = 0
      where id = (select val::uuid from t_ids where cle='session1');
    raise exception 'T09 ÉCHOUÉ : session clôturée modifiée';
  exception when others then
    if sqlerrm like 'T09%' then raise; end if;
  end;
end $$;

-- La serveuse ne valide PAS son propre dépôt (elle n'a de toute façon pas le rôle)
select set_config('nganda.utilisateur_id', 'cccccccc-0000-0000-0000-000000000003', false);
do $$
begin
  begin
    perform valider_depot((select val::uuid from t_ids where cle='depot1'), true);
    raise exception 'T09 ÉCHOUÉ : validation par la serveuse acceptée';
  exception when others then
    if sqlerrm like 'T09%' then raise; end if;
  end;
end $$;

-- Auto-validation : un GÉRANT ne peut pas valider un dépôt dont IL est le déposant
insert into sessions_service (terrasse_id, serveuse_id, statut, montant_attendu_cdf, cloturee_le)
  values ((select val::uuid from t_ids where cle='terA'),
          'bbbbbbbb-0000-0000-0000-000000000002', 'CLOTUREE', 5000, now());
insert into depots (session_id, terrasse_id, serveuse_id, montant_attendu_cdf, montant_depose_cdf)
  select s.id, s.terrasse_id, s.serveuse_id, 5000, 5000
    from sessions_service s
   where s.terrasse_id = (select val::uuid from t_ids where cle='terA')
     and s.serveuse_id = 'bbbbbbbb-0000-0000-0000-000000000002' and s.statut = 'CLOTUREE';

select set_config('nganda.utilisateur_id', 'bbbbbbbb-0000-0000-0000-000000000002', false);
do $$
declare v_depot uuid;
begin
  select d.id into v_depot from depots d
    where d.serveuse_id = 'bbbbbbbb-0000-0000-0000-000000000002' and d.statut = 'DECLARE';
  begin
    perform valider_depot(v_depot, true);
    raise exception 'T09 ÉCHOUÉ : nul ne valide son propre dépôt — contourné';
  exception when others then
    if sqlerrm like 'T09%' then raise; end if;
  end;
end $$;

-- Le gérant valide ; notification à la serveuse ; idempotent au rejeu
select set_config('nganda.utilisateur_id', 'bbbbbbbb-0000-0000-0000-000000000002', false);
select valider_depot((select val::uuid from t_ids where cle='depot1'), true);

do $$
begin
  if not exists (select 1 from depots where id = (select val::uuid from t_ids where cle='depot1')
                 and statut = 'VALIDE' and valide_par = 'bbbbbbbb-0000-0000-0000-000000000002') then
    raise exception 'T09 ÉCHOUÉ : dépôt non validé';
  end if;
  if not exists (select 1 from notifications where type = 'DEPOT_VALIDE'
                 and utilisateur_id = 'cccccccc-0000-0000-0000-000000000003') then
    raise exception 'T09 ÉCHOUÉ : serveuse non notifiée';
  end if;
  if not exists (select 1 from audit_log where action = 'DEPOT_VALIDE'
                 and entite_id = (select val::uuid from t_ids where cle='depot1')) then
    raise exception 'T09 ÉCHOUÉ : audit manquant';
  end if;
  raise notice 'T09 OK : fin de service, dépôt, écart, validation, audit';
end $$;

-- Alerte fraude au-delà du seuil + dédoublonnage des rôles cumulés
update terrasses set parametres = jsonb_set(parametres, '{seuil_ecart_cdf}', '500')
  where id = (select val::uuid from t_ids where cle='terA');

select set_config('nganda.utilisateur_id', 'cccccccc-0000-0000-0000-000000000003', false);
insert into t_ids select 'session2',
  (ouvrir_session((select val::uuid from t_ids where cle='terA'))).id::text;
select set_config('request.jwt.claims', '{"sub":"ffffffff-0000-0000-0000-000000000006"}', false);
insert into t_ids
  select 'cmd5', passer_commande('cle-test-5',
    jsonb_build_array(jsonb_build_object('produit_id', (select val from t_ids where cle='prod_Primus'), 'quantite', 1))
  ) ->> 'commande_id';
select set_config('request.jwt.claims', '{}', false);
select set_config('nganda.utilisateur_id', 'cccccccc-0000-0000-0000-000000000003', false);
select marquer_servie((select val::uuid from t_ids where cle='cmd5'));
select cloturer_session((select val::uuid from t_ids where cle='session2'));
insert into t_ids select 'depot2',
  (declarer_depot((select val::uuid from t_ids where cle='session2'), 2000, 'Billet faux')).id::text;

do $$
begin
  if not exists (select 1 from alertes where type = 'ECART_CAISSE' and severite = 'CRITIQUE'
                 and reference_id = (select val::uuid from t_ids where cle='depot2')) then
    raise exception 'T10 ÉCHOUÉ : alerte fraude manquante';
  end if;
  -- Marie est GERANT + RESPONSABLE + PROPRIETAIRE : UNE SEULE notification
  if (select count(*) from notifications where type = 'ECART_CAISSE'
      and utilisateur_id = 'aaaaaaaa-0000-0000-0000-000000000001') <> 1 then
    raise exception 'T10 ÉCHOUÉ : notification dupliquée pour rôles cumulés';
  end if;
  -- Paul (gérant) notifié aussi
  if (select count(*) from notifications where type = 'ECART_CAISSE'
      and utilisateur_id = 'bbbbbbbb-0000-0000-0000-000000000002') <> 1 then
    raise exception 'T10 ÉCHOUÉ : gérant non notifié de l''écart';
  end if;
  raise notice 'T10 OK : alerte fraude au-delà du seuil + notifications dédoublonnées';
end $$;

-- ---------------------------------------------------------------------------
-- T11 — Stock manuel : règle d'or, motif obligatoire, bornes, journalisation
-- ---------------------------------------------------------------------------
select set_config('nganda.utilisateur_id', 'aaaaaaaa-0000-0000-0000-000000000001', false);
select set_config('nganda.role_actif', 'RESPONSABLE', false);

do $$
begin
  -- Entrée +24 sur Fanta (stock 0)
  perform ajuster_stock((select val::uuid from t_ids where cle='prod_Fanta'), 'ENTREE', 24, 'Livraison brasserie');
  if (select stock from produits where id = (select val::uuid from t_ids where cle='prod_Fanta')) <> 24 then
    raise exception 'T11 ÉCHOUÉ : entrée de stock';
  end if;
  -- Perte 4
  perform ajuster_stock((select val::uuid from t_ids where cle='prod_Fanta'), 'PERTE', 4, 'Casse');
  if (select stock from produits where id = (select val::uuid from t_ids where cle='prod_Fanta')) <> 20 then
    raise exception 'T11 ÉCHOUÉ : perte de stock';
  end if;
  -- Inventaire : on compte 18 (delta -2 tracé)
  perform ajuster_stock((select val::uuid from t_ids where cle='prod_Fanta'), 'INVENTAIRE', 18, 'Inventaire tournant');
  if not exists (select 1 from mouvements_stock where type = 'INVENTAIRE' and quantite = -2
                 and produit_id = (select val::uuid from t_ids where cle='prod_Fanta')) then
    raise exception 'T11 ÉCHOUÉ : mouvement INVENTAIRE incorrect';
  end if;
  -- Types système réservés
  begin
    perform ajuster_stock((select val::uuid from t_ids where cle='prod_Fanta'), 'VENTE', 1, 'triche');
    raise exception 'T11 ÉCHOUÉ : type système accessible manuellement';
  exception when others then
    if sqlerrm like 'T11%' then raise; end if;
  end;
  -- Stock négatif interdit
  begin
    perform ajuster_stock((select val::uuid from t_ids where cle='prod_Fanta'), 'PERTE', 100, 'test');
    raise exception 'T11 ÉCHOUÉ : stock négatif accepté';
  exception when others then
    if sqlerrm like 'T11%' then raise; end if;
  end;
  -- Motif obligatoire
  begin
    perform ajuster_stock((select val::uuid from t_ids where cle='prod_Fanta'), 'ENTREE', 1, null);
    raise exception 'T11 ÉCHOUÉ : modification sans motif acceptée';
  exception when others then
    if sqlerrm like 'T11%' then raise; end if;
  end;
  -- Le GÉRANT ne peut PAS utiliser ajuster_stock
  perform set_config('nganda.utilisateur_id', 'bbbbbbbb-0000-0000-0000-000000000002', true);
  begin
    perform ajuster_stock((select val::uuid from t_ids where cle='prod_Fanta'), 'ENTREE', 1, 'tentative gérant');
    raise exception 'T11 ÉCHOUÉ : un gérant a modifié le stock';
  exception when others then
    if sqlerrm like 'T11%' then raise; end if;
  end;
  perform set_config('nganda.utilisateur_id', 'aaaaaaaa-0000-0000-0000-000000000001', true);
  raise notice 'T11 OK : règle d''or du stock (fonction)';
end $$;

-- Modification DIRECTE du stock : journalisée avec motif, refusée sans motif
do $$
declare v_bloque boolean := false;
begin
  begin
    update produits set stock = stock + 1 where id = (select val::uuid from t_ids where cle='prod_Fanta');
  exception when others then v_bloque := true; end;
  if not v_bloque then
    raise exception 'T12 ÉCHOUÉ : update direct du stock sans motif accepté';
  end if;
  raise notice 'T12 OK : update direct du stock sans motif refusé (trigger)';
end $$;

do $$
begin
  perform set_config('nganda.motif', 'Réappro directe test', true);
  update produits set stock = stock + 1 where id = (select val::uuid from t_ids where cle='prod_Fanta');
  if not exists (select 1 from mouvements_stock where type = 'AJUSTEMENT' and motif = 'Réappro directe test'
                 and produit_id = (select val::uuid from t_ids where cle='prod_Fanta')) then
    raise exception 'T12 ÉCHOUÉ : mouvement AJUSTEMENT non tracé';
  end if;
  raise exception 'ROLLBACK_VOLONTAIRE';   -- on annule ce mouvement de test
exception when others then
  if sqlerrm <> 'ROLLBACK_VOLONTAIRE' then raise; end if;
  raise notice 'T12 OK : update direct du stock tracé avec motif';
end $$;

-- Changement de prix : historisé avec la casquette active
update produits set prix_cdf = 3200 where id = (select val::uuid from t_ids where cle='prod_Primus');
do $$
begin
  if not exists (select 1 from historique_prix
                 where produit_id = (select val::uuid from t_ids where cle='prod_Primus')
                   and ancien_prix_cdf = 3000 and nouveau_prix_cdf = 3200
                   and role_actif = 'RESPONSABLE') then
    raise exception 'T13 ÉCHOUÉ : historique_prix incomplet (role_actif manquant)';
  end if;
  raise notice 'T13 OK : historique des prix avec role_actif';
end $$;

-- ---------------------------------------------------------------------------
-- T14 — Demandes de stock du gérant : approbation = exécution tracée
-- ---------------------------------------------------------------------------
select set_config('nganda.utilisateur_id', 'bbbbbbbb-0000-0000-0000-000000000002', false);
insert into t_ids select 'dem1',
  (creer_demande_stock((select val::uuid from t_ids where cle='prod_Coca'), 'REAPPRO', 12, 'Stock bas')).id::text;

do $$
begin
  if not exists (select 1 from notifications where type = 'DEMANDE_STOCK'
                 and utilisateur_id = 'aaaaaaaa-0000-0000-0000-000000000001') then
    raise exception 'T14 ÉCHOUÉ : responsable non notifié de la demande';
  end if;
  -- Le gérant ne peut pas approuver lui-même
  begin
    perform traiter_demande_stock((select val::uuid from t_ids where cle='dem1'), true);
    raise exception 'T14 ÉCHOUÉ : un gérant a approuvé sa demande';
  exception when others then
    if sqlerrm like 'T14%' then raise; end if;
  end;
end $$;

select set_config('nganda.utilisateur_id', 'aaaaaaaa-0000-0000-0000-000000000001', false);
select traiter_demande_stock((select val::uuid from t_ids where cle='dem1'), true);

do $$
declare v_stock_avant int;
begin
  -- Coca : 5 au départ, cmd2 refusée (0 réservé/consommé) → 5 + 12 = 17
  if (select stock from produits where id = (select val::uuid from t_ids where cle='prod_Coca')) <> 17 then
    raise exception 'T14 ÉCHOUÉ : approbation sans exécution du mouvement';
  end if;
  if not exists (select 1 from mouvements_stock where type = 'ENTREE'
                 and reference_type = 'demande_stock'
                 and reference_id = (select val::uuid from t_ids where cle='dem1')) then
    raise exception 'T14 ÉCHOUÉ : mouvement de la demande non tracé';
  end if;
  -- Refus sans motif : refusé
  perform set_config('nganda.utilisateur_id', 'bbbbbbbb-0000-0000-0000-000000000002', true);
  insert into t_ids select 'dem2',
    (creer_demande_stock((select val::uuid from t_ids where cle='prod_Coca'), 'PERTE', 1, 'Casse')).id::text
  on conflict (cle) do nothing;
  perform set_config('nganda.utilisateur_id', 'aaaaaaaa-0000-0000-0000-000000000001', true);
  begin
    perform traiter_demande_stock((select val::uuid from t_ids where cle='dem2'), false, null);
    raise exception 'T14 ÉCHOUÉ : refus sans motif accepté';
  exception when others then
    if sqlerrm like 'T14%' then raise; end if;
  end;
  perform traiter_demande_stock((select val::uuid from t_ids where cle='dem2'), false, 'Photo manquante');
  if not exists (select 1 from demandes_stock where id = (select val::uuid from t_ids where cle='dem2')
                 and statut = 'REFUSEE') then
    raise exception 'T14 ÉCHOUÉ : refus non enregistré';
  end if;
  raise notice 'T14 OK : demandes de stock (approbation exécute, refus motivé)';
end $$;

-- ---------------------------------------------------------------------------
-- T15 — Avis : uniquement commande SERVIE, un seul avis par commande
-- ---------------------------------------------------------------------------
do $$
begin
  insert into avis_serveuse (commande_id, terrasse_id, serveuse_id, note)
    values ((select val::uuid from t_ids where cle='cmd1'),
            (select val::uuid from t_ids where cle='terA'),
            'cccccccc-0000-0000-0000-000000000003', 5);
  begin
    insert into avis_serveuse (commande_id, terrasse_id, serveuse_id, note)
      values ((select val::uuid from t_ids where cle='cmd1'),
              (select val::uuid from t_ids where cle='terA'),
              'cccccccc-0000-0000-0000-000000000003', 4);
    raise exception 'T15 ÉCHOUÉ : deux avis sur la même commande';
  exception when others then
    if sqlerrm like 'T15%' then raise; end if;
  end;
  begin
    insert into avis_serveuse (commande_id, terrasse_id, serveuse_id, note)
      values ((select val::uuid from t_ids where cle='cmd2'),
              (select val::uuid from t_ids where cle='terA'),
              'cccccccc-0000-0000-0000-000000000003', 1);
    raise exception 'T15 ÉCHOUÉ : avis sur commande non servie';
  exception when others then
    if sqlerrm like 'T15%' then raise; end if;
  end;
  raise notice 'T15 OK : avis (unicité + commande servie)';
end $$;

-- ---------------------------------------------------------------------------
-- T16 — Historiques append-only : UPDATE/DELETE interdits à tous
-- ---------------------------------------------------------------------------
do $$
begin
  begin
    update mouvements_stock set motif = 'triche'
      where id = (select id from mouvements_stock limit 1);
    raise exception 'T16 ÉCHOUÉ : mouvements_stock modifiable';
  exception when others then
    if sqlerrm like 'T16%' then raise; end if;
  end;
  begin
    delete from historique_prix;
    raise exception 'T16 ÉCHOUÉ : historique_prix supprimable';
  exception when others then
    if sqlerrm like 'T16%' then raise; end if;
  end;
  begin
    delete from audit_log;
    raise exception 'T16 ÉCHOUÉ : audit_log supprimable';
  exception when others then
    if sqlerrm like 'T16%' then raise; end if;
  end;
  raise notice 'T16 OK : tables d''historique immuables';
end $$;

-- ---------------------------------------------------------------------------
-- T17 — RLS : 403 gérant/serveuse sur stock-prix, cloisonnement inter-org
-- (Simulation JWT via request.jwt.claims — éditeur SQL Supabase)
-- ---------------------------------------------------------------------------
select set_config('nganda.utilisateur_id', '', false);
select set_config('nganda.role_actif', '', false);

-- Paul = GÉRANT de A : modification de prix/stock refusée EN BASE
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"bbbbbbbb-0000-0000-0000-000000000002","role":"authenticated"}';
update produits set prix_cdf = 9999 where id = (select val::uuid from t_ids where cle='prod_Primus');
update produits set stock = 0       where id = (select val::uuid from t_ids where cle='prod_Primus');
do $$
begin
  if exists (select 1 from produits where id = (select val::uuid from t_ids where cle='prod_Primus')
             and (prix_cdf = 9999 or stock = 0)) then
    raise exception 'T17 ÉCHOUÉ : un gérant a modifié prix/stock en direct (RLS)';
  end if;
  -- Lecture : autorisée pour le gérant
  if not exists (select 1 from produits where id = (select val::uuid from t_ids where cle='prod_Primus')) then
    raise exception 'T17 ÉCHOUÉ : lecture stock refusée au gérant';
  end if;
  -- Étanchéité : Paul ne voit RIEN de l'organisation de Rosa
  if exists (select 1 from terrasses where organisation_id = (select val::uuid from t_ids where cle='orgB')) then
    raise exception 'T17 ÉCHOUÉ : fuite inter-organisations (terrasses)';
  end if;
end $$;
rollback;

-- Léa = SERVEUSE : idem + commandes limitées aux siennes
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"cccccccc-0000-0000-0000-000000000003","role":"authenticated"}';
update produits set seuil_alerte = 0 where id = (select val::uuid from t_ids where cle='prod_Primus');
do $$
declare v_nb int;
begin
  if exists (select 1 from produits where id = (select val::uuid from t_ids where cle='prod_Primus')
             and seuil_alerte = 0) then
    raise exception 'T18 ÉCHOUÉ : une serveuse a modifié un seuil (RLS)';
  end if;
  select count(*) into v_nb from commandes;
  if v_nb <> 5 then   -- toutes les commandes ont serveuse_id = Léa (table 1)
    raise exception 'T18 ÉCHOUÉ : périmètre serveuse incorrect (% commandes)', v_nb;
  end if;
end $$;
rollback;

-- Marie = RESPONSABLE de A : modification AUTORISÉE, historisée au bon utilisateur
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"aaaaaaaa-0000-0000-0000-000000000001","role":"authenticated"}';
update produits set prix_cdf = 3500 where id = (select val::uuid from t_ids where cle='prod_Primus');
do $$
begin
  if not exists (select 1 from produits where id = (select val::uuid from t_ids where cle='prod_Primus')
                 and prix_cdf = 3500) then
    raise exception 'T19 ÉCHOUÉ : modification Responsable refusée';
  end if;
  if not exists (select 1 from historique_prix
                 where produit_id = (select val::uuid from t_ids where cle='prod_Primus')
                   and nouveau_prix_cdf = 3500
                   and modifie_par = 'aaaaaaaa-0000-0000-0000-000000000001') then
    raise exception 'T19 ÉCHOUÉ : historique_prix non attribué au bon utilisateur';
  end if;
  -- Marie ne voit pas la terrasse de Rosa
  if exists (select 1 from terrasses where id = (select val::uuid from t_ids where cle='terB')) then
    raise exception 'T19 ÉCHOUÉ : fuite inter-organisations';
  end if;
end $$;
rollback;   -- prix restauré à 3200 pour la suite

do $$ begin
  raise notice 'T17-T19 OK : RLS (403 gérant/serveuse, droits responsable, étanchéité)';
end $$;

-- ---------------------------------------------------------------------------
-- T20 — LECTURE_SEULE : écritures refusées EN BASE, lecture et export possibles
-- ---------------------------------------------------------------------------
update abonnements set statut = 'LECTURE_SEULE'
  where terrasse_id = (select val::uuid from t_ids where cle='terA');

begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"aaaaaaaa-0000-0000-0000-000000000001","role":"authenticated"}';
update produits set prix_cdf = 9999 where id = (select val::uuid from t_ids where cle='prod_Primus');
do $$
begin
  if exists (select 1 from produits where id = (select val::uuid from t_ids where cle='prod_Primus')
             and prix_cdf = 9999) then
    raise exception 'T20 ÉCHOUÉ : écriture acceptée en LECTURE_SEULE';
  end if;
  -- Lecture / export : toujours possible
  if not exists (select 1 from produits where id = (select val::uuid from t_ids where cle='prod_Primus')) then
    raise exception 'T20 ÉCHOUÉ : lecture refusée en LECTURE_SEULE';
  end if;
end $$;
rollback;

-- Le client, lui, voit un service indisponible (message neutre)
select set_config('request.jwt.claims', '{"sub":"ffffffff-0000-0000-0000-000000000006"}', false);
do $$
begin
  begin
    perform passer_commande('cle-test-ls',
      jsonb_build_array(jsonb_build_object('produit_id', (select val from t_ids where cle='prod_Primus'), 'quantite', 1)));
    raise exception 'T20 ÉCHOUÉ : commande acceptée en LECTURE_SEULE';
  exception when others then
    if sqlerrm like 'T20%' then raise; end if;
    if sqlerrm not like '%momentanément indisponible%' then
      raise exception 'T20 ÉCHOUÉ : le client voit un détail de facturation';
    end if;
  end;
end $$;
select set_config('request.jwt.claims', '{}', false);

-- Retour à l'essai pour la suite
update abonnements set statut = 'ESSAI', essai_fin = current_date + 14, periode_fin = current_date + 14
  where terrasse_id = (select val::uuid from t_ids where cle='terA');
do $$ begin
  raise notice 'T20 OK : LECTURE_SEULE bloque en base, lecture/export préservés';
end $$;

-- ---------------------------------------------------------------------------
-- T21 — Feature flags : ESSAI = accès Pro complet, jamais Business
-- ---------------------------------------------------------------------------
do $$
begin
  if not plan_autorise((select val::uuid from t_ids where cle='terA'), 'consignes') then
    raise exception 'T21 ÉCHOUÉ : essai sans accès Pro (consignes)';
  end if;
  if plan_autorise((select val::uuid from t_ids where cle='terA'), 'crm') then
    raise exception 'T21 ÉCHOUÉ : essai avec accès Business (crm)';
  end if;
  raise notice 'T21 OK : feature flags par plan (essai = Pro)';
end $$;

-- ---------------------------------------------------------------------------
-- T22 — Cron quotidien : ESSAI → EN_GRACE → LECTURE_SEULE → SUSPENDU + rappels
-- ---------------------------------------------------------------------------
select set_config('nganda.utilisateur_id', 'aaaaaaaa-0000-0000-0000-000000000001', false);

do $$
begin
  -- Rappel J-7 pour la terrasse B (essai à +7 j)
  update abonnements set essai_fin = current_date + 7, periode_fin = current_date + 7
    where terrasse_id = (select val::uuid from t_ids where cle='terB');
  perform cron_abonnements();
  if not exists (select 1 from notifications where type = 'ESSAI_RAPPEL') then
    raise exception 'T22 ÉCHOUÉ : rappel J-7 non envoyé';
  end if;
  -- Idempotent : second passage, pas de doublon
  perform cron_abonnements();
  if (select count(*) from notifications where type = 'ESSAI_RAPPEL') <> 1 then
    raise exception 'T22 ÉCHOUÉ : rappel dupliqué';
  end if;

  -- Échéance dépassée → EN_GRACE (+7 j)
  update abonnements set statut = 'ESSAI', essai_fin = current_date - 1, periode_fin = current_date - 1
    where terrasse_id = (select val::uuid from t_ids where cle='terA');
  perform cron_abonnements();
  if not exists (select 1 from abonnements
                 where terrasse_id = (select val::uuid from t_ids where cle='terA')
                   and statut = 'EN_GRACE' and grace_fin = current_date + 6) then
    raise exception 'T22 ÉCHOUÉ : passage en grâce';
  end if;

  -- Grâce dépassée → LECTURE_SEULE
  update abonnements set grace_fin = current_date - 1
    where terrasse_id = (select val::uuid from t_ids where cle='terA');
  perform cron_abonnements();
  if not exists (select 1 from abonnements
                 where terrasse_id = (select val::uuid from t_ids where cle='terA')
                   and statut = 'LECTURE_SEULE') then
    raise exception 'T22 ÉCHOUÉ : passage en lecture seule';
  end if;

  -- 60 jours d'impayé → SUSPENDU (données conservées)
  update abonnements set statut_change_le = now() - interval '61 days'
    where terrasse_id = (select val::uuid from t_ids where cle='terA');
  perform cron_abonnements();
  if not exists (select 1 from abonnements
                 where terrasse_id = (select val::uuid from t_ids where cle='terA')
                   and statut = 'SUSPENDU') then
    raise exception 'T22 ÉCHOUÉ : passage en suspendu';
  end if;
  if not exists (select 1 from produits where terrasse_id = (select val::uuid from t_ids where cle='terA')) then
    raise exception 'T22 ÉCHOUÉ : données supprimées après suspension';
  end if;
  raise notice 'T22 OK : cycle de vie des abonnements (cron idempotent)';
end $$;

-- ---------------------------------------------------------------------------
-- T23 — Facturation : montants calculés serveur, remises, validation admin
-- ---------------------------------------------------------------------------
-- 3e et 4e terrasses → palier de remise -15 %
select creer_terrasse('Terrasse C', 'Likasi', 4);
select creer_terrasse('Terrasse D', 'Kolwezi', 6);

insert into t_ids select 'pay1',
  (soumettre_paiement((select val::uuid from t_ids where cle='terA'), 'ESSENTIEL', false,
                      'MPESA', 'TXN-TEST-001'))::text;

do $$
declare v_pay jsonb;
begin
  -- Rosa paie SA terrasse B (seule dans son org → pas de remise)
  perform set_config('nganda.utilisateur_id', 'dddddddd-0000-0000-0000-000000000004', true);
  v_pay := soumettre_paiement((select val::uuid from t_ids where cle='terB'), 'ESSENTIEL', false,
                              'AIRTEL_MONEY', 'TXN-TEST-002');
  -- 2000 + 5000 (installation) = 7000 centimes
  if (v_pay ->> 'montant_usd_centimes')::int <> 7000 then
    raise exception 'T23 ÉCHOUÉ : montant terrasse B (% ≠ 7000)', v_pay ->> 'montant_usd_centimes';
  end if;
end $$;

do $$
declare v_pay jsonb;
begin
  -- Terrasse A : l'org de Marie a 3 terrasses → -15 % ; installation déjà facturée
  v_pay := soumettre_paiement((select val::uuid from t_ids where cle='terA'), 'ESSENTIEL', false,
                              'MPESA', 'TXN-TEST-003');
  -- 2000 × 0,85 = 1700 ; frais déjà payés (facture pay1 existe) → 1700
  if (v_pay ->> 'montant_usd_centimes')::int <> 1700 then
    raise exception 'T23 ÉCHOUÉ : remise multi-terrasses (% ≠ 1700)', v_pay ->> 'montant_usd_centimes';
  end if;
  if (v_pay ->> 'remise_appliquee_pct')::numeric <> 15 then
    raise exception 'T23 ÉCHOUÉ : palier de remise incorrect';
  end if;
  -- Annuel : 10 mois payés pour 12 → 2000 × 10 × 0,85 = 17000
  v_pay := soumettre_paiement((select val::uuid from t_ids where cle='terA'), 'ESSENTIEL', true,
                              'ORANGE_MONEY', 'TXN-TEST-004');
  if (v_pay ->> 'montant_usd_centimes')::int <> 17000 then
    raise exception 'T23 ÉCHOUÉ : tarif annuel (% ≠ 17000)', v_pay ->> 'montant_usd_centimes';
  end if;
end $$;

-- Un non-super-admin ne valide pas
do $$
declare v_paiement uuid;
begin
  select p.id into v_paiement from paiements p
    join factures f on f.id = p.facture_id
   where f.terrasse_id = (select val::uuid from t_ids where cle='terA')
   order by p.created_at limit 1;
  begin
    perform valider_paiement(v_paiement, true);   -- exécuté par Marie (pas super-admin)
    raise exception 'T23 ÉCHOUÉ : validation par un non super-admin';
  exception when others then
    if sqlerrm like 'T23%' then raise; end if;
  end;
end $$;

-- Super-admin : validation → ACTIF immédiat ; rejeu idempotent
insert into super_admins (utilisateur_id) values ('eeeeeeee-0000-0000-0000-000000000005')
on conflict do nothing;
select set_config('nganda.utilisateur_id', 'eeeeeeee-0000-0000-0000-000000000005', false);

do $$
declare v_paiement uuid; v_fin date;
begin
  select p.id into v_paiement from paiements p
    join factures f on f.id = p.facture_id
   where f.terrasse_id = (select val::uuid from t_ids where cle='terA') and p.statut = 'EN_ATTENTE'
   order by p.created_at limit 1;

  perform valider_paiement(v_paiement, true);
  if not exists (select 1 from abonnements
                 where terrasse_id = (select val::uuid from t_ids where cle='terA')
                   and statut = 'ACTIF' and periode_fin = current_date + interval '1 month') then
    raise exception 'T23 ÉCHOUÉ : réactivation immédiate au paiement';
  end if;
  if not exists (select 1 from notifications where type = 'PAIEMENT_VALIDE') then
    raise exception 'T23 ÉCHOUÉ : notification de validation manquante';
  end if;
  -- Webhook rejoué / double validation : pas de double crédit
  select periode_fin into v_fin from abonnements
    where terrasse_id = (select val::uuid from t_ids where cle='terA');
  perform valider_paiement(v_paiement, true);
  if (select periode_fin from abonnements
      where terrasse_id = (select val::uuid from t_ids where cle='terA')) <> v_fin then
    raise exception 'T23 ÉCHOUÉ : double validation = double crédit';
  end if;
  raise notice 'T23 OK : facturation, remises, validation admin idempotente';
end $$;

-- Refus de paiement + notification
do $$
declare v_paiement uuid;
begin
  select p.id into v_paiement from paiements p
    join factures f on f.id = p.facture_id
   where f.terrasse_id = (select val::uuid from t_ids where cle='terB') and p.statut = 'EN_ATTENTE'
   limit 1;
  perform valider_paiement(v_paiement, false, 'Référence introuvable chez l''opérateur');
  if not exists (select 1 from paiements where id = v_paiement and statut = 'REFUSE') then
    raise exception 'T24 ÉCHOUÉ : refus de paiement';
  end if;
  if not exists (select 1 from notifications where type = 'PAIEMENT_REFUSE') then
    raise exception 'T24 ÉCHOUÉ : notification de refus manquante';
  end if;
  raise notice 'T24 OK : refus de paiement notifié au propriétaire';
end $$;

-- ---------------------------------------------------------------------------
-- T25 — Changement de plan : montée immédiate, descente à l'échéance ;
--        prolongation exceptionnelle réservée au super-admin
-- ---------------------------------------------------------------------------
select set_config('nganda.utilisateur_id', 'aaaaaaaa-0000-0000-0000-000000000001', false);
do $$
begin
  perform changer_plan((select val::uuid from t_ids where cle='terA'), 'PRO');
  if not exists (select 1 from abonnements ab join plans p on p.id = ab.plan_id
                 where ab.terrasse_id = (select val::uuid from t_ids where cle='terA')
                   and p.code = 'PRO') then
    raise exception 'T25 ÉCHOUÉ : montée de plan immédiate';
  end if;
  perform changer_plan((select val::uuid from t_ids where cle='terA'), 'ESSENTIEL');
  if not exists (select 1 from abonnements ab
                 join plans pc on pc.id = ab.plan_id
                 join plans pn on pn.id = ab.plan_id_prochain
                 where ab.terrasse_id = (select val::uuid from t_ids where cle='terA')
                   and pc.code = 'PRO' and pn.code = 'ESSENTIEL') then
    raise exception 'T25 ÉCHOUÉ : descente de plan différée';
  end if;
  -- Prolongation : interdite au propriétaire, réservée au super-admin
  begin
    perform prolonger_abonnement((select val::uuid from t_ids where cle='terA'), 7);
    raise exception 'T25 ÉCHOUÉ : prolongation par un non super-admin';
  exception when others then
    if sqlerrm like 'T25%' then raise; end if;
  end;
  raise notice 'T25 OK : changements de plan + prolongation réservée';
end $$;

-- ---------------------------------------------------------------------------
-- T26 — Vues de rapports et d'abonnement
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from v_ventes_journalieres
                 where terrasse_id = (select val::uuid from t_ids where cle='terA')
                   and total_cdf > 0) then
    raise exception 'T26 ÉCHOUÉ : vue ventes journalières';
  end if;
  if not exists (select 1 from v_performance_serveuses
                 where terrasse_id = (select val::uuid from t_ids where cle='terA')
                   and note_moyenne = 5) then
    raise exception 'T26 ÉCHOUÉ : vue performance serveuses';
  end if;
  if not exists (select 1 from v_mrr where organisation_id = (select val::uuid from t_ids where cle='orgA')) then
    raise exception 'T26 ÉCHOUÉ : vue MRR';
  end if;
  raise notice 'T26 OK : vues de rapports (journalier, serveuses, MRR)';
end $$;

-- Nettoyage de la table de passage
drop table public.t_ids;

do $$ begin
  raise notice '';
  raise notice '============================================================';
  raise notice '  TOUS LES TESTS PASSENT — schéma Phase 1 validé';
  raise notice '============================================================';
end $$;
