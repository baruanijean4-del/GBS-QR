CREATE TABLE "catalogue_codes_barres" (
	"id" varchar(40) PRIMARY KEY NOT NULL,
	"code_barres" varchar(50) NOT NULL,
	"nom" varchar(120) NOT NULL,
	"categorie" varchar(60) DEFAULT 'Divers' NOT NULL,
	"variante" varchar(60),
	"photo_url" varchar(500),
	"consignable" boolean DEFAULT false NOT NULL,
	"bouteilles_par_casier" integer,
	"prix_cdf_moyen" integer,
	"prix_usd_moyen" integer,
	"nb_utilisations" integer DEFAULT 0 NOT NULL,
	"source" varchar(20) DEFAULT 'MANUEL' NOT NULL,
	"cree_le" varchar(30) NOT NULL,
	CONSTRAINT "catalogue_codes_barres_code_barres_unique" UNIQUE("code_barres")
);
--> statement-breakpoint
ALTER TABLE "produits" ADD COLUMN "code_barres" varchar(50);--> statement-breakpoint
CREATE INDEX "idx_codes_barres_code" ON "catalogue_codes_barres" USING btree ("code_barres");--> statement-breakpoint
CREATE INDEX "idx_produits_code_barres" ON "produits" USING btree ("code_barres");