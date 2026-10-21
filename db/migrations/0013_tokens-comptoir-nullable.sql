-- Billard — joueurs ajoutés au comptoir par le staff (sans session client).
-- Le schéma prévoit client_session_id NULLABLE (migration 0011), mais la
-- table « tokens » pré-existait avec NOT NULL : le CREATE TABLE IF NOT
-- EXISTS de 0011 était sans effet sur cette colonne. On lève la contrainte
-- pour aligner la base réelle sur le schéma.
ALTER TABLE "tokens" ALTER COLUMN "client_session_id" DROP NOT NULL;
