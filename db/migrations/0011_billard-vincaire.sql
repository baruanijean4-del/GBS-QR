-- Migration 0011 — Billard Vincaire (annexe §1, étape 3).
-- RÉALITÉ DE LA BASE : les tables « tokens » et « parties » existent
-- déjà (prototype antérieur, jamais versionné dans db/schema.ts).
-- Cette migration est donc IDEMPOTENTE (IF NOT EXISTS partout) :
-- base neuve → CREATE complet ; base existante → ALTER complémentaires.
-- Le garde-fou api/lib/assurerSchema.ts reprend exactement ce corps.

-- Billards : une zone de tables_qr peut être un billard
ALTER TABLE "tables_qr" ADD COLUMN IF NOT EXISTS "kind" varchar(12) DEFAULT 'ZONE' NOT NULL;

-- Configuration billard par établissement (annexe : config_billard)
CREATE TABLE IF NOT EXISTS "config_billard" (
	"id" varchar(40) PRIMARY KEY NOT NULL,
	"terrasse_id" varchar(40) NOT NULL,
	"prix_token_cdf" integer DEFAULT 5000 NOT NULL,
	"regle_perdant" varchar(10) DEFAULT 'RACHAT' NOT NULL,
	"max_parties_vincaire" integer,
	"delai_presence_min" integer DEFAULT 3 NOT NULL,
	"modifie_par" varchar(40),
	"modifie_le" varchar(30) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "config_billard_terrasse_id_unique" ON "config_billard" USING btree ("terrasse_id");
--> statement-breakpoint
-- File d'attente : table « tokens » (créée si absente, sinon complétée)
CREATE TABLE IF NOT EXISTS "tokens" (
	"id" varchar(40) PRIMARY KEY NOT NULL,
	"terrasse_id" varchar(40) NOT NULL,
	"table_id" varchar(40) NOT NULL,
	"numero" integer NOT NULL,
	"client_session_id" varchar(40),
	"prenom" varchar(60) NOT NULL,
	"prix_cdf" integer NOT NULL,
	"statut" varchar(20) DEFAULT 'ATTENTE_PAIEMENT' NOT NULL,
	"serie" integer DEFAULT 0 NOT NULL,
	"cree_le" varchar(30) NOT NULL,
	"paye_le" varchar(30),
	"paye_par" varchar(40),
	"entree_file_le" varchar(30),
	"appele_le" varchar(30),
	"annule_le" varchar(30),
	"annule_par" varchar(40)
);
--> statement-breakpoint
ALTER TABLE "tokens" ADD COLUMN IF NOT EXISTS "serie" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE "tokens" ADD COLUMN IF NOT EXISTS "paye_le" varchar(30);
--> statement-breakpoint
ALTER TABLE "tokens" ADD COLUMN IF NOT EXISTS "paye_par" varchar(40);
--> statement-breakpoint
ALTER TABLE "tokens" ADD COLUMN IF NOT EXISTS "entree_file_le" varchar(30);
--> statement-breakpoint
ALTER TABLE "tokens" ADD COLUMN IF NOT EXISTS "annule_le" varchar(30);
--> statement-breakpoint
ALTER TABLE "tokens" ADD COLUMN IF NOT EXISTS "annule_par" varchar(40);
--> statement-breakpoint
ALTER TABLE "tokens" ALTER COLUMN "statut" SET DATA TYPE varchar(20);
--> statement-breakpoint
-- Alignement des statuts du prototype : EN_ATTENTE → ATTENTE_PAIEMENT
UPDATE "tokens" SET "statut" = 'ATTENTE_PAIEMENT' WHERE "statut" = 'EN_ATTENTE';
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_tokens_file" ON "tokens" USING btree ("table_id","statut","entree_file_le");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_tokens_terrasse_date" ON "tokens" USING btree ("terrasse_id","cree_le");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_tokens_client" ON "tokens" USING btree ("client_session_id");
--> statement-breakpoint
-- Parties : table « parties » (créée si absente, sinon complétée)
CREATE TABLE IF NOT EXISTS "parties" (
	"id" varchar(40) PRIMARY KEY NOT NULL,
	"terrasse_id" varchar(40) NOT NULL,
	"table_id" varchar(40) NOT NULL,
	"numero" integer DEFAULT 0 NOT NULL,
	"vincaire_token_id" varchar(40),
	"challenger_token_id" varchar(40) NOT NULL,
	"gagnant_token_id" varchar(40),
	"statut" varchar(20) DEFAULT 'EN_COURS' NOT NULL,
	"debut_le" varchar(30) NOT NULL,
	"fin_le" varchar(30),
	"termine_par" varchar(40)
);
--> statement-breakpoint
ALTER TABLE "parties" ADD COLUMN IF NOT EXISTS "numero" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE "parties" ADD COLUMN IF NOT EXISTS "termine_par" varchar(40);
--> statement-breakpoint
ALTER TABLE "parties" ALTER COLUMN "statut" SET DATA TYPE varchar(20);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_parties_table" ON "parties" USING btree ("table_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_parties_terrasse_date" ON "parties" USING btree ("terrasse_id","debut_le");
