// ============================================================
// GBS — Bandeaux d'état globaux (Phase B.5 et B.7)
//
// - BandeauMaj : « Une nouvelle version est prête. [Mettre à
//   jour] » — le rechargement n'arrive qu'au clic, JAMAIS sans
//   prévenir (contrairement à l'ancien skipWaiting automatique).
// - BanniereHorsLigne : distingue visuellement « hors-ligne »
//   (bannière discrète, l'app reste utilisable) d'« erreur »
//   (écran de secours des boundaries).
// ============================================================

import { useEffect, useState } from 'react'
import { CloudOff, RefreshCw, X } from 'lucide-react'
import { EVENEMENT_MAJ, appliquerMiseAJour } from '@/lib/pwa'
import { useT } from '@/i18n'

/** Bandeau de mise à jour : affiché quand le SW signale une version prête */
export function BandeauMaj() {
  const t = useT()
  const [prete, setPrete] = useState(false)
  const [application, setApplication] = useState(false)

  useEffect(() => {
    const surPrete = () => setPrete(true)
    window.addEventListener(EVENEMENT_MAJ, surPrete)
    return () => window.removeEventListener(EVENEMENT_MAJ, surPrete)
  }, [])

  if (!prete) return null

  return (
    <div
      role="status"
      className="fixed inset-x-0 bottom-0 z-50 flex items-center justify-between gap-3 border-t border-ambre/30 bg-surface px-4 py-3 shadow-lg"
    >
      <p className="text-base font-semibold text-white">{t('bandeau.maj_prete')}</p>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => setPrete(false)}
          className="flex min-h-12 items-center gap-1 rounded-xl px-3 text-base text-sable/70 active:bg-white/10"
          aria-label={t('bandeau.maj_plus_tard')}
        >
          <X className="h-4 w-4" aria-hidden />
          {t('bandeau.maj_plus_tard')}
        </button>
        <button
          type="button"
          disabled={application}
          onClick={() => {
            if (application) return
            setApplication(true)
            void appliquerMiseAJour()
          }}
          className="flex min-h-12 items-center gap-2 rounded-xl bg-ambre px-4 text-base font-bold text-sur-ambre active:bg-ambre-actif disabled:opacity-60"
        >
          <RefreshCw className={`h-4 w-4 ${application ? 'animate-spin' : ''}`} aria-hidden />
          {t('bandeau.maj_bouton')}
        </button>
      </div>
    </div>
  )
}

/** Bannière hors-ligne : discrète, l'app reste utilisable (≠ écran d'erreur) */
export function BanniereHorsLigne() {
  const t = useT()
  const [enLigne, setEnLigne] = useState(() =>
    typeof navigator === 'undefined' ? true : navigator.onLine,
  )

  useEffect(() => {
    const enMarche = () => setEnLigne(true)
    const enPanne = () => setEnLigne(false)
    window.addEventListener('online', enMarche)
    window.addEventListener('offline', enPanne)
    return () => {
      window.removeEventListener('online', enMarche)
      window.removeEventListener('offline', enPanne)
    }
  }, [])

  if (enLigne) return null

  return (
    <div
      role="status"
      className="fixed inset-x-0 top-0 z-50 flex items-center justify-center gap-2 border-b border-white/10 bg-surface px-4 py-2.5"
    >
      <CloudOff className="h-4 w-4 text-ambre" aria-hidden />
      <p className="text-sm font-semibold text-sable">
        {t('bandeau.hors_ligne')}
      </p>
    </div>
  )
}
