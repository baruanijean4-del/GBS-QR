-- ============================================================
-- RETOUR ARRIÈRE de la migration 0016 (script manuel, hors
-- journal drizzle — à exécuter explicitement si nécessaire) :
--   psql "$DATABASE_URL" -f db/migrations/0016_rollback.sql
--
-- Restaure « taux_change » (NOT NULL, défaut 2800) à partir de
-- « taux_usd_cdf » et supprime les colonnes ajoutées par la 0016.
--
-- ⚠ LIMITES ASSUMÉES :
--  - Si des établissements ont taux_usd_cdf NULL (mono-devise),
--    le SET NOT NULL ÉCHOUERA : choisir alors une valeur ou
--    annuler le retour arrière. C'est voulu — pas de valeur
--    inventée silencieusement.
--  - Les taux figés sur les ventes (commandes/tokens/séjours)
--    sont SUPPRIMÉS par ce script : ne l'exécuter que si la 0016
--    vient d'être appliquée et qu'aucune vente n'a encore figé
--    de taux.
--  - Après retour arrière, supprimer la ligne 0016 de la table
--    drizzle.__drizzle_migrations pour réaligner le journal.
-- ============================================================
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'terrasses' AND column_name = 'taux_usd_cdf'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'terrasses' AND column_name = 'taux_change'
  ) THEN
    ALTER TABLE "terrasses" RENAME COLUMN "taux_usd_cdf" TO "taux_change";
  END IF;
END $$;
ALTER TABLE "terrasses" ALTER COLUMN "taux_change" SET NOT NULL;
ALTER TABLE "terrasses" ALTER COLUMN "taux_change" SET DEFAULT 2800;
ALTER TABLE "terrasses" DROP COLUMN IF EXISTS "taux_alerte_variation_pct";
ALTER TABLE "terrasses" DROP COLUMN IF EXISTS "taux_alerte_max_par_jour";
ALTER TABLE "terrasses" DROP COLUMN IF EXISTS "taux_plafond_cdf";
ALTER TABLE "commandes" DROP COLUMN IF EXISTS "taux_usd_cdf";
ALTER TABLE "tokens" DROP COLUMN IF EXISTS "taux_usd_cdf";
ALTER TABLE "sejours" DROP COLUMN IF EXISTS "taux_usd_cdf";
