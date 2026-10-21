-- ============================================================
-- D2 — Assainissement du journal drizzle de PRODUCTION
-- (exécution MANUELLE par le propriétaire, en heure creuse,
--  APRÈS sauvegarde Neon confirmée — jamais au démarrage)
--
-- État constaté (2026-10-20) : 19 lignes = 17 migrations uniques
-- (0000→0016) + doublons 0011 (ids 12/14) et 0012 (ids 13/15) ;
-- 0017 absente (appliquée manuellement le 19/10/2026).
--
-- created_at de la ligne 0017 = valeur « when » de
-- db/migrations/meta/_journal.json (1792445318121) — PAS now() :
-- le migrator drizzle n'applique une migration que si son « when »
-- est POSTÉRIEUR au max(created_at) du journal ; now() ferait
-- sauter silencieusement toute migration générée avant la
-- réparation mais pas encore appliquée.
--
-- Retour arrière : scripts/d2-retour-arriere.sql (testé).
-- ============================================================

BEGIN;

-- 0) Sauvegarde de session du journal (retour arrière)
CREATE TABLE IF NOT EXISTS drizzle.__drizzle_migrations_sav_d2
  AS SELECT * FROM drizzle.__drizzle_migrations;

-- 1) Suppression des doublons (garde la PREMIÈRE occurrence de
--    chaque hash : les occurrences tardives ids 14 et 15)
DELETE FROM drizzle.__drizzle_migrations a
USING drizzle.__drizzle_migrations b
WHERE a.hash = b.hash AND a.id > b.id;

-- 2) Insertion de la 0017 avec son « when » canonique
INSERT INTO drizzle.__drizzle_migrations (hash, created_at)
VALUES ('ca61cd5efed10abc7def3a93e48652097a98de68adb678af6d4008ad96faad5f',
        1792445318121);

COMMIT;

-- 3) Vérification attendue : 18 lignes, 18 hash uniques,
--    max(created_at) = 1792445318121 (la 0017)
SELECT count(*) AS lignes, count(DISTINCT hash) AS hash_uniques,
       max(created_at) AS max_created_at
FROM drizzle.__drizzle_migrations;
