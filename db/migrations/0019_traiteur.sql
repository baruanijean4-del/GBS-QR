-- 0019 — Module traiteur (docs/MODULE-TRAITEUR.md §8, fidèle au doc).
-- Règles clés :
--  * recettes versionnées, immuables après validation (PROPOSEE → VALIDEE) ;
--  * quantités recette en unité de base ENTIÈRE (mg, ml, pièces) — aucun
--    arrondi intermédiaire (§4) ;
--  * composition du menu figée dans le plan (§6 : les jours passés ne
--    changent jamais) ;
--  * bons de sortie SANS aucun prix, agrégés par ingrédient (§4) ;
--  * coûts et marges visibles du PROPRIÉTAIRE SEUL (§5, contrôle API) ;
--  * produits.cout_achat_usd : coût d'achat en centimes USD par unité
--    de stock (NULL = non renseigné).
-- Rejouable (IF NOT EXISTS).

ALTER TABLE "produits" ADD COLUMN IF NOT EXISTS "cout_achat_usd" integer;
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "traiteur_composants" (
  "id" varchar(40) PRIMARY KEY NOT NULL,
  "terrasse_id" varchar(40) NOT NULL REFERENCES "terrasses"("id"),
  "nom" varchar(120) NOT NULL,
  "kind" varchar(20) NOT NULL,              -- PLAT | SAUCE | ACCOMPAGNEMENT | BOISSON
  "actif" boolean NOT NULL DEFAULT true,
  "cree_le" varchar(30) NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_composants_terrasse" ON "traiteur_composants" ("terrasse_id", "actif");
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "traiteur_recettes" (
  "id" varchar(40) PRIMARY KEY NOT NULL,
  "composant_id" varchar(40) NOT NULL REFERENCES "traiteur_composants"("id"),
  "version" integer NOT NULL DEFAULT 1,
  "statut" varchar(20) NOT NULL DEFAULT 'PROPOSEE',  -- PROPOSEE | VALIDEE
  "propose_par" varchar(40) NOT NULL,     -- chef
  "valide_par" varchar(40),               -- propriétaire
  "validee_le" varchar(30),
  "cree_le" varchar(30) NOT NULL,
  CONSTRAINT "uq_recette_composant_version" UNIQUE ("composant_id", "version")
);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "traiteur_recette_lignes" (
  "id" varchar(40) PRIMARY KEY NOT NULL,
  "recette_id" varchar(40) NOT NULL REFERENCES "traiteur_recettes"("id") ON DELETE CASCADE,
  "produit_id" varchar(40) NOT NULL REFERENCES "produits"("id"),
  "sous_recette_id" varchar(40),          -- v2 prévu, NULL en v1 (§7)
  "quantite_par_personne_base" bigint NOT NULL,  -- mg | ml | pièces (entier, §8)
  "taux_perte_pct" integer NOT NULL DEFAULT 0    -- 0 pour les produits achetés non cuisinés
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_rec_lignes_recette" ON "traiteur_recette_lignes" ("recette_id");
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "traiteur_menus" (
  "id" varchar(40) PRIMARY KEY NOT NULL,
  "terrasse_id" varchar(40) NOT NULL REFERENCES "terrasses"("id"),
  "nom" varchar(120) NOT NULL,
  "prix_personne_usd" integer NOT NULL,   -- centimes USD
  "version" integer NOT NULL DEFAULT 1,   -- incrémentée à chaque modification (§6)
  "actif" boolean NOT NULL DEFAULT true,
  "cree_le" varchar(30) NOT NULL
);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "traiteur_menu_lignes" (
  "id" varchar(40) PRIMARY KEY NOT NULL,
  "menu_id" varchar(40) NOT NULL REFERENCES "traiteur_menus"("id") ON DELETE CASCADE,
  "composant_id" varchar(40) NOT NULL REFERENCES "traiteur_composants"("id"),
  "qte_par_personne_x1000" integer NOT NULL DEFAULT 1000,  -- 1000 = 1 ; 500 = 0,5 ; 2000 = 2
  "position" integer NOT NULL DEFAULT 0
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_menu_lignes_menu" ON "traiteur_menu_lignes" ("menu_id");
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "traiteur_plans" (
  "id" varchar(40) PRIMARY KEY NOT NULL,
  "terrasse_id" varchar(40) NOT NULL REFERENCES "terrasses"("id"),
  "menu_id" varchar(40) NOT NULL REFERENCES "traiteur_menus"("id"),
  "menu_version" integer NOT NULL,        -- version du menu au démarrage (§6)
  "entreprise" varchar(200) NOT NULL,
  "nb_personnes" integer NOT NULL,
  "jour" varchar(10) NOT NULL,            -- ISO « AAAA-MM-JJ »
  "heure" varchar(5) NOT NULL,            -- « HH:MM »
  "repartition_options" jsonb,            -- menu à choix : {menuLigneId: personnes}, somme = nb_personnes
  "composition" jsonb NOT NULL,           -- FIGÉE au démarrage : lignes menu + versions des recettes
  "statut" varchar(20) NOT NULL DEFAULT 'BROUILLON',  -- BROUILLON | EN_COURS | TERMINE | ANNULE
  "cree_par" varchar(40) NOT NULL,
  "cree_le" varchar(30) NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_plans_terrasse" ON "traiteur_plans" ("terrasse_id", "jour");
--> statement-breakpoint

-- Composition par contrat (§3) : un COMPOSANT absent pour cette entreprise.
CREATE TABLE IF NOT EXISTS "traiteur_plan_exclusions" (
  "id" varchar(40) PRIMARY KEY NOT NULL,
  "plan_id" varchar(40) NOT NULL REFERENCES "traiteur_plans"("id") ON DELETE CASCADE,
  "composant_id" varchar(40) NOT NULL REFERENCES "traiteur_composants"("id"),
  "motif" varchar(200),                   -- ex. « l'eau est fournie par l'entreprise »
  CONSTRAINT "uq_plan_exclusion" UNIQUE ("plan_id", "composant_id")
);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "traiteur_bons_sortie" (
  "id" varchar(40) PRIMARY KEY NOT NULL,
  "terrasse_id" varchar(40) NOT NULL REFERENCES "terrasses"("id"),
  "plan_id" varchar(40) NOT NULL REFERENCES "traiteur_plans"("id"),
  "statut" varchar(20) NOT NULL DEFAULT 'BROUILLON',  -- BROUILLON | EMIS
  "magasinier_id" varchar(40) NOT NULL,
  "emis_le" varchar(30),
  "cree_le" varchar(30) NOT NULL,
  CONSTRAINT "uq_bon_plan" UNIQUE ("plan_id")   -- un plan = un jour = un bon
);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "traiteur_bon_lignes" (
  "id" varchar(40) PRIMARY KEY NOT NULL,
  "bon_id" varchar(40) NOT NULL REFERENCES "traiteur_bons_sortie"("id") ON DELETE CASCADE,
  "produit_id" varchar(40) NOT NULL REFERENCES "produits"("id"),
  "lot" varchar(60),                      -- lot FEFO retenu à l'émission
  "quantite_base" bigint NOT NULL,        -- mg | ml | pièces (entier exact)
  "details" jsonb,                        -- traçabilité : [{composantId, quantiteBase}]
  CONSTRAINT "uq_bon_ligne" UNIQUE ("bon_id", "produit_id")  -- UNE ligne par ingrédient (§4)
);
--> statement-breakpoint

-- Comptage à l'aveugle (§7bis) : le théorique est rempli par le serveur
-- et JAMAIS affiché au compteur ; l'écart sort en quantité seule pour le
-- personnel, en valeur pour le propriétaire seul.
CREATE TABLE IF NOT EXISTS "traiteur_comptages" (
  "id" varchar(40) PRIMARY KEY NOT NULL,
  "terrasse_id" varchar(40) NOT NULL REFERENCES "terrasses"("id"),
  "produit_id" varchar(40) NOT NULL REFERENCES "produits"("id"),
  "compte_par" varchar(40) NOT NULL,
  "quantite_comptee" integer NOT NULL,    -- unité de stock (entier), saisie à l'aveugle
  "theorique" integer NOT NULL,           -- stock serveur au moment du comptage
  "ecart" integer NOT NULL,               -- théorique - compté
  "cree_le" varchar(30) NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_comptages_terrasse" ON "traiteur_comptages" ("terrasse_id", "cree_le");
