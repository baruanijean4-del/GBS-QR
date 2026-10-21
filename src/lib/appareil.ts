// ============================================================
// GBS — Identifiant stable de l'appareil (côté client)
//
// UUID généré une fois, conservé dans localStorage. Sert à :
// - la session glissante : chaque connexion attache cet identifiant
//   à la ligne sessions_appareils (révocation par appareil) ;
// - le journal d'erreurs : limite de débit côté serveur.
// Opaque : aucune donnée personnelle, jamais transmis hors API.
// ============================================================

const CLE_APPAREIL = 'gbs.appareil.id'

/** Identifiant opaque et stable de cet appareil (« inconnu » si stockage bloqué) */
export function idAppareil(): string {
  try {
    let id = localStorage.getItem(CLE_APPAREIL)
    if (!id) {
      id = crypto.randomUUID()
      localStorage.setItem(CLE_APPAREIL, id)
    }
    return id
  } catch {
    return 'inconnu'
  }
}
