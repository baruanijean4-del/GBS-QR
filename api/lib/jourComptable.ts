// ============================================================
// GBS — Jour comptable Africa/Lubumbashi (correctif 3)
//
// RÈGLE : les horodatages stockés restent en UTC — SEUL le
// découpage en « jours » (caisse du jour, export CSV, numérotation
// billard, rapport du jour, alerte fréquence de taux) suit le
// fuseau de Lubumbashi (UTC+2, sans heure d'été).
//
// Avant ce correctif, le « jour » était calculé en UTC
// (maintenant().slice(0, 10)) : les ventes de 00h00 à 02h00
// heure locale étaient comptées à la veille — un service de nuit
// se retrouvait sur deux jours comptables différents.
// ============================================================

const FORMATTEUR = new Intl.DateTimeFormat("fr", {
  timeZone: "Africa/Lubumbashi",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/**
 * Date du jour comptable (AAAA-MM-JJ) à Lubumbashi pour un instant
 * UTC donné (défaut : maintenant). Ex. : 2026-10-19T23:30:00Z
 * (= 01h30 locales le 20) → "2026-10-20".
 */
export function jourComptable(instantUtc: Date = new Date()): string {
  const p = Object.fromEntries(
    FORMATTEUR.formatToParts(instantUtc).map((x) => [x.type, x.value]),
  );
  return `${p.year}-${p.month}-${p.day}`;
}

/**
 * Plage UTC [début, fin[ correspondant à un jour LOCAL donné
 * (AAAA-MM-JJ). Minuit à Lubumbashi = 22:00 UTC la veille (UTC+2
 * fixe, pas d'heure d'été). À utiliser avec gte/lt sur les
 * horodatages UTC stockés — jamais de LIKE sur le préfixe.
 */
export function plageUtcDuJourLocal(jour: string): { debut: string; fin: string } {
  const debut = new Date(`${jour}T00:00:00+02:00`);
  const fin = new Date(debut.getTime() + 24 * 60 * 60 * 1000);
  return { debut: debut.toISOString(), fin: fin.toISOString() };
}
