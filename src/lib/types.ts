// ============================================================
// GBS — Types frontend : réexport des types partagés avec le
// serveur (source unique : contracts/) + session locale.
// ============================================================

export * from '@contracts/types'

// ---------- Session locale (qui est connecté, sur quelle terrasse) ----------
// Volontairement par appareil : chaque écran garde sa propre connexion.
export interface SessionLocale {
  utilisateurId: string
  terrasseId: string // terrasse active affichée
  /** Jeton signé (HMAC, 12 h) retourné par connexionPin — preuve d'identité */
  jeton: string
}
