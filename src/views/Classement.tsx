// ============================================================
// GBS — Classement des joueurs de billard (côté client)
// Affiche le top 10 des joueurs par série de victoires.
// ============================================================

import { Crown, Trophy } from 'lucide-react'
import { Carte, Chargement, Vide } from '@/components/gbs'
import { trpc } from '@/providers/trpc'
import { useDB } from '@/lib/store'

export function OngletClassement() {
  const db = useDB()
  const classement = trpc.billard.classementJoueurs.useQuery(
    { terrasseId: db.terrasses[0]?.id ?? '' },
    { enabled: !!db.terrasses[0]?.id },
  )

  if (classement.isLoading) {
    return <Chargement label="Chargement du classement..." />
  }

  if (!classement.data || classement.data.length === 0) {
    return (
      <Vide
        icone={<Trophy className="h-8 w-8" />}
        titre="Aucun joueur pour l'instant"
        detail="Les joueurs apparaîtront ici après leurs premières parties."
      />
    )
  }

  return (
    <div className="px-4 pt-4">
      <Carte>
        <p className="mb-3 flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-sable/50">
          <Trophy className="h-4 w-4" /> Classement des champions
        </p>
        <div className="flex flex-col gap-1.5">
          {classement.data.map((j) => (
            <div
              key={j.id}
              className="flex items-center gap-3 rounded-xl bg-white/4 px-3 py-2"
            >
              <span
                className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full font-mono text-sm font-bold ${
                  j.rang === 1 ? 'bg-ambre text-sur-ambre' : 'bg-white/8 text-sable'
                }`}
              >
                {j.rang}
              </span>
              <span className="font-semibold text-white">
                {j.prenom} <span className="text-xs text-sable/50">#{j.numero}</span>
              </span>
              {j.estChampion && <Crown className="h-4 w-4 text-ambre" />}
              <span className="ml-auto font-mono text-xs text-sable/50">
                {j.serie} victoire{j.serie > 1 ? 's' : ''}
              </span>
            </div>
          ))}
        </div>
      </Carte>
    </div>
  )
}