CREATE TABLE "permissions_surcharge" (
	"id" varchar(40) PRIMARY KEY NOT NULL,
	"terrasse_id" varchar(40) NOT NULL,
	"utilisateur_id" varchar(40) NOT NULL,
	"action" varchar(40) NOT NULL,
	"autorisee" boolean NOT NULL,
	"cree_par" varchar(40) NOT NULL,
	"cree_le" varchar(30) NOT NULL,
	"modifie_le" varchar(30) NOT NULL,
	CONSTRAINT "uq_permsurch" UNIQUE("terrasse_id","utilisateur_id","action")
);
--> statement-breakpoint
ALTER TABLE "affectations" ALTER COLUMN "role" SET DATA TYPE varchar(16);--> statement-breakpoint
ALTER TABLE "audit_log" ALTER COLUMN "role_actif" SET DATA TYPE varchar(16);--> statement-breakpoint
ALTER TABLE "invitations" ALTER COLUMN "role" SET DATA TYPE varchar(16);--> statement-breakpoint
ALTER TABLE "audit_log" ADD COLUMN "terrasse_id" varchar(40);--> statement-breakpoint
ALTER TABLE "audit_log" ADD COLUMN "avant" text;--> statement-breakpoint
ALTER TABLE "audit_log" ADD COLUMN "apres" text;--> statement-breakpoint
CREATE INDEX "idx_permsurch_ter" ON "permissions_surcharge" USING btree ("terrasse_id");--> statement-breakpoint
CREATE INDEX "idx_audit_terrasse_date" ON "audit_log" USING btree ("terrasse_id","cree_le");