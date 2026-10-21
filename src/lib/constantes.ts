// ============================================================
// GBS — Clés de stockage partagées entre vues.
// Séparées des vues pour ne pas casser le chargement paresseux
// (boucle 7) : importer une constante ne doit jamais tirer tout
// un écran dans le bundle initial.
// ============================================================

/** Clé sessionStorage du PIN administrateur saisi (accueil ↔ /admin). */
export const CLE_PIN_ADMIN = 'gbs.admin.pin'
