// ============================================================
// GBS — Supervision des erreurs (Sentry, backend)
//
// Activé uniquement si SENTRY_DSN est défini. Hygiène stricte :
// - seules les erreurs serveur (5xx / INTERNAL) sont envoyées —
//   un 401/403 ou un refus métier (BAD_REQUEST) n'est pas un bug ;
// - jamais de jeton ni de PIN dans un rapport (en-têtes et corps
//   nettoyés dans beforeSend).
// ============================================================

import * as Sentry from "@sentry/node";
import { env } from "./env";

let actif = false;

/** Champs qui ne doivent JAMAIS quitter le serveur */
const CLES_SENSIBLES = ["pin", "jeton", "token", "authorization", "session", "password"];

/** Nettoie récursivement un objet des champs sensibles (copie) */
function epurer(valeur: unknown): unknown {
  if (Array.isArray(valeur)) return valeur.map(epurer);
  if (valeur && typeof valeur === "object") {
    const sortie: Record<string, unknown> = {};
    for (const [cle, v] of Object.entries(valeur)) {
      sortie[cle] = CLES_SENSIBLES.some((s) => cle.toLowerCase().includes(s)) ? "[filtré]" : epurer(v);
    }
    return sortie;
  }
  return valeur;
}

/** À appeler au tout début du démarrage (avant le serveur HTTP). */
export function initMonitoring(): void {
  if (!env.sentryDsn) return;
  Sentry.init({
    dsn: env.sentryDsn,
    environment: env.isProduction ? "production" : "development",
    // 10 % des transactions suffisent pour la perf ; 100 % des erreurs.
    tracesSampleRate: 0.1,
    beforeSend(evenement) {
      if (evenement.request) {
        delete evenement.request.headers; // Authorization, cookies…
        if (evenement.request.data) {
          evenement.request.data = epurer(evenement.request.data) as typeof evenement.request.data;
        }
      }
      return evenement;
    },
  });
  actif = true;
  console.log("Supervision Sentry activée.");
}

/** Capture une exception serveur (no-op si Sentry n'est pas configuré). */
export function capturerErreur(e: unknown): void {
  if (actif) Sentry.captureException(e);
}
