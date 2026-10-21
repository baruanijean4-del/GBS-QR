-- ============================================================
-- Migration 0018 : note client unique (ANNEXE-2) + « payer pour
-- quelqu'un » (ANNEXE-3).
--
-- - clients / client_appareils : identité reconnue sur tous les QR
--   de l'organisation (jamais de fusion sur le prénom seul).
-- - notes / note_lignes : folio unique par client ; chaque commande,
--   token de billard et nuitée y est rattachée.
-- - encaissements / remises_caisse / pourboires : suivi de l'argent
--   PHYSIQUE (qui détient le cash, remise validée par le receveur,
--   écart = alerte propriétaire ; pourboire hors CA).
-- - note_ventilations : ventilation COMPTABLE par espace (la table
--   « paiements » appartient à la facturation des abonnements et
--   n'est PAS touchée).
-- - prises_en_charge : voie serveuse, lignes figées à l'acceptation,
--   expiration 10 min, remontée au gérant, anti-abus.
-- - terrasses : + note_plafond_cdf (NULL = pas de plafond,
--   comportement historique inchangé) et + token_sur_note (défaut
--   false — exception désactivée tant que le gérant ne l'active pas).
-- - tokens : + sur_note (défaut false — rien ne change pour les
--   billards existants).
--
-- Règle permanente respectée : AUCUNE table « espaces » — l'espace
-- est une étiquette varchar sur chaque ligne de note.
-- REJOUABLE : IF NOT EXISTS / ADD COLUMN IF NOT EXISTS partout.
-- ============================================================

CREATE TABLE IF NOT EXISTS "clients" (
  "id" varchar(40) PRIMARY KEY,
  "organisation_id" varchar(40) NOT NULL,
  "prenom" varchar(60) NOT NULL,
  "telephone" varchar(20),
  "cree_le" varchar(30) NOT NULL
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_clients_org" ON "clients" ("organisation_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uq_clients_org_tel" ON "clients" ("organisation_id", "telephone") WHERE telephone IS NOT NULL;--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "client_appareils" (
  "client_session_id" varchar(40) PRIMARY KEY,
  "client_id" varchar(40) NOT NULL,
  "cree_le" varchar(30) NOT NULL
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_appareils_client" ON "client_appareils" ("client_id");--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "notes" (
  "id" varchar(40) PRIMARY KEY,
  "organisation_id" varchar(40) NOT NULL,
  "client_id" varchar(40) NOT NULL,
  "sejour_id" varchar(40),
  "statut" varchar(10) DEFAULT 'OUVERTE' NOT NULL,
  "ouverte_le" varchar(30) NOT NULL,
  "reglee_le" varchar(30),
  "taux_usd_cdf" integer,
  "motif_litige" varchar(200),
  "litige_le" varchar(30),
  "litige_declare_par" varchar(40)
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uq_notes_client_ouverte" ON "notes" ("client_id") WHERE statut IN ('OUVERTE','A_REGLER');--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_notes_org_statut" ON "notes" ("organisation_id", "statut");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_notes_sejour" ON "notes" ("sejour_id");--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "note_lignes" (
  "id" varchar(40) PRIMARY KEY,
  "note_id" varchar(40) NOT NULL,
  "terrasse_id" varchar(40) NOT NULL,
  "espace" varchar(20) NOT NULL,
  "type" varchar(15) NOT NULL,
  "ref_id" varchar(80),
  "libelle" varchar(200) NOT NULL,
  "quantite" integer DEFAULT 1 NOT NULL,
  "montant_cdf" integer DEFAULT 0 NOT NULL,
  "montant_usd" integer DEFAULT 0 NOT NULL,
  "taux_usd_cdf" integer,
  "statut" varchar(12) DEFAULT 'EN_ATTENTE' NOT NULL,
  "cree_par_id" varchar(40),
  "cree_le" varchar(30) NOT NULL,
  "annule_le" varchar(30),
  "annule_par" varchar(40),
  "motif_annulation" varchar(200),
  "prise_en_charge_id" varchar(40)
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uq_note_lignes_ref" ON "note_lignes" ("type", "ref_id") WHERE ref_id IS NOT NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_note_lignes_note" ON "note_lignes" ("note_id", "statut");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_note_lignes_terrasse_date" ON "note_lignes" ("terrasse_id", "cree_le");--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "encaissements" (
  "id" varchar(40) PRIMARY KEY,
  "note_id" varchar(40) NOT NULL,
  "organisation_id" varchar(40) NOT NULL,
  "encaisse_par_id" varchar(40) NOT NULL,
  "montant_cdf" integer DEFAULT 0 NOT NULL,
  "montant_usd" integer DEFAULT 0 NOT NULL,
  "mode" varchar(12) NOT NULL,
  "reference_mobile" varchar(30),
  "statut" varchar(10) DEFAULT 'EN_MAIN' NOT NULL,
  "remise_id" varchar(40),
  "cree_le" varchar(30) NOT NULL,
  "remis_le" varchar(30)
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uq_encaissements_reference" ON "encaissements" ("organisation_id", "reference_mobile") WHERE reference_mobile IS NOT NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_enc_note" ON "encaissements" ("note_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_enc_employe_statut" ON "encaissements" ("encaisse_par_id", "statut");--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "note_ventilations" (
  "id" varchar(40) PRIMARY KEY,
  "encaissement_id" varchar(40) NOT NULL,
  "terrasse_id" varchar(40) NOT NULL,
  "espace" varchar(20) NOT NULL,
  "montant_cdf" integer DEFAULT 0 NOT NULL,
  "montant_usd" integer DEFAULT 0 NOT NULL,
  "cree_le" varchar(30) NOT NULL
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_ventil_enc" ON "note_ventilations" ("encaissement_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_ventil_terrasse_date" ON "note_ventilations" ("terrasse_id", "cree_le");--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "remises_caisse" (
  "id" varchar(40) PRIMARY KEY,
  "organisation_id" varchar(40) NOT NULL,
  "employe_id" varchar(40) NOT NULL,
  "attendu_cdf" integer DEFAULT 0 NOT NULL,
  "attendu_usd" integer DEFAULT 0 NOT NULL,
  "recu_cdf" integer DEFAULT 0 NOT NULL,
  "recu_usd" integer DEFAULT 0 NOT NULL,
  "statut" varchar(12) DEFAULT 'EN_ATTENTE' NOT NULL,
  "valide_par" varchar(40),
  "motif_ecart" varchar(200),
  "cree_le" varchar(30) NOT NULL,
  "valide_le" varchar(30)
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_remises_org" ON "remises_caisse" ("organisation_id", "statut");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_remises_employe" ON "remises_caisse" ("employe_id", "cree_le");--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "pourboires" (
  "id" varchar(40) PRIMARY KEY,
  "note_id" varchar(40) NOT NULL,
  "encaissement_id" varchar(40) NOT NULL,
  "employe_id" varchar(40) NOT NULL,
  "montant_cdf" integer DEFAULT 0 NOT NULL,
  "montant_usd" integer DEFAULT 0 NOT NULL,
  "cree_le" varchar(30) NOT NULL
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_pourboires_employe" ON "pourboires" ("employe_id", "cree_le");--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "prises_en_charge" (
  "id" varchar(40) PRIMARY KEY,
  "organisation_id" varchar(40) NOT NULL,
  "terrasse_id" varchar(40) NOT NULL,
  "note_beneficiaire_id" varchar(40) NOT NULL,
  "payeur_client_id" varchar(40),
  "propose_par" varchar(40) NOT NULL,
  "lignes" jsonb NOT NULL,
  "montant_cdf" integer DEFAULT 0 NOT NULL,
  "montant_usd" integer DEFAULT 0 NOT NULL,
  "statut" varchar(12) DEFAULT 'EN_ATTENTE' NOT NULL,
  "decide_par" varchar(40),
  "decide_le" varchar(30),
  "expire_le" varchar(30) NOT NULL,
  "cree_le" varchar(30) NOT NULL
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_pec_terrasse_statut" ON "prises_en_charge" ("terrasse_id", "statut");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_pec_note" ON "prises_en_charge" ("note_beneficiaire_id");--> statement-breakpoint

ALTER TABLE "terrasses" ADD COLUMN IF NOT EXISTS "note_plafond_cdf" integer;--> statement-breakpoint
ALTER TABLE "terrasses" ADD COLUMN IF NOT EXISTS "token_sur_note" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "tokens" ADD COLUMN IF NOT EXISTS "sur_note" boolean DEFAULT false NOT NULL;
