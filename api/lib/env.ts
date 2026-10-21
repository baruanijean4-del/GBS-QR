import "dotenv/config";
import { verifierConfigProduction } from "./configProduction";
import { verifierBaseLocale } from "./gardeLocale";

const isProd = process.env.NODE_ENV === "production";

function required(name: string): string {
  const value = process.env[name];
  if (!value && isProd) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value ?? "";
}

/** Annuaire démo (personas + PIN affichés sur la page de connexion,
 *  bouton « Réinitialiser la démo », insertion des fixtures au 1er accès).
 *  PRODUCTION DIRECTE ZÉRO DÉMO : INTERDIT en production (démarrage
 *  refusé — voir verifierConfigProduction) ; activé par défaut en
 *  développement/test. */
function annuaireDemoParDefaut(): boolean {
  const v = process.env.ANNUAIRE_DEMO;
  if (v !== undefined) return v === "true";
  return !isProd;
}

// Durcissement production (boucle 8 — exigence explicite) : ADMIN_PIN
// et SESSION_SECRET OBLIGATOIRES, annuaire démo INTERDIT — le serveur
// refuse de démarrer tant que ce n'est pas corrigé. Hors production,
// les défauts de développement restent disponibles.
if (isProd) {
  verifierConfigProduction({
    adminPin: process.env.ADMIN_PIN ?? "",
    sessionSecret: process.env.SESSION_SECRET ?? "",
    annuaireDemo: process.env.ANNUAIRE_DEMO ?? "",
    pinEncKey: process.env.PIN_ENC_KEY ?? "",
  });
}

// Clé de CHIFFREMENT des PIN (AES-256-GCM, 64 hex = 32 octets),
// distincte de SESSION_SECRET. En développement/test : clé fixe
// DOCUMENTÉE et non secrète — elle ne protège que des PIN de test.
const PIN_ENC_KEY_DEV = "00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff";

// Garde-fou copie locale : hors production et hors tests, une
// DATABASE_URL pointant vers neon.tech = démarrage refusé (la copie
// locale ne touche jamais une base cloud). Voir api/lib/gardeLocale.ts.
verifierBaseLocale(process.env.DATABASE_URL ?? "", {
  production: isProd,
  test: process.env.VITEST === "true" || process.env.NODE_ENV === "test",
  autoriseNeonHorsProd: process.env.GBS_NEON_HORS_PROD === "1",
});

export const env = {
  appId: required("APP_ID"),
  appSecret: required("APP_SECRET"),
  isProduction: isProd,
  databaseUrl: required("DATABASE_URL"),
  // PIN du super-admin plateforme. Choix produit assumé : stocké en
  // clair en base (jamais haché), obligatoire en production (8+ car.).
  adminPin: process.env.ADMIN_PIN ?? "2468",
  // Téléphone du compte super-admin (connexion unique téléphone + PIN)
  adminTelephone: process.env.ADMIN_TELEPHONE ?? "+243970000000",
  // Secret HMAC de signature des jetons de session. Obligatoire en
  // production (32+ car.) ; hors production, secret aléatoire au
  // démarrage (sessions invalidées à chaque redémarrage).
  sessionSecret: process.env.SESSION_SECRET ?? "",
  annuaireDemo: annuaireDemoParDefaut(),
  // DSN Sentry (backend). Vide = monitoring désactivé.
  sentryDsn: process.env.SENTRY_DSN ?? "",
  // Clé AES-256-GCM des PIN (voir api/lib/pin.ts). Obligatoire en
  // production (garde ci-dessus) ; hors production, clé de dev fixe.
  pinEncKey: process.env.PIN_ENC_KEY ?? PIN_ENC_KEY_DEV,
  // Session glissante (docs/SESSION-GLISSANTE.md) : expiration après
  // N secondes d'inactivité, plafonnée par une durée absolue maximale.
  // SESSION_GLISSANTE=0 revient au comportement fixe 12 h d'avant.
  sessionGlissante: process.env.SESSION_GLISSANTE !== "0" && process.env.SESSION_GLISSANTE !== "false",
  sessionInactiviteSecondes: parseInt(process.env.SESSION_INACTIVITE_SECONDES ?? "", 10) || 12 * 60 * 60,
  sessionDureeMaxSecondes: parseInt(process.env.SESSION_DUREE_MAX_SECONDES ?? "", 10) || 7 * 24 * 60 * 60,
};
