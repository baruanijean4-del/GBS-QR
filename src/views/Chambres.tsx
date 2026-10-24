// ============================================================
// GBS — Onglet "Chambres" côté Client : liste les chambres
// libres et permet d'en prendre une (ajout à la note unifiée).
// ============================================================

import { useState } from 'react'
import { BedDouble, CheckCircle2 } from 'lucide-react'
import { toast } from 'sonner'
import { Carte, Chargement, GrosBouton, Vide } from '@/components/gbs'
import { fmtCDF } from '@/lib/format'
import { trpc } from '@/providers/trpc'
import { useT } from '@/i18n'

export function OngletChambres({ token, clientSessionId, terrasseId }: { token: string; clientSessionId: string; terrasseId: string }) {
  const t = useT()
  const [enCours, setEnCours] = useState<string | null>(null)

  // On récupère les chambres libres depuis l'API
  const { data: chambres, isLoading } = trpc.hotel.voirChambresPubliques.useQuery({ terrasseId })
  
  // Le hook useMutation DOIT être appelé au début du composant (pas dans une fonction)
  const mutation = trpc.hotel.prendreChambreDepuisTerrasse.useMutation()

  const prendre = async (chambreId: string) => {
    setEnCours(chambreId)
    try {
      await mutation.mutateAsync({
        token,
        clientSessionId,
        chambreId,
        mode: 'NUIT',
      })
      toast.success(t('chambres.ajoutee'))
      // On force le rechargement pour que la note se mette à jour
      window.location.reload()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t('chambres.erreur_prise'))
    } finally {
      setEnCours(null)
    }
  }

  if (isLoading) return <Chargement label={t('chambres.chargement')} />

  const libres = chambres ?? []

  if (libres.length === 0) {
    return (
      <Vide
        icone={<BedDouble className="h-8 w-8" />}
        titre={t('chambres.aucune')}
        detail={t('chambres.aucune_d')}
      />
    )
  }

  return (
    <div className="px-4 pt-4">
      <p className="mb-4 text-sm text-sable/70">
        {t('chambres.intro')}
      </p>
      <div className="flex flex-col gap-3">
        {libres.map((c) => (
          <Carte key={c.id}>
            {c.photoUrl && (
              <img src={c.photoUrl} alt={t('hotel.chambre_n', { n: c.numero })} className="mb-3 w-full rounded-xl object-cover" style={{ height: 160 }} />
            )}
            <div className="flex items-center justify-between">
              <div>
                <p className="font-bold text-white">{t('hotel.chambre_n', { n: c.numero })}</p>
                <p className="text-sm text-sable/60">{c.type}</p>
              </div>
              <p className="text-lg font-bold text-ambre">{fmtCDF(c.prixNuitCdf)}</p>
            </div>
            <div className="mt-3">
              <GrosBouton
                onClick={() => void prendre(c.id)}
                desactive={enCours === c.id}
              >
                {enCours === c.id ? t('chambres.ajout_en_cours') : <><CheckCircle2 className="h-5 w-5" /> {t('chambres.prendre')}</>}
              </GrosBouton>
            </div>
          </Carte>
        ))}
      </div>
    </div>
  )
}