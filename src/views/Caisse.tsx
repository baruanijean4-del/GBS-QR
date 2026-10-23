// ============================================================
// GBS — Espace CAISSIER (route /c) : gestion de la caisse,
// des dépôts et des dépenses. Réservé au rôle CAISSIER.
// ============================================================

import { useT } from '@/i18n'
import { BoutonDeconnexion, CoquilleRole, PorteRole } from '@/components/Coquille'
import { BlocCaisse } from '@/components/Caisse'
import { FournisseurPortee, useSession } from '@/lib/store'
import type { Terrasse, Utilisateur } from '@/lib/types'
import { Wallet } from 'lucide-react'

export function VueCaisse() {
  const [session] = useSession()
  const portee = session ? { kind: 'staff' as const } : { kind: 'public' as const }
  return (
    <FournisseurPortee portee={portee}>
      <VueCaisseInterne />
    </FournisseurPortee>
  )
}

function VueCaisseInterne() {
  const t = useT()
  return (
    <PorteRole rolesVoulus={['CAISSIER']} indiceDemo={t('caisse.indice_demo')}>
      {({ moi, terrasse }) => <EspaceCaisse moi={moi} terrasse={terrasse} />}
    </PorteRole>
  )
}

function EspaceCaisse({ moi, terrasse }: { moi: Utilisateur; terrasse: Terrasse }) {
  const t = useT()
  return (
    <CoquilleRole
      titre={terrasse.nom}
      sousTitre={`${moi.nom} — ${t('role.caissier')}`}
      droite={<BoutonDeconnexion />}
      actif="caisse"
      onChange={() => undefined}
      onglets={[{ id: 'caisse', label: t('caisse.onglet'), icone: <Wallet className="h-6 w-6" /> }]}
    >
      <div className="px-4 pt-4">
        <BlocCaisse terrasseId={terrasse.id} />
      </div>
    </CoquilleRole>
  )
}