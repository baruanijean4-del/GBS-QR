CREATE TABLE "chambres" (
	"id" varchar(40) PRIMARY KEY NOT NULL,
	"terrasse_id" varchar(40) NOT NULL,
	"numero" varchar(10) NOT NULL,
	"type" varchar(20) DEFAULT 'SIMPLE' NOT NULL,
	"statut" varchar(12) DEFAULT 'LIBRE' NOT NULL,
	"prix_nuit_cdf" integer NOT NULL,
	"prix_heure_cdf" integer,
	"cree_le" varchar(30) NOT NULL,
	CONSTRAINT "uq_chambres_terrasse_numero" UNIQUE("terrasse_id","numero")
);
--> statement-breakpoint
CREATE TABLE "sejours" (
	"id" varchar(40) PRIMARY KEY NOT NULL,
	"chambre_id" varchar(40) NOT NULL,
	"terrasse_id" varchar(40) NOT NULL,
	"client_nom" varchar(120) NOT NULL,
	"piece_identite" varchar(60),
	"mode" varchar(6) NOT NULL,
	"arrivee_le" varchar(30) NOT NULL,
	"depart_le" varchar(30),
	"montant_total_cdf" integer,
	"statut" varchar(10) DEFAULT 'EN_COURS' NOT NULL,
	"cree_par" varchar(40) NOT NULL,
	"cree_le" varchar(30) NOT NULL
);
--> statement-breakpoint
CREATE INDEX "idx_chambres_terrasse_statut" ON "chambres" USING btree ("terrasse_id","statut");--> statement-breakpoint
CREATE INDEX "idx_sejours_chambre" ON "sejours" USING btree ("chambre_id","statut");--> statement-breakpoint
CREATE INDEX "idx_sejours_terrasse_date" ON "sejours" USING btree ("terrasse_id","cree_le");