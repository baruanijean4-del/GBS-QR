-- 0020 — Chaîne de l argent : versement du gérant au propriétaire.
-- encaissements.versement_id : remise (versement) qui couvre ce cash une fois
-- remis au gérant. Le propriétaire la confirme EN PERSONNE (statut VERSE).
-- Rejouable (IF NOT EXISTS).
ALTER TABLE "encaissements" ADD COLUMN IF NOT EXISTS "versement_id" varchar(40);
