// ============================================================
// GBS — Garde-fou copie LOCALE (essai local avant production).
//
// Règle absolue du propriétaire : « Rien ne touche la base de
// production, jamais. » Une copie locale (Windows, PostgreSQL
// local ou Docker) ne doit JAMAIS démarrer avec une DATABASE_URL
// pointant vers Neon (base vivante ou branche cloud) — une URL
// copiée par mégarde suffirait à écrire en production depuis un
// poste de test.
//
// Fonction PURE (aucune entrée/sortie), appelée par api/lib/env.ts
// au chargement de la configuration. Le serveur local refuse de
// démarrer tant que DATABASE_URL vise *.neon.tech.
//
// Exemptions explicites :
//   - production (Render) : Neon est l'hébergement prévu ;
//   - tests automatisés (vitest) : ils ciblent leur branche dédiée ;
//   - GBS_NEON_HORS_PROD=1 : hatch documenté pour le sandbox / la CI
//     qui travaillent volontairement sur des BRANCHES Neon jetables.
//     Ne JAMAIS définir cette variable sur la copie locale Windows.
// ============================================================

export interface ContexteBaseLocale {
  production: boolean;
  test: boolean;
  autoriseNeonHorsProd: boolean;
}

/** Lance une erreur explicite si une base Neon est visée hors des cas permis. */
export function verifierBaseLocale(databaseUrl: string, c: ContexteBaseLocale): void {
  if (c.production || c.test || c.autoriseNeonHorsProd) return;
  if (databaseUrl.includes(".neon.tech")) {
    throw new Error(
      "LOCAL : DATABASE_URL pointe vers neon.tech — la copie locale ne doit JAMAIS " +
        "toucher une base cloud. Utilisez un PostgreSQL local (voir docs/ESSAI-LOCAL.md) " +
        "avec une URL du type postgres://postgres:...@localhost:5432/gbs_local. " +
        "Démarrage refusé.",
    );
  }
}
