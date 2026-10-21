-- ============================================================================
-- NGANDA POS — PHASE 1 : SCHÉMA DE DONNÉES COMPLET
-- SaaS PWA de gestion de terrasses (Lubumbashi, RDC)
-- Cible : projet Supabase VIERGE (PostgreSQL 15+)
-- Exécution : SQL Editor Supabase (un seul passage, dans l'ordre du fichier)
--             ou `supabase db push` en le plaçant dans supabase/migrations/
--
-- Conventions :
--   - Montants en ENTIERS : CDF en francs (integer/bigint), USD en centimes.
--   - Soft delete : colonne supprime_le / desactive_le, jamais de DELETE métier.
--   - Tables d'historique (mouvements_stock, historique_prix, audit_log) :
--     insertion via fonctions SQL uniquement, UPDATE/DELETE interdits à tous.
--   - Le client (sans compte) passe par une session anonyme Supabase
--     (anonymous sign-in) : auth.uid() porte son identité de session.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 0. EXTENSIONS
-- ---------------------------------------------------------------------------
create extension if not exists pgcrypto;        -- gen_random_uuid, gen_random_bytes, crypt

-- ---------------------------------------------------------------------------
-- 1. TYPES ÉNUMÉRÉS
-- ---------------------------------------------------------------------------
create type public.role_type as enum (
  'PROPRIETAIRE',   -- un par organisation (affectation sans terrasse)
  'RESPONSABLE',    -- stock, prix, équipe, dashboard complet de SA terrasse
  'GERANT',         -- lecture stock/prix, dépôts, QR, assignations, demandes
  'SERVEUSE'        -- commandes de ses tables, fin de service, dépôt
);

create type public.statut_affectation as enum ('ACTIVE', 'DESACTIVEE');

create type public.statut_invitation as enum ('ACTIVE', 'UTILISEE', 'EXPIREE', 'REVOQUEE');

create type public.statut_commande as enum (
  'EN_ATTENTE', 'CONFIRMEE', 'SERVIE', 'ANNULEE', 'REFUSEE_STOCK'
);

create type public.statut_session_service as enum ('OUVERTE', 'CLOTUREE');

create type public.statut_depot as enum ('DECLARE', 'VALIDE', 'CONTESTE');

create type public.type_mouvement_stock as enum (
  'ENTREE',        -- manuel : entrée / réappro (Responsable)
  'PERTE',         -- manuel : casse, perte (Responsable)
  'INVENTAIRE',    -- manuel : correction d'inventaire (Responsable)
  'AJUSTEMENT',    -- manuel : tout autre retrait/ajout tracé
  'RESERVATION',   -- automatique : confirmation de commande (système)
  'LIBERATION',    -- automatique : annulation / refus (système)
  'VENTE'          -- automatique : commande servie (système)
);

create type public.type_demande_stock as enum ('REAPPRO', 'PERTE', 'ECART');
create type public.statut_demande_stock as enum ('EN_ATTENTE', 'APPROUVEE', 'REFUSEE');

create type public.statut_abonnement as enum (
  'ESSAI',          -- 14 jours, accès Pro complet
  'ACTIF',
  'EN_GRACE',       -- 7 jours après échéance, tout fonctionne + bannière
  'LECTURE_SEULE',  -- consultation + export uniquement (bloqué en base)
  'SUSPENDU'        -- après 60 j d'impayé, accès bloqué sauf export
);

create type public.methode_paiement as enum (
  'MPESA', 'AIRTEL_MONEY', 'ORANGE_MONEY', 'ESPECES', 'AUTRE'
);
create type public.statut_paiement as enum ('EN_ATTENTE', 'VALIDE', 'REFUSE');
create type public.statut_facture as enum ('EMISE', 'PAYEE', 'ANNULEE');

create type public.type_alerte as enum (
  'ECART_CAISSE', 'STOCK_BAS', 'RUPTURE', 'FRAUDE_SUSPECTE',
  'SESSION_NON_CLOTUREE', 'COMMANDE_TARDIVE'
);

create type public.devise as enum ('CDF', 'USD');

-- V2/V3 (tables créées dès maintenant, UI plus tard)
create type public.statut_bon_commande as enum ('BROUILLON', 'ENVOYE', 'RECU_PARTIEL', 'RECU', 'ANNULE');
create type public.type_mvt_consigne as enum ('SORTIE', 'RETOUR', 'CASSE', 'MANQUANT');
create type public.statut_ardoise as enum ('OUVERTE', 'SOLDEE', 'BLOQUEE');
create type public.type_op_ardoise as enum ('CREDIT', 'REMBOURSEMENT');
create type public.statut_inventaire as enum ('EN_COURS', 'CLOTURE');
create type public.statut_avance as enum ('ACCORDEE', 'REMBOURSEE', 'ANNULEE');

-- ---------------------------------------------------------------------------
-- 2. SOCLE : ORGANISATIONS, UTILISATEURS, TERRASSES, AFFECTATIONS, INVITATIONS
-- ---------------------------------------------------------------------------

-- Une organisation = l'entreprise du Propriétaire (plusieurs terrasses possibles)
create table public.organisations (
  id          uuid primary key default gen_random_uuid(),
  nom         text not null check (length(trim(nom)) >= 2),
  cree_par    uuid,                          -- rempli par la fonction d'inscription
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  supprime_le timestamptz                    -- soft delete
);

-- Profil applicatif. AUCUNE colonne rôle : le rôle est porté par les affectations.
-- id = auth.users.id (création automatique par trigger handle_new_user).
create table public.utilisateurs (
  id            uuid primary key references auth.users (id) on delete cascade,
  nom           text not null check (length(trim(nom)) >= 2),
  telephone     text,
  email         text,
  photo_url     text,                        -- photo de la serveuse montrée au client
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  desactive_le  timestamptz                  -- soft delete
);

create table public.terrasses (
  id              uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations (id),
  nom             text not null check (length(trim(nom)) >= 2),
  adresse         text,
  slug            text not null unique,      -- utilisé dans les URL de QR
  -- Paramètres configurables par terrasse (seuils d'alerte, anti-abus, heures calmes)
  parametres      jsonb not null default '{
    "seuil_ecart_cdf": 10000,
    "commande_tardive_min": 15,
    "max_commandes_attente_par_session": 3,
    "plafond_commande_cdf": 500000,
    "heures_calmes": {"debut": "23:00", "fin": "06:00"}
  }'::jsonb,
  cree_par        uuid,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  supprime_le     timestamptz
);

-- LE CŒUR DU MODÈLE DE RÔLES.
-- Règles : PROPRIETAIRE = affectation d'organisation (terrasse_id NULL) ;
--          les autres rôles sont toujours rattachés à une terrasse.
create table public.affectations (
  id              uuid primary key default gen_random_uuid(),
  utilisateur_id  uuid not null references public.utilisateurs (id),
  organisation_id uuid not null references public.organisations (id),
  terrasse_id     uuid references public.terrasses (id),
  role            public.role_type not null,
  statut          public.statut_affectation not null default 'ACTIVE',
  role_actif_dernier public.role_type,       -- dernière casquette utilisée (traçabilité UX)
  cree_par        uuid,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  desactive_le    timestamptz,
  constraint affectation_coherente check (
    (role = 'PROPRIETAIRE' and terrasse_id is null)
    or (role <> 'PROPRIETAIRE' and terrasse_id is not null)
  )
);

-- Unicité : un même rôle une seule fois par (utilisateur, terrasse) ;
-- COALESCE gère le NULL des affectations PROPRIETAIRE.
create unique index affectations_unique
  on public.affectations (utilisateur_id, coalesce(terrasse_id, '00000000-0000-0000-0000-000000000000'::uuid), role);
create index affectations_utilisateur_idx on public.affectations (utilisateur_id) where statut = 'ACTIVE';
create index affectations_terrasse_idx    on public.affectations (terrasse_id)    where statut = 'ACTIVE';

-- Invitations 100 % in-app (QR + code à saisir). L'invité ne choisit jamais son rôle.
create table public.invitations (
  id              uuid primary key default gen_random_uuid(),
  code            text not null unique,      -- 8 caractères non devinables (fonction dédiée)
  organisation_id uuid not null references public.organisations (id),
  terrasse_id     uuid references public.terrasses (id),   -- NULL si invitation PROPRIETAIRE (transfert)
  role            public.role_type not null check (role in ('RESPONSABLE', 'GERANT', 'SERVEUSE')),
  nom_prevu       text,                      -- affiché à la saisie du code (« pour Marie »)
  cree_par        uuid not null,
  expire_le       timestamptz not null default (now() + interval '48 hours'),
  usage_unique    boolean not null default true,
  statut          public.statut_invitation not null default 'ACTIVE',
  utilise_par     uuid,
  utilise_le      timestamptz,
  created_at      timestamptz not null default now()
);
create index invitations_code_idx on public.invitations (upper(code)) where statut = 'ACTIVE';

-- ---------------------------------------------------------------------------
-- 3. OPÉRATIONNEL : TABLES PHYSIQUES, PRODUITS, ASSIGNATIONS, CLIENTS, COMMANDES
-- ---------------------------------------------------------------------------

create table public.tables (
  id          uuid primary key default gen_random_uuid(),
  terrasse_id uuid not null references public.terrasses (id),
  numero      integer not null check (numero > 0),
  libelle     text,                          -- « Table 5 » (défaut généré côté UI)
  -- Token opaque, révocable et régénérable : c'est LUI qui signe l'URL du QR.
  token_qr    text not null unique default encode(gen_random_bytes(16), 'hex'),
  actif       boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (terrasse_id, numero)
);

create table public.produits (
  id                 uuid primary key default gen_random_uuid(),
  terrasse_id        uuid not null references public.terrasses (id),
  nom                text not null check (length(trim(nom)) >= 1),
  categorie          text not null default 'Boissons',
  prix_cdf           integer not null check (prix_cdf >= 0),        -- francs congolais
  prix_usd_centimes  integer check (prix_usd_centimes >= 0),        -- V3 multi-devises
  stock              integer not null default 0 check (stock >= 0),
  stock_reserve      integer not null default 0 check (stock_reserve >= 0),
  -- Disponible = stock - réservé (colonne calculée, toujours cohérente)
  stock_disponible   integer generated always as (stock - stock_reserve) stored,
  seuil_alerte       integer not null default 0 check (seuil_alerte >= 0),
  photo_url          text,
  actif              boolean not null default true,                 -- false = retiré de la carte
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  supprime_le        timestamptz,
  constraint reserve_ne_depasse_pas_stock check (stock_reserve <= stock)
);
create index produits_terrasse_idx on public.produits (terrasse_id) where supprime_le is null;

-- Assignation serveuse ↔ table. Un SEUL lien actif par table (index unique partiel).
create table public.table_serveuse (
  id           uuid primary key default gen_random_uuid(),
  terrasse_id  uuid not null references public.terrasses (id),
  table_id     uuid not null references public.tables (id) on delete cascade,
  serveuse_id  uuid not null references public.utilisateurs (id),
  assigne_par  uuid,
  actif        boolean not null default true,
  created_at   timestamptz not null default now(),
  termine_le   timestamptz
);
create unique index table_serveuse_active_unique
  on public.table_serveuse (table_id) where actif;

-- Session client anonyme (le client ne crée JAMAIS de compte).
-- anon_auth_id = identité du « anonymous sign-in » Supabase : permet RLS + Realtime.
create table public.clients_session (
  id                  uuid primary key default gen_random_uuid(),
  terrasse_id         uuid not null references public.terrasses (id),
  table_id            uuid references public.tables (id),   -- dernière table scannée
  anon_auth_id        uuid unique,                          -- auth.users.id de la session anonyme
  prenom              text not null check (length(trim(prenom)) >= 1),
  telephone           text,                                 -- optionnel (V3 CRM)
  push_token          text,                                 -- FCM du client (consentement explicite)
  consentement_notif  boolean not null default false,
  created_at          timestamptz not null default now(),
  derniere_visite_le  timestamptz not null default now()
);
create index clients_session_terrasse_idx on public.clients_session (terrasse_id);

create table public.commandes (
  id                uuid primary key default gen_random_uuid(),
  terrasse_id       uuid not null references public.terrasses (id),
  table_id          uuid not null references public.tables (id),
  client_session_id uuid not null references public.clients_session (id),
  serveuse_id       uuid references public.utilisateurs (id),  -- serveuse assignée au moment de la commande
  statut            public.statut_commande not null default 'EN_ATTENTE',
  montant_total_cdf integer not null default 0 check (montant_total_cdf >= 0),
  devise            public.devise not null default 'CDF',
  motif_annulation  text,
  -- Idempotence : la file hors-ligne du client envoie une clé unique par commande.
  cle_idempotence   text unique,
  confirmee_le      timestamptz,
  servie_le         timestamptz,
  annulee_le        timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
-- Le client doit pouvoir suivre SA commande en Realtime (anciennes valeurs incluses).
alter table public.commandes replica identity full;
create index commandes_terrasse_statut_idx on public.commandes (terrasse_id, statut);
create index commandes_serveuse_idx        on public.commandes (serveuse_id, statut);
create index commandes_client_idx          on public.commandes (client_session_id);
create index commandes_servie_le_idx       on public.commandes (terrasse_id, servie_le) where statut = 'SERVIE';

create table public.commande_lignes (
  id               uuid primary key default gen_random_uuid(),
  commande_id      uuid not null references public.commandes (id) on delete cascade,
  produit_id       uuid not null references public.produits (id),
  quantite         integer not null check (quantite > 0),
  -- Snapshot du prix AU MOMENT de la commande (jamais de jointure de prix rétroactive)
  prix_unitaire_cdf integer not null check (prix_unitaire_cdf >= 0),
  created_at       timestamptz not null default now()
);
create index commande_lignes_commande_idx on public.commande_lignes (commande_id);

-- ---------------------------------------------------------------------------
-- 4. CAISSE : SESSIONS DE SERVICE, DÉPÔTS, AVIS, HISTORIQUE CLIENT
-- ---------------------------------------------------------------------------

create table public.sessions_service (
  id                 uuid primary key default gen_random_uuid(),
  terrasse_id        uuid not null references public.terrasses (id),
  serveuse_id        uuid not null references public.utilisateurs (id),
  statut             public.statut_session_service not null default 'OUVERTE',
  ouverte_le         timestamptz not null default now(),
  cloturee_le        timestamptz,
  montant_attendu_cdf integer check (montant_attendu_cdf >= 0), -- figé à la clôture
  created_at         timestamptz not null default now()
);
-- Une seule session OUVERTE par serveuse et par terrasse.
create unique index session_ouverte_unique
  on public.sessions_service (terrasse_id, serveuse_id) where statut = 'OUVERTE';

create table public.depots (
  id                  uuid primary key default gen_random_uuid(),
  session_id          uuid not null unique references public.sessions_service (id), -- 1 dépôt par session
  terrasse_id         uuid not null references public.terrasses (id),
  serveuse_id         uuid not null references public.utilisateurs (id),
  montant_attendu_cdf integer not null check (montant_attendu_cdf >= 0),
  montant_depose_cdf  integer not null check (montant_depose_cdf >= 0),
  ecart_cdf           integer generated always as (montant_depose_cdf - montant_attendu_cdf) stored,
  motif_ecart         text,                        -- obligatoire si écart < 0 (vérifié par fonction)
  statut              public.statut_depot not null default 'DECLARE',
  declare_le          timestamptz not null default now(),
  valide_par          uuid references public.utilisateurs (id),
  valide_le           timestamptz,
  motif_contestation  text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create index depots_terrasse_idx on public.depots (terrasse_id, statut);

create table public.avis_serveuse (
  id           uuid primary key default gen_random_uuid(),
  commande_id  uuid not null unique references public.commandes (id), -- un seul avis par commande
  terrasse_id  uuid not null references public.terrasses (id),
  serveuse_id  uuid not null references public.utilisateurs (id),
  note         integer not null check (note between 1 and 5),
  commentaire  text,
  created_at   timestamptz not null default now()
);

-- Agrégat par client identifié (téléphone si fourni, sinon prénom normalisé).
create table public.historique_client (
  id                 uuid primary key default gen_random_uuid(),
  terrasse_id        uuid not null references public.terrasses (id),
  identifiant        text not null,               -- 'tel:+243…' ou 'nom:jean k.'
  prenom             text,
  telephone          text,
  visites            integer not null default 0,
  depense_total_cdf  bigint not null default 0,
  derniere_visite_le timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (terrasse_id, identifiant)
);

-- ---------------------------------------------------------------------------
-- 5. STOCK ET PRIX (journalisation stricte)
-- ---------------------------------------------------------------------------

-- Journal append-only de TOUT mouvement de stock (manuel ou système).
create table public.mouvements_stock (
  id              uuid primary key default gen_random_uuid(),
  terrasse_id     uuid not null references public.terrasses (id),
  produit_id      uuid not null references public.produits (id),
  type            public.type_mouvement_stock not null,
  quantite        integer not null,            -- signé : + entrée, - sortie
  stock_avant     integer not null,
  stock_apres     integer not null,
  reserve_avant   integer not null default 0,
  reserve_apres   integer not null default 0,
  motif           text,
  reference_type  text,                        -- 'commande' | 'demande_stock' | 'inventaire'…
  reference_id    uuid,
  effectue_par    uuid,                        -- NULL = système
  role_actif      public.role_type,            -- casquette portée lors de l'action
  created_at      timestamptz not null default now()
);
create index mouvements_stock_produit_idx  on public.mouvements_stock (produit_id, created_at desc);
create index mouvements_stock_terrasse_idx on public.mouvements_stock (terrasse_id, created_at desc);

-- Pertes déclarées (casse, vol constaté) — complément qualitatif du mouvement.
create table public.pertes_stock (
  id          uuid primary key default gen_random_uuid(),
  terrasse_id uuid not null references public.terrasses (id),
  produit_id  uuid not null references public.produits (id),
  quantite    integer not null check (quantite > 0),
  motif       text not null,
  photo_url   text,
  declare_par uuid,
  created_at  timestamptz not null default now()
);

-- Le GÉRANT ne modifie jamais le stock : il fait une DEMANDE, que le
-- Responsable/Propriétaire approuve (l'approbation exécute le mouvement).
create table public.demandes_stock (
  id           uuid primary key default gen_random_uuid(),
  terrasse_id  uuid not null references public.terrasses (id),
  produit_id   uuid not null references public.produits (id),
  type         public.type_demande_stock not null,
  quantite     integer not null,                 -- REAPPRO/PERTE : > 0 ; ECART : delta signé
  motif        text not null,
  photo_url    text,
  demande_par  uuid not null,
  statut       public.statut_demande_stock not null default 'EN_ATTENTE',
  traite_par   uuid,
  traite_le    timestamptz,
  motif_refus  text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint demande_quantite_coherente check (
    (type in ('REAPPRO', 'PERTE') and quantite > 0) or (type = 'ECART')
  )
);
create index demandes_stock_terrasse_idx on public.demandes_stock (terrasse_id, statut);

-- Historique append-only des changements de prix.
create table public.historique_prix (
  id              uuid primary key default gen_random_uuid(),
  terrasse_id     uuid not null references public.terrasses (id),
  produit_id      uuid not null references public.produits (id),
  ancien_prix_cdf integer not null,
  nouveau_prix_cdf integer not null,
  modifie_par     uuid,
  role_actif      public.role_type,
  created_at      timestamptz not null default now()
);
create index historique_prix_produit_idx on public.historique_prix (produit_id, created_at desc);

-- ---------------------------------------------------------------------------
-- 6. NOTIFICATIONS, PUSH, ALERTES, AUDIT
-- ---------------------------------------------------------------------------

-- Tokens FCM par utilisateur ET par appareil (un membre peut avoir 2 téléphones).
create table public.push_tokens (
  id                    uuid primary key default gen_random_uuid(),
  utilisateur_id        uuid not null references public.utilisateurs (id) on delete cascade,
  token                 text not null unique,
  plateforme            text not null default 'android',   -- android | ios | web
  appareil              text,
  actif                 boolean not null default true,
  created_at            timestamptz not null default now(),
  derniere_utilisation  timestamptz not null default now()
);
create index push_tokens_utilisateur_idx on public.push_tokens (utilisateur_id) where actif;

-- Boîte de notifications in-app. Chaque notification y est enregistrée
-- (le backend la lit ensuite pour envoyer le push FCM ; fallback = Realtime).
create table public.notifications (
  id                uuid primary key default gen_random_uuid(),
  terrasse_id       uuid references public.terrasses (id),
  utilisateur_id    uuid references public.utilisateurs (id),      -- destinataire staff
  client_session_id uuid references public.clients_session (id),   -- OU destinataire client
  type              text not null,                -- 'COMMANDE_CONFIRMEE', 'DEPOT_VALIDE'…
  titre             text not null,
  corps             text,
  donnees           jsonb not null default '{}'::jsonb,            -- route cible, ids…
  lu                boolean not null default false,
  push_envoye       boolean not null default false,
  created_at        timestamptz not null default now(),
  constraint notification_destinataire check (utilisateur_id is not null or client_session_id is not null)
);
alter table public.notifications replica identity full;
create index notifications_utilisateur_idx on public.notifications (utilisateur_id, lu, created_at desc);
create index notifications_client_idx      on public.notifications (client_session_id, created_at desc);

create table public.alertes (
  id           uuid primary key default gen_random_uuid(),
  terrasse_id  uuid not null references public.terrasses (id),
  type         public.type_alerte not null,
  severite     text not null default 'INFO' check (severite in ('INFO', 'IMPORTANT', 'CRITIQUE')),
  message      text not null,
  donnees      jsonb not null default '{}'::jsonb,
  reference_id uuid,
  traitee      boolean not null default false,
  traitee_par  uuid,
  traitee_le   timestamptz,
  created_at   timestamptz not null default now()
);
alter table public.alertes replica identity full;
create index alertes_terrasse_idx on public.alertes (terrasse_id, traitee, created_at desc);

-- Journal d'audit append-only de TOUTE action sensible.
create table public.audit_log (
  id              uuid primary key default gen_random_uuid(),
  organisation_id uuid,
  terrasse_id     uuid,
  utilisateur_id  uuid,
  role_actif      public.role_type,          -- OBLIGATOIRE pour la traçabilité des casquettes
  action          text not null,             -- 'DEPOT_VALIDE', 'PRIX_MODIFIE'…
  entite          text,
  entite_id       uuid,
  donnees         jsonb not null default '{}'::jsonb,
  created_at      timestamptz not null default now()
);
create index audit_log_terrasse_idx on public.audit_log (terrasse_id, created_at desc);
create index audit_log_org_idx      on public.audit_log (organisation_id, created_at desc);

-- ---------------------------------------------------------------------------
-- 7. SaaS : PLANS, ABONNEMENTS, FACTURES, PAIEMENTS, REMISES, SUPER-ADMINS
-- ---------------------------------------------------------------------------

-- Prix, limites et feature flags EN BASE, jamais en dur dans le code.
create table public.plans (
  id                            uuid primary key default gen_random_uuid(),
  code                          text not null unique,          -- ESSENTIEL | PRO | BUSINESS
  nom                           text not null,
  prix_usd_centimes             integer not null check (prix_usd_centimes >= 0), -- mensuel
  mois_factures_annuel          integer not null default 10,   -- annuel = 10 mois payés pour 12
  frais_installation_usd_centimes integer not null default 5000 check (frais_installation_usd_centimes between 0 and 100000),
  max_comptes_staff             integer not null default 15,
  fonctionnalites               jsonb not null default '{}'::jsonb, -- flags par plan
  actif                         boolean not null default true,
  ordre                         integer not null default 0,
  created_at                    timestamptz not null default now(),
  updated_at                    timestamptz not null default now()
);

-- UNE terrasse = UN abonnement.
create table public.abonnements (
  id                uuid primary key default gen_random_uuid(),
  terrasse_id       uuid not null unique references public.terrasses (id),
  organisation_id   uuid not null references public.organisations (id),
  plan_id           uuid not null references public.plans (id),
  plan_id_prochain  uuid references public.plans (id),   -- descente de plan : effet à l'échéance
  statut            public.statut_abonnement not null default 'ESSAI',
  periode_debut     date not null default current_date,
  periode_fin       date not null,
  essai_fin         date,
  grace_fin         date,
  annuel            boolean not null default false,
  statut_change_le  timestamptz not null default now(),  -- pilote les délais (grâce, 60 j…)
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index abonnements_statut_idx on public.abonnements (statut, periode_fin);

create sequence public.facture_numero_seq start 1;

create table public.factures (
  id                    uuid primary key default gen_random_uuid(),
  numero                text not null unique default
    ('NGD-' || to_char(now(), 'YYYY') || '-' || lpad(nextval('public.facture_numero_seq')::text, 5, '0')),
  organisation_id       uuid not null references public.organisations (id),
  terrasse_id           uuid not null references public.terrasses (id),
  abonnement_id         uuid references public.abonnements (id),
  plan_id               uuid references public.plans (id),      -- plan payé par cette facture
  montant_usd_centimes  integer not null check (montant_usd_centimes >= 0),
  remise_appliquee_pct  numeric(5,2) not null default 0,
  taux_change_cdf       numeric(12,2),              -- CDF pour 1 USD au jour d'émission
  montant_cdf_equiv     bigint,                     -- équivalent affiché sur le reçu
  periode_debut         date,
  periode_fin           date,
  annuel                boolean not null default false,
  statut                public.statut_facture not null default 'EMISE',
  emise_le              timestamptz not null default now(),
  payee_le              timestamptz,
  created_at            timestamptz not null default now()
);

-- Phase 1 : référence de transaction saisie par le Propriétaire,
-- validée MANUELLEMENT par un super-admin. Phase 2 : webhook signé (webhook_id).
create table public.paiements (
  id                    uuid primary key default gen_random_uuid(),
  facture_id            uuid not null references public.factures (id),
  organisation_id       uuid not null references public.organisations (id),
  terrasse_id           uuid not null references public.terrasses (id),
  methode               public.methode_paiement not null,
  reference             text not null,               -- référence mobile money saisie
  montant_usd_centimes  integer not null check (montant_usd_centimes > 0),
  statut                public.statut_paiement not null default 'EN_ATTENTE',
  saisi_par             uuid not null,
  valide_par            uuid,                        -- super-admin plateforme
  valide_le             timestamptz,
  motif_refus           text,
  webhook_id            text unique,                 -- idempotence webhooks (phase 2)
  created_at            timestamptz not null default now()
);
create index paiements_statut_idx  on public.paiements (statut);
create index paiements_facture_idx on public.paiements (facture_id);

-- Paliers de remise multi-terrasses (ex. -15 % dès 3, -25 % dès 5).
create table public.remises (
  id                       uuid primary key default gen_random_uuid(),
  code                     text not null unique,
  description              text,
  type                     text not null default 'POURCENTAGE' check (type in ('POURCENTAGE', 'MONTANT_USD_CENTIMES')),
  valeur                   numeric(8,2) not null check (valeur >= 0),
  condition_min_terrasses  integer not null default 1,
  actif                    boolean not null default true,
  created_at               timestamptz not null default now()
);

-- Rôle PLATEFORME, hors de toute organisation.
create table public.super_admins (
  utilisateur_id uuid primary key references public.utilisateurs (id),
  created_at     timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- 8. TABLES V2 / V3 — CRÉÉES MAINTENANT (schéma anticipé), UI PLUS TARD.
--    RLS activée, AUCUNE politique d'écriture : verrouillées jusqu'à la version.
-- ---------------------------------------------------------------------------

create table public.fournisseurs (
  id              uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations (id),
  nom             text not null,
  telephone       text,
  adresse         text,
  created_at      timestamptz not null default now(),
  supprime_le     timestamptz
);

create table public.bons_commande (
  id               uuid primary key default gen_random_uuid(),
  terrasse_id      uuid not null references public.terrasses (id),
  fournisseur_id   uuid not null references public.fournisseurs (id),
  statut           public.statut_bon_commande not null default 'BROUILLON',
  montant_total_cdf bigint not null default 0,
  cree_par         uuid,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create table public.bons_commande_lignes (
  id              uuid primary key default gen_random_uuid(),
  bon_commande_id uuid not null references public.bons_commande (id) on delete cascade,
  produit_id      uuid not null references public.produits (id),
  quantite        integer not null check (quantite > 0),
  prix_achat_cdf  integer not null check (prix_achat_cdf >= 0),
  quantite_recue  integer not null default 0
);

-- La réception alimente le stock via une entrée TRACÉE (implémenté en V2).
create table public.receptions (
  id              uuid primary key default gen_random_uuid(),
  bon_commande_id uuid not null references public.bons_commande (id),
  terrasse_id     uuid not null references public.terrasses (id),
  recu_par        uuid,
  recu_le         timestamptz not null default now(),
  created_at      timestamptz not null default now()
);

create table public.consignes (
  id           uuid primary key default gen_random_uuid(),
  terrasse_id  uuid not null references public.terrasses (id),
  produit_id   uuid not null references public.produits (id),
  type         text not null check (type in ('BOUTEILLE', 'CASIER')),
  montant_cdf  integer not null default 0 check (montant_cdf >= 0),
  casiers_pleins integer not null default 0,
  casiers_vides  integer not null default 0,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (terrasse_id, produit_id, type)
);

create table public.mouvements_consigne (
  id             uuid primary key default gen_random_uuid(),
  terrasse_id    uuid not null references public.terrasses (id),
  consigne_id    uuid not null references public.consignes (id),
  type           public.type_mvt_consigne not null,
  quantite       integer not null,
  fournisseur_id uuid references public.fournisseurs (id),
  reference_id   uuid,
  effectue_par   uuid,
  created_at     timestamptz not null default now()
);

-- Ardoise : crédit accordé UNIQUEMENT par un Gérant/Responsable (jamais serveuse seule).
create table public.ardoises (
  id               uuid primary key default gen_random_uuid(),
  terrasse_id      uuid not null references public.terrasses (id),
  client_nom       text not null,
  client_telephone text,
  plafond_cdf      integer not null check (plafond_cdf >= 0),
  solde_cdf        integer not null default 0,
  statut           public.statut_ardoise not null default 'OUVERTE',
  ouverte_par      uuid not null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create table public.ardoise_operations (
  id           uuid primary key default gen_random_uuid(),
  ardoise_id   uuid not null references public.ardoises (id),
  type         public.type_op_ardoise not null,
  montant_cdf  integer not null check (montant_cdf > 0),
  commande_id  uuid references public.commandes (id),
  effectue_par uuid,
  created_at   timestamptz not null default now()
);

create table public.categories_depense (
  id              uuid primary key default gen_random_uuid(),
  organisation_id uuid references public.organisations (id),  -- NULL = catégorie plateforme par défaut
  nom             text not null,
  created_at      timestamptz not null default now()
);

create table public.depenses (
  id           uuid primary key default gen_random_uuid(),
  terrasse_id  uuid not null references public.terrasses (id),
  categorie_id uuid not null references public.categories_depense (id),
  montant_cdf  integer not null check (montant_cdf > 0),
  description  text,
  depense_le   date not null default current_date,
  saisi_par    uuid,
  created_at   timestamptz not null default now()
);

create table public.inventaires (
  id          uuid primary key default gen_random_uuid(),
  terrasse_id uuid not null references public.terrasses (id),
  statut      public.statut_inventaire not null default 'EN_COURS',
  demarre_par uuid,
  demarre_le  timestamptz not null default now(),
  cloture_le  timestamptz
);

create table public.inventaire_lignes (
  id              uuid primary key default gen_random_uuid(),
  inventaire_id   uuid not null references public.inventaires (id) on delete cascade,
  produit_id      uuid not null references public.produits (id),
  stock_theorique integer not null,
  stock_reel      integer not null,
  ecart           integer generated always as (stock_reel - stock_theorique) stored,
  created_at      timestamptz not null default now()
);

create table public.fidelite_comptes (
  id                 uuid primary key default gen_random_uuid(),
  terrasse_id        uuid not null references public.terrasses (id),
  client_identifiant text not null,               -- même convention que historique_client
  points             integer not null default 0,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (terrasse_id, client_identifiant)
);

create table public.fidelite_mouvements (
  id          uuid primary key default gen_random_uuid(),
  compte_id   uuid not null references public.fidelite_comptes (id),
  points      integer not null,                   -- signé
  motif       text,
  valide_par  uuid,                               -- récompense validée par le staff
  created_at  timestamptz not null default now()
);

create table public.promotions (
  id          uuid primary key default gen_random_uuid(),
  terrasse_id uuid not null references public.terrasses (id),
  nom         text not null,
  description text,
  type        text not null default 'POURCENTAGE' check (type in ('POURCENTAGE', 'MONTANT', 'PRODUIT_OFFERT')),
  valeur      numeric(8,2),
  produit_id  uuid references public.produits (id),
  debut_le    timestamptz not null,
  fin_le      timestamptz not null,
  actif       boolean not null default true,
  created_at  timestamptz not null default now(),
  check (fin_le > debut_le)
);

-- Taux du jour fixé par le Responsable, HISTORISÉ (multi-devises V3).
create table public.taux_change (
  id           uuid primary key default gen_random_uuid(),
  terrasse_id  uuid not null references public.terrasses (id),
  cdf_pour_usd numeric(12,2) not null check (cdf_pour_usd > 0),
  fixe_par     uuid,
  fixe_le      timestamptz not null default now()
);

create table public.avances_serveuse (
  id           uuid primary key default gen_random_uuid(),
  terrasse_id  uuid not null references public.terrasses (id),
  serveuse_id  uuid not null references public.utilisateurs (id),
  montant_cdf  integer not null check (montant_cdf > 0),
  motif        text,
  statut       public.statut_avance not null default 'ACCORDEE',
  accordee_par uuid,
  created_at   timestamptz not null default now()
);

create table public.commissions (
  id               uuid primary key default gen_random_uuid(),
  terrasse_id      uuid not null references public.terrasses (id),
  serveuse_id      uuid not null references public.utilisateurs (id),
  periode_debut    date not null,
  periode_fin      date not null,
  base_ventes_cdf  bigint not null default 0,
  taux_pct         numeric(5,2) not null,
  montant_cdf      integer not null default 0,
  created_at       timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- 9. CONTEXTE D'EXÉCUTION (posé par le backend à chaque transaction)
--    set_config('nganda.utilisateur_id', …) / set_config('nganda.role_actif', …)
--    Permet la traçabilité (role_actif) et les tests SQL hors HTTP.
-- ---------------------------------------------------------------------------

create or replace function public.ctx_utilisateur()
returns uuid language sql stable as $$
  select coalesce(
    nullif(current_setting('nganda.utilisateur_id', true), '')::uuid,
    auth.uid()
  );
$$;

create or replace function public.ctx_role_actif()
returns public.role_type language sql stable as $$
  select nullif(current_setting('nganda.role_actif', true), '')::public.role_type;
$$;

-- ---------------------------------------------------------------------------
-- 10. FONCTIONS D'AUTORISATION (RLS) — SECURITY DEFINER STABLE
--     Toutes lisent les affectations ACTIVES ; jamais de confiance au client.
-- ---------------------------------------------------------------------------

create or replace function public.est_proprietaire(p_organisation_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from affectations
    where utilisateur_id = ctx_utilisateur()
      and organisation_id = p_organisation_id
      and role = 'PROPRIETAIRE'
      and statut = 'ACTIVE'
  );
$$;

create or replace function public.a_role(p_terrasse_id uuid, p_roles public.role_type[])
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from affectations
    where utilisateur_id = ctx_utilisateur()
      and terrasse_id = p_terrasse_id
      and role = any (p_roles)
      and statut = 'ACTIVE'
  );
$$;

-- Union des casquettes actives de l'utilisateur courant sur une terrasse.
create or replace function public.roles_actifs(p_terrasse_id uuid)
returns setof public.role_type language sql stable security definer set search_path = public as $$
  select role from affectations
  where utilisateur_id = ctx_utilisateur()
    and terrasse_id = p_terrasse_id
    and statut = 'ACTIVE';
$$;

create or replace function public.membre_organisation(p_organisation_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from affectations
    where utilisateur_id = ctx_utilisateur()
      and organisation_id = p_organisation_id
      and statut = 'ACTIVE'
  );
$$;

-- Règle d'or : seuls Responsable (sa terrasse) et Propriétaire (son organisation)
-- peuvent modifier stock et prix.
create or replace function public.peut_modifier_stock_prix(p_terrasse_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select
    a_role(p_terrasse_id, array['RESPONSABLE']::public.role_type[])
    or est_proprietaire((select organisation_id from terrasses where id = p_terrasse_id));
$$;

create or replace function public.est_super_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from super_admins where utilisateur_id = ctx_utilisateur());
$$;

-- Statut courant de l'abonnement d'une terrasse.
create or replace function public.abonnement_statut(p_terrasse_id uuid)
returns public.statut_abonnement language sql stable security definer set search_path = public as $$
  select statut from abonnements where terrasse_id = p_terrasse_id;
$$;

-- Les écritures sont possibles en ESSAI / ACTIF / EN_GRACE.
-- En LECTURE_SEULE et SUSPENDU : refusées EN BASE (politiques RLS ci-dessous).
create or replace function public.abonnement_permet_ecriture(p_terrasse_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(
    (select statut in ('ESSAI', 'ACTIF', 'EN_GRACE') from abonnements where terrasse_id = p_terrasse_id),
    false
  );
$$;

-- Feature flags par plan. Pendant l'ESSAI : accès PRO complet (offre d'essai).
create or replace function public.plan_autorise(p_terrasse_id uuid, p_fonctionnalite text)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(
    (
      select case
               when ab.statut = 'ESSAI'
                 then coalesce((p_essai.fonctionnalites ->> p_fonctionnalite)::boolean, false)
               else coalesce((pl.fonctionnalites ->> p_fonctionnalite)::boolean, false)
             end
      from abonnements ab
      join plans pl        on pl.id = ab.plan_id
      left join plans p_essai on p_essai.code = 'PRO'
      where ab.terrasse_id = p_terrasse_id
    ),
    false
  );
$$;

-- ---------------------------------------------------------------------------
-- 11. FONCTIONS MÉTIER (SECURITY DEFINER, appelées via RPC)
--     Toute la logique sensible vit ici : le client/staff ne fait jamais
--     d'UPDATE direct sur les tables critiques.
-- ---------------------------------------------------------------------------

-- Enregistre une notification in-app pour TOUS les porteurs actifs des rôles
-- donnés sur la terrasse (dédoublonné : rôles cumulés = une seule notification).
create or replace function public.notifier_roles(
  p_terrasse_id uuid, p_roles public.role_type[],
  p_type text, p_titre text, p_corps text default null,
  p_donnees jsonb default '{}'::jsonb, p_aussi_proprietaire boolean default false
) returns void language plpgsql security definer set search_path = public as $$
begin
  insert into notifications (terrasse_id, utilisateur_id, type, titre, corps, donnees)
  select distinct p_terrasse_id, a.utilisateur_id, p_type, p_titre, p_corps, p_donnees
  from affectations a
  where a.statut = 'ACTIVE'
    and (
      (a.terrasse_id = p_terrasse_id and a.role = any (p_roles))
      or (p_aussi_proprietaire and a.role = 'PROPRIETAIRE'
          and a.organisation_id = (select organisation_id from terrasses where id = p_terrasse_id))
    );
end;
$$;

create or replace function public.notifier_client(
  p_client_session_id uuid, p_terrasse_id uuid,
  p_type text, p_titre text, p_corps text default null, p_donnees jsonb default '{}'::jsonb
) returns void language plpgsql security definer set search_path = public as $$
begin
  insert into notifications (terrasse_id, client_session_id, type, titre, corps, donnees)
  values (p_terrasse_id, p_client_session_id, p_type, p_titre, p_corps, p_donnees);
end;
$$;

-- Code d'invitation : 8 caractères, alphabet sans ambiguïté (pas de I/L/O/0/1),
-- octets aléatoires cryptographiques. Unicité garantie par la contrainte unique.
create or replace function public.genere_code_invitation()
returns text language plpgsql volatile security definer set search_path = public as $$
declare
  v_alphabet constant text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  v_code text;
begin
  loop
    select string_agg(substr(v_alphabet, 1 + (get_byte(b.octets, g.i) % length(v_alphabet)), 1), '')
      into v_code
    from (select gen_random_bytes(8) as octets) b, generate_series(0, 7) g(i);
    exit when not exists (select 1 from invitations where code = v_code);
  end loop;
  return v_code;
end;
$$;

-- ==========================================================================
-- 11.1 INSCRIPTION — CHEMIN A : « JE CRÉE MON ÉTABLISSEMENT »
-- Le créateur reçoit AUTOMATIQUEMENT Propriétaire (org) + Responsable (terrasse 1).
-- Tout rôle forcé dans la requête est ignoré : les rôles sont codés ici.
-- Option p_aussi_gerant : espace unifié (Responsable + Gérant autorisé).
-- ==========================================================================
create or replace function public.finaliser_inscription_etablissement(
  p_nom_organisation text,
  p_nom_terrasse text,
  p_adresse_terrasse text,
  p_nombre_tables integer,
  p_aussi_gerant boolean default false
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := ctx_utilisateur();
  v_org_id uuid;
  v_terrasse_id uuid;
  v_slug text;
  v_plan_essentiel uuid;
  v_i int;
begin
  if v_uid is null then raise exception 'Authentification requise.'; end if;
  if p_nombre_tables is null or p_nombre_tables < 1 or p_nombre_tables > 500 then
    raise exception 'Nombre de tables invalide (1 à 500).';
  end if;

  insert into organisations (nom, cree_par) values (trim(p_nom_organisation), v_uid)
    returning id into v_org_id;

  -- slug URL-safe et unique
  v_slug := trim(both '-' from regexp_replace(
    lower(translate(p_nom_terrasse, 'éèêëàâäùûüôöîïç', 'eeeeaaauuuooiic')),
    '[^a-z0-9]+', '-', 'g'))
    || '-' || substr(encode(gen_random_bytes(3), 'hex'), 1, 6);

  insert into terrasses (organisation_id, nom, adresse, slug, cree_par)
    values (v_org_id, trim(p_nom_terrasse), p_adresse_terrasse, v_slug, v_uid)
    returning id into v_terrasse_id;

  -- Création des tables physiques avec leur token QR opaque
  for v_i in 1..p_nombre_tables loop
    insert into tables (terrasse_id, numero, libelle) values (v_terrasse_id, v_i, 'Table ' || v_i);
  end loop;

  -- Affectations automatiques : PROPRIETAIRE (organisation) + RESPONSABLE (terrasse)
  insert into affectations (utilisateur_id, organisation_id, terrasse_id, role, cree_par)
    values (v_uid, v_org_id, null, 'PROPRIETAIRE', v_uid),
           (v_uid, v_org_id, v_terrasse_id, 'RESPONSABLE', v_uid);
  if p_aussi_gerant then
    insert into affectations (utilisateur_id, organisation_id, terrasse_id, role, cree_par)
      values (v_uid, v_org_id, v_terrasse_id, 'GERANT', v_uid);
  end if;

  -- Essai gratuit 14 jours (plan_autorise donne l'accès PRO pendant l'ESSAI)
  select id into v_plan_essentiel from plans where code = 'ESSENTIEL' and actif;
  insert into abonnements (terrasse_id, organisation_id, plan_id, statut, periode_debut, periode_fin, essai_fin)
    values (v_terrasse_id, v_org_id, v_plan_essentiel, 'ESSAI',
            current_date, current_date + 14, current_date + 14);

  insert into audit_log (organisation_id, terrasse_id, utilisateur_id, role_actif, action, entite, entite_id, donnees)
    values (v_org_id, v_terrasse_id, v_uid, 'PROPRIETAIRE', 'ETABLISSEMENT_CREE', 'terrasse', v_terrasse_id,
            jsonb_build_object('nom', p_nom_terrasse, 'tables', p_nombre_tables));

  return jsonb_build_object('organisation_id', v_org_id, 'terrasse_id', v_terrasse_id, 'slug', v_slug);
end;
$$;

-- ==========================================================================
-- 11.2 INVITATIONS (100 % in-app)
-- ==========================================================================

-- Création : Responsable → GERANT/SERVEUSE de SA terrasse uniquement ;
--            Propriétaire → tout rôle, toute terrasse de son organisation.
create or replace function public.creer_invitation(
  p_terrasse_id uuid, p_role public.role_type, p_nom_prevu text default null
) returns public.invitations language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := ctx_utilisateur();
  v_org uuid;
  v_inv public.invitations;
begin
  select organisation_id into v_org from terrasses where id = p_terrasse_id;
  if v_org is null then raise exception 'Terrasse introuvable.'; end if;

  if p_role in ('GERANT', 'SERVEUSE') then
    if not (a_role(p_terrasse_id, array['RESPONSABLE']::public.role_type[]) or est_proprietaire(v_org)) then
      raise exception 'Seul le Responsable de la terrasse ou le Propriétaire peut inviter un gérant ou une serveuse.';
    end if;
  elsif p_role = 'RESPONSABLE' then
    if not est_proprietaire(v_org) then
      raise exception 'Seul le Propriétaire peut nommer un Responsable.';
    end if;
  else
    raise exception 'Ce rôle ne peut pas être invité.';
  end if;

  insert into invitations (code, organisation_id, terrasse_id, role, nom_prevu, cree_par)
    values (genere_code_invitation(), v_org, p_terrasse_id, p_role, p_nom_prevu, v_uid)
    returning * into v_inv;

  insert into audit_log (organisation_id, terrasse_id, utilisateur_id, role_actif, action, entite, entite_id)
    values (v_org, p_terrasse_id, v_uid, ctx_role_actif(), 'INVITATION_CREEE', 'invitation', v_inv.id);
  return v_inv;
end;
$$;

-- Consommation (chemin B) : l'invité ne choisit JAMAIS son rôle.
-- Si la personne a déjà un compte, le code AJOUTE une affectation.
create or replace function public.consommer_invitation(p_code text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := ctx_utilisateur();
  v_inv public.invitations;
begin
  if v_uid is null then raise exception 'Authentification requise.'; end if;

  select * into v_inv from invitations where code = upper(trim(p_code)) for update;
  if not found then
    raise exception 'Code d''invitation invalide.';   -- message volontairement générique (anti-énumération)
  end if;
  if v_inv.statut = 'ACTIVE' and v_inv.expire_le < now() then
    update invitations set statut = 'EXPIREE' where id = v_inv.id;
    raise exception 'Code d''invitation invalide.';
  end if;
  if v_inv.statut <> 'ACTIVE' then
    raise exception 'Code d''invitation invalide.';
  end if;

  -- Idempotent : si l'affectation existe déjà et est active, on ne duplique pas.
  if not exists (
    select 1 from affectations
    where utilisateur_id = v_uid
      and terrasse_id is not distinct from v_inv.terrasse_id
      and role = v_inv.role and statut = 'ACTIVE'
  ) then
    -- Les triggers d'affectation appliquent les règles de conflit d'intérêts.
    insert into affectations (utilisateur_id, organisation_id, terrasse_id, role, cree_par)
      values (v_uid, v_inv.organisation_id, v_inv.terrasse_id, v_inv.role, v_inv.cree_par);
  end if;

  if v_inv.usage_unique then
    update invitations set statut = 'UTILISEE', utilise_par = v_uid, utilise_le = now()
      where id = v_inv.id;
  end if;

  insert into audit_log (organisation_id, terrasse_id, utilisateur_id, role_actif, action, entite, entite_id)
    values (v_inv.organisation_id, v_inv.terrasse_id, v_uid, v_inv.role, 'INVITATION_CONSOMMEE', 'invitation', v_inv.id);

  return jsonb_build_object('terrasse_id', v_inv.terrasse_id, 'role', v_inv.role);
end;
$$;

create or replace function public.revoquer_invitation(p_invitation_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_inv public.invitations;
begin
  select * into v_inv from invitations where id = p_invitation_id;
  if not found then raise exception 'Invitation introuvable.'; end if;
  if not (a_role(v_inv.terrasse_id, array['RESPONSABLE']::public.role_type[])
          or est_proprietaire(v_inv.organisation_id)) then
    raise exception 'Non autorisé.';
  end if;
  update invitations set statut = 'REVOQUEE' where id = v_inv.id and statut = 'ACTIVE';
  insert into audit_log (organisation_id, terrasse_id, utilisateur_id, role_actif, action, entite, entite_id)
    values (v_inv.organisation_id, v_inv.terrasse_id, ctx_utilisateur(), ctx_role_actif(),
            'INVITATION_REVOQUEE', 'invitation', v_inv.id);
end;
$$;

-- ==========================================================================
-- 11.3 CLIENT SANS COMPTE : session anonyme + contexte de table (QR)
-- ==========================================================================

-- Le client scanne le QR : le token opaque donne terrasse, table et serveuse.
-- Jamais d'exposition directe de la table `tables` ni de `utilisateurs` aux anonymes.
create or replace function public.obtenir_contexte_table(p_token text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_table public.tables;
begin
  select * into v_table from tables where token_qr = trim(p_token) and actif;
  if not found then raise exception 'QR code invalide ou révoqué.'; end if;

  return jsonb_build_object(
    'terrasse', (select jsonb_build_object('id', t.id, 'nom', t.nom, 'slug', t.slug)
                 from terrasses t where t.id = v_table.terrasse_id),
    'table', jsonb_build_object('id', v_table.id, 'numero', v_table.numero, 'libelle', v_table.libelle),
    'serveuse', (
      select jsonb_build_object('nom', u.nom, 'photo_url', u.photo_url)
      from table_serveuse ts join utilisateurs u on u.id = ts.serveuse_id
      where ts.table_id = v_table.id and ts.actif
      limit 1
    ),
    'service_disponible', abonnement_permet_ecriture(v_table.terrasse_id)
  );
end;
$$;

-- Création (ou reprise) de la session client : prénom saisi UNE seule fois.
-- Nécessite une session anonyme Supabase (auth.uid() non NULL).
create or replace function public.creer_session_client(p_token text, p_prenom text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_table public.tables;
  v_session public.clients_session;
begin
  if v_uid is null then raise exception 'Session anonyme requise.'; end if;
  if p_prenom is null or length(trim(p_prenom)) < 1 then raise exception 'Prénom requis.'; end if;

  select * into v_table from tables where token_qr = trim(p_token) and actif;
  if not found then raise exception 'QR code invalide ou révoqué.'; end if;

  -- Une session par appareil (contrainte unique sur anon_auth_id) :
  -- le client retrouve sa session, son prénom n'est jamais redemandé.
  insert into clients_session (terrasse_id, table_id, anon_auth_id, prenom)
    values (v_table.terrasse_id, v_table.id, v_uid, trim(p_prenom))
  on conflict (anon_auth_id) do update
    set table_id = excluded.table_id, terrasse_id = excluded.terrasse_id,
        derniere_visite_le = now()
  returning * into v_session;

  return jsonb_build_object('session_id', v_session.id, 'prenom', v_session.prenom);
end;
$$;

-- ==========================================================================
-- 11.4 COMMANDES : passage (client), confirmation atomique, service, annulation
-- ==========================================================================

-- Le client valide son panier. UNE SEULE transaction : commande + lignes
-- (prix en snapshot) + réservation de stock. Idempotente via cle_idempotence
-- (la file hors-ligne peut renvoyer la même clé sans créer de doublon).
create or replace function public.passer_commande(
  p_cle_idempotence text,
  p_lignes jsonb        -- [{"produit_id": "…", "quantite": 2}, …]
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_session public.clients_session;
  v_params jsonb;
  v_commande_id uuid;
  v_statut public.statut_commande;
  v_ligne jsonb;
  v_produit public.produits;
  v_total integer := 0;
  v_nb_attente integer;
begin
  -- Rejeu hors-ligne : la clé existe déjà → on renvoie la commande existante.
  if p_cle_idempotence is not null then
    select id, statut into v_commande_id, v_statut from commandes where cle_idempotence = p_cle_idempotence;
    if found then
      return jsonb_build_object('commande_id', v_commande_id, 'statut', v_statut, 'idempotent', true);
    end if;
  end if;

  select * into v_session from clients_session where anon_auth_id = v_uid;
  if not found then raise exception 'Session client introuvable.'; end if;

  if not abonnement_permet_ecriture(v_session.terrasse_id) then
    -- Message volontairement neutre : le client ne voit jamais la facturation.
    raise exception 'Service momentanément indisponible.';
  end if;

  if p_lignes is null or jsonb_typeof(p_lignes) <> 'array' or jsonb_array_length(p_lignes) = 0 then
    raise exception 'Panier vide.';
  end if;

  v_params := (select parametres from terrasses where id = v_session.terrasse_id);

  select count(*) into v_nb_attente from commandes
    where client_session_id = v_session.id and statut = 'EN_ATTENTE';
  if v_nb_attente >= coalesce((v_params ->> 'max_commandes_attente_par_session')::int, 3) then
    raise exception 'Trop de commandes en attente. Attendez d''être servi.';
  end if;

  -- Validation du panier et calcul du total (prix actuels, snapshot au insert)
  for v_ligne in select * from jsonb_array_elements(p_lignes) loop
    select * into v_produit from produits
      where id = (v_ligne ->> 'produit_id')::uuid
        and terrasse_id = v_session.terrasse_id
        and actif and supprime_le is null;
    if not found then raise exception 'Produit indisponible.'; end if;
    if coalesce((v_ligne ->> 'quantite')::int, 0) < 1 then raise exception 'Quantité invalide.'; end if;
    v_total := v_total + v_produit.prix_cdf * (v_ligne ->> 'quantite')::int;
  end loop;

  if v_total > coalesce((v_params ->> 'plafond_commande_cdf')::int, 500000) then
    raise exception 'Montant trop élevé pour une seule commande.';
  end if;

  insert into commandes (terrasse_id, table_id, client_session_id, serveuse_id, cle_idempotence, montant_total_cdf)
    select v_session.terrasse_id, v_session.table_id, v_session.id,
           ts.serveuse_id, p_cle_idempotence, v_total
    from (select 1) s
    left join lateral (
      select serveuse_id from table_serveuse
      where table_id = v_session.table_id and actif limit 1
    ) ts on true
    returning id into v_commande_id;

  for v_ligne in select * from jsonb_array_elements(p_lignes) loop
    insert into commande_lignes (commande_id, produit_id, quantite, prix_unitaire_cdf)
      select v_commande_id, p.id, (v_ligne ->> 'quantite')::int, p.prix_cdf
      from produits p where p.id = (v_ligne ->> 'produit_id')::uuid;
  end loop;

  -- Confirmation atomique (réservation de stock, tout ou rien)
  perform confirmer_commande(v_commande_id);

  select statut into v_statut from commandes where id = v_commande_id;
  return jsonb_build_object('commande_id', v_commande_id, 'statut', v_statut, 'montant_total_cdf', v_total);
end;
$$;

-- Réservation atomique du stock : verrouille chaque produit (ordre stable,
-- anti-deadlock), vérifie le DISPONIBLE, réserve tout ou rien.
create or replace function public.confirmer_commande(p_commande_id uuid)
returns public.commandes language plpgsql security definer set search_path = public as $$
declare
  v_commande public.commandes;
  v_ligne record;
  v_produit public.produits;
  v_rupture boolean := false;
begin
  select * into v_commande from commandes where id = p_commande_id for update;
  if not found then raise exception 'Commande introuvable.'; end if;
  if v_commande.statut = 'CONFIRMEE' then return v_commande; end if;   -- idempotent
  if v_commande.statut <> 'EN_ATTENTE' then
    raise exception 'Transition impossible : % → CONFIRMEE.', v_commande.statut;
  end if;

  perform set_config('nganda.systeme', '1', true);   -- les triggers produits ne re-journalisent pas

  -- Passe 1 : vérification (locks pris dans l'ordre des produits)
  for v_ligne in
    select cl.produit_id, sum(cl.quantite) as qte
    from commande_lignes cl where cl.commande_id = p_commande_id
    group by cl.produit_id order by cl.produit_id
  loop
    select * into v_produit from produits where id = v_ligne.produit_id for update;
    if not found or not v_produit.actif or v_produit.supprime_le is not null
       or v_produit.stock_disponible < v_ligne.qte then
      v_rupture := true;
      exit;
    end if;
  end loop;

  if v_rupture then
    update commandes set statut = 'REFUSEE_STOCK' where id = p_commande_id;
  else
    -- Passe 2 : réservation tracée
    for v_ligne in
      select cl.produit_id, sum(cl.quantite) as qte
      from commande_lignes cl where cl.commande_id = p_commande_id
      group by cl.produit_id order by cl.produit_id
    loop
      update produits set stock_reserve = stock_reserve + v_ligne.qte
        where id = v_ligne.produit_id returning * into v_produit;
      insert into mouvements_stock
        (terrasse_id, produit_id, type, quantite, stock_avant, stock_apres,
         reserve_avant, reserve_apres, motif, reference_type, reference_id)
        values (v_commande.terrasse_id, v_produit.id, 'RESERVATION', 0,
                v_produit.stock, v_produit.stock,
                v_produit.stock_reserve - v_ligne.qte, v_produit.stock_reserve,
                'Réservation commande', 'commande', p_commande_id);
    end loop;
    update commandes set statut = 'CONFIRMEE' where id = p_commande_id;
  end if;

  perform set_config('nganda.systeme', '0', true);
  select * into v_commande from commandes where id = p_commande_id;
  return v_commande;
end;
$$;

-- « Servi » : UNIQUEMENT la serveuse assignée (matrice des permissions).
-- Décrémente le stock physique et libère la réservation, avec traçabilité.
create or replace function public.marquer_servie(p_commande_id uuid)
returns public.commandes language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := ctx_utilisateur();
  v_commande public.commandes;
  v_ligne record;
  v_produit public.produits;
begin
  select * into v_commande from commandes where id = p_commande_id for update;
  if not found then raise exception 'Commande introuvable.'; end if;
  if v_commande.statut = 'SERVIE' then return v_commande; end if;      -- idempotent
  if v_commande.statut <> 'CONFIRMEE' then
    raise exception 'Transition impossible : % → SERVIE.', v_commande.statut;
  end if;
  if not (a_role(v_commande.terrasse_id, array['SERVEUSE']::public.role_type[])
          and v_commande.serveuse_id = v_uid) then
    raise exception 'Seule la serveuse assignée peut marquer « Servi ».';
  end if;

  perform set_config('nganda.systeme', '1', true);
  for v_ligne in
    select cl.produit_id, sum(cl.quantite) as qte
    from commande_lignes cl where cl.commande_id = p_commande_id
    group by cl.produit_id order by cl.produit_id
  loop
    update produits
       set stock = stock - v_ligne.qte, stock_reserve = stock_reserve - v_ligne.qte
     where id = v_ligne.produit_id returning * into v_produit;
    insert into mouvements_stock
      (terrasse_id, produit_id, type, quantite, stock_avant, stock_apres,
       reserve_avant, reserve_apres, motif, reference_type, reference_id,
       effectue_par, role_actif)
      values (v_commande.terrasse_id, v_produit.id, 'VENTE', -v_ligne.qte,
              v_produit.stock + v_ligne.qte, v_produit.stock,
              v_produit.stock_reserve + v_ligne.qte, v_produit.stock_reserve,
              'Vente (commande servie)', 'commande', p_commande_id, v_uid, 'SERVEUSE');
  end loop;
  update commandes set statut = 'SERVIE' where id = p_commande_id;
  perform set_config('nganda.systeme', '0', true);

  select * into v_commande from commandes where id = p_commande_id;
  return v_commande;
end;
$$;

-- Annulation staff (serveuse / gérant / responsable / propriétaire) avant SERVIE.
-- Le trigger de transition libère automatiquement le stock réservé.
create or replace function public.annuler_commande(p_commande_id uuid, p_motif text)
returns public.commandes language plpgsql security definer set search_path = public as $$
declare
  v_commande public.commandes;
begin
  if p_motif is null or length(trim(p_motif)) < 2 then
    raise exception 'Motif d''annulation obligatoire.';
  end if;
  select * into v_commande from commandes where id = p_commande_id for update;
  if not found then raise exception 'Commande introuvable.'; end if;
  if v_commande.statut = 'ANNULEE' then return v_commande; end if;     -- idempotent
  if v_commande.statut not in ('EN_ATTENTE', 'CONFIRMEE') then
    raise exception 'Cette commande ne peut plus être annulée.';
  end if;
  if not (a_role(v_commande.terrasse_id, array['SERVEUSE', 'GERANT', 'RESPONSABLE']::public.role_type[])
          or est_proprietaire((select organisation_id from terrasses where id = v_commande.terrasse_id))) then
    raise exception 'Non autorisé.';
  end if;
  update commandes set statut = 'ANNULEE', motif_annulation = trim(p_motif) where id = p_commande_id;
  select * into v_commande from commandes where id = p_commande_id;
  return v_commande;
end;
$$;

-- Annulation par le CLIENT lui-même : tant que EN_ATTENTE uniquement.
create or replace function public.annuler_ma_commande(p_commande_id uuid)
returns public.commandes language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_commande public.commandes;
begin
  select c.* into v_commande
    from commandes c join clients_session cs on cs.id = c.client_session_id
   where c.id = p_commande_id and cs.anon_auth_id = v_uid
   for update of c;
  if not found then raise exception 'Commande introuvable.'; end if;
  if v_commande.statut = 'ANNULEE' then return v_commande; end if;
  if v_commande.statut <> 'EN_ATTENTE' then
    raise exception 'Trop tard : la commande est déjà confirmée. Appelez la serveuse.';
  end if;
  update commandes set statut = 'ANNULEE', motif_annulation = 'Annulée par le client'
    where id = p_commande_id;
  select * into v_commande from commandes where id = p_commande_id;
  return v_commande;
end;
$$;

-- ==========================================================================
-- 11.5 SESSION DE SERVICE ET DÉPÔT (fin de journée)
-- ==========================================================================

create or replace function public.ouvrir_session(p_terrasse_id uuid)
returns public.sessions_service language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := ctx_utilisateur();
  v_session public.sessions_service;
begin
  if not a_role(p_terrasse_id, array['SERVEUSE']::public.role_type[]) then
    raise exception 'Seule une serveuse affectée peut ouvrir une session de service.';
  end if;
  if not abonnement_permet_ecriture(p_terrasse_id) then
    raise exception 'Terrasse en lecture seule : ouverture impossible.';
  end if;
  -- Idempotent : la session ouverte du jour est renvoyée si elle existe déjà.
  select * into v_session from sessions_service
    where terrasse_id = p_terrasse_id and serveuse_id = v_uid and statut = 'OUVERTE';
  if found then return v_session; end if;

  insert into sessions_service (terrasse_id, serveuse_id) values (p_terrasse_id, v_uid)
    returning * into v_session;
  return v_session;
end;
$$;

-- FIN DE SERVICE : fige le montant attendu (somme des commandes SERVIE
-- pendant la session). La session clôturée devient immuable (trigger).
create or replace function public.cloturer_session(p_session_id uuid)
returns public.sessions_service language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := ctx_utilisateur();
  v_session public.sessions_service;
  v_attendu integer;
begin
  select * into v_session from sessions_service where id = p_session_id for update;
  if not found then raise exception 'Session introuvable.'; end if;
  if v_session.statut = 'CLOTUREE' then return v_session; end if;      -- idempotent
  if v_session.serveuse_id <> v_uid then
    raise exception 'Seule la serveuse de la session peut clôturer.';
  end if;

  select coalesce(sum(c.montant_total_cdf), 0) into v_attendu
    from commandes c
   where c.terrasse_id = v_session.terrasse_id
     and c.serveuse_id = v_session.serveuse_id
     and c.statut = 'SERVIE'
     and c.servie_le >= v_session.ouverte_le;

  update sessions_service
     set statut = 'CLOTUREE', cloturee_le = now(), montant_attendu_cdf = v_attendu
   where id = p_session_id
   returning * into v_session;
  return v_session;
end;
$$;

-- La serveuse confirme son dépôt ou signale un écart (motif obligatoire).
create or replace function public.declarer_depot(
  p_session_id uuid, p_montant_depose_cdf integer, p_motif_ecart text default null
) returns public.depots language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := ctx_utilisateur();
  v_session public.sessions_service;
  v_depot public.depots;
begin
  if p_montant_depose_cdf is null or p_montant_depose_cdf < 0 then
    raise exception 'Montant déposé invalide.';
  end if;
  select * into v_session from sessions_service where id = p_session_id;
  if not found then raise exception 'Session introuvable.'; end if;
  if v_session.serveuse_id <> v_uid then
    raise exception 'Seule la serveuse de la session peut déclarer le dépôt.';
  end if;
  if v_session.statut <> 'CLOTUREE' then
    raise exception 'Clôturez d''abord la session (FIN DE SERVICE).';
  end if;
  if p_montant_depose_cdf < v_session.montant_attendu_cdf
     and (p_motif_ecart is null or length(trim(p_motif_ecart)) < 3) then
    raise exception 'Motif obligatoire en cas d''écart de caisse.';
  end if;

  insert into depots (session_id, terrasse_id, serveuse_id, montant_attendu_cdf,
                      montant_depose_cdf, motif_ecart)
    values (p_session_id, v_session.terrasse_id, v_uid,
            v_session.montant_attendu_cdf, p_montant_depose_cdf, nullif(trim(p_motif_ecart), ''))
    returning * into v_depot;

  insert into audit_log (organisation_id, terrasse_id, utilisateur_id, role_actif, action, entite, entite_id, donnees)
    select t.organisation_id, v_session.terrasse_id, v_uid, 'SERVEUSE', 'DEPOT_DECLARE', 'depot', v_depot.id,
           jsonb_build_object('attendu', v_depot.montant_attendu_cdf, 'depose', v_depot.montant_depose_cdf)
    from terrasses t where t.id = v_session.terrasse_id;
  return v_depot;
end;
$$;

-- Validation / contestation : Gérant, Responsable ou Propriétaire.
-- NUL NE VALIDE SON PROPRE DÉPÔT (contrôlé ici ET par trigger).
create or replace function public.valider_depot(
  p_depot_id uuid, p_approuve boolean, p_motif_contestation text default null
) returns public.depots language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := ctx_utilisateur();
  v_depot public.depots;
begin
  select * into v_depot from depots where id = p_depot_id for update;
  if not found then raise exception 'Dépôt introuvable.'; end if;
  if v_depot.statut <> 'DECLARE' then return v_depot; end if;          -- idempotent

  if not (a_role(v_depot.terrasse_id, array['GERANT', 'RESPONSABLE']::public.role_type[])
          or est_proprietaire((select organisation_id from terrasses where id = v_depot.terrasse_id))) then
    raise exception 'Seuls le Gérant, le Responsable ou le Propriétaire valident un dépôt.';
  end if;
  if v_depot.serveuse_id = v_uid then
    raise exception 'Nul ne valide son propre dépôt.';
  end if;
  if not p_approuve and (p_motif_contestation is null or length(trim(p_motif_contestation)) < 3) then
    raise exception 'Motif de contestation obligatoire.';
  end if;

  update depots
     set statut = case when p_approuve then 'VALIDE'::public.statut_depot else 'CONTESTE'::public.statut_depot end,
         valide_par = v_uid, valide_le = now(),
         motif_contestation = nullif(trim(p_motif_contestation), '')
   where id = p_depot_id
   returning * into v_depot;

  insert into audit_log (organisation_id, terrasse_id, utilisateur_id, role_actif, action, entite, entite_id, donnees)
    select t.organisation_id, v_depot.terrasse_id, v_uid, ctx_role_actif(),
           case when p_approuve then 'DEPOT_VALIDE' else 'DEPOT_CONTESTE' end,
           'depot', v_depot.id,
           jsonb_build_object('ecart_cdf', v_depot.ecart_cdf)
    from terrasses t where t.id = v_depot.terrasse_id;
  return v_depot;
end;
$$;

-- ==========================================================================
-- 11.6 STOCK : ajustement manuel (Responsable/Propriétaire) + demandes du Gérant
-- ==========================================================================

-- p_type : ENTREE / PERTE / AJUSTEMENT  → p_quantite = quantité (> 0)
--          INVENTAIRE                    → p_quantite = stock RÉEL compté
-- Les types RESERVATION / LIBERATION / VENTE sont réservés au système.
create or replace function public.ajuster_stock(
  p_produit_id uuid,
  p_type public.type_mouvement_stock,
  p_quantite integer,
  p_motif text,
  p_reference_type text default null,
  p_reference_id uuid default null
) returns public.produits language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := ctx_utilisateur();
  v_produit public.produits;
  v_delta integer;
begin
  if p_type in ('RESERVATION', 'LIBERATION', 'VENTE') then
    raise exception 'Ce type de mouvement est réservé au système.';
  end if;
  if p_motif is null or length(trim(p_motif)) < 3 then
    raise exception 'Motif obligatoire pour toute modification de stock.';
  end if;

  select * into v_produit from produits where id = p_produit_id for update;
  if not found or v_produit.supprime_le is not null then raise exception 'Produit introuvable.'; end if;

  if not peut_modifier_stock_prix(v_produit.terrasse_id) then
    raise exception 'Seuls le Responsable et le Propriétaire modifient le stock.';
  end if;
  if not abonnement_permet_ecriture(v_produit.terrasse_id) then
    raise exception 'Terrasse en lecture seule.';
  end if;

  v_delta := case p_type
    when 'ENTREE'     then abs(p_quantite)
    when 'PERTE'      then -abs(p_quantite)
    when 'AJUSTEMENT' then p_quantite
    when 'INVENTAIRE' then p_quantite - v_produit.stock
  end;

  if v_produit.stock + v_delta < 0 then
    raise exception 'Stock insuffisant : impossible de descendre sous zéro.';
  end if;
  if v_produit.stock_reserve > v_produit.stock + v_delta then
    raise exception 'Impossible : des commandes en cours réservent déjà % unités.', v_produit.stock_reserve;
  end if;

  perform set_config('nganda.systeme', '1', true);
  update produits set stock = stock + v_delta where id = p_produit_id returning * into v_produit;
  insert into mouvements_stock
    (terrasse_id, produit_id, type, quantite, stock_avant, stock_apres,
     reserve_avant, reserve_apres, motif, reference_type, reference_id, effectue_par, role_actif)
    values (v_produit.terrasse_id, p_produit_id, p_type, v_delta,
            v_produit.stock - v_delta, v_produit.stock,
            v_produit.stock_reserve, v_produit.stock_reserve,
            trim(p_motif), p_reference_type, p_reference_id, v_uid, ctx_role_actif());
  perform set_config('nganda.systeme', '0', true);
  return v_produit;
end;
$$;

-- Le Gérant SIGNALE, il ne modifie pas (réappro, perte, écart).
create or replace function public.creer_demande_stock(
  p_produit_id uuid, p_type public.type_demande_stock,
  p_quantite integer, p_motif text, p_photo_url text default null
) returns public.demandes_stock language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := ctx_utilisateur();
  v_produit public.produits;
  v_demande public.demandes_stock;
begin
  select * into v_produit from produits where id = p_produit_id and supprime_le is null;
  if not found then raise exception 'Produit introuvable.'; end if;
  if not a_role(v_produit.terrasse_id, array['GERANT']::public.role_type[]) then
    raise exception 'Seul le Gérant crée des demandes de stock (le Responsable modifie directement).';
  end if;
  if p_motif is null or length(trim(p_motif)) < 3 then
    raise exception 'Motif obligatoire.';
  end if;

  insert into demandes_stock (terrasse_id, produit_id, type, quantite, motif, photo_url, demande_par)
    values (v_produit.terrasse_id, p_produit_id, p_type, p_quantite, trim(p_motif), p_photo_url, v_uid)
    returning * into v_demande;

  perform notifier_roles(v_produit.terrasse_id, array['RESPONSABLE']::public.role_type[],
    'DEMANDE_STOCK', 'Demande de stock du gérant',
    p_quantite || ' × ' || v_produit.nom || ' — ' || trim(p_motif),
    jsonb_build_object('demande_id', v_demande.id, 'produit_id', p_produit_id));
  return v_demande;
end;
$$;

-- L'approbation EXÉCUTE le mouvement de stock (tracé, référencé).
create or replace function public.traiter_demande_stock(
  p_demande_id uuid, p_approuve boolean, p_motif_refus text default null
) returns public.demandes_stock language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := ctx_utilisateur();
  v_demande public.demandes_stock;
begin
  select * into v_demande from demandes_stock where id = p_demande_id for update;
  if not found then raise exception 'Demande introuvable.'; end if;
  if v_demande.statut <> 'EN_ATTENTE' then return v_demande; end if;    -- idempotent
  if not peut_modifier_stock_prix(v_demande.terrasse_id) then
    raise exception 'Seuls le Responsable et le Propriétaire traitent les demandes.';
  end if;
  if not p_approuve and (p_motif_refus is null or length(trim(p_motif_refus)) < 3) then
    raise exception 'Motif de refus obligatoire.';
  end if;

  if p_approuve then
    perform ajuster_stock(
      v_demande.produit_id,
      case v_demande.type
        when 'REAPPRO' then 'ENTREE'::public.type_mouvement_stock
        when 'PERTE'   then 'PERTE'::public.type_mouvement_stock
        when 'ECART'   then 'AJUSTEMENT'::public.type_mouvement_stock
      end,
      v_demande.quantite,
      'Demande gérant approuvée : ' || v_demande.motif,
      'demande_stock', v_demande.id
    );
  end if;

  update demandes_stock
     set statut = case when p_approuve then 'APPROUVEE'::public.statut_demande_stock
                       else 'REFUSEE'::public.statut_demande_stock end,
         traite_par = v_uid, traite_le = now(), motif_refus = nullif(trim(p_motif_refus), '')
   where id = p_demande_id
   returning * into v_demande;

  insert into notifications (terrasse_id, utilisateur_id, type, titre, corps, donnees)
    values (v_demande.terrasse_id, v_demande.demande_par,
            case when p_approuve then 'DEMANDE_APPROUVEE' else 'DEMANDE_REFUSEE' end,
            case when p_approuve then 'Demande de stock approuvée' else 'Demande de stock refusée' end,
            coalesce(nullif(trim(p_motif_refus), ''), v_demande.motif),
            jsonb_build_object('demande_id', v_demande.id));
  return v_demande;
end;
$$;

-- ==========================================================================
-- 11.7 SaaS : FACTURATION, PAIEMENT MOBILE MONEY (phase 1 manuelle), CRON
-- ==========================================================================

-- Calcul du montant dû : TOUJOURS côté serveur (jamais de montant reçu du client).
-- Remises multi-terrasses + annuel (10 mois payés) + frais d'installation uniques.
create or replace function public.calcul_montant_abonnement(
  p_plan_id uuid, p_annuel boolean, p_organisation_id uuid, p_terrasse_id uuid,
  out montant_usd_centimes integer, out remise_pct numeric, out frais_installation integer
) language plpgsql stable security definer set search_path = public as $$
declare
  v_plan public.plans;
  v_nb_terrasses integer;
  v_base integer;
begin
  select * into v_plan from plans where id = p_plan_id and actif;
  if not found then raise exception 'Plan introuvable ou inactif.'; end if;

  select count(*) into v_nb_terrasses from terrasses
    where organisation_id = p_organisation_id and supprime_le is null;

  -- Meilleur palier applicable (les paliers sont en base, table remises)
  select coalesce(max(r.valeur), 0) into remise_pct
    from remises r
   where r.actif and r.type = 'POURCENTAGE' and v_nb_terrasses >= r.condition_min_terrasses;

  v_base := v_plan.prix_usd_centimes * case when p_annuel then v_plan.mois_factures_annuel else 1 end;
  montant_usd_centimes := round(v_base * (1 - remise_pct / 100.0))::integer;

  -- Frais d'installation : une seule fois par terrasse (première facture)
  frais_installation := case
    when exists (select 1 from factures f where f.terrasse_id = p_terrasse_id) then 0
    else v_plan.frais_installation_usd_centimes end;
  montant_usd_centimes := montant_usd_centimes + frais_installation;
end;
$$;

-- Le Propriétaire déclare son paiement mobile money (référence de transaction).
-- La facture est générée côté serveur ; le montant saisi n'est jamais utilisé.
create or replace function public.soumettre_paiement(
  p_terrasse_id uuid, p_plan_code text, p_annuel boolean,
  p_methode public.methode_paiement, p_reference text
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := ctx_utilisateur();
  v_terrasse public.terrasses;
  v_plan public.plans;
  v_calc record;
  v_facture public.factures;
  v_taux numeric;
  v_abonnement public.abonnements;
begin
  select * into v_terrasse from terrasses where id = p_terrasse_id and supprime_le is null;
  if not found then raise exception 'Terrasse introuvable.'; end if;
  if not est_proprietaire(v_terrasse.organisation_id) then
    raise exception 'Seul le Propriétaire gère l''abonnement et la facturation.';
  end if;
  if p_reference is null or length(trim(p_reference)) < 4 then
    raise exception 'Référence de transaction invalide.';
  end if;
  select * into v_plan from plans where code = upper(trim(p_plan_code)) and actif;
  if not found then raise exception 'Plan inconnu.'; end if;
  select * into v_abonnement from abonnements where terrasse_id = p_terrasse_id;
  if not found then raise exception 'Aucun abonnement pour cette terrasse.'; end if;

  select * into v_calc from calcul_montant_abonnement(v_plan.id, p_annuel, v_terrasse.organisation_id, p_terrasse_id);

  -- Taux du jour (si le Responsable l'a fixé) pour l'équivalent CDF du reçu
  select cdf_pour_usd into v_taux from taux_change
    where terrasse_id = p_terrasse_id order by fixe_le desc limit 1;

  insert into factures (organisation_id, terrasse_id, abonnement_id, plan_id,
                        montant_usd_centimes, remise_appliquee_pct,
                        taux_change_cdf, montant_cdf_equiv,
                        periode_debut, periode_fin, annuel)
    values (v_terrasse.organisation_id, p_terrasse_id, v_abonnement.id, v_plan.id,
            v_calc.montant_usd_centimes, v_calc.remise_pct,
            v_taux, case when v_taux is not null
                         then round(v_calc.montant_usd_centimes / 100.0 * v_taux)::bigint end,
            current_date,
            current_date + case when p_annuel then interval '1 year' else interval '1 month' end,
            p_annuel)
    returning * into v_facture;

  insert into paiements (facture_id, organisation_id, terrasse_id, methode, reference,
                         montant_usd_centimes, saisi_par)
    values (v_facture.id, v_terrasse.organisation_id, p_terrasse_id, p_methode,
            trim(p_reference), v_calc.montant_usd_centimes, v_uid);

  insert into audit_log (organisation_id, terrasse_id, utilisateur_id, role_actif, action, entite, entite_id, donnees)
    values (v_terrasse.organisation_id, p_terrasse_id, v_uid, 'PROPRIETAIRE', 'PAIEMENT_SOUMIS',
            'facture', v_facture.id, jsonb_build_object('montant_usd_centimes', v_calc.montant_usd_centimes));

  return jsonb_build_object(
    'facture_id', v_facture.id, 'numero', v_facture.numero,
    'montant_usd_centimes', v_calc.montant_usd_centimes,
    'montant_cdf_equiv', v_facture.montant_cdf_equiv,
    'remise_appliquee_pct', v_calc.remise_pct,
    'frais_installation', v_calc.frais_installation,
    'message', 'Effectuez le paiement mobile money exact de ce montant, il sera validé sous 24 h.'
  );
end;
$$;

-- Validation MANUELLE par un super-admin plateforme (phase 1).
-- Idempotent : un paiement déjà traité (ou un webhook rejoué) ne double-credite jamais.
create or replace function public.valider_paiement(
  p_paiement_id uuid, p_approuve boolean, p_motif_refus text default null
) returns public.paiements language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := ctx_utilisateur();
  v_paiement public.paiements;
  v_facture public.factures;
  v_debut date;
begin
  if not est_super_admin() then
    raise exception 'Réservé au super-admin plateforme.';
  end if;
  select * into v_paiement from paiements where id = p_paiement_id for update;
  if not found then raise exception 'Paiement introuvable.'; end if;
  if v_paiement.statut <> 'EN_ATTENTE' then return v_paiement; end if;  -- idempotent

  if not p_approuve then
    update paiements set statut = 'REFUSE', valide_par = v_uid, valide_le = now(),
           motif_refus = nullif(trim(p_motif_refus), '')
      where id = p_paiement_id returning * into v_paiement;
    perform notifier_roles(v_paiement.terrasse_id, '{}'::public.role_type[],
      'PAIEMENT_REFUSE', 'Paiement refusé',
      coalesce(nullif(trim(p_motif_refus), ''), 'Référence non retrouvée. Contactez le support.'),
      jsonb_build_object('paiement_id', v_paiement.id), true);
  else
    update paiements set statut = 'VALIDE', valide_par = v_uid, valide_le = now()
      where id = p_paiement_id returning * into v_paiement;

    update factures set statut = 'PAYEE', payee_le = now()
      where id = v_paiement.facture_id returning * into v_facture;

    -- Réactivation immédiate ; prolonge la période en cours si elle court encore.
    update abonnements ab
       set statut = 'ACTIF',
           plan_id = coalesce(v_facture.plan_id, ab.plan_id),
           plan_id_prochain = null,
           annuel = v_facture.annuel,
           periode_debut = case
             when ab.statut = 'ACTIF' and ab.periode_fin >= current_date then ab.periode_fin
             else current_date end,
           periode_fin = (case
             when ab.statut = 'ACTIF' and ab.periode_fin >= current_date then ab.periode_fin
             else current_date end)
             + case when v_facture.annuel then interval '1 year' else interval '1 month' end,
           grace_fin = null
     where ab.terrasse_id = v_paiement.terrasse_id;

    perform notifier_roles(v_paiement.terrasse_id, '{}'::public.role_type[],
      'PAIEMENT_VALIDE', 'Paiement validé — merci !',
      'Votre abonnement est actif. Facture ' || v_facture.numero || '.',
      jsonb_build_object('facture_id', v_facture.id), true);
  end if;

  insert into audit_log (organisation_id, terrasse_id, utilisateur_id, action, entite, entite_id, donnees)
    values (v_paiement.organisation_id, v_paiement.terrasse_id, v_uid,
            case when p_approuve then 'PAIEMENT_VALIDE_ADMIN' else 'PAIEMENT_REFUSE_ADMIN' end,
            'paiement', v_paiement.id, jsonb_build_object('super_admin', true));
  return v_paiement;
end;
$$;

-- Changement de plan : montée immédiate, descente à l'échéance.
create or replace function public.changer_plan(p_terrasse_id uuid, p_plan_code text)
returns public.abonnements language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := ctx_utilisateur();
  v_terrasse public.terrasses;
  v_abonnement public.abonnements;
  v_nouveau public.plans;
  v_actuel public.plans;
begin
  select * into v_terrasse from terrasses where id = p_terrasse_id;
  if not found then raise exception 'Terrasse introuvable.'; end if;
  if not est_proprietaire(v_terrasse.organisation_id) then
    raise exception 'Seul le Propriétaire change le plan.';
  end if;
  select * into v_abonnement from abonnements where terrasse_id = p_terrasse_id for update;
  select * into v_nouveau from plans where code = upper(trim(p_plan_code)) and actif;
  if not found then raise exception 'Plan inconnu.'; end if;
  select * into v_actuel from plans where id = v_abonnement.plan_id;

  if v_nouveau.prix_usd_centimes >= v_actuel.prix_usd_centimes then
    -- Montée : effet immédiat (le prorata est facturé via soumettre_paiement)
    update abonnements set plan_id = v_nouveau.id, plan_id_prochain = null
      where id = v_abonnement.id returning * into v_abonnement;
  else
    -- Descente : effet à l'échéance de la période payée
    update abonnements set plan_id_prochain = v_nouveau.id
      where id = v_abonnement.id returning * into v_abonnement;
  end if;

  insert into audit_log (organisation_id, terrasse_id, utilisateur_id, role_actif, action, entite, entite_id, donnees)
    values (v_terrasse.organisation_id, p_terrasse_id, v_uid, 'PROPRIETAIRE', 'CHANGEMENT_PLAN',
            'abonnement', v_abonnement.id, jsonb_build_object('nouveau_plan', v_nouveau.code));
  return v_abonnement;
end;
$$;

-- Prolongation exceptionnelle (super-admin).
create or replace function public.prolonger_abonnement(p_terrasse_id uuid, p_jours integer)
returns public.abonnements language plpgsql security definer set search_path = public as $$
declare
  v_abonnement public.abonnements;
begin
  if not est_super_admin() then raise exception 'Réservé au super-admin plateforme.'; end if;
  if p_jours is null or p_jours < 1 or p_jours > 365 then raise exception 'Durée invalide.'; end if;

  update abonnements
     set periode_fin = greatest(periode_fin, current_date) + p_jours,
         statut = case when statut in ('LECTURE_SEULE', 'SUSPENDU') then 'EN_GRACE'::public.statut_abonnement
                       else statut end,
         grace_fin = case when statut in ('LECTURE_SEULE', 'SUSPENDU')
                          then current_date + p_jours else grace_fin end
   where terrasse_id = p_terrasse_id
   returning * into v_abonnement;

  insert into audit_log (organisation_id, terrasse_id, utilisateur_id, action, entite, entite_id, donnees)
    values (v_abonnement.organisation_id, p_terrasse_id, ctx_utilisateur(), 'PROLONGATION_EXCEPTIONNELLE',
            'abonnement', v_abonnement.id, jsonb_build_object('jours', p_jours));
  return v_abonnement;
end;
$$;

-- CRON QUOTIDIEN (idempotent) : transitions de statut + rappels d'essai.
-- Planification : voir section 16 (pg_cron) — à activer une fois en production.
create or replace function public.cron_abonnements()
returns text language plpgsql security definer set search_path = public as $$
declare
  v_grace int; v_lecture int; v_suspendu int; v_rappels int := 0; v_expirees int;
  v record;
begin
  -- Ménage : invitations périmées (le refus à la consommation fait un rollback ;
  -- c'est donc le cron qui matérialise le statut EXPIREE)
  update invitations set statut = 'EXPIREE' where statut = 'ACTIVE' and expire_le < now();
  get diagnostics v_expirees = row_count;
  -- ESSAI ou ACTIF arrivé à échéance → EN_GRACE (7 jours). Application du plan différé.
  update abonnements set plan_id = plan_id_prochain, plan_id_prochain = null
    where plan_id_prochain is not null and periode_fin < current_date;

  update abonnements
     set statut = 'EN_GRACE', grace_fin = coalesce(essai_fin, periode_fin) + 7
   where statut in ('ESSAI', 'ACTIF') and coalesce(essai_fin, periode_fin) < current_date;
  get diagnostics v_grace = row_count;

  update abonnements set statut = 'LECTURE_SEULE'
    where statut = 'EN_GRACE' and grace_fin < current_date;
  get diagnostics v_lecture = row_count;

  update abonnements set statut = 'SUSPENDU'
    where statut = 'LECTURE_SEULE' and statut_change_le < now() - interval '60 days';
  get diagnostics v_suspendu = row_count;

  -- Rappels d'essai J-7 / J-3 / J-1 (dédoublonnés par jour dans donnees)
  for v in
    select ab.terrasse_id, ab.organisation_id, (ab.essai_fin - current_date) as j_restants
      from abonnements ab
     where ab.statut = 'ESSAI' and (ab.essai_fin - current_date) in (7, 3, 1)
  loop
    if not exists (
      select 1 from notifications
      where terrasse_id = v.terrasse_id and type = 'ESSAI_RAPPEL'
        and (donnees ->> 'j_restants')::int = v.j_restants
    ) then
      perform notifier_roles(v.terrasse_id, '{}'::public.role_type[],
        'ESSAI_RAPPEL',
        'Essai gratuit : J-' || v.j_restants,
        'Votre essai se termine dans ' || v.j_restants || ' jour(s). Passez au payant pour ne rien perdre.',
        jsonb_build_object('j_restants', v.j_restants), true);
      v_rappels := v_rappels + 1;
    end if;
  end loop;

  return format('grace=%s lecture_seule=%s suspendu=%s rappels=%s invitations_expirees=%s',
                v_grace, v_lecture, v_suspendu, v_rappels, v_expirees);
end;
$$;

-- ---------------------------------------------------------------------------
-- 12. TRIGGERS : machine à états, traçabilité, règles de conflit d'intérêts
-- ---------------------------------------------------------------------------

-- updated_at automatique
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  NEW.updated_at := now();
  return NEW;
end;
$$;

-- Création automatique du profil à l'inscription Supabase Auth
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.utilisateurs (id, nom, telephone, email)
    values (NEW.id,
            coalesce(nullif(trim(NEW.raw_user_meta_data ->> 'nom'), ''), 'Utilisateur'),
            NEW.phone, NEW.email);
  return NEW;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ----- Affectations : conflits d'intérêts, dernier propriétaire, push -----
create or replace function public.trg_affectations_regles()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_cible record;
begin
  v_cible := case when TG_OP = 'DELETE' then OLD else NEW end;

  -- Règle d'interdiction : SERVEUSE + (GERANT | RESPONSABLE) sur la MÊME terrasse
  if TG_OP in ('INSERT', 'UPDATE') and NEW.statut = 'ACTIVE' and NEW.terrasse_id is not null then
    if exists (
      select 1 from affectations a
      where a.utilisateur_id = NEW.utilisateur_id
        and a.terrasse_id = NEW.terrasse_id
        and a.statut = 'ACTIVE'
        and a.id <> coalesce(NEW.id, '00000000-0000-0000-0000-000000000000'::uuid)
        and (
          (NEW.role = 'SERVEUSE' and a.role in ('GERANT', 'RESPONSABLE'))
          or (NEW.role in ('GERANT', 'RESPONSABLE') and a.role = 'SERVEUSE')
        )
    ) then
      raise exception 'Conflit d''intérêts : impossible de cumuler SERVEUSE avec GERANT/RESPONSABLE sur la même terrasse.';
    end if;
  end if;

  -- Dernier Propriétaire : impossible à retirer ou désactiver
  if (TG_OP = 'DELETE' and OLD.role = 'PROPRIETAIRE' and OLD.statut = 'ACTIVE')
     or (TG_OP = 'UPDATE' and OLD.role = 'PROPRIETAIRE' and OLD.statut = 'ACTIVE'
         and (NEW.statut <> 'ACTIVE' or NEW.role <> 'PROPRIETAIRE')) then
    if not exists (
      select 1 from affectations
      where organisation_id = v_cible.organisation_id and role = 'PROPRIETAIRE'
        and statut = 'ACTIVE' and id <> v_cible.id
    ) then
      raise exception 'Impossible de retirer le dernier Propriétaire de l''organisation.';
    end if;
  end if;

  -- Désactivation : coupe les tokens push si plus AUCUNE affectation active
  if TG_OP = 'UPDATE' and NEW.statut = 'DESACTIVEE' and OLD.statut = 'ACTIVE' then
    NEW.desactive_le := now();
    if not exists (
      select 1 from affectations
      where utilisateur_id = NEW.utilisateur_id and statut = 'ACTIVE' and id <> NEW.id
    ) then
      update push_tokens set actif = false where utilisateur_id = NEW.utilisateur_id;
    end if;
  end if;

  if TG_OP = 'DELETE' then return OLD; end if;
  return NEW;
end;
$$;

create trigger affectations_regles
  before insert or update or delete on public.affectations
  for each row execute function public.trg_affectations_regles();

-- ----- Produits : traçabilité prix + stock, alertes -----
create or replace function public.trg_produits_trace()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_motif text;
begin
  -- Changement de prix : toujours journalisé
  if NEW.prix_cdf is distinct from OLD.prix_cdf then
    insert into historique_prix (terrasse_id, produit_id, ancien_prix_cdf, nouveau_prix_cdf, modifie_par, role_actif)
      values (NEW.terrasse_id, NEW.id, OLD.prix_cdf, NEW.prix_cdf, ctx_utilisateur(), ctx_role_actif());
  end if;

  -- Modification DIRECTE du stock (hors fonctions système) : motif obligatoire + journal.
  -- Les fonctions (réservation/vente/ajustement) posent nganda.systeme = '1' ou
  -- s'exécutent dans un trigger de commande (pg_trigger_depth > 1) : elles journalisent elles-mêmes.
  if NEW.stock is distinct from OLD.stock
     and current_setting('nganda.systeme', true) is distinct from '1'
     and pg_trigger_depth() <= 1 then
    v_motif := nullif(current_setting('nganda.motif', true), '');
    if v_motif is null then
      raise exception 'Motif obligatoire : passez par ajuster_stock() ou définissez nganda.motif.';
    end if;
    insert into mouvements_stock
      (terrasse_id, produit_id, type, quantite, stock_avant, stock_apres,
       reserve_avant, reserve_apres, motif, effectue_par, role_actif)
      values (NEW.terrasse_id, NEW.id, 'AJUSTEMENT', NEW.stock - OLD.stock,
              OLD.stock, NEW.stock, OLD.stock_reserve, NEW.stock_reserve,
              v_motif, ctx_utilisateur(), ctx_role_actif());
  end if;

  -- Alerte stock bas / rupture (dédoublonnée tant qu'une alerte est ouverte)
  if NEW.stock <= NEW.seuil_alerte and OLD.stock > OLD.seuil_alerte
     and not exists (select 1 from alertes
                     where reference_id = NEW.id and type in ('STOCK_BAS', 'RUPTURE') and not traitee) then
    insert into alertes (terrasse_id, type, severite, message, reference_id, donnees)
      values (NEW.terrasse_id,
              case when NEW.stock = 0 then 'RUPTURE'::public.type_alerte else 'STOCK_BAS'::public.type_alerte end,
              case when NEW.stock = 0 then 'CRITIQUE' else 'IMPORTANT' end,
              case when NEW.stock = 0 then 'Rupture : ' else 'Stock bas : ' end || NEW.nom,
              NEW.id, jsonb_build_object('produit_id', NEW.id, 'stock', NEW.stock, 'seuil', NEW.seuil_alerte));
    perform notifier_roles(NEW.terrasse_id, array['GERANT', 'RESPONSABLE']::public.role_type[],
      case when NEW.stock = 0 then 'RUPTURE' else 'STOCK_BAS' end,
      case when NEW.stock = 0 then 'Rupture : ' else 'Stock bas : ' end || NEW.nom,
      'Stock restant : ' || NEW.stock,
      jsonb_build_object('produit_id', NEW.id));
  end if;

  return NEW;
end;
$$;

create trigger produits_trace
  after update on public.produits
  for each row execute function public.trg_produits_trace();

-- ----- Commandes : machine à états (BEFORE) -----
create or replace function public.trg_commandes_transition()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_ok boolean;
begin
  if NEW.statut is not distinct from OLD.statut then return NEW; end if;

  v_ok := (OLD.statut = 'EN_ATTENTE' and NEW.statut in ('CONFIRMEE', 'ANNULEE', 'REFUSEE_STOCK'))
       or (OLD.statut = 'CONFIRMEE' and NEW.statut in ('SERVIE', 'ANNULEE'));
  if not v_ok then
    raise exception 'Transition de commande interdite : % → %.', OLD.statut, NEW.statut;
  end if;

  -- Horodatages de cycle de vie
  if NEW.statut = 'CONFIRMEE' then NEW.confirmee_le := now(); end if;
  if NEW.statut = 'SERVIE'    then NEW.servie_le    := now(); end if;
  if NEW.statut = 'ANNULEE'   then NEW.annulee_le   := now(); end if;

  -- Libération automatique du stock réservé si la commande confirmée tombe
  if OLD.statut = 'CONFIRMEE' and NEW.statut in ('ANNULEE', 'REFUSEE_STOCK') then
    with l as (
      select produit_id, sum(quantite) as qte from commande_lignes
      where commande_id = NEW.id group by produit_id
    )
    update produits p set stock_reserve = p.stock_reserve - l.qte from l
      where p.id = l.produit_id;

    insert into mouvements_stock
      (terrasse_id, produit_id, type, quantite, stock_avant, stock_apres,
       reserve_avant, reserve_apres, motif, reference_type, reference_id, effectue_par, role_actif)
      select p.terrasse_id, p.id, 'LIBERATION', 0, p.stock, p.stock,
             p.stock_reserve + l.qte, p.stock_reserve,
             'Libération (annulation/refus)', 'commande', NEW.id, ctx_utilisateur(), ctx_role_actif()
      from (select produit_id, sum(quantite) as qte from commande_lignes
            where commande_id = NEW.id group by produit_id) l
      join produits p on p.id = l.produit_id;
  end if;

  return NEW;
end;
$$;

create trigger commandes_transition
  before update on public.commandes
  for each row execute function public.trg_commandes_transition();

-- ----- Commandes : audit + notifications + historique client (AFTER) -----
create or replace function public.trg_commandes_apres()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_resume text;
  v_table_no integer;
  v_prenom text;
  v_org uuid;
begin
  if NEW.statut is distinct from OLD.statut then
    select t.organisation_id into v_org from terrasses t where t.id = NEW.terrasse_id;
    insert into audit_log (organisation_id, terrasse_id, utilisateur_id, role_actif, action, entite, entite_id, donnees)
      values (v_org, NEW.terrasse_id, ctx_utilisateur(), ctx_role_actif(),
              'COMMANDE_' || NEW.statut::text, 'commande', NEW.id,
              jsonb_build_object('de', OLD.statut, 'vers', NEW.statut));

    select t.numero, cs.prenom into v_table_no, v_prenom
      from tables t, clients_session cs
     where t.id = NEW.table_id and cs.id = NEW.client_session_id;
    select string_agg(cl.quantite || ' ' || p.nom, ', ' order by p.nom) into v_resume
      from commande_lignes cl join produits p on p.id = cl.produit_id
     where cl.commande_id = NEW.id;

    if NEW.statut = 'CONFIRMEE' then
      -- Push + son à la serveuse assignée ; flux en direct gérant/responsable (Realtime)
      if NEW.serveuse_id is not null then
        insert into notifications (terrasse_id, utilisateur_id, type, titre, corps, donnees)
          values (NEW.terrasse_id, NEW.serveuse_id, 'COMMANDE_CONFIRMEE',
                  'Table ' || v_table_no || ' : ' || v_prenom,
                  v_resume, jsonb_build_object('commande_id', NEW.id, 'son', true));
      end if;

    elsif NEW.statut = 'SERVIE' then
      perform notifier_client(NEW.client_session_id, NEW.terrasse_id, 'COMMANDE_SERVIE',
        'Commande servie', 'Bon appétit ! Notez votre serveuse.',
        jsonb_build_object('commande_id', NEW.id));

      -- Historique client agrégé
      insert into historique_client (terrasse_id, identifiant, prenom, telephone, visites, depense_total_cdf, derniere_visite_le)
        select cs.terrasse_id,
               case when cs.telephone is not null then 'tel:' || cs.telephone
                    else 'nom:' || lower(trim(cs.prenom)) end,
               cs.prenom, cs.telephone, 1, NEW.montant_total_cdf, now()
          from clients_session cs where cs.id = NEW.client_session_id
      on conflict (terrasse_id, identifiant) do update
        set visites = historique_client.visites + 1,
            depense_total_cdf = historique_client.depense_total_cdf + excluded.depense_total_cdf,
            derniere_visite_le = now();

    elsif NEW.statut in ('ANNULEE', 'REFUSEE_STOCK') then
      if NEW.serveuse_id is not null then
        insert into notifications (terrasse_id, utilisateur_id, type, titre, corps, donnees)
          values (NEW.terrasse_id, NEW.serveuse_id, 'COMMANDE_' || NEW.statut::text,
                  case when NEW.statut = 'ANNULEE' then 'Commande annulée' else 'Stock insuffisant' end
                       || ' — table ' || v_table_no,
                  coalesce(NEW.motif_annulation, v_resume),
                  jsonb_build_object('commande_id', NEW.id));
      end if;
      perform notifier_roles(NEW.terrasse_id, array['GERANT']::public.role_type[],
        'COMMANDE_' || NEW.statut::text,
        case when NEW.statut = 'ANNULEE' then 'Commande annulée' else 'Commande refusée (stock)' end
             || ' — table ' || v_table_no,
        coalesce(NEW.motif_annulation, v_resume),
        jsonb_build_object('commande_id', NEW.id));
      perform notifier_client(NEW.client_session_id, NEW.terrasse_id, 'COMMANDE_' || NEW.statut::text,
        case when NEW.statut = 'ANNULEE' then 'Commande annulée' else 'Produit en rupture' end,
        coalesce(NEW.motif_annulation, 'Désolé, un produit est en rupture.'),
        jsonb_build_object('commande_id', NEW.id));
    end if;
  end if;
  return NEW;
end;
$$;

create trigger commandes_apres
  after update on public.commandes
  for each row execute function public.trg_commandes_apres();

-- ----- Sessions : immuabilité après clôture + notification gérant -----
create or replace function public.trg_sessions_regles()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if TG_OP = 'UPDATE' then
    if OLD.statut = 'CLOTUREE' then
      raise exception 'Session clôturée : immuable (corrections par écriture d''ajustement).';
    end if;
    if NEW.statut = 'CLOTUREE' and OLD.statut = 'OUVERTE' then
      perform notifier_roles(NEW.terrasse_id, array['GERANT']::public.role_type[],
        'FIN_DE_SERVICE', 'Fin de service déclarée',
        (select 'Session de ' || u.nom from utilisateurs u where u.id = NEW.serveuse_id),
        jsonb_build_object('session_id', NEW.id, 'montant_attendu_cdf', NEW.montant_attendu_cdf));
    end if;
  end if;
  return NEW;
end;
$$;

create trigger sessions_regles
  before update on public.sessions_service
  for each row execute function public.trg_sessions_regles();

-- ----- Dépôts : nul ne valide son propre dépôt, alertes d'écart -----
create or replace function public.trg_depots_avant()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if OLD.statut <> 'DECLARE' and NEW.statut is distinct from OLD.statut then
    raise exception 'Dépôt déjà traité : immuable.';
  end if;
  if NEW.statut in ('VALIDE', 'CONTESTE') and NEW.valide_par is not null
     and NEW.valide_par = OLD.serveuse_id then
    raise exception 'Nul ne valide son propre dépôt.';
  end if;
  return NEW;
end;
$$;

create trigger depots_avant
  before update on public.depots
  for each row execute function public.trg_depots_avant();

create or replace function public.trg_depots_apres()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_seuil integer;
begin
  if TG_OP = 'INSERT' then
    v_seuil := coalesce((select (parametres ->> 'seuil_ecart_cdf')::int
                         from terrasses where id = NEW.terrasse_id), 10000);
    if abs(NEW.ecart_cdf) > v_seuil then
      insert into alertes (terrasse_id, type, severite, message, reference_id, donnees)
        values (NEW.terrasse_id, 'ECART_CAISSE', 'CRITIQUE',
                'Écart de caisse de ' || NEW.ecart_cdf || ' FC (seuil : ' || v_seuil || ' FC)',
                NEW.id, jsonb_build_object('depot_id', NEW.id, 'serveuse_id', NEW.serveuse_id));
      -- Gérant + Responsable + Propriétaire en UN SEUL appel :
      -- une personne cumulant plusieurs rôles ne reçoit qu'UNE notification.
      perform notifier_roles(NEW.terrasse_id, array['GERANT', 'RESPONSABLE']::public.role_type[],
        'ECART_CAISSE', '🚨 Écart de caisse détecté',
        'Écart de ' || NEW.ecart_cdf || ' FC sur un dépôt. À traiter en priorité.',
        jsonb_build_object('depot_id', NEW.id, 'prioritaire', true), true);
    end if;
  elsif TG_OP = 'UPDATE' and NEW.statut is distinct from OLD.statut then
    -- Dépôt validé / contesté → serveuse ; Responsable notifié si contesté
    insert into notifications (terrasse_id, utilisateur_id, type, titre, corps, donnees)
      values (NEW.terrasse_id, NEW.serveuse_id,
              'DEPOT_' || NEW.statut::text,
              case when NEW.statut = 'VALIDE' then 'Dépôt validé ✅' else 'Dépôt contesté' end,
              coalesce(NEW.motif_contestation, 'Montant déposé : ' || NEW.montant_depose_cdf || ' FC'),
              jsonb_build_object('depot_id', NEW.id));
    if NEW.statut = 'CONTESTE' then
      perform notifier_roles(NEW.terrasse_id, array['RESPONSABLE']::public.role_type[],
        'DEPOT_CONTESTE', 'Dépôt contesté', NEW.motif_contestation,
        jsonb_build_object('depot_id', NEW.id));
    end if;
  end if;
  return coalesce(NEW, OLD);
end;
$$;

create trigger depots_apres
  after insert or update on public.depots
  for each row execute function public.trg_depots_apres();

-- ----- Avis : uniquement sur commande SERVIE, rattachement forcé -----
create or replace function public.trg_avis_regles()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_commande public.commandes;
begin
  select * into v_commande from commandes where id = NEW.commande_id;
  if not found or v_commande.statut <> 'SERVIE' then
    raise exception 'Avis possible uniquement sur une commande servie.';
  end if;
  -- Le client ne choisit pas la serveuse notée : elle vient de la commande.
  NEW.terrasse_id := v_commande.terrasse_id;
  NEW.serveuse_id := v_commande.serveuse_id;
  return NEW;
end;
$$;

create trigger avis_regles
  before insert on public.avis_serveuse
  for each row execute function public.trg_avis_regles();

-- ----- table_serveuse : la serveuse doit être affectée SERVEUSE active -----
create or replace function public.trg_table_serveuse_regles()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if NEW.actif and not exists (
    select 1 from affectations
    where utilisateur_id = NEW.serveuse_id and terrasse_id = NEW.terrasse_id
      and role = 'SERVEUSE' and statut = 'ACTIVE'
  ) then
    raise exception 'La personne assignée doit avoir une affectation SERVEUSE active sur cette terrasse.';
  end if;
  return NEW;
end;
$$;

create trigger table_serveuse_regles
  before insert or update on public.table_serveuse
  for each row execute function public.trg_table_serveuse_regles();

-- ----- Abonnements : mémoriser la date de changement de statut -----
create or replace function public.trg_abonnements_statut()
returns trigger language plpgsql as $$
begin
  if NEW.statut is distinct from OLD.statut then
    NEW.statut_change_le := now();
  end if;
  return NEW;
end;
$$;

create trigger abonnements_statut
  before update on public.abonnements
  for each row execute function public.trg_abonnements_statut();

-- ----- Historiques append-only : UPDATE/DELETE interdits À TOUS -----
create or replace function public.trg_interdire_modif()
returns trigger language plpgsql as $$
begin
  raise exception 'Table d''historique : modification et suppression interdites.';
end;
$$;

create trigger mouvements_stock_immutable before update or delete on public.mouvements_stock
  for each row execute function public.trg_interdire_modif();
create trigger historique_prix_immutable before update or delete on public.historique_prix
  for each row execute function public.trg_interdire_modif();
create trigger audit_log_immutable before update or delete on public.audit_log
  for each row execute function public.trg_interdire_modif();

-- ----- updated_at sur les tables concernées -----
create trigger set_updated_at before update on public.organisations   for each row execute function public.set_updated_at();
create trigger set_updated_at before update on public.utilisateurs    for each row execute function public.set_updated_at();
create trigger set_updated_at before update on public.terrasses       for each row execute function public.set_updated_at();
create trigger set_updated_at before update on public.affectations    for each row execute function public.set_updated_at();
create trigger set_updated_at before update on public.tables          for each row execute function public.set_updated_at();
create trigger set_updated_at before update on public.produits        for each row execute function public.set_updated_at();
create trigger set_updated_at before update on public.commandes       for each row execute function public.set_updated_at();
create trigger set_updated_at before update on public.depots          for each row execute function public.set_updated_at();
create trigger set_updated_at before update on public.demandes_stock  for each row execute function public.set_updated_at();
create trigger set_updated_at before update on public.plans           for each row execute function public.set_updated_at();
create trigger set_updated_at before update on public.abonnements     for each row execute function public.set_updated_at();
create trigger set_updated_at before update on public.historique_client for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- 13. FONCTION COMPLÉMENTAIRE : création de terrasse (Propriétaire exclusif)
-- ---------------------------------------------------------------------------
create or replace function public.creer_terrasse(
  p_nom text, p_adresse text, p_nombre_tables integer
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := ctx_utilisateur();
  v_org uuid;
  v_terrasse_id uuid;
  v_slug text;
  v_plan uuid;
  v_i int;
begin
  select organisation_id into v_org from affectations
    where utilisateur_id = v_uid and role = 'PROPRIETAIRE' and statut = 'ACTIVE' limit 1;
  if v_org is null then raise exception 'Seul le Propriétaire crée une terrasse.'; end if;
  if p_nombre_tables is null or p_nombre_tables < 1 or p_nombre_tables > 500 then
    raise exception 'Nombre de tables invalide (1 à 500).';
  end if;

  v_slug := trim(both '-' from regexp_replace(
    lower(translate(p_nom, 'éèêëàâäùûüôöîïç', 'eeeeaaauuuooiic')), '[^a-z0-9]+', '-', 'g'))
    || '-' || substr(encode(gen_random_bytes(3), 'hex'), 1, 6);

  insert into terrasses (organisation_id, nom, adresse, slug, cree_par)
    values (v_org, trim(p_nom), p_adresse, v_slug, v_uid) returning id into v_terrasse_id;

  for v_i in 1..p_nombre_tables loop
    insert into tables (terrasse_id, numero, libelle) values (v_terrasse_id, v_i, 'Table ' || v_i);
  end loop;

  -- Chaque terrasse a SON abonnement : nouvel essai de 14 jours.
  select id into v_plan from plans where code = 'ESSENTIEL' and actif;
  insert into abonnements (terrasse_id, organisation_id, plan_id, statut, periode_debut, periode_fin, essai_fin)
    values (v_terrasse_id, v_org, v_plan, 'ESSAI', current_date, current_date + 14, current_date + 14);

  insert into audit_log (organisation_id, terrasse_id, utilisateur_id, role_actif, action, entite, entite_id)
    values (v_org, v_terrasse_id, v_uid, 'PROPRIETAIRE', 'TERRASSE_CREEE', 'terrasse', v_terrasse_id);

  return jsonb_build_object('terrasse_id', v_terrasse_id, 'slug', v_slug);
end;
$$;

-- Raccourci : propriétaire de l'organisation qui possède la terrasse
create or replace function public.est_proprietaire_terrasse(p_terrasse_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select est_proprietaire((select organisation_id from terrasses where id = p_terrasse_id));
$$;

-- ---------------------------------------------------------------------------
-- 14. ROW LEVEL SECURITY — cloisonnement organisation + terrasse + rôle
--     (3e niveau de la règle d'or, après l'UI et le middleware backend)
-- ---------------------------------------------------------------------------

alter table public.organisations        enable row level security;
alter table public.utilisateurs         enable row level security;
alter table public.terrasses            enable row level security;
alter table public.affectations         enable row level security;
alter table public.invitations          enable row level security;
alter table public.tables               enable row level security;
alter table public.produits             enable row level security;
alter table public.table_serveuse       enable row level security;
alter table public.clients_session      enable row level security;
alter table public.commandes            enable row level security;
alter table public.commande_lignes      enable row level security;
alter table public.sessions_service     enable row level security;
alter table public.depots               enable row level security;
alter table public.avis_serveuse        enable row level security;
alter table public.historique_client    enable row level security;
alter table public.mouvements_stock     enable row level security;
alter table public.pertes_stock         enable row level security;
alter table public.demandes_stock       enable row level security;
alter table public.historique_prix      enable row level security;
alter table public.push_tokens          enable row level security;
alter table public.notifications        enable row level security;
alter table public.alertes              enable row level security;
alter table public.audit_log            enable row level security;
alter table public.plans                enable row level security;
alter table public.abonnements          enable row level security;
alter table public.factures             enable row level security;
alter table public.paiements            enable row level security;
alter table public.remises              enable row level security;
alter table public.super_admins         enable row level security;
-- V2/V3 : lecture staff, AUCUNE écriture (verrouillées jusqu'à leur version)
alter table public.fournisseurs         enable row level security;
alter table public.bons_commande        enable row level security;
alter table public.bons_commande_lignes enable row level security;
alter table public.receptions           enable row level security;
alter table public.consignes            enable row level security;
alter table public.mouvements_consigne  enable row level security;
alter table public.ardoises             enable row level security;
alter table public.ardoise_operations   enable row level security;
alter table public.categories_depense   enable row level security;
alter table public.depenses             enable row level security;
alter table public.inventaires          enable row level security;
alter table public.inventaire_lignes    enable row level security;
alter table public.fidelite_comptes     enable row level security;
alter table public.fidelite_mouvements  enable row level security;
alter table public.promotions           enable row level security;
alter table public.taux_change          enable row level security;
alter table public.avances_serveuse     enable row level security;
alter table public.commissions          enable row level security;

-- ----- organisations -----
create policy organisations_select on public.organisations for select to authenticated
  using (membre_organisation(id) or est_super_admin());
create policy organisations_update on public.organisations for update to authenticated
  using (est_proprietaire(id)) with check (est_proprietaire(id));

-- ----- utilisateurs -----
create policy utilisateurs_select on public.utilisateurs for select to authenticated
  using (id = ctx_utilisateur() or est_super_admin()
         or exists (select 1 from affectations a1
                    join affectations a2 on a2.organisation_id = a1.organisation_id
                    where a1.utilisateur_id = ctx_utilisateur() and a1.statut = 'ACTIVE'
                      and a2.utilisateur_id = utilisateurs.id and a2.statut = 'ACTIVE'));
create policy utilisateurs_update on public.utilisateurs for update to authenticated
  using (id = ctx_utilisateur()) with check (id = ctx_utilisateur());

-- ----- terrasses -----
create policy terrasses_select on public.terrasses for select to authenticated
  using (membre_organisation(organisation_id) or est_super_admin());
create policy terrasses_update on public.terrasses for update to authenticated
  using ((est_proprietaire(organisation_id) or a_role(id, array['RESPONSABLE']::public.role_type[]))
         and abonnement_permet_ecriture(id))
  with check ((est_proprietaire(organisation_id) or a_role(id, array['RESPONSABLE']::public.role_type[]))
         and abonnement_permet_ecriture(id));
create policy terrasses_delete on public.terrasses for delete to authenticated
  using (est_proprietaire(organisation_id));

-- ----- affectations (le Responsable gère gérants/serveuses de SA terrasse) -----
create policy affectations_select on public.affectations for select to authenticated
  using (membre_organisation(organisation_id) or est_super_admin());
create policy affectations_insert on public.affectations for insert to authenticated
  with check (
    est_proprietaire(organisation_id)
    or (terrasse_id is not null and role in ('GERANT', 'SERVEUSE')
        and a_role(terrasse_id, array['RESPONSABLE']::public.role_type[])
        and abonnement_permet_ecriture(terrasse_id))
  );
create policy affectations_update on public.affectations for update to authenticated
  using (est_proprietaire(organisation_id)
         or (terrasse_id is not null and role in ('GERANT', 'SERVEUSE')
             and a_role(terrasse_id, array['RESPONSABLE']::public.role_type[])))
  with check (est_proprietaire(organisation_id)
         or (terrasse_id is not null and role in ('GERANT', 'SERVEUSE')
             and a_role(terrasse_id, array['RESPONSABLE']::public.role_type[])));
create policy affectations_delete on public.affectations for delete to authenticated
  using (est_proprietaire(organisation_id)
         or (terrasse_id is not null and role in ('GERANT', 'SERVEUSE')
             and a_role(terrasse_id, array['RESPONSABLE']::public.role_type[])));

-- ----- invitations (gestion via RPC ; lecture par les inviteurs) -----
create policy invitations_select on public.invitations for select to authenticated
  using (est_proprietaire(organisation_id)
         or (terrasse_id is not null and a_role(terrasse_id, array['RESPONSABLE']::public.role_type[]))
         or est_super_admin());

-- ----- tables physiques -----
create policy tables_select on public.tables for select to authenticated
  using (a_role(terrasse_id, array['SERVEUSE','GERANT','RESPONSABLE']::public.role_type[])
         or est_proprietaire_terrasse(terrasse_id) or est_super_admin());
create policy tables_insert on public.tables for insert to authenticated
  with check ((a_role(terrasse_id, array['GERANT','RESPONSABLE']::public.role_type[])
               or est_proprietaire_terrasse(terrasse_id)) and abonnement_permet_ecriture(terrasse_id));
create policy tables_update on public.tables for update to authenticated
  using ((a_role(terrasse_id, array['GERANT','RESPONSABLE']::public.role_type[])
          or est_proprietaire_terrasse(terrasse_id)) and abonnement_permet_ecriture(terrasse_id));
create policy tables_delete on public.tables for delete to authenticated
  using ((a_role(terrasse_id, array['GERANT','RESPONSABLE']::public.role_type[])
          or est_proprietaire_terrasse(terrasse_id)) and abonnement_permet_ecriture(terrasse_id));

-- ----- produits : RÈGLE D'OR -----
-- Lecture staff complète ; menu public (carte) limité aux produits actifs.
create policy produits_select_staff on public.produits for select to authenticated
  using (a_role(terrasse_id, array['SERVEUSE','GERANT','RESPONSABLE']::public.role_type[])
         or est_proprietaire_terrasse(terrasse_id) or est_super_admin());
create policy produits_select_menu on public.produits for select to anon
  using (actif and supprime_le is null);
create policy produits_insert on public.produits for insert to authenticated
  with check (peut_modifier_stock_prix(terrasse_id) and abonnement_permet_ecriture(terrasse_id));
create policy produits_update on public.produits for update to authenticated
  using (peut_modifier_stock_prix(terrasse_id) and abonnement_permet_ecriture(terrasse_id))
  with check (peut_modifier_stock_prix(terrasse_id) and abonnement_permet_ecriture(terrasse_id));
create policy produits_delete on public.produits for delete to authenticated
  using (peut_modifier_stock_prix(terrasse_id) and abonnement_permet_ecriture(terrasse_id));

-- ----- table_serveuse -----
create policy table_serveuse_select on public.table_serveuse for select to authenticated
  using (a_role(terrasse_id, array['SERVEUSE','GERANT','RESPONSABLE']::public.role_type[])
         or est_proprietaire_terrasse(terrasse_id));
create policy table_serveuse_insert on public.table_serveuse for insert to authenticated
  with check ((a_role(terrasse_id, array['GERANT','RESPONSABLE']::public.role_type[])
               or est_proprietaire_terrasse(terrasse_id)) and abonnement_permet_ecriture(terrasse_id));
create policy table_serveuse_update on public.table_serveuse for update to authenticated
  using ((a_role(terrasse_id, array['GERANT','RESPONSABLE']::public.role_type[])
          or est_proprietaire_terrasse(terrasse_id)) and abonnement_permet_ecriture(terrasse_id));
create policy table_serveuse_delete on public.table_serveuse for delete to authenticated
  using (a_role(terrasse_id, array['GERANT','RESPONSABLE']::public.role_type[])
         or est_proprietaire_terrasse(terrasse_id));

-- ----- clients_session -----
create policy clients_session_select on public.clients_session for select to authenticated
  using (anon_auth_id = auth.uid()
         or a_role(terrasse_id, array['GERANT','RESPONSABLE']::public.role_type[])
         or est_proprietaire_terrasse(terrasse_id));
create policy clients_session_update on public.clients_session for update to authenticated
  using (anon_auth_id = auth.uid()) with check (anon_auth_id = auth.uid());

-- ----- commandes : lecture seule pour tous, écriture via RPC -----
create policy commandes_select on public.commandes for select to authenticated
  using (
    a_role(terrasse_id, array['GERANT','RESPONSABLE']::public.role_type[])
    or est_proprietaire_terrasse(terrasse_id)
    or est_super_admin()
    or (a_role(terrasse_id, array['SERVEUSE']::public.role_type[]) and serveuse_id = auth.uid())
    or exists (select 1 from clients_session cs
               where cs.id = commandes.client_session_id and cs.anon_auth_id = auth.uid())
  );

create policy commande_lignes_select on public.commande_lignes for select to authenticated
  using (exists (
    select 1 from commandes c
    where c.id = commande_lignes.commande_id
      and (a_role(c.terrasse_id, array['SERVEUSE','GERANT','RESPONSABLE']::public.role_type[])
           or est_proprietaire_terrasse(c.terrasse_id)
           or exists (select 1 from clients_session cs
                      where cs.id = c.client_session_id and cs.anon_auth_id = auth.uid()))
  ));

-- ----- sessions de service, dépôts (écriture via RPC) -----
create policy sessions_select on public.sessions_service for select to authenticated
  using (a_role(terrasse_id, array['SERVEUSE','GERANT','RESPONSABLE']::public.role_type[])
         or est_proprietaire_terrasse(terrasse_id));
create policy depots_select on public.depots for select to authenticated
  using (a_role(terrasse_id, array['SERVEUSE','GERANT','RESPONSABLE']::public.role_type[])
         or est_proprietaire_terrasse(terrasse_id));

-- ----- avis serveuse -----
create policy avis_select on public.avis_serveuse for select to authenticated
  using (a_role(terrasse_id, array['SERVEUSE','GERANT','RESPONSABLE']::public.role_type[])
         or est_proprietaire_terrasse(terrasse_id)
         or exists (select 1 from commandes c join clients_session cs on cs.id = c.client_session_id
                    where c.id = avis_serveuse.commande_id and cs.anon_auth_id = auth.uid()));
create policy avis_insert on public.avis_serveuse for insert to authenticated
  with check (exists (select 1 from commandes c join clients_session cs on cs.id = c.client_session_id
                      where c.id = commande_id and cs.anon_auth_id = auth.uid() and c.statut = 'SERVIE'));

-- ----- historique client (données sensibles : Responsable/Propriétaire) -----
create policy historique_client_select on public.historique_client for select to authenticated
  using (a_role(terrasse_id, array['RESPONSABLE']::public.role_type[])
         or est_proprietaire_terrasse(terrasse_id));

-- ----- stock : lecture staff, écriture JAMAIS directe -----
create policy mouvements_stock_select on public.mouvements_stock for select to authenticated
  using (a_role(terrasse_id, array['SERVEUSE','GERANT','RESPONSABLE']::public.role_type[])
         or est_proprietaire_terrasse(terrasse_id));
create policy pertes_stock_select on public.pertes_stock for select to authenticated
  using (a_role(terrasse_id, array['GERANT','RESPONSABLE']::public.role_type[])
         or est_proprietaire_terrasse(terrasse_id));
create policy pertes_stock_insert on public.pertes_stock for insert to authenticated
  with check (peut_modifier_stock_prix(terrasse_id) and abonnement_permet_ecriture(terrasse_id));
create policy demandes_stock_select on public.demandes_stock for select to authenticated
  using (a_role(terrasse_id, array['GERANT','RESPONSABLE']::public.role_type[])
         or est_proprietaire_terrasse(terrasse_id));
create policy historique_prix_select on public.historique_prix for select to authenticated
  using (a_role(terrasse_id, array['GERANT','RESPONSABLE']::public.role_type[])
         or est_proprietaire_terrasse(terrasse_id));

-- ----- push tokens / notifications / alertes -----
create policy push_tokens_all on public.push_tokens for all to authenticated
  using (utilisateur_id = auth.uid()) with check (utilisateur_id = auth.uid());
create policy notifications_select on public.notifications for select to authenticated
  using (utilisateur_id = auth.uid()
         or exists (select 1 from clients_session cs
                    where cs.id = notifications.client_session_id and cs.anon_auth_id = auth.uid()));
create policy notifications_update on public.notifications for update to authenticated
  using (utilisateur_id = auth.uid()) with check (utilisateur_id = auth.uid());
create policy alertes_select on public.alertes for select to authenticated
  using (a_role(terrasse_id, array['GERANT','RESPONSABLE']::public.role_type[])
         or est_proprietaire_terrasse(terrasse_id));
create policy alertes_update on public.alertes for update to authenticated
  using (a_role(terrasse_id, array['GERANT','RESPONSABLE']::public.role_type[])
         or est_proprietaire_terrasse(terrasse_id));

-- ----- audit : lecture Responsable/Propriétaire/super-admin, écriture interdite -----
create policy audit_log_select on public.audit_log for select to authenticated
  using ((terrasse_id is not null and a_role(terrasse_id, array['RESPONSABLE']::public.role_type[]))
         or (organisation_id is not null and est_proprietaire(organisation_id))
         or est_super_admin());

-- ----- SaaS -----
create policy plans_select on public.plans for select using (actif);          -- tarifs publics
create policy remises_select on public.remises for select using (actif);
create policy abonnements_select on public.abonnements for select to authenticated
  using (est_proprietaire(organisation_id) or est_super_admin());
create policy factures_select on public.factures for select to authenticated
  using (est_proprietaire(organisation_id) or est_super_admin());
create policy paiements_select on public.paiements for select to authenticated
  using (est_proprietaire(organisation_id) or est_super_admin());
create policy super_admins_select on public.super_admins for select to authenticated
  using (utilisateur_id = auth.uid() or est_super_admin());

-- ----- V2/V3 : lecture staff uniquement, écriture bloquée jusqu'à la version -----
create policy fournisseurs_select on public.fournisseurs for select to authenticated
  using (membre_organisation(organisation_id));
create policy categories_depense_select on public.categories_depense for select to authenticated
  using (organisation_id is null or membre_organisation(organisation_id));

-- Macro : même politique de lecture pour toutes les tables V2/V3 par terrasse
do $$
declare
  t text;
begin
  foreach t in array array[
    'bons_commande','consignes','mouvements_consigne',
    'ardoises','depenses','inventaires',
    'fidelite_comptes','promotions','taux_change',
    'avances_serveuse','commissions'
  ] loop
    execute format(
      'create policy %I on public.%I for select to authenticated
         using (a_role(terrasse_id, array[''SERVEUSE'',''GERANT'',''RESPONSABLE'']::public.role_type[])
                or est_proprietaire_terrasse(terrasse_id))',
      t || '_select', t);
  end loop;
  -- Tables filles : lecture via le parent
  execute 'create policy bons_commande_lignes_select on public.bons_commande_lignes for select to authenticated
    using (exists (select 1 from bons_commande b where b.id = bon_commande_id
                   and (a_role(b.terrasse_id, array[''SERVEUSE'',''GERANT'',''RESPONSABLE'']::public.role_type[])
                        or est_proprietaire_terrasse(b.terrasse_id))))';
  execute 'create policy receptions_select on public.receptions for select to authenticated
    using (a_role(terrasse_id, array[''SERVEUSE'',''GERANT'',''RESPONSABLE'']::public.role_type[])
           or est_proprietaire_terrasse(terrasse_id))';
  execute 'create policy ardoise_operations_select on public.ardoise_operations for select to authenticated
    using (exists (select 1 from ardoises a where a.id = ardoise_id
                   and (a_role(a.terrasse_id, array[''GERANT'',''RESPONSABLE'']::public.role_type[])
                        or est_proprietaire_terrasse(a.terrasse_id))))';
  execute 'create policy inventaire_lignes_select on public.inventaire_lignes for select to authenticated
    using (exists (select 1 from inventaires i where i.id = inventaire_id
                   and (a_role(i.terrasse_id, array[''GERANT'',''RESPONSABLE'']::public.role_type[])
                        or est_proprietaire_terrasse(i.terrasse_id))))';
  execute 'create policy fidelite_mouvements_select on public.fidelite_mouvements for select to authenticated
    using (exists (select 1 from fidelite_comptes f where f.id = compte_id
                   and (a_role(f.terrasse_id, array[''GERANT'',''RESPONSABLE'']::public.role_type[])
                        or est_proprietaire_terrasse(f.terrasse_id))))';
end $$;

-- ----- Durcissements complémentaires -----
-- Historiques : même avec un token volé, UPDATE/DELETE refusés (RLS + triggers).
revoke update, delete on public.mouvements_stock from anon, authenticated;
revoke update, delete on public.historique_prix from anon, authenticated;
revoke update, delete on public.audit_log      from anon, authenticated;

-- Fonctions internes : jamais exposées en RPC
revoke execute on function public.notifier_roles(uuid, public.role_type[], text, text, text, jsonb, boolean) from anon, authenticated;
revoke execute on function public.notifier_client(uuid, uuid, text, text, text, jsonb) from anon, authenticated;
revoke execute on function public.cron_abonnements() from anon, authenticated;
revoke execute on function public.genere_code_invitation() from anon, authenticated;

-- ---------------------------------------------------------------------------
-- 15. VUES DE RAPPORTS (security_invoker : le lecteur garde SES droits RLS)
-- ---------------------------------------------------------------------------

create or replace view public.v_ventes_journalieres
with (security_invoker = true) as
  select terrasse_id,
         servie_le::date                      as jour,
         count(*)                             as nb_commandes,
         sum(montant_total_cdf)               as total_cdf
    from commandes
   where statut = 'SERVIE'
   group by terrasse_id, servie_le::date;

create or replace view public.v_ventes_hebdomadaires
with (security_invoker = true) as
  select terrasse_id,
         date_trunc('week', servie_le)::date  as semaine,
         count(*)                             as nb_commandes,
         sum(montant_total_cdf)               as total_cdf
    from commandes
   where statut = 'SERVIE'
   group by terrasse_id, date_trunc('week', servie_le)::date;

create or replace view public.v_performance_serveuses
with (security_invoker = true) as
  select c.terrasse_id,
         c.serveuse_id,
         u.nom                                as serveuse,
         c.servie_le::date                    as jour,
         count(*)                             as commandes_servies,
         sum(c.montant_total_cdf)             as total_cdf,
         (select round(avg(a.note)::numeric, 2)
            from avis_serveuse a where a.serveuse_id = c.serveuse_id) as note_moyenne
    from commandes c join utilisateurs u on u.id = c.serveuse_id
   where c.statut = 'SERVIE'
   group by c.terrasse_id, c.serveuse_id, u.nom, c.servie_le::date;

create or replace view public.v_depots_controle
with (security_invoker = true) as
  select d.id, d.terrasse_id, u.nom as serveuse, d.montant_attendu_cdf,
         d.montant_depose_cdf, d.ecart_cdf, d.motif_ecart, d.statut,
         d.declare_le, v.nom as valide_par, d.valide_le
    from depots d
    join utilisateurs u  on u.id = d.serveuse_id
    left join utilisateurs v on v.id = d.valide_par;

create or replace view public.v_stock_etat
with (security_invoker = true) as
  select id, terrasse_id, nom, categorie, prix_cdf, stock, stock_reserve,
         stock_disponible, seuil_alerte,
         (stock <= seuil_alerte) as alerte_active,
         actif
    from produits
   where supprime_le is null;

-- MRR par organisation : équivalent mensuel en centimes USD, remise appliquée.
create or replace view public.v_mrr
with (security_invoker = true) as
  select ab.organisation_id,
         sum(round(
               p.prix_usd_centimes
               * case when ab.annuel then p.mois_factures_annuel / 12.0 else 1 end
               * (1 - coalesce((
                   select max(r.valeur) from remises r
                    where r.actif and r.type = 'POURCENTAGE'
                      and (select count(*) from terrasses t
                           where t.organisation_id = ab.organisation_id and t.supprime_le is null)
                        >= r.condition_min_terrasses
                 ), 0) / 100.0)
             ))::bigint as mrr_usd_centimes,
         count(*) filter (where ab.statut = 'ACTIF')    as terrasses_actives,
         count(*) filter (where ab.statut = 'ESSAI')    as terrasses_essai
    from abonnements ab join plans p on p.id = ab.plan_id
   where ab.statut in ('ACTIF', 'EN_GRACE')
   group by ab.organisation_id;

create or replace view public.v_impayes
with (security_invoker = true) as
  select ab.terrasse_id, ab.organisation_id, t.nom as terrasse, ab.statut,
         ab.periode_fin, ab.grace_fin,
         greatest(0, current_date - coalesce(ab.grace_fin, ab.periode_fin)) as jours_retard
    from abonnements ab join terrasses t on t.id = ab.terrasse_id
   where ab.statut in ('EN_GRACE', 'LECTURE_SEULE', 'SUSPENDU');

-- ---------------------------------------------------------------------------
-- 16. REALTIME + CRON
-- ---------------------------------------------------------------------------

-- Canaux temps réel (commandes, notifications, alertes, stock, dépôts, demandes)
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    execute 'alter publication supabase_realtime add table public.commandes';
    execute 'alter publication supabase_realtime add table public.notifications';
    execute 'alter publication supabase_realtime add table public.alertes';
    execute 'alter publication supabase_realtime add table public.produits';
    execute 'alter publication supabase_realtime add table public.depots';
    execute 'alter publication supabase_realtime add table public.demandes_stock';
    execute 'alter publication supabase_realtime add table public.sessions_service';
  end if;
exception when duplicate_object then
  null;  -- déjà ajouté
end $$;

-- CRON quotidien (idempotent) — à activer UNE FOIS en production :
--   create extension if not exists pg_cron;
--   select cron.schedule('nganda-abonnements-quotidien', '15 4 * * *',
--                        $$ select public.cron_abonnements(); $$);
-- (04h15 UTC ≈ 06h15 à Lubumbashi, avant l'ouverture)

-- ============================================================================
-- FIN DU SCHÉMA PHASE 1 — exécutez ensuite 02_seed.sql puis 03_tests.sql
-- ============================================================================
