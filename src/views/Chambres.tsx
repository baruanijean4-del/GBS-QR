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

export function OngletChambres({ token, clientSessionId, terrasseId }: { token: string; clientSessionId: string; terrasseId: string }) {
  const [enCours, setEnCours] = useState<string | null>(null)

  // On récupère les chambres libres depuis l'API
  const { data: chambres, isLoading } = trpc.hotel.voirChambresPubliques.useQuery({ terrasseId })

  const prendre = async (chambreId: string) => {
    setEnCours(chambreId)
    try {
            const mutation = trpc.hotel.prendreChambreDepuisTerrasse.useMutation()
      await mutation.mutateAsync({
        token,
        clientSessionId,
        chambreId,
        mode: 'NUIT',
      })
      toast.success('Chambre ajoutée à votre note !')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Erreur lors de la prise de chambre.')
    } finally {
      setEnCours(null)
    }
  }

  if (isLoading) return <Chargement label="Chargement des chambres..." />

  const libres = chambres ?? []

  if (libres.length === 0) {
    return (
      <Vide
        icone={<BedDouble className="h-8 w-8" />}
        titre="Aucune chambre disponible"
        detail="Toutes les chambres sont occupées. Revenez plus tard."
      />
    )
  }

  return (
    <div className="px-4 pt-4">
      <p className="mb-4 text-sm text-sable/70">
        Prenez une chambre directement depuis votre téléphone. Elle sera ajoutée à votre note.
      </p>
      <div className="flex flex-col gap-3">
        {libres.map((c) => (
          <Carte key={c.id}>
            <div className="flex items-center justify-between">
              <div>
                <p className="font-bold text-white">Chambre {c.numero}</p>
                <p className="text-sm text-sable/60">{c.type}</p>
              </div>
              <p className="text-lg font-bold text-ambre">{fmtCDF(c.prixNuitCdf)}</p>
            </div>
            <div className="mt-3">
              <GrosBouton
                onClick={() => void prendre(c.id)}
                desactive={enCours === c.id}
              >
                {enCours === c.id ? 'Ajout en cours...' : <><CheckCircle2 className="h-5 w-5" /> Prendre cette chambre</>}
              </GrosBouton>
            </div>
          </Carte>
        ))}
      </div>
    </div>
  )
}