// ============================================================
// GBS — Coordonnées de contact officielles (support commercial).
// Module utilitaire partagé (aucune logique React) : l'exporter
// depuis une vue déclencherait la règle fast-refresh d'ESLint.
// ============================================================

/** Numéro WhatsApp support, format international pour les liens wa.me. */
export const WA_NUMERO = '243815486276'

/** Numéro affiché à l'écran (format lisible congolais). */
export const WA_AFFICHE = '+243 81 548 62 76'

/** Adresse e-mail de contact. */
export const COURRIEL = 'henrkihiutila@gbs.com'

/** Lien WhatsApp pré-rempli (message traduit par l'appelant). */
export function lienWhatsApp(message: string): string {
  return `https://wa.me/${WA_NUMERO}?text=${encodeURIComponent(message)}`
}
