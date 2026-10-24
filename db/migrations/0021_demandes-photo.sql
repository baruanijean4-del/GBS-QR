-- 0021 — Demandes de photo (produits, chambres).
-- Le gérant ou le propriétaire DEMANDE une photo ; le super-admin colle
-- l'adresse (URL) de l'image et valide. Aucune image n'est stockée.
-- Une seule demande EN_ATTENTE par produit/chambre (index unique partiel).
-- Rejouable (IF NOT EXISTS).
CREATE TABLE IF NOT EXISTS "demandes_photo" (
  "id" varchar(40) PRIMARY KEY NOT NULL,
  "terrasse_id" varchar(40) NOT NULL,
  "cible" varchar(10) NOT NULL,
  "cible_id" varchar(40) NOT NULL,
  "demandeur_id" varchar(40) NOT NULL,
  "note" varchar(300),
  "statut" varchar(10) DEFAULT 'EN_ATTENTE' NOT NULL,
  "url" varchar(500),
  "motif_refus" varchar(200),
  "cree_le" varchar(30) NOT NULL,
  "traite_le" varchar(30),
  "traite_par" varchar(40)
);
CREATE INDEX IF NOT EXISTS "idx_demandes_photo_statut" ON "demandes_photo" ("statut", "cree_le");
CREATE INDEX IF NOT EXISTS "idx_demandes_photo_terrasse" ON "demandes_photo" ("terrasse_id", "cree_le");
CREATE UNIQUE INDEX IF NOT EXISTS "uq_demandes_photo_attente" ON "demandes_photo" ("cible", "cible_id") WHERE statut = 'EN_ATTENTE';
