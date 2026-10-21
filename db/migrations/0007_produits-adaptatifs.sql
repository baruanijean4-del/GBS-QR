CREATE TABLE "categories_produit" (
	"id" varchar(40) PRIMARY KEY NOT NULL,
	"code" varchar(30) NOT NULL,
	"type_etablissement" varchar(20) NOT NULL,
	"nom_fr" varchar(60) NOT NULL,
	"nom_en" varchar(60) NOT NULL,
	"nom_pt" varchar(60) NOT NULL,
	"icone" varchar(40) NOT NULL,
	"ordre_affichage" integer DEFAULT 0 NOT NULL,
	"actif" boolean DEFAULT true NOT NULL,
	CONSTRAINT "uq_catprod_code_type" UNIQUE("code","type_etablissement")
);
--> statement-breakpoint
ALTER TABLE "produits" ADD COLUMN "type_produit" varchar(12);--> statement-breakpoint
ALTER TABLE "produits" ADD COLUMN "unite" varchar(20);--> statement-breakpoint
ALTER TABLE "produits" ADD COLUMN "duree_minutes" integer;--> statement-breakpoint
ALTER TABLE "produits" ADD COLUMN "capacite" integer;--> statement-breakpoint
ALTER TABLE "produits" ADD COLUMN "lot" varchar(60);--> statement-breakpoint
ALTER TABLE "produits" ADD COLUMN "date_peremption" varchar(10);--> statement-breakpoint
CREATE INDEX "idx_catprod_type" ON "categories_produit" USING btree ("type_etablissement");