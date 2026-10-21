-- ============================================================
-- Migration 0016 : taux de change USD/FC par établissement
-- (règle figée, docs/REGLE-TAUX-CHANGE.md) — VERSION REJOUABLE
--
--  - UNE SEULE colonne de taux : l'ancienne « taux_change »
--    (NOT NULL, défaut 2800) devient « taux_usd_cdf » NULLABLE.
--    Le RENAME conserve les valeurs existantes — aucune vente ni
--    aucune configuration n'est réécrite. NULL = mono-devise.
--  - Taux FIGÉ sur chaque ligne de vente (commande, token,
--    nuitée) : colonnes NULLABLES sans défaut — les ventes
--    antérieures restent NULL (« taux d'époque »), aucune
--    conversion rétroactive.
--  - Historique : table audit_log EXISTANTE, non modifiable
--    (aucun endpoint d'écriture) — action TAUX_MODIFIE avec
--    avant/après. Aucune table d'historique créée.
--
--  REJOUABLE : le rename est encadré (seulement si « taux_change »
--  existe encore et « taux_usd_cdf » pas encore) et tous les
--  ajouts utilisent IF NOT EXISTS — une seconde exécution est un
--  no-op complet. Retour arrière : db/migrations/0016_rollback.sql
-- ============================================================
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'terrasses' AND column_name = 'taux_change'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'terrasses' AND column_name = 'taux_usd_cdf'
  ) THEN
    ALTER TABLE "terrasses" RENAME COLUMN "taux_change" TO "taux_usd_cdf";
  END IF;
END $$;--> statement-breakpoint
ALTER TABLE "terrasses" ALTER COLUMN "taux_usd_cdf" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "terrasses" ALTER COLUMN "taux_usd_cdf" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "terrasses" ADD COLUMN IF NOT EXISTS "taux_alerte_variation_pct" integer DEFAULT 5 NOT NULL;--> statement-breakpoint
ALTER TABLE "terrasses" ADD COLUMN IF NOT EXISTS "taux_alerte_max_par_jour" integer DEFAULT 3 NOT NULL;--> statement-breakpoint
ALTER TABLE "terrasses" ADD COLUMN IF NOT EXISTS "taux_plafond_cdf" integer DEFAULT 10000 NOT NULL;--> statement-breakpoint
ALTER TABLE "commandes" ADD COLUMN IF NOT EXISTS "taux_usd_cdf" integer;--> statement-breakpoint
ALTER TABLE "tokens" ADD COLUMN IF NOT EXISTS "taux_usd_cdf" integer;--> statement-breakpoint
ALTER TABLE "sejours" ADD COLUMN IF NOT EXISTS "taux_usd_cdf" integer;
