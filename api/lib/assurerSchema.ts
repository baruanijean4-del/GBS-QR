// ============================================================
// GBS — Garde de schéma au démarrage (publication)
// ------------------------------------------------------------
// Constat : la plateforme de publication démarre dist/boot.js sur
// une base EXISTANTE — or l'entrypoint Docker ne migre que les
// bases vides. Toute migration postérieure au dernier déploiement
// manque alors en production : erreurs SQL « colonne manquante »
// au premier snapshot → « Échec de la publication ».
//
// Ce module suit le pattern établi d'assurerTableErreursClient :
// routine IDEMPOTENTE (IF NOT EXISTS partout), mémoïsée, appelée
// au démarrage AVANT d'accepter le trafic (voir api/boot.ts).
// Elle ne fait RIEN sur une base vide (cas couvert par
// drizzle-kit migrate dans l'entrypoint) et réaligne le journal
// drizzle pour que `npm run db:migrate` reste cohérent ensuite.
//
// Couvre : 0006 (organisations.langue), 0007 (produits adaptatifs +
// categories_produit), 0008 (modules_etablissement), 0009
// (terrasses.types_secondaires), 0010 (RBAC : rôles élargis,
// audit enrichi, permissions_surcharge), 0011 (billard Vincaire), 0012 (alertes.type varchar(30)),
// 0013 (tokens.client_session_id nullable), 0014 (hôtel : chambres
// et séjours), 0015 (Airtel Money manuel : tokens.reference_mobile unique),
// 0016 (taux USD/FC : taux_change renommée taux_usd_cdf NULLABLE,
// seuils d'alerte, taux figé sur commandes/tokens/sejours).
// 0005 (erreurs_client)
// est déjà couverte par assurerTableErreursClient.
// TOUTE migration future doit ajouter ses artefacts ici, sinon la
// publication sur base existante cassera de nouveau.
// ============================================================

import { sql } from "drizzle-orm";
import { getDb } from "../queries/connection";
import { env } from "./env";

/** Artefacts marquants des migrations 0006→0016 (tables et colonnes).
 *  En production, la garde ne fait QUE vérifier leur présence —
 *  l'application des migrations y est DÉSACTIVÉE (décision pilote :
 *  une migration s'applique explicitement, jamais en silence au
 *  démarrage). En dev/test, la garde applique comme avant. */
export const ARTEFACTS_REQUIS: readonly { type: "table" | "colonne"; nom: string }[] = [
  { type: "colonne", nom: "organisations.langue" }, // 0006
  { type: "table", nom: "categories_produit" }, // 0007
  { type: "table", nom: "modules_etablissement" }, // 0008
  { type: "colonne", nom: "terrasses.types_secondaires" }, // 0009
  { type: "table", nom: "permissions_surcharge" }, // 0010
  { type: "table", nom: "config_billard" }, // 0011
  { type: "colonne", nom: "tokens.client_session_id" }, // 0013
  { type: "table", nom: "chambres" }, // 0014
  { type: "colonne", nom: "tokens.reference_mobile" }, // 0015
  { type: "colonne", nom: "terrasses.taux_usd_cdf" }, // 0016
  { type: "colonne", nom: "commandes.taux_usd_cdf" }, // 0016
  { type: "colonne", nom: "tokens.taux_usd_cdf" }, // 0016
  { type: "colonne", nom: "sejours.taux_usd_cdf" }, // 0016
  { type: "table", nom: "sessions_appareils" }, // 0017
  { type: "table", nom: "clients" }, // 0018
  { type: "table", nom: "notes" }, // 0018
  { type: "table", nom: "note_lignes" }, // 0018
  { type: "table", nom: "encaissements" }, // 0018
  { type: "table", nom: "note_ventilations" }, // 0018
  { type: "table", nom: "remises_caisse" }, // 0018
  { type: "table", nom: "pourboires" }, // 0018
  { type: "table", nom: "prises_en_charge" }, // 0018
  { type: "colonne", nom: "terrasses.note_plafond_cdf" }, // 0018
  { type: "colonne", nom: "terrasses.token_sur_note" }, // 0018
  { type: "colonne", nom: "tokens.sur_note" }, // 0018
  { type: "table", nom: "traiteur_composants" }, // 0019
  { type: "table", nom: "traiteur_recettes" }, // 0019
  { type: "table", nom: "traiteur_recette_lignes" }, // 0019
  { type: "table", nom: "traiteur_menus" }, // 0019
  { type: "table", nom: "traiteur_menu_lignes" }, // 0019
  { type: "table", nom: "traiteur_plans" }, // 0019
  { type: "table", nom: "traiteur_plan_exclusions" }, // 0019
  { type: "table", nom: "traiteur_bons_sortie" }, // 0019
  { type: "table", nom: "traiteur_bon_lignes" }, // 0019
  { type: "table", nom: "traiteur_comptages" }, // 0019
  { type: "colonne", nom: "produits.cout_achat_usd" }, // 0019
];

/** Pur : artefacts requis absents d'un ensemble de noms présents. */
export function artefactsManquants(presents: ReadonlySet<string>): string[] {
  return ARTEFACTS_REQUIS.filter((a) => !presents.has(a.nom)).map((a) => a.nom);
}

// Journal des migrations 0000→0016 : (hash SHA-256 du fichier SQL,
// horodatage du journal drizzle). Permet de marquer « déjà appliquée »
// toute migration dont les artefacts sont présents, sans la rejouer.
const JOURNAL: readonly { hash: string; when: number }[] = [
  { hash: "8deed8755e1d554c3b09409e588a0abf864268ca267957fb6bfacd9c46e8f17f", when: 1791543811061 },
  { hash: "d7f67350f80169e8f9a45c86a9882c7bb6be4a1312ff7780beac5bff095c816a", when: 1791624906316 },
  { hash: "bf97847a0c8c52754d8297b7aff67a4eddc57bd309cd117d363ee0cf4b8a3a76", when: 1791627374693 },
  { hash: "bf5c2ef0a65ee242e901ae60f6ee2c28c6c512d51282ebd1213cb01a802abad6", when: 1791631296005 },
  { hash: "b8ea9d0e4c5cac09fdbabdb64521e13460897b14dcd00e339dabebfca751c0c6", when: 1791639848459 },
  { hash: "88c5bd64e751d30932cfd1df684e33c649203182e5b13e917b078b3969263a88", when: 1791671437508 },
  { hash: "3bf9d5087a5f5e8b731912cb7521ecad1d3024770a6903d1e3a3cc6efde294bf", when: 1791703786746 },
  { hash: "81aa2f4ef1e6dcafa04af14d03688f37be52ca2e309379314986cd7130449ae8", when: 1792053262775 },
  { hash: "17f42805f4b803b1950568b3051b7412ed69310f0b34d6ca585e2b7ab935bff0", when: 1792060000000 },
  { hash: "8f28079ade559d6d6cb05b5485657ac31ef8ec7cafe3037041d48c390e462cbc", when: 1792060000001 },
  { hash: "b0f19ff54800d8ccb2d657de8d525a948234a183ca4ca60dad2123161313c388", when: 1792060000002 },
  { hash: "ba910f99f827c0c4dbe872ab932d89def3a917b4a100321b7c081a8cb4e28639", when: 1792060000003 },
  { hash: "e79fe5c9c9ec26b84426f3354123f9883dde8c299dc55fa7aad0df6100e12b2c", when: 1792060000004 },
  { hash: "ed10e2fbb0108839c25d1d79aff75989c5cc998a9ca0a81babb54ae7bd0f4951", when: 1792075075408 },
  { hash: "67b00dbae6b349b2889bbd6e8ed7af9201d30b1016ce9aeb6cb159c66acde498", when: 1792392061366 },
  { hash: "694a683eb4687db966c4bfe98d27609b1b64d8bc22dd6e21ddb99359126ddc8f", when: 1792565000000 },
  { hash: "c03d2f2fd0a96979e4b17f9135b04c18781e82ed8e2b15d28f4d2214a5b8a997", when: 1792405634498 },
  { hash: "ca61cd5efed10abc7def3a93e48652097a98de68adb678af6d4008ad96faad5f", when: 1792445318121 },
  { hash: "5fff4d9a84985cec5c609cc6d617b1c0a45e193c5c72c8ca19aa1d818dd1fdc2", when: 1792570737821 },
  { hash: "d9293eee4ecbededee0b3032c285670fed1c95d569a66a478465a816c1c63485", when: 1792572943367 },
];

let schemaPret: Promise<void> | null = null;

/** Applique les artefacts des migrations récentes si absents
 *  (idempotent, mémoïsé). No-op strict sur une base vide. */
export function assurerSchema(): Promise<void> {
  if (!schemaPret) {
    schemaPret = (async () => {
      const db = getDb();

      // Base vide → on sort : l'entrypoint (drizzle-kit migrate)
      // crée tout le schéma, y compris ces artefacts.
      const base = await db.execute(sql`
        SELECT COUNT(*)::int AS n FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'organisations'
      `);
      if (Number(base[0]?.n ?? 0) === 0) return;

      // PRODUCTION : vérification SEULE — aucune écriture de schéma.
      // Une migration manquante refuse le démarrage avec la liste des
      // artefacts absents (application explicite : npm run db:migrate).
      if (env.isProduction) {
        const tables = await db.execute(sql`
          SELECT table_name AS nom FROM information_schema.tables
          WHERE table_schema = 'public'
        `);
        const colonnes = await db.execute(sql`
          SELECT table_name || '.' || column_name AS nom
          FROM information_schema.columns WHERE table_schema = 'public'
        `);
        const presents = new Set<string>([
          ...tables.map((r) => String((r as { nom: string }).nom)),
          ...colonnes.map((r) => String((r as { nom: string }).nom)),
        ]);
        const manquants = artefactsManquants(presents);
        if (manquants.length > 0) {
          throw new Error(
            `[boot] Migrations manquantes en production : ${manquants.join(", ")}. ` +
            `Application automatique DÉSACTIVÉE — appliquer explicitement : npm run db:migrate`,
          );
        }
        console.log("[boot] schéma vérifié (production : lecture seule, 0006-0019 présents).");
        return;
      }

      // --- Migration 0006 : langue de l'organisation (FR/EN/PT) --
      await db.execute(sql`
        ALTER TABLE organisations
        ADD COLUMN IF NOT EXISTS langue varchar(2) DEFAULT 'fr' NOT NULL
      `);

      // --- Migration 0007 : produits adaptatifs -----------------
      await db.execute(sql`
        CREATE TABLE IF NOT EXISTS categories_produit (
          id varchar(40) PRIMARY KEY NOT NULL,
          code varchar(30) NOT NULL,
          type_etablissement varchar(20) NOT NULL,
          nom_fr varchar(60) NOT NULL,
          nom_en varchar(60) NOT NULL,
          nom_pt varchar(60) NOT NULL,
          icone varchar(40) NOT NULL,
          ordre_affichage integer DEFAULT 0 NOT NULL,
          actif boolean DEFAULT true NOT NULL,
          CONSTRAINT uq_catprod_code_type UNIQUE (code, type_etablissement)
        )
      `);
      await db.execute(sql`ALTER TABLE produits ADD COLUMN IF NOT EXISTS type_produit varchar(12)`);
      await db.execute(sql`ALTER TABLE produits ADD COLUMN IF NOT EXISTS unite varchar(20)`);
      await db.execute(sql`ALTER TABLE produits ADD COLUMN IF NOT EXISTS duree_minutes integer`);
      await db.execute(sql`ALTER TABLE produits ADD COLUMN IF NOT EXISTS capacite integer`);
      await db.execute(sql`ALTER TABLE produits ADD COLUMN IF NOT EXISTS lot varchar(60)`);
      await db.execute(sql`ALTER TABLE produits ADD COLUMN IF NOT EXISTS date_peremption varchar(10)`);
      await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_catprod_type ON categories_produit (type_etablissement)`);

      // --- Migration 0008 : feature flags par établissement ------
      await db.execute(sql`
        CREATE TABLE IF NOT EXISTS modules_etablissement (
          id varchar(40) PRIMARY KEY NOT NULL,
          terrasse_id varchar(40) NOT NULL,
          module varchar(20) NOT NULL,
          actif boolean DEFAULT true NOT NULL,
          modifie_par varchar(40),
          modifie_le varchar(30) NOT NULL,
          CONSTRAINT uq_modetab_terrasse_module UNIQUE (terrasse_id, module)
        )
      `);
      await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_modetab_terrasse ON modules_etablissement (terrasse_id)`);

      // --- Migration 0009 : établissements multi-métiers ---------
      await db.execute(sql`
        ALTER TABLE terrasses
        ADD COLUMN IF NOT EXISTS types_secondaires jsonb DEFAULT '[]'::jsonb NOT NULL
      `);

      // --- Migration 0010 : RBAC (annexe §7, étape 2) ------------
      // Colonnes rôle élargies (RECEPTIONNISTE = 14 caractères),
      // audit enrichi (établissement, avant/après), surcharges.
      await db.execute(sql`ALTER TABLE affectations ALTER COLUMN role TYPE varchar(16)`);
      await db.execute(sql`ALTER TABLE invitations ALTER COLUMN role TYPE varchar(16)`);
      await db.execute(sql`ALTER TABLE audit_log ALTER COLUMN role_actif TYPE varchar(16)`);
      await db.execute(sql`ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS terrasse_id varchar(40)`);
      await db.execute(sql`ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS avant text`);
      await db.execute(sql`ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS apres text`);
      await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_audit_terrasse_date ON audit_log (terrasse_id, cree_le)`);
      await db.execute(sql`
        CREATE TABLE IF NOT EXISTS permissions_surcharge (
          id varchar(40) PRIMARY KEY,
          terrasse_id varchar(40) NOT NULL,
          utilisateur_id varchar(40) NOT NULL,
          action varchar(40) NOT NULL,
          autorisee boolean NOT NULL,
          cree_par varchar(40) NOT NULL,
          cree_le varchar(30) NOT NULL,
          modifie_le varchar(30) NOT NULL,
          CONSTRAINT uq_permsurch UNIQUE (terrasse_id, utilisateur_id, action)
        )
      `);
      await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_permsurch_ter ON permissions_surcharge (terrasse_id)`);

      // --- Migration 0011 : billard Vincaire (annexe §1, étape 3) --
      // Les tables « tokens » et « parties » pré-existent (prototype) :
      // corps IDEMPOTENT = CREATE IF NOT EXISTS + ALTER IF NOT EXISTS,
      // identique au fichier db/migrations/0011_billard-vincaire.sql.
      await db.execute(sql`ALTER TABLE tables_qr ADD COLUMN IF NOT EXISTS kind varchar(12) DEFAULT 'ZONE' NOT NULL`);
      await db.execute(sql`
        CREATE TABLE IF NOT EXISTS config_billard (
          id varchar(40) PRIMARY KEY,
          terrasse_id varchar(40) NOT NULL,
          prix_token_cdf integer DEFAULT 5000 NOT NULL,
          regle_perdant varchar(10) DEFAULT 'RACHAT' NOT NULL,
          max_parties_vincaire integer,
          delai_presence_min integer DEFAULT 3 NOT NULL,
          modifie_par varchar(40),
          modifie_le varchar(30) NOT NULL
        )
      `);
      await db.execute(sql`CREATE UNIQUE INDEX IF NOT EXISTS config_billard_terrasse_id_unique ON config_billard (terrasse_id)`);
      await db.execute(sql`
        CREATE TABLE IF NOT EXISTS tokens (
          id varchar(40) PRIMARY KEY,
          terrasse_id varchar(40) NOT NULL,
          table_id varchar(40) NOT NULL,
          numero integer NOT NULL,
          client_session_id varchar(40),
          prenom varchar(60) NOT NULL,
          prix_cdf integer NOT NULL,
          statut varchar(20) DEFAULT 'ATTENTE_PAIEMENT' NOT NULL,
          serie integer DEFAULT 0 NOT NULL,
          cree_le varchar(30) NOT NULL,
          paye_le varchar(30),
          paye_par varchar(40),
          entree_file_le varchar(30),
          appele_le varchar(30),
          annule_le varchar(30),
          annule_par varchar(40)
        )
      `);
      await db.execute(sql`ALTER TABLE tokens ADD COLUMN IF NOT EXISTS serie integer DEFAULT 0 NOT NULL`);
      await db.execute(sql`ALTER TABLE tokens ADD COLUMN IF NOT EXISTS paye_le varchar(30)`);
      await db.execute(sql`ALTER TABLE tokens ADD COLUMN IF NOT EXISTS paye_par varchar(40)`);
      await db.execute(sql`ALTER TABLE tokens ADD COLUMN IF NOT EXISTS entree_file_le varchar(30)`);
      await db.execute(sql`ALTER TABLE tokens ADD COLUMN IF NOT EXISTS annule_le varchar(30)`);
      await db.execute(sql`ALTER TABLE tokens ADD COLUMN IF NOT EXISTS annule_par varchar(40)`);
      await db.execute(sql`ALTER TABLE tokens ALTER COLUMN statut TYPE varchar(20)`);
      await db.execute(sql`UPDATE tokens SET statut = 'ATTENTE_PAIEMENT' WHERE statut = 'EN_ATTENTE'`);
      await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_tokens_file ON tokens (table_id, statut, entree_file_le)`);
      await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_tokens_terrasse_date ON tokens (terrasse_id, cree_le)`);
      await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_tokens_client ON tokens (client_session_id)`);
      await db.execute(sql`
        CREATE TABLE IF NOT EXISTS parties (
          id varchar(40) PRIMARY KEY,
          terrasse_id varchar(40) NOT NULL,
          table_id varchar(40) NOT NULL,
          numero integer DEFAULT 0 NOT NULL,
          vincaire_token_id varchar(40),
          challenger_token_id varchar(40) NOT NULL,
          gagnant_token_id varchar(40),
          statut varchar(20) DEFAULT 'EN_COURS' NOT NULL,
          debut_le varchar(30) NOT NULL,
          fin_le varchar(30),
          termine_par varchar(40)
        )
      `);
      await db.execute(sql`ALTER TABLE parties ADD COLUMN IF NOT EXISTS numero integer DEFAULT 0 NOT NULL`);
      await db.execute(sql`ALTER TABLE parties ADD COLUMN IF NOT EXISTS termine_par varchar(40)`);
      await db.execute(sql`ALTER TABLE parties ALTER COLUMN statut TYPE varchar(20)`);
      await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_parties_table ON parties (table_id)`);
      await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_parties_terrasse_date ON parties (terrasse_id, debut_le)`);

      // --- Migration 0012 : alertes.type élargi (BILLARD_*) ---------
      await db.execute(sql`ALTER TABLE alertes ALTER COLUMN type TYPE varchar(30)`);

      // --- Migration 0013 : tokens.client_session_id nullable ----
      // (joueurs ajoutés au comptoir par le staff, sans session client ;
      // la table « tokens » pré-existait avec NOT NULL)
      await db.execute(sql`ALTER TABLE tokens ALTER COLUMN client_session_id DROP NOT NULL`);

      // --- Migration 0014 : hôtel — chambres et séjours (§4) ------
      await db.execute(sql`
        CREATE TABLE IF NOT EXISTS chambres (
          id varchar(40) PRIMARY KEY NOT NULL,
          terrasse_id varchar(40) NOT NULL,
          numero varchar(10) NOT NULL,
          type varchar(20) DEFAULT 'SIMPLE' NOT NULL,
          statut varchar(12) DEFAULT 'LIBRE' NOT NULL,
          prix_nuit_cdf integer NOT NULL,
          prix_heure_cdf integer,
          cree_le varchar(30) NOT NULL
        )
      `);
      await db.execute(sql`
        CREATE TABLE IF NOT EXISTS sejours (
          id varchar(40) PRIMARY KEY NOT NULL,
          chambre_id varchar(40) NOT NULL,
          terrasse_id varchar(40) NOT NULL,
          client_nom varchar(120) NOT NULL,
          piece_identite varchar(60),
          mode varchar(6) NOT NULL,
          arrivee_le varchar(30) NOT NULL,
          depart_le varchar(30),
          montant_total_cdf integer,
          statut varchar(10) DEFAULT 'EN_COURS' NOT NULL,
          cree_par varchar(40) NOT NULL,
          cree_le varchar(30) NOT NULL
        )
      `);
      await db.execute(sql`CREATE UNIQUE INDEX IF NOT EXISTS uq_chambres_terrasse_numero ON chambres (terrasse_id, numero)`);
      await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_chambres_terrasse_statut ON chambres (terrasse_id, statut)`);
      await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_sejours_chambre ON sejours (chambre_id, statut)`);
      await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_sejours_terrasse_date ON sejours (terrasse_id, cree_le)`);

      // --- Migration 0015 : Airtel Money manuel — référence unique --
      await db.execute(sql`ALTER TABLE tokens ADD COLUMN IF NOT EXISTS reference_mobile varchar(30)`);
      await db.execute(sql`
        CREATE UNIQUE INDEX IF NOT EXISTS uq_tokens_reference_mobile
        ON tokens (terrasse_id, reference_mobile) WHERE reference_mobile IS NOT NULL
      `);

      // --- Migration 0016 : taux USD/FC par établissement ---------
      // Rename idempotent (l'ancienne colonne taux_change NOT NULL
      // devient taux_usd_cdf NULLABLE — valeurs conservées), seuils
      // d'alerte par établissement, taux figé sur chaque vente.
      await db.execute(sql`
        DO $$ BEGIN
          IF EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_name = 'terrasses' AND column_name = 'taux_change'
          ) THEN
            ALTER TABLE terrasses RENAME COLUMN taux_change TO taux_usd_cdf;
          END IF;
        END $$
      `);
      await db.execute(sql`ALTER TABLE terrasses ALTER COLUMN taux_usd_cdf DROP NOT NULL`);
      await db.execute(sql`ALTER TABLE terrasses ALTER COLUMN taux_usd_cdf DROP DEFAULT`);
      await db.execute(sql`ALTER TABLE terrasses ADD COLUMN IF NOT EXISTS taux_alerte_variation_pct integer NOT NULL DEFAULT 5`);
      await db.execute(sql`ALTER TABLE terrasses ADD COLUMN IF NOT EXISTS taux_alerte_max_par_jour integer NOT NULL DEFAULT 3`);
      await db.execute(sql`ALTER TABLE terrasses ADD COLUMN IF NOT EXISTS taux_plafond_cdf integer NOT NULL DEFAULT 10000`);
      await db.execute(sql`ALTER TABLE commandes ADD COLUMN IF NOT EXISTS taux_usd_cdf integer`);
      await db.execute(sql`ALTER TABLE tokens ADD COLUMN IF NOT EXISTS taux_usd_cdf integer`);
      await db.execute(sql`ALTER TABLE sejours ADD COLUMN IF NOT EXISTS taux_usd_cdf integer`);

      // --- Migration 0018 : note unique (ANNEXE-2) + prise en charge
      // (ANNEXE-3). Corps identique au fichier
      // db/migrations/0018_note-unique.sql : aucune table « espaces »,
      // la table « paiements » (abonnements) n'est PAS touchée.
      await db.execute(sql`ALTER TABLE terrasses ADD COLUMN IF NOT EXISTS note_plafond_cdf integer`);
      await db.execute(sql`ALTER TABLE terrasses ADD COLUMN IF NOT EXISTS token_sur_note boolean DEFAULT false NOT NULL`);
      await db.execute(sql`ALTER TABLE tokens ADD COLUMN IF NOT EXISTS sur_note boolean DEFAULT false NOT NULL`);
      await db.execute(sql`
        CREATE TABLE IF NOT EXISTS clients (
          id varchar(40) PRIMARY KEY,
          organisation_id varchar(40) NOT NULL,
          prenom varchar(60) NOT NULL,
          telephone varchar(20),
          cree_le varchar(30) NOT NULL
        )
      `);
      await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_clients_org ON clients (organisation_id)`);
      await db.execute(sql`CREATE UNIQUE INDEX IF NOT EXISTS uq_clients_org_tel ON clients (organisation_id, telephone) WHERE telephone IS NOT NULL`);
      await db.execute(sql`
        CREATE TABLE IF NOT EXISTS client_appareils (
          client_session_id varchar(40) PRIMARY KEY,
          client_id varchar(40) NOT NULL,
          cree_le varchar(30) NOT NULL
        )
      `);
      await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_appareils_client ON client_appareils (client_id)`);
      await db.execute(sql`
        CREATE TABLE IF NOT EXISTS notes (
          id varchar(40) PRIMARY KEY,
          organisation_id varchar(40) NOT NULL,
          client_id varchar(40) NOT NULL,
          sejour_id varchar(40),
          statut varchar(10) DEFAULT 'OUVERTE' NOT NULL,
          ouverte_le varchar(30) NOT NULL,
          reglee_le varchar(30),
          taux_usd_cdf integer,
          motif_litige varchar(200),
          litige_le varchar(30),
          litige_declare_par varchar(40)
        )
      `);
      await db.execute(sql`CREATE UNIQUE INDEX IF NOT EXISTS uq_notes_client_ouverte ON notes (client_id) WHERE statut IN ('OUVERTE','A_REGLER')`);
      await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_notes_org_statut ON notes (organisation_id, statut)`);
      await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_notes_sejour ON notes (sejour_id)`);
      await db.execute(sql`
        CREATE TABLE IF NOT EXISTS note_lignes (
          id varchar(40) PRIMARY KEY,
          note_id varchar(40) NOT NULL,
          terrasse_id varchar(40) NOT NULL,
          espace varchar(20) NOT NULL,
          type varchar(15) NOT NULL,
          ref_id varchar(80),
          libelle varchar(200) NOT NULL,
          quantite integer DEFAULT 1 NOT NULL,
          montant_cdf integer DEFAULT 0 NOT NULL,
          montant_usd integer DEFAULT 0 NOT NULL,
          taux_usd_cdf integer,
          statut varchar(12) DEFAULT 'EN_ATTENTE' NOT NULL,
          cree_par_id varchar(40),
          cree_le varchar(30) NOT NULL,
          annule_le varchar(30),
          annule_par varchar(40),
          motif_annulation varchar(200),
          prise_en_charge_id varchar(40)
        )
      `);
      await db.execute(sql`CREATE UNIQUE INDEX IF NOT EXISTS uq_note_lignes_ref ON note_lignes (type, ref_id) WHERE ref_id IS NOT NULL`);
      await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_note_lignes_note ON note_lignes (note_id, statut)`);
      await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_note_lignes_terrasse_date ON note_lignes (terrasse_id, cree_le)`);
      await db.execute(sql`
        CREATE TABLE IF NOT EXISTS encaissements (
          id varchar(40) PRIMARY KEY,
          note_id varchar(40) NOT NULL,
          organisation_id varchar(40) NOT NULL,
          encaisse_par_id varchar(40) NOT NULL,
          montant_cdf integer DEFAULT 0 NOT NULL,
          montant_usd integer DEFAULT 0 NOT NULL,
          mode varchar(12) NOT NULL,
          reference_mobile varchar(30),
          statut varchar(10) DEFAULT 'EN_MAIN' NOT NULL,
          remise_id varchar(40),
          cree_le varchar(30) NOT NULL,
          remis_le varchar(30)
        )
      `);
      await db.execute(sql`CREATE UNIQUE INDEX IF NOT EXISTS uq_encaissements_reference ON encaissements (organisation_id, reference_mobile) WHERE reference_mobile IS NOT NULL`);
      await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_enc_note ON encaissements (note_id)`);
      await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_enc_employe_statut ON encaissements (encaisse_par_id, statut)`);
      await db.execute(sql`
        CREATE TABLE IF NOT EXISTS note_ventilations (
          id varchar(40) PRIMARY KEY,
          encaissement_id varchar(40) NOT NULL,
          terrasse_id varchar(40) NOT NULL,
          espace varchar(20) NOT NULL,
          montant_cdf integer DEFAULT 0 NOT NULL,
          montant_usd integer DEFAULT 0 NOT NULL,
          cree_le varchar(30) NOT NULL
        )
      `);
      await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_ventil_enc ON note_ventilations (encaissement_id)`);
      await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_ventil_terrasse_date ON note_ventilations (terrasse_id, cree_le)`);
      await db.execute(sql`
        CREATE TABLE IF NOT EXISTS remises_caisse (
          id varchar(40) PRIMARY KEY,
          organisation_id varchar(40) NOT NULL,
          employe_id varchar(40) NOT NULL,
          attendu_cdf integer DEFAULT 0 NOT NULL,
          attendu_usd integer DEFAULT 0 NOT NULL,
          recu_cdf integer DEFAULT 0 NOT NULL,
          recu_usd integer DEFAULT 0 NOT NULL,
          statut varchar(12) DEFAULT 'EN_ATTENTE' NOT NULL,
          valide_par varchar(40),
          motif_ecart varchar(200),
          cree_le varchar(30) NOT NULL,
          valide_le varchar(30)
        )
      `);
      await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_remises_org ON remises_caisse (organisation_id, statut)`);
      await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_remises_employe ON remises_caisse (employe_id, cree_le)`);
      await db.execute(sql`
        CREATE TABLE IF NOT EXISTS pourboires (
          id varchar(40) PRIMARY KEY,
          note_id varchar(40) NOT NULL,
          encaissement_id varchar(40) NOT NULL,
          employe_id varchar(40) NOT NULL,
          montant_cdf integer DEFAULT 0 NOT NULL,
          montant_usd integer DEFAULT 0 NOT NULL,
          cree_le varchar(30) NOT NULL
        )
      `);
      await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_pourboires_employe ON pourboires (employe_id, cree_le)`);
      await db.execute(sql`
        CREATE TABLE IF NOT EXISTS prises_en_charge (
          id varchar(40) PRIMARY KEY,
          organisation_id varchar(40) NOT NULL,
          terrasse_id varchar(40) NOT NULL,
          note_beneficiaire_id varchar(40) NOT NULL,
          payeur_client_id varchar(40),
          propose_par varchar(40) NOT NULL,
          lignes jsonb NOT NULL,
          montant_cdf integer DEFAULT 0 NOT NULL,
          montant_usd integer DEFAULT 0 NOT NULL,
          statut varchar(12) DEFAULT 'EN_ATTENTE' NOT NULL,
          decide_par varchar(40),
          decide_le varchar(30),
          expire_le varchar(30) NOT NULL,
          cree_le varchar(30) NOT NULL
        )
      `);
      await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_pec_terrasse_statut ON prises_en_charge (terrasse_id, statut)`);
      await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_pec_note ON prises_en_charge (note_beneficiaire_id)`);

      // --- Migration 0019 : module traiteur (docs/MODULE-TRAITEUR.md §8).
      // Corps identique à db/migrations/0019_traiteur.sql : quantités en
      // unité de base entière, composition figée, bons SANS prix, coûts
      // visibles du propriétaire seul (contrôle applicatif).
      await db.execute(sql`ALTER TABLE produits ADD COLUMN IF NOT EXISTS cout_achat_usd integer`);
      await db.execute(sql`
        CREATE TABLE IF NOT EXISTS traiteur_composants (
          id varchar(40) PRIMARY KEY,
          terrasse_id varchar(40) NOT NULL,
          nom varchar(120) NOT NULL,
          kind varchar(20) NOT NULL,
          actif boolean DEFAULT true NOT NULL,
          cree_le varchar(30) NOT NULL
        )
      `);
      await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_composants_terrasse ON traiteur_composants (terrasse_id, actif)`);
      await db.execute(sql`
        CREATE TABLE IF NOT EXISTS traiteur_recettes (
          id varchar(40) PRIMARY KEY,
          composant_id varchar(40) NOT NULL,
          version integer DEFAULT 1 NOT NULL,
          statut varchar(20) DEFAULT 'PROPOSEE' NOT NULL,
          propose_par varchar(40) NOT NULL,
          valide_par varchar(40),
          validee_le varchar(30),
          cree_le varchar(30) NOT NULL
        )
      `);
      await db.execute(sql`CREATE UNIQUE INDEX IF NOT EXISTS uq_recette_composant_version ON traiteur_recettes (composant_id, version)`);
      await db.execute(sql`
        CREATE TABLE IF NOT EXISTS traiteur_recette_lignes (
          id varchar(40) PRIMARY KEY,
          recette_id varchar(40) NOT NULL,
          produit_id varchar(40) NOT NULL,
          sous_recette_id varchar(40),
          quantite_par_personne_base bigint NOT NULL,
          taux_perte_pct integer DEFAULT 0 NOT NULL
        )
      `);
      await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_rec_lignes_recette ON traiteur_recette_lignes (recette_id)`);
      await db.execute(sql`
        CREATE TABLE IF NOT EXISTS traiteur_menus (
          id varchar(40) PRIMARY KEY,
          terrasse_id varchar(40) NOT NULL,
          nom varchar(120) NOT NULL,
          prix_personne_usd integer NOT NULL,
          version integer DEFAULT 1 NOT NULL,
          actif boolean DEFAULT true NOT NULL,
          cree_le varchar(30) NOT NULL
        )
      `);
      await db.execute(sql`
        CREATE TABLE IF NOT EXISTS traiteur_menu_lignes (
          id varchar(40) PRIMARY KEY,
          menu_id varchar(40) NOT NULL,
          composant_id varchar(40) NOT NULL,
          qte_par_personne_x1000 integer DEFAULT 1000 NOT NULL,
          position integer DEFAULT 0 NOT NULL
        )
      `);
      await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_menu_lignes_menu ON traiteur_menu_lignes (menu_id)`);
      await db.execute(sql`
        CREATE TABLE IF NOT EXISTS traiteur_plans (
          id varchar(40) PRIMARY KEY,
          terrasse_id varchar(40) NOT NULL,
          menu_id varchar(40) NOT NULL,
          menu_version integer NOT NULL,
          entreprise varchar(200) NOT NULL,
          nb_personnes integer NOT NULL,
          jour varchar(10) NOT NULL,
          heure varchar(5) NOT NULL,
          repartition_options jsonb,
          composition jsonb NOT NULL,
          statut varchar(20) DEFAULT 'BROUILLON' NOT NULL,
          cree_par varchar(40) NOT NULL,
          cree_le varchar(30) NOT NULL
        )
      `);
      await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_plans_terrasse ON traiteur_plans (terrasse_id, jour)`);
      await db.execute(sql`
        CREATE TABLE IF NOT EXISTS traiteur_plan_exclusions (
          id varchar(40) PRIMARY KEY,
          plan_id varchar(40) NOT NULL,
          composant_id varchar(40) NOT NULL,
          motif varchar(200)
        )
      `);
      await db.execute(sql`CREATE UNIQUE INDEX IF NOT EXISTS uq_plan_exclusion ON traiteur_plan_exclusions (plan_id, composant_id)`);
      await db.execute(sql`
        CREATE TABLE IF NOT EXISTS traiteur_bons_sortie (
          id varchar(40) PRIMARY KEY,
          terrasse_id varchar(40) NOT NULL,
          plan_id varchar(40) NOT NULL,
          statut varchar(20) DEFAULT 'BROUILLON' NOT NULL,
          magasinier_id varchar(40) NOT NULL,
          emis_le varchar(30),
          cree_le varchar(30) NOT NULL
        )
      `);
      await db.execute(sql`CREATE UNIQUE INDEX IF NOT EXISTS uq_bon_plan ON traiteur_bons_sortie (plan_id)`);
      await db.execute(sql`
        CREATE TABLE IF NOT EXISTS traiteur_bon_lignes (
          id varchar(40) PRIMARY KEY,
          bon_id varchar(40) NOT NULL,
          produit_id varchar(40) NOT NULL,
          lot varchar(60),
          quantite_base bigint NOT NULL,
          details jsonb
        )
      `);
      await db.execute(sql`CREATE UNIQUE INDEX IF NOT EXISTS uq_bon_ligne ON traiteur_bon_lignes (bon_id, produit_id)`);
      await db.execute(sql`
        CREATE TABLE IF NOT EXISTS traiteur_comptages (
          id varchar(40) PRIMARY KEY,
          terrasse_id varchar(40) NOT NULL,
          produit_id varchar(40) NOT NULL,
          compte_par varchar(40) NOT NULL,
          quantite_comptee integer NOT NULL,
          theorique integer NOT NULL,
          ecart integer NOT NULL,
          cree_le varchar(30) NOT NULL
        )
      `);
      await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_comptages_terrasse ON traiteur_comptages (terrasse_id, cree_le)`);


      // --- Journal drizzle : marque les migrations présentes ----
      // (une base existante a forcément 0000-0004 ; 0005-0007 sont
      // assurées ici ou par assurerTableErreursClient).
      // WHERE NOT EXISTS = idempotent.
      await db.execute(sql`CREATE SCHEMA IF NOT EXISTS drizzle`);
      await db.execute(sql`
        CREATE TABLE IF NOT EXISTS drizzle.__drizzle_migrations (
          id serial PRIMARY KEY,
          hash text NOT NULL,
          created_at bigint
        )
      `);
      for (const m of JOURNAL) {
        await db.execute(sql`
          INSERT INTO drizzle.__drizzle_migrations (hash, created_at)
          SELECT ${m.hash}, ${m.when}
          WHERE NOT EXISTS (
            SELECT 1 FROM drizzle.__drizzle_migrations WHERE hash = ${m.hash}
          )
        `);
      }
      console.log("[boot] schéma vérifié (migrations 0006-0019 assurées).");
    })().catch((e) => {
      schemaPret = null; // prochain appel : nouvelle tentative
      throw e;
    });
  }
  return schemaPret;
}
