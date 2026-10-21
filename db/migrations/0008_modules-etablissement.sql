CREATE TABLE "modules_etablissement" (
	"id" varchar(40) PRIMARY KEY NOT NULL,
	"terrasse_id" varchar(40) NOT NULL,
	"module" varchar(20) NOT NULL,
	"actif" boolean DEFAULT true NOT NULL,
	"modifie_par" varchar(40),
	"modifie_le" varchar(30) NOT NULL,
	CONSTRAINT "uq_modetab_terrasse_module" UNIQUE("terrasse_id","module")
);
--> statement-breakpoint
CREATE INDEX "idx_modetab_terrasse" ON "modules_etablissement" USING btree ("terrasse_id");