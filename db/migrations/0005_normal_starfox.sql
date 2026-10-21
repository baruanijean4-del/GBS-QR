CREATE TABLE "erreurs_client" (
	"id" varchar(40) PRIMARY KEY NOT NULL,
	"cree_le" varchar(30) NOT NULL,
	"utilisateur_id" varchar(40),
	"etablissement_id" varchar(40),
	"route" varchar(200) DEFAULT '' NOT NULL,
	"message" varchar(1000) NOT NULL,
	"stack" varchar(4000),
	"user_agent" varchar(300),
	"version" varchar(60),
	"langue" varchar(5),
	"code_court" varchar(12) NOT NULL
);
--> statement-breakpoint
CREATE INDEX "idx_err_code" ON "erreurs_client" USING btree ("code_court");--> statement-breakpoint
CREATE INDEX "idx_err_date" ON "erreurs_client" USING btree ("cree_le");