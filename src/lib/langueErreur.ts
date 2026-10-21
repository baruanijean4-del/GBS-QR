// ============================================================
// GBS — Détection de langue AUTONOME pour l'écran d'erreur et
// le journal d'erreurs. Ne dépend volontairement d'aucun
// mécanisme i18n : l'écran de secours doit fonctionner même si
// le chargement des traductions est la cause du plantage.
// ============================================================

export type LangueErreur = 'fr' | 'en' | 'pt' | 'sw'

/** Langue de secours : choix mémorisé, sinon navigateur, sinon FR */
export function langueErreur(): LangueErreur {
  try {
    const choix = localStorage.getItem('gbs-lang')
    if (choix === 'fr' || choix === 'en' || choix === 'pt' || choix === 'sw') return choix
  } catch {
    // localStorage indisponible : on continue sur le navigateur
  }
  try {
    const nav = (navigator.language || '').slice(0, 2).toLowerCase()
    if (nav === 'en' || nav === 'pt' || nav === 'sw') return nav
  } catch {
    // navigateur exotique : repli français
  }
  return 'fr'
}
