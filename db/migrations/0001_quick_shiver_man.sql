CREATE TABLE "depenses" (
	"id" varchar(40) PRIMARY KEY NOT NULL,
	"terrasse_id" varchar(40) NOT NULL,
	"montant_cdf" integer DEFAULT 0 NOT NULL,
	"montant_usd" integer DEFAULT 0 NOT NULL,
	"motif" varchar(200) NOT NULL,
	"saisi_par" varchar(40) NOT NULL,
	"role_actif" varchar(12),
	"cree_le" varchar(30) NOT NULL
);
--> statement-breakpoint
ALTER TABLE "commandes" ADD COLUMN "payee_le" varchar(30);--> statement-breakpoint
ALTER TABLE "commandes" ADD COLUMN "payee_par" varchar(40);--> statement-breakpoint
CREATE INDEX "idx_dep_ter_date" ON "depenses" USING btree ("terrasse_id","cree_le");--> statement-breakpoint
CREATE INDEX "idx_audit_date" ON "audit_log" USING btree ("cree_le");--> statement-breakpoint
CREATE INDEX "idx_audit_action_date" ON "audit_log" USING btree ("action","cree_le");--> statement-breakpoint
CREATE INDEX "idx_cmd_ter_statut" ON "commandes" USING btree ("terrasse_id","statut");--> statement-breakpoint
CREATE INDEX "idx_cmd_session" ON "commandes" USING btree ("client_session_id");--> statement-breakpoint
CREATE INDEX "idx_mvt_ter_date" ON "mouvements_stock" USING btree ("terrasse_id","cree_le");