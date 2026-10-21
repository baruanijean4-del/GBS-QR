// ============================================================
// GBS — Session locale par appareil (côté client)
// Contient le jeton signé retourné par connexionPin : c'est
// l'unique preuve d'identité présentée au serveur (en-tête
// Authorization: Bearer). Le jeton expire après 12 h.
// ============================================================

import type { SessionLocale } from './types'

// v2 : les anciennes sessions (sans jeton) sont ignorées → reconnexion
const CLE_SESSION = 'gbs.session.v2'

export function lireSession(): SessionLocale | null {
  try {
    const brut = localStorage.getItem(CLE_SESSION)
    if (!brut) return null
    const s = JSON.parse(brut) as SessionLocale
    // Garde-fou : une session sans jeton ne peut rien faire → reconnexion
    if (!s.jeton || !s.utilisateurId) return null
    return s
  } catch {
    return null
  }
}

export function ecrireSessionBrute(s: SessionLocale | null) {
  if (s) localStorage.setItem(CLE_SESSION, JSON.stringify(s))
  else localStorage.removeItem(CLE_SESSION)
}

/** En-tête Authorization pour les appels API (vide si non connecté) */
export function enteteAuth(): Record<string, string> {
  const jeton = lireSession()?.jeton
  return jeton ? { authorization: `Bearer ${jeton}` } : {}
}

/** Remplace le jeton mémorisé par le jeton prolongé renvoyé par le
 *  serveur (session glissante, en-tête X-Session-Renouvelee). */
export function mettreAJourJeton(nouveauJeton: string) {
  const s = lireSession()
  if (s) ecrireSessionBrute({ ...s, jeton: nouveauJeton })
}
