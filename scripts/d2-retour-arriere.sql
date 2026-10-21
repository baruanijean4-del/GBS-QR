-- ============================================================
-- D2 — RETOUR ARRIÈRE (testé sur base jetable peuplée)
-- Restaure le journal EXACTEMENT comme avant l'assainissement
-- (ids, hash, created_at, séquence) depuis la sauvegarde créée
-- par scripts/d2-assainissement-journal.sql.
-- ============================================================

BEGIN;

TRUNCATE drizzle.__drizzle_migrations;

INSERT INTO drizzle.__drizzle_migrations (id, hash, created_at)
  SELECT id, hash, created_at FROM drizzle.__drizzle_migrations_sav_d2;

-- Réaligne la séquence sur le max(id) restauré
SELECT setval('drizzle.__drizzle_migrations_id_seq',
  (SELECT max(id) FROM drizzle.__drizzle_migrations));

COMMIT;

-- Vérification attendue : retour à l'état d'avant (19 lignes en
-- production, avec les 2 doublons et sans la 0017)
SELECT count(*) AS lignes, count(DISTINCT hash) AS hash_uniques
FROM drizzle.__drizzle_migrations;

-- Après validation visuelle, la table de sauvegarde peut être
-- supprimée : DROP TABLE drizzle.__drizzle_migrations_sav_d2;
