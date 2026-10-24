// ============================================================
// GBS — Layouts partagés des espaces staff (Serveuse, Gérant,
// Propriétaire) : coquille d'écran (en-tête + navigation basse),
// garde d'accès par rôle, bouton de déconnexion.
// ============================================================

import { useEffect, type ReactNode } from 'react'
import { LogOut } from 'lucide-react'
import { Chargement, Entete, GrosBouton, NavBasse, Vide } from '@/components/gbs'
import type { Onglet } from '@/components/gbs'
import { useEtablissementCourant, useI18n, useT } from '@/i18n'
import { naviguer } from '@/lib/router'
import { definirLangue, deconnexion, ecrireSession, organisationDe, rolesSur, terrasseDe, useDB, useDBPret, useSession, utilisateurDe } from '@/lib/store'
import type { RoleActif, SessionLocale, Terrasse, Utilisateur } from '@/lib/types'

/** Bouton de déconnexion (cercle, en-tête) — identique sur les 3 espaces.
 *  Révoque la session de cet appareil côté serveur (session glissante),
 *  puis coupe la session locale sans attendre la réponse. */
export function BoutonDeconnexion() {
  const [, setSession] = useSession()
  const t = useT()
  return (
    <button
      onClick={() => { void deconnexion(); setSession(null); naviguer('/') }}
      className="flex h-11 w-11 items-center justify-center rounded-full text-sable active:bg-white/10"
      aria-label={t('commun.deconnexion')}
    >
      <LogOut className="h-5 w-5" />
    </button>
  )
}

/**
 * Coquille d'un écran staff : conteneur mobile, en-tête collante
 * et navigation basse. Chaque onglet est rendu par l'enfant.
 */
export function CoquilleRole({ titre, sousTitre, onglets, actif, onChange, droite, children }: {
  titre: string
  sousTitre?: string
  onglets: Onglet[]
  actif: string
  onChange: (id: string) => void
  droite?: ReactNode
  children: ReactNode
}) {
  return (
    <div className="mx-auto min-h-dvh max-w-[430px] pb-24">
      <Entete titre={titre} sousTitre={sousTitre} droite={droite} />
      {children}
      <NavBasse actif={actif} onChange={onChange} onglets={onglets} />
    </div>
  )
}

/**
 * Garde d'accès d'un espace staff : attend le 1er snapshot, vérifie la
 * session locale et le rôle sur la terrasse, sinon écran « accès refusé ».
 * L'enfant reçoit { moi, terrasse, session } vérifiés.
 */
export function PorteRole({ rolesVoulus, indiceDemo, children }: {
  rolesVoulus: RoleActif[]
  indiceDemo: string // ex. « démo : Mama Njoki, PIN 2345 »
  children: (ctx: { moi: Utilisateur; terrasse: Terrasse; session: SessionLocale }) => ReactNode
}) {
  const db = useDB()
  const pret = useDBPret()
  const [session] = useSession()
  const t = useT()
  const { langue } = useI18n()

  const moi = utilisateurDe(db, session?.utilisateurId)
  const terrasse = session ? terrasseDe(db, session.terrasseId) : null
  // Vocabulaire de l'écran : table / chambre / comptoir selon le type d'établissement
  useEtablissementCourant(terrasse)

  // Boucle 5 : la langue choisie sur l'appareil est mémorisée sur
  // l'organisation — on ne pousse que si elle diffère de la base.
  useEffect(() => {
    if (!pret || !terrasse) return
    const org = organisationDe(db, terrasse.organisationId)
    if (org?.langue === langue) return
    definirLangue(terrasse.id, langue).catch(() => { /* silencieux : préférence seulement */ })
  }, [pret, terrasse, langue, db])

  if (!pret) return <Chargement />
  if (!session || !moi || !terrasse || !rolesVoulus.some((r) => rolesSur(db, moi.id, terrasse.id).includes(r))) {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center gap-4 px-6">
        <Vide
          icone={<LogOut className="h-8 w-8" />}
          titre={t('porte.acces_requis', { roles: rolesVoulus.map((r) => t(`role.${r.toLowerCase()}`)).join(t('porte.ou')) })}
          detail={t('porte.detail', { indice: indiceDemo })}
        />
        <GrosBouton petit onClick={() => { ecrireSession(null); naviguer('/connexion') }}>{t('porte.se_connecter')}</GrosBouton>
      </div>
    )
  }
  return <>{children({ moi, terrasse, session })}</>
}
