CREATE TABLE "abonnements" (
	"id" varchar(40) PRIMARY KEY NOT NULL,
	"terrasse_id" varchar(40) NOT NULL,
	"plan" varchar(10) NOT NULL,
	"tranche" varchar(10) NOT NULL,
	"statut" varchar(15) NOT NULL,
	"type_etablissement" varchar(10),
	"essai_fin" varchar(30),
	"periode_debut" varchar(30) NOT NULL,
	"periode_fin" varchar(30) NOT NULL,
	"annuel" boolean DEFAULT false NOT NULL,
	"nb_tables_max_periode" integer DEFAULT 0 NOT NULL,
	"prorata_du" integer DEFAULT 0 NOT NULL,
	"frais_install_payes" boolean DEFAULT false NOT NULL,
	CONSTRAINT "abonnements_terrasse_id_unique" UNIQUE("terrasse_id")
);
--> statement-breakpoint
CREATE TABLE "affectations" (
	"id" varchar(40) PRIMARY KEY NOT NULL,
	"utilisateur_id" varchar(40) NOT NULL,
	"terrasse_id" varchar(40) NOT NULL,
	"role" varchar(10) NOT NULL,
	"actif" boolean DEFAULT true NOT NULL,
	"cree_le" varchar(30) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "alertes" (
	"id" varchar(40) PRIMARY KEY NOT NULL,
	"terrasse_id" varchar(40) NOT NULL,
	"type" varchar(15) NOT NULL,
	"message" varchar(300) NOT NULL,
	"lu" boolean DEFAULT false NOT NULL,
	"cree_le" varchar(30) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" varchar(40) PRIMARY KEY NOT NULL,
	"acteur_id" varchar(40),
	"role_actif" varchar(12),
	"action" varchar(40) NOT NULL,
	"details" varchar(300) NOT NULL,
	"cree_le" varchar(30) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "avis" (
	"id" varchar(40) PRIMARY KEY NOT NULL,
	"commande_id" varchar(40) NOT NULL,
	"serveuse_id" varchar(40) NOT NULL,
	"terrasse_id" varchar(40) NOT NULL,
	"note" integer NOT NULL,
	"commentaire" varchar(300) DEFAULT '' NOT NULL,
	"masque" boolean DEFAULT false NOT NULL,
	"motif_masquage" varchar(200),
	"cree_le" varchar(30) NOT NULL,
	CONSTRAINT "avis_commande_id_unique" UNIQUE("commande_id")
);
--> statement-breakpoint
CREATE TABLE "catalogue_produits" (
	"id" varchar(40) PRIMARY KEY NOT NULL,
	"categorie" varchar(60) NOT NULL,
	"nom" varchar(120) NOT NULL,
	"variante" varchar(60),
	"consignable" boolean DEFAULT false NOT NULL,
	"bouteilles_par_casier" integer,
	"photo_url" varchar(500),
	"photo_thumbnail_url" varchar(500),
	"ordre_affichage" integer DEFAULT 0 NOT NULL,
	"actif" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "clients_session" (
	"id" varchar(40) PRIMARY KEY NOT NULL,
	"table_id" varchar(40) NOT NULL,
	"prenom" varchar(60) NOT NULL,
	"cree_le" varchar(30) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "commandes" (
	"id" varchar(40) PRIMARY KEY NOT NULL,
	"terrasse_id" varchar(40) NOT NULL,
	"table_id" varchar(40) NOT NULL,
	"client_session_id" varchar(40) NOT NULL,
	"statut" varchar(15) NOT NULL,
	"lignes" jsonb NOT NULL,
	"total_cdf" integer DEFAULT 0 NOT NULL,
	"total_usd" integer DEFAULT 0 NOT NULL,
	"cle_idempotence" varchar(60) NOT NULL,
	"cree_le" varchar(30) NOT NULL,
	"confirmee_le" varchar(30),
	"servie_le" varchar(30),
	"annule_le" varchar(30),
	"motif_annulation" varchar(200),
	"servie_par" varchar(40),
	CONSTRAINT "commandes_cle_idempotence_unique" UNIQUE("cle_idempotence")
);
--> statement-breakpoint
CREATE TABLE "demandes_stock" (
	"id" varchar(40) PRIMARY KEY NOT NULL,
	"terrasse_id" varchar(40) NOT NULL,
	"produit_id" varchar(40) NOT NULL,
	"quantite" integer NOT NULL,
	"type" varchar(10) NOT NULL,
	"motif" varchar(200) NOT NULL,
	"statut" varchar(10) NOT NULL,
	"cree_par" varchar(40) NOT NULL,
	"cree_le" varchar(30) NOT NULL,
	"traite_par" varchar(40),
	"traite_le" varchar(30)
);
--> statement-breakpoint
CREATE TABLE "depots" (
	"id" varchar(40) PRIMARY KEY NOT NULL,
	"session_id" varchar(40) NOT NULL,
	"terrasse_id" varchar(40) NOT NULL,
	"serveuse_id" varchar(40) NOT NULL,
	"attendu_cdf" integer DEFAULT 0 NOT NULL,
	"attendu_usd" integer DEFAULT 0 NOT NULL,
	"declare_cdf" integer DEFAULT 0 NOT NULL,
	"declare_usd" integer DEFAULT 0 NOT NULL,
	"statut" varchar(10) NOT NULL,
	"declare_le" varchar(30) NOT NULL,
	"valide_le" varchar(30),
	"valide_par" varchar(40),
	"motif_contest" varchar(200)
);
--> statement-breakpoint
CREATE TABLE "factures" (
	"id" varchar(40) PRIMARY KEY NOT NULL,
	"numero" varchar(20) NOT NULL,
	"abonnement_id" varchar(40) NOT NULL,
	"terrasse_id" varchar(40) NOT NULL,
	"plan" varchar(10) NOT NULL,
	"tranche" varchar(10) NOT NULL,
	"montant_usd" integer NOT NULL,
	"cree_le" varchar(30) NOT NULL,
	CONSTRAINT "factures_numero_unique" UNIQUE("numero")
);
--> statement-breakpoint
CREATE TABLE "historique_tranches" (
	"id" varchar(40) PRIMARY KEY NOT NULL,
	"abonnement_id" varchar(40) NOT NULL,
	"ancienne" varchar(10) NOT NULL,
	"nouvelle" varchar(10) NOT NULL,
	"nb_tables" integer NOT NULL,
	"prorata_usd" integer NOT NULL,
	"cree_par" varchar(40) NOT NULL,
	"cree_le" varchar(30) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invitations" (
	"id" varchar(40) PRIMARY KEY NOT NULL,
	"code" varchar(8) NOT NULL,
	"terrasse_id" varchar(40) NOT NULL,
	"role" varchar(10) NOT NULL,
	"cree_par" varchar(40) NOT NULL,
	"nom_prevu" varchar(120) DEFAULT '' NOT NULL,
	"expire_le" varchar(30) NOT NULL,
	"statut" varchar(10) NOT NULL,
	"cree_le" varchar(30) NOT NULL,
	CONSTRAINT "invitations_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "meta" (
	"cle" varchar(30) PRIMARY KEY NOT NULL,
	"valeur" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mouvements_stock" (
	"id" varchar(40) PRIMARY KEY NOT NULL,
	"produit_id" varchar(40) NOT NULL,
	"terrasse_id" varchar(40) NOT NULL,
	"type" varchar(12) NOT NULL,
	"quantite" integer NOT NULL,
	"motif" varchar(200) NOT NULL,
	"acteur_id" varchar(40),
	"role_actif" varchar(12),
	"cree_le" varchar(30) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "organisations" (
	"id" varchar(40) PRIMARY KEY NOT NULL,
	"nom" varchar(120) NOT NULL,
	"proprietaire_id" varchar(40) NOT NULL,
	"cree_le" varchar(30) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "paiements" (
	"id" varchar(40) PRIMARY KEY NOT NULL,
	"abonnement_id" varchar(40) NOT NULL,
	"terrasse_id" varchar(40) NOT NULL,
	"montant_usd" integer NOT NULL,
	"methode" varchar(15) NOT NULL,
	"reference" varchar(60) NOT NULL,
	"statut" varchar(10) NOT NULL,
	"soumis_par" varchar(40) NOT NULL,
	"cree_le" varchar(30) NOT NULL,
	"valide_le" varchar(30),
	"valide_par" varchar(40)
);
--> statement-breakpoint
CREATE TABLE "plans_tarifs" (
	"plan" varchar(10) NOT NULL,
	"tranche" varchar(10) NOT NULL,
	"tables_min" integer NOT NULL,
	"tables_max" integer,
	"prix_usd" integer NOT NULL,
	"frais_install_usd" integer NOT NULL,
	"type_etablissement_cible" varchar(10),
	CONSTRAINT "plans_tarifs_plan_tranche_pk" PRIMARY KEY("plan","tranche")
);
--> statement-breakpoint
CREATE TABLE "produits" (
	"id" varchar(40) PRIMARY KEY NOT NULL,
	"terrasse_id" varchar(40) NOT NULL,
	"nom" varchar(120) NOT NULL,
	"categorie" varchar(60) NOT NULL,
	"prix_cdf" integer DEFAULT 0 NOT NULL,
	"prix_usd" integer DEFAULT 0 NOT NULL,
	"stock" integer DEFAULT 0 NOT NULL,
	"stock_reserve" integer DEFAULT 0 NOT NULL,
	"seuil_alerte" integer DEFAULT 0 NOT NULL,
	"actif" boolean DEFAULT true NOT NULL,
	"photo_url" varchar(500),
	"photo_thumbnail_url" varchar(500),
	"photo_source" varchar(10),
	"variante" varchar(60),
	"consignable" boolean DEFAULT false NOT NULL,
	"bouteilles_par_casier" integer
);
--> statement-breakpoint
CREATE TABLE "sessions_service" (
	"id" varchar(40) PRIMARY KEY NOT NULL,
	"terrasse_id" varchar(40) NOT NULL,
	"serveuse_id" varchar(40) NOT NULL,
	"statut" varchar(10) NOT NULL,
	"ouverte_le" varchar(30) NOT NULL,
	"cloturee_le" varchar(30)
);
--> statement-breakpoint
CREATE TABLE "table_serveuse" (
	"id" varchar(40) PRIMARY KEY NOT NULL,
	"table_id" varchar(40) NOT NULL,
	"serveuse_id" varchar(40) NOT NULL,
	"actif" boolean DEFAULT true NOT NULL,
	"depuis_le" varchar(30) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tables_qr" (
	"id" varchar(40) PRIMARY KEY NOT NULL,
	"terrasse_id" varchar(40) NOT NULL,
	"numero" integer NOT NULL,
	"token_qr" varchar(40) NOT NULL,
	"actif" boolean DEFAULT true NOT NULL,
	"cree_le" varchar(30) NOT NULL,
	"archive_le" varchar(30),
	CONSTRAINT "tables_qr_token_qr_unique" UNIQUE("token_qr")
);
--> statement-breakpoint
CREATE TABLE "terrasses" (
	"id" varchar(40) PRIMARY KEY NOT NULL,
	"organisation_id" varchar(40) NOT NULL,
	"nom" varchar(120) NOT NULL,
	"adresse" varchar(200) NOT NULL,
	"type_etablissement" varchar(10) DEFAULT 'TERRASSE' NOT NULL,
	"token_qr_boutique" varchar(40),
	"seuil_ecart_cdf" integer DEFAULT 5000 NOT NULL,
	"seuil_ecart_usd" integer DEFAULT 200 NOT NULL,
	"taux_change" integer DEFAULT 2800 NOT NULL,
	"cree_le" varchar(30) NOT NULL,
	CONSTRAINT "terrasses_token_qr_boutique_unique" UNIQUE("token_qr_boutique")
);
--> statement-breakpoint
CREATE TABLE "utilisateurs" (
	"id" varchar(40) PRIMARY KEY NOT NULL,
	"nom" varchar(120) NOT NULL,
	"telephone" varchar(30) NOT NULL,
	"pin" varchar(12) NOT NULL,
	"cree_le" varchar(30) NOT NULL
);
--> statement-breakpoint
CREATE INDEX "idx_aff_util" ON "affectations" USING btree ("utilisateur_id");--> statement-breakpoint
CREATE INDEX "idx_aff_ter" ON "affectations" USING btree ("terrasse_id");--> statement-breakpoint
CREATE INDEX "idx_alertes_ter" ON "alertes" USING btree ("terrasse_id");--> statement-breakpoint
CREATE INDEX "idx_catalogue_categorie" ON "catalogue_produits" USING btree ("categorie");--> statement-breakpoint
CREATE INDEX "idx_cmd_ter" ON "commandes" USING btree ("terrasse_id");--> statement-breakpoint
CREATE INDEX "idx_cmd_table" ON "commandes" USING btree ("table_id");--> statement-breakpoint
CREATE INDEX "idx_mvt_ter" ON "mouvements_stock" USING btree ("terrasse_id");--> statement-breakpoint
CREATE INDEX "idx_prod_ter" ON "produits" USING btree ("terrasse_id");--> statement-breakpoint
CREATE INDEX "idx_prod_consignable" ON "produits" USING btree ("consignable");--> statement-breakpoint
CREATE INDEX "idx_tables_ter" ON "tables_qr" USING btree ("terrasse_id");