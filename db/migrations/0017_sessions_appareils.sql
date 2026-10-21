-- ============================================================
-- Migration 0017 : sessions par appareil (session glissante)
-- (docs/SESSION-GLISSANTE.md — appliquée avec les valeurs
-- documentées : inactivité 12 h, durée absolue 7 jours)
--
-- Chaque connexion crée une ligne : le jeton signé porte « sid »
-- (identifiant de cette ligne). La vérification lit la ligne :
-- refus si révoquée ou si la durée absolue est dépassée ;
-- l'activité glisse l'expiration (plafonnée à l'absolu).
-- REJOUABLE : IF NOT EXISTS partout.
-- ============================================================
CREATE TABLE IF NOT EXISTS "sessions_appareils" (
  "id" varchar(40) PRIMARY KEY,
  "utilisateur_id" varchar(40) NOT NULL,
  "appareil_id" varchar(60) NOT NULL,
  "cree_le" varchar(30) NOT NULL,
  "derniere_activite_le" varchar(30) NOT NULL,
  "expire_absolu_le" varchar(30) NOT NULL,
  "revoque_le" varchar(30)
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_sessapp_util" ON "sessions_appareils" ("utilisateur_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_sessapp_appareil" ON "sessions_appareils" ("appareil_id");
