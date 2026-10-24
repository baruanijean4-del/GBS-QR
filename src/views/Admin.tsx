// ============================================================
// GBS — Super-admin plateforme (hors organisations) :
// validation des paiements mobile money, MRR, abonnés, tarifs.
// ============================================================

import { useEffect, useState } from 'react'
import { BadgeDollarSign, Bug, CircleCheck, CircleX, CreditCard, Eye, FileDown, KeyRound, LockKeyhole, LogOut, MapPin, Package, RefreshCw, Store, TrendingUp, Trophy, UsersRound } from 'lucide-react'
import { toast } from 'sonner'
import { Carte, Chargement, Entete, Feuille, GrosBouton, Money, Pill, SaisieNombre, Vide, classeSaisie } from '@/components/gbs'
import { BlocBoundary } from '@/components/ErrorBoundary'
import { dateCourte, dateHeure, fmtUSD, joursRestants } from '@/lib/format'
import { telechargerRapportConsommation } from '@/lib/rapportPdf'
import { naviguer } from '@/lib/router'
import { PLANS, nbTablesActives } from '@/lib/pricing'
import { useI18n, useT, vocabulaireDe } from '@/i18n'
import { trpc } from '@/providers/trpc'
import {
  FournisseurPortee, modifierTarif, mrrPlateforme, produitPhare, terrasseDe, useDB, useDBPret,
  utilisateurDe, validerPaiement, ventesDuJour, verifierPinAdmin,
} from '@/lib/store'
import type { PlanCode, Portee, Tranche } from '@/lib/types'
import { CLE_PIN_ADMIN } from '@/lib/constantes'
import { PhotosAdmin, useNbDemandesPhoto } from './PhotosAdmin'

export function VueAdmin() {
  const [pin, setPin] = useState(() => sessionStorage.getItem(CLE_PIN_ADMIN) ?? '')
  if (!pin) return <PorteAdmin surPin={(p) => { sessionStorage.setItem(CLE_PIN_ADMIN, p); setPin(p) }} />
  const portee: Portee = { kind: 'admin', pin }
  return (
    <FournisseurPortee portee={portee}>
      <VueAdminInterne pin={pin} />
    </FournisseurPortee>
  )
}

/** Porte d'entrée super-admin : le PIN est vérifié côté serveur */
function PorteAdmin({ surPin }: { surPin: (pin: string) => void }) {
  const t = useT()
  const [pin, setPin] = useState('')
  const [chargement, setChargement] = useState(false)
  const entrer = async () => {
    if (chargement) return
    setChargement(true)
    try {
      if (await verifierPinAdmin(pin)) surPin(pin)
      else { toast.error(t('admin.pin_incorrect')); setPin('') }
    } catch { toast.error(t('admin.serveur_injoignable')) } finally { setChargement(false) }
  }
  return (
    <div className="mx-auto flex min-h-dvh max-w-[430px] flex-col items-center justify-center gap-4 px-6">
      <LockKeyhole className="h-10 w-10 text-ambre" />
      <p className="text-center font-bold text-white">{t('admin.titre_porte')}</p>
      <p className="-mt-2 text-center text-sm text-sable/60">{t('admin.porte_detail')}</p>
      <input
        className={`${classeSaisie} text-center font-mono tracking-[0.5em]`}
        type="password" inputMode="numeric" value={pin} placeholder="••••"
        onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 8))}
        onKeyDown={(e) => { if (e.key === 'Enter') void entrer() }}
      />
      <GrosBouton onClick={() => void entrer()}>{chargement ? t('admin.verification') : t('admin.entrer')}</GrosBouton>
      <GrosBouton ton="fantome" petit onClick={() => naviguer('/')}>{t('commun.retour')}</GrosBouton>
    </div>
  )
}

function VueAdminInterne({ pin }: { pin: string }) {
  const t = useT()
  const db = useDB()
  const pret = useDBPret()
  const [onglet, setOnglet] = useState<'paiements' | 'photos' | 'terrasses' | 'abonnes' | 'tarifs' | 'erreurs' | 'pin'>('paiements')
  const nbDemandesPhoto = useNbDemandesPhoto(pin)
  const [delai, setDelai] = useState(false)
  const [pdfEnCours, setPdfEnCours] = useState(false)
  useEffect(() => {
    const t = setTimeout(() => setDelai(true), 10000)
    return () => clearTimeout(t)
  }, [])

  if (!pret) {
    // PIN devenu invalide (changement côté serveur) : on efface et on revient à la porte
    if (delai) {
      sessionStorage.removeItem(CLE_PIN_ADMIN)
      return (
        <div className="mx-auto flex min-h-dvh max-w-[430px] flex-col items-center justify-center gap-4 px-6">
          <Vide icone={<LockKeyhole className="h-8 w-8" />} titre={t('admin.pin_refuse')} detail={t('admin.pin_refuse_d')} />
          <GrosBouton petit onClick={() => window.location.reload()}>{t('admin.revenir_porte')}</GrosBouton>
        </div>
      )
    }
    return <Chargement label={t('admin.chargement')} />
  }

  const enAttente = db.paiements.filter((p) => p.statut === 'EN_ATTENTE')
  const mrr = mrrPlateforme(db)
  const actifs = db.abonnements.filter((a) => a.statut === 'ACTIF').length
  const essais = db.abonnements.filter((a) => a.statut === 'ESSAI').length
  const impayes = db.abonnements.filter((a) => a.statut === 'EN_GRACE' || a.statut === 'LECTURE_SEULE' || a.statut === 'SUSPENDU').length

  return (
    <div className="mx-auto min-h-dvh max-w-[430px] pb-10">
      <Entete
        titre={t('admin.titre')}
        sousTitre={t('admin.sous_titre')}
        droite={
          <button onClick={() => naviguer('/')} className="flex h-11 w-11 items-center justify-center rounded-full text-sable active:bg-white/10" aria-label={t('admin.quitter')}>
            <LogOut className="h-5 w-5" />
          </button>
        }
      />

      {/* KPIs */}
      <div className="grid grid-cols-4 gap-2 px-4 pt-4">
        <Carte classe="!p-3 text-center">
          <TrendingUp className="mx-auto h-4 w-4 text-ambre" />
          <p className="mt-1 font-mono text-lg font-bold text-white">{fmtUSD(mrr)}</p>
          <p className="text-[10px] uppercase text-sable/50">{t('admin.mrr')}</p>
        </Carte>
        <Carte classe="!p-3 text-center">
          <CreditCard className="mx-auto h-4 w-4 text-succes-clair" />
          <p className="mt-1 font-mono text-lg font-bold text-white">{actifs}</p>
          <p className="text-[10px] uppercase text-sable/50">{t('admin.actifs')}</p>
        </Carte>
        <Carte classe="!p-3 text-center">
          <UsersRound className="mx-auto h-4 w-4 text-info-clair" />
          <p className="mt-1 font-mono text-lg font-bold text-white">{essais}</p>
          <p className="text-[10px] uppercase text-sable/50">{t('admin.essais')}</p>
        </Carte>
        <Carte classe="!p-3 text-center">
          <CircleX className="mx-auto h-4 w-4 text-danger-clair" />
          <p className="mt-1 font-mono text-lg font-bold text-white">{impayes}</p>
          <p className="text-[10px] uppercase text-sable/50">{t('admin.impayes')}</p>
        </Carte>
      </div>

      {/* Rapport PDF : consommation générale de la plateforme
          (top 10 produits, catégories, zones qui achètent le plus) */}
      <div className="px-4 pt-3">
        <GrosBouton
          ton="secondaire"
          charge={pdfEnCours}
          onClick={async () => {
            if (pdfEnCours) return
            setPdfEnCours(true)
            try {
              await telechargerRapportConsommation(db)
              toast.success(t('admin.pdf_toast'))
            } catch (e) {
              toast.error(e instanceof Error ? e.message : t('admin.pdf_erreur'))
            } finally {
              setPdfEnCours(false)
            }
          }}
        >
          <FileDown className="h-5 w-5" /> {t('admin.pdf_bouton')}
        </GrosBouton>
      </div>

      <div className="mt-4 flex flex-wrap gap-2 px-4">
        {([['paiements', t('admin.onglet_paiements', { n: enAttente.length })], ['photos', t('admin.onglet_photos', { n: nbDemandesPhoto })], ['terrasses', t('admin.onglet_terrasses')], ['abonnes', t('admin.onglet_abonnes')], ['tarifs', t('admin.onglet_tarifs')], ['erreurs', t('admin.onglet_erreurs')], ['pin', t('admin.onglet_pin')]] as const).map(([id, label]) => (
          <button
            key={id}
            onClick={() => setOnglet(id)}
            className={`flex-1 rounded-2xl py-2.5 text-sm font-bold ${onglet === id ? 'bg-ambre text-sur-ambre' : 'bg-white/8 text-sable'}`}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="mt-4 px-4">
        {/* Chaque panneau est un bloc protégé : une liste qui plante
            n'emporte ni la page admin ni les autres onglets */}
        {onglet === 'paiements' && <BlocBoundary><PaiementsAdmin pin={pin} /></BlocBoundary>}
        {onglet === 'photos' && <BlocBoundary><PhotosAdmin pin={pin} /></BlocBoundary>}
        {onglet === 'terrasses' && <BlocBoundary><TerrassesAdmin /></BlocBoundary>}
        {onglet === 'abonnes' && <BlocBoundary><AbonnesAdmin /></BlocBoundary>}
        {onglet === 'tarifs' && <BlocBoundary><TarifsAdmin pin={pin} /></BlocBoundary>}
        {onglet === 'erreurs' && <BlocBoundary><ErreursAdmin pin={pin} /></BlocBoundary>}
        {onglet === 'pin' && <BlocBoundary><PinOublieAdmin pin={pin} /></BlocBoundary>}
      </div>
    </div>
  )
}

function PaiementsAdmin({ pin }: { pin: string }) {
  const t = useT()
  const db = useDB()
  const enAttente = db.paiements.filter((p) => p.statut === 'EN_ATTENTE')
  const traites = db.paiements.filter((p) => p.statut !== 'EN_ATTENTE').slice(0, 8)

  if (enAttente.length === 0 && traites.length === 0) {
    return <Vide icone={<BadgeDollarSign className="h-8 w-8" />} titre={t('admin.aucun_paiement')} detail={t('admin.aucun_paiement_d')} />
  }

  return (
    <div className="flex flex-col gap-3">
      {enAttente.map((p) => {
        const te = terrasseDe(db, p.terrasseId)
        const soumisPar = utilisateurDe(db, p.soumisPar)
        return (
          <Carte key={p.id} classe="border-ambre/40">
            <div className="mb-2 flex items-center justify-between">
              <p className="font-bold text-white">{te?.nom}</p>
              <Pill ton="ambre">{t('admin.a_verifier')}</Pill>
            </div>
            <div className="mb-3 rounded-xl bg-white/5 p-3 text-sm">
              <p className="text-white"><span className="text-sable/50">{t('admin.montant')}</span> <b className="font-mono">{fmtUSD(p.montantUsdCentimes)}</b></p>
              <p className="text-white"><span className="text-sable/50">{t('admin.methode')}</span> {p.methode.replace('_', ' ')}</p>
              <p className="text-white"><span className="text-sable/50">{t('admin.reference')}</span> <span className="font-mono">{p.reference}</span></p>
              <p className="text-white"><span className="text-sable/50">{t('admin.soumis_par')}</span> {soumisPar?.nom} · {dateHeure(p.creeLe)}</p>
            </div>
            <div className="flex gap-2">
              <GrosBouton petit ton="danger" onClick={async () => { try { await validerPaiement(p.id, 'REJETE', pin); toast.success(t('admin.paiement_rejete')) } catch (e) { toast.error(e instanceof Error ? e.message : t('commun.erreur')) } }}>
                <CircleX className="h-4 w-4" /> {t('admin.rejeter')}
              </GrosBouton>
              <GrosBouton petit onClick={async () => { try { await validerPaiement(p.id, 'VALIDE', pin); toast.success(t('admin.paiement_valide')) } catch (e) { toast.error(e instanceof Error ? e.message : t('commun.erreur')) } }}>
                <CircleCheck className="h-4 w-4" /> {t('gerant.valider')}
              </GrosBouton>
            </div>
          </Carte>
        )
      })}
      {traites.length > 0 && <p className="mt-2 text-xs font-bold uppercase tracking-widest text-sable/50">{t('admin.traites')}</p>}
      {traites.map((p) => (
        <div key={p.id} className="flex items-center justify-between rounded-2xl border border-white/8 bg-surface/60 px-4 py-3">
          <div>
            <p className="font-semibold text-white">{terrasseDe(db, p.terrasseId)?.nom} — {fmtUSD(p.montantUsdCentimes)}</p>
            <p className="text-xs text-sable/50">{p.reference} · {dateHeure(p.creeLe)}</p>
          </div>
          <Pill ton={p.statut === 'VALIDE' ? 'vert' : 'rouge'}>{p.statut === 'VALIDE' ? t('paiement.statut_valide') : t('paiement.statut_rejete')}</Pill>
        </div>
      ))}
    </div>
  )
}

// ---------- Journal des erreurs client (Phase B.6) ----------

/** Erreurs des apps groupées par message : « qu'est-ce qui casse en prod ? » */
function ErreursAdmin({ pin }: { pin: string }) {
  const t = useT()
  const requete = trpc.gbs.erreursClient.useQuery({ pin }, { retry: false })

  if (requete.isPending) return <Chargement label={t('admin.chargement_erreurs')} />
  if (requete.error) {
    return <Vide icone={<Bug className="h-8 w-8" />} titre={t('admin.journal_indispo')} detail={t('admin.journal_indispo_d')} />
  }
  const groupes = requete.data
  if (groupes.length === 0) {
    return <Vide icone={<CircleCheck className="h-8 w-8" />} titre={t('admin.aucune_erreur')} detail={t('admin.aucune_erreur_d')} />
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <p className="text-sm text-sable/70">{t(groupes.length > 1 ? 'admin.familles_pl' : 'admin.familles_une', { n: groupes.length })}</p>
        <button
          type="button"
          onClick={() => void requete.refetch()}
          className="flex min-h-11 items-center gap-1.5 rounded-xl border border-white/15 px-3 text-sm font-semibold text-sable active:bg-white/10"
        >
          <RefreshCw className="h-4 w-4" /> {t('admin.actualiser')}
        </button>
      </div>
      {groupes.map((g) => (
        <Carte key={`${g.codeCourt}-${g.message.slice(0, 40)}`}>
          <div className="mb-1.5 flex items-start justify-between gap-2">
            <p className="min-w-0 flex-1 break-words font-mono text-xs text-white">{g.message}</p>
            <Pill ton="rouge">×{g.total}</Pill>
          </div>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-sable/60">
            <span className="rounded-md bg-white/8 px-1.5 py-0.5 font-mono font-bold text-ambre">{g.codeCourt}</span>
            <span>{t('admin.derniere', { date: dateHeure(g.dernierLe) })}</span>
            {g.routes.length > 0 && <span>{t('admin.route', { routes: g.routes.join(', ') })}</span>}
            {g.versions.length > 0 && <span title={g.versions.join(', ')}>{t('admin.version', { versions: `${g.versions[0]}${g.versions.length > 1 ? ` +${g.versions.length - 1}` : ''}` })}</span>}
            {g.langues.length > 0 && <span>{t('admin.langue', { langues: g.langues.join(', ') })}</span>}
          </div>
        </Carte>
      ))}
    </div>
  )
}

// ---------- « Mot de passe oublié » (révélation encadrée) ----------

type CompteTrouve = { id: string; nom: string; telephone: string; pinMasque: string; lisible: boolean }
type MethodeVerification = 'APPEL' | 'WHATSAPP' | 'PRESENTIEL'

function PinOublieAdmin({ pin }: { pin: string }) {
  const t = useT()
  const [telephone, setTelephone] = useState('')
  const [resultats, setResultats] = useState<CompteTrouve[] | null>(null)
  const [methode, setMethode] = useState<MethodeVerification | ''>('')
  const [revele, setRevele] = useState<{ pin: string; reste: number } | null>(null)
  const recherche = trpc.gbs.rechercherCompte.useMutation({
    onError: (e) => toast.error(e.message),
  })
  const revelation = trpc.gbs.revelerPin.useMutation({
    onError: (e) => toast.error(e.message),
  })
  const reinitialisation = trpc.gbs.reinitialiserPin.useMutation({
    onError: (e) => toast.error(e.message),
  })

  // Compte à rebours : le PIN affiché s'efface tout seul après 30 s
  // (toutes les mises à jour d'état ont lieu dans le rappel du minuteur,
  //  jamais dans le corps de l'effet — règle react-hooks/set-state-in-effect)
  useEffect(() => {
    if (!revele) return
    const minuteur = setTimeout(() => {
      setRevele((r) => {
        if (!r || r.reste <= 1) return null
        return { ...r, reste: r.reste - 1 }
      })
    }, 1000)
    return () => clearTimeout(minuteur)
  }, [revele])

  return (
    <div className="flex flex-col gap-3">
      <Carte>
        <p className="text-sm font-bold text-white">{t('admin.pin_titre')}</p>
        <p className="mt-1 text-xs text-sable/60">{t('admin.pin_intro')}</p>
        <input
          value={telephone}
          onChange={(e) => setTelephone(e.target.value)}
          inputMode="tel"
          placeholder={t('admin.pin_placeholder')}
          className={`mt-3 ${classeSaisie}`}
        />
        <GrosBouton
          petit
          charge={recherche.isPending}
          onClick={async () => {
            setRevele(null)
            const r = await recherche.mutateAsync({ pinAdmin: pin, telephone })
            setResultats(r)
          }}
        >
          {t('admin.pin_rechercher')}
        </GrosBouton>
      </Carte>

      {resultats !== null && resultats.length === 0 && (
        <Vide icone={<UsersRound className="h-8 w-8" />} titre={t('admin.pin_aucun')} detail={t('admin.pin_aucun_d')} />
      )}

      {resultats?.map((c) => (
        <Carte key={c.id}>
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0">
              <p className="truncate font-bold text-white">{c.nom}</p>
              <p className="font-mono text-xs text-sable/60">{c.telephone}</p>
            </div>
            <Pill ton={c.lisible ? 'vert' : 'rouge'}>{c.lisible ? t('admin.pin_lisible') : t('admin.pin_illisible')}</Pill>
          </div>
          <div className="mt-3 flex items-center justify-between rounded-xl bg-white/5 px-3 py-2.5">
            <span className="font-mono text-lg tracking-widest text-white">
              {revele ? revele.pin : c.pinMasque}
            </span>
            {revele && <span className="font-mono text-xs text-ambre">{revele.reste}s</span>}
          </div>
          {c.lisible && !revele && (
            <>
              <div className="mt-3 flex gap-2">
                {(['APPEL', 'WHATSAPP', 'PRESENTIEL'] as const).map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => setMethode(m)}
                    className={`flex-1 rounded-xl py-2 text-xs font-bold ${methode === m ? 'bg-ambre text-sur-ambre' : 'bg-white/8 text-sable'}`}
                  >
                    {t(`admin.pin_methode_${m.toLowerCase()}`)}
                  </button>
                ))}
              </div>
              <GrosBouton
                petit
                ton="secondaire"
                desactive={!methode}
                charge={revelation.isPending}
                onClick={async () => {
                  if (!methode) return
                  const r = await revelation.mutateAsync({ pinAdmin: pin, utilisateurId: c.id, methodeVerification: methode })
                  setRevele({ pin: r.pin, reste: r.dureeAffichageSecondes })
                }}
              >
                <Eye className="h-4 w-4" /> {t('admin.pin_afficher')}
              </GrosBouton>
            </>
          )}
          {!c.lisible && !revele && (
            <>
              <p className="mt-2 text-xs text-danger-clair">{t('admin.pin_illisible_d')}</p>
              <div className="mt-3 flex gap-2">
                {(['APPEL', 'WHATSAPP', 'PRESENTIEL'] as const).map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => setMethode(m)}
                    className={`flex-1 rounded-xl py-2 text-xs font-bold ${methode === m ? 'bg-ambre text-sur-ambre' : 'bg-white/8 text-sable'}`}
                  >
                    {t(`admin.pin_methode_${m.toLowerCase()}`)}
                  </button>
                ))}
              </div>
              <GrosBouton
                petit
                ton="secondaire"
                desactive={!methode}
                charge={reinitialisation.isPending}
                onClick={async () => {
                  if (!methode) return
                  const r = await reinitialisation.mutateAsync({ pinAdmin: pin, utilisateurId: c.id, methodeVerification: methode })
                  setRevele({ pin: r.pin, reste: r.dureeAffichageSecondes })
                }}
              >
                <KeyRound className="h-4 w-4" /> {t('admin.pin_reinitialiser')}
              </GrosBouton>
            </>
          )}
        </Carte>
      ))}
      <p className="px-1 text-[11px] text-sable/40">{t('admin.pin_note')}</p>
    </div>
  )
}

// ---------- Panorama de toutes les terrasses ----------

function TerrassesAdmin() {
  const t = useT()
  const { langue } = useI18n()
  const db = useDB()

  if (db.terrasses.length === 0) {
    return <Vide icone={<Store className="h-8 w-8" />} titre={t('admin.aucune_terrasse')} detail={t('admin.aucune_terrasse_d')} />
  }

  const totaux = db.terrasses.reduce(
    (acc, t) => {
      const v = ventesDuJour(db, t.id)
      return { cdf: acc.cdf + v.cdf, usd: acc.usd + v.usdCentimes, nb: acc.nb + v.nb }
    },
    { cdf: 0, usd: 0, nb: 0 },
  )

  return (
    <div className="flex flex-col gap-3">
      {/* Consolidé plateforme du jour */}
      <Carte classe="border-ambre/30 bg-ambre/5">
        <p className="text-xs uppercase tracking-widest text-sable/60">{t('admin.consolide_titre')}</p>
        <div className="mt-1"><Money cdf={totaux.cdf} usd={totaux.usd} gros /></div>
        <p className="mt-1 text-xs text-sable/60">{t(totaux.nb > 1 ? 'admin.consolide_resume_pl' : 'admin.consolide_resume_une', { nb: totaux.nb, terrasses: db.terrasses.length })}</p>
      </Carte>

      {db.terrasses.map((te) => {
        const org = db.organisations.find((o) => o.id === te.organisationId)
        const proprio = org ? utilisateurDe(db, org.proprietaireId) : null
        const abo = db.abonnements.find((a) => a.terrasseId === te.id)
        const ventes = ventesDuJour(db, te.id)
        const phare = produitPhare(db, te.id)
        const produits = db.produits.filter((p) => p.terrasseId === te.id)
        const stockTotal = produits.reduce((somme, p) => somme + p.stock, 0)
        const stockBas = produits.filter((p) => p.actif && p.stock - p.stockReserve <= p.seuilAlerte).length
        const nbTables = nbTablesActives(db, te.id)
        const equipe = db.affectations.filter((a) => a.terrasseId === te.id && a.actif).length
        return (
          <Carte key={te.id}>
            <div className="mb-2 flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="font-bold text-white">{te.nom}</p>
                <p className="flex items-center gap-1 text-xs text-sable/60">
                  <MapPin className="h-3 w-3 shrink-0" /> {te.adresse}
                </p>
                <p className="mt-0.5 text-xs text-sable/50">{t('admin.resume_terrasse', { proprio: proprio?.nom ?? '—', tables: nbTables, zones: vocabulaireDe(langue, te.type, te.typesSecondaires).zones, membres: equipe, s: equipe > 1 ? 's' : '' })}</p>
              </div>
              {abo && (
                <Pill ton={abo.statut === 'ACTIF' ? 'vert' : abo.statut === 'ESSAI' ? 'bleu' : abo.statut === 'EN_GRACE' ? 'ambre' : 'rouge'}>
                  {PLANS.find((p) => p.code === abo.plan)?.nom} · {abo.statut === 'ACTIF' ? t('abo.statut_actif') : abo.statut === 'ESSAI' ? t('admin.essai_court') : abo.statut === 'EN_GRACE' ? t('admin.grace_court') : abo.statut === 'LECTURE_SEULE' ? t('abo.statut_lecture') : t('abo.statut_suspendu')}
                </Pill>
              )}
            </div>
            <div className="grid grid-cols-3 gap-2 text-center">
              <div className="rounded-xl bg-white/5 p-2.5">
                <p className="text-[10px] uppercase text-sable/50">{t('gerant.ventes_jour')}</p>
                <div className="mt-0.5"><Money cdf={ventes.cdf} usd={ventes.usdCentimes} /></div>
                <p className="text-[10px] text-sable/40">{t('admin.cmd', { n: ventes.nb })}</p>
              </div>
              <div className="rounded-xl bg-white/5 p-2.5">
                <p className="flex items-center justify-center gap-1 text-[10px] uppercase text-sable/50"><Trophy className="h-3 w-3 text-ambre" /> {t('admin.produit_phare')}</p>
                <p className="mt-0.5 truncate text-sm font-semibold text-white">{phare ? phare.nom : '—'}</p>
                <p className="text-[10px] text-sable/40">{phare ? t('admin.vendus', { n: phare.qte }) : t('admin.aucune_vente')}</p>
              </div>
              <div className="rounded-xl bg-white/5 p-2.5">
                <p className="flex items-center justify-center gap-1 text-[10px] uppercase text-sable/50"><Package className="h-3 w-3" /> {t('admin.stock')}</p>
                <p className="mt-0.5 font-mono text-sm font-bold text-white">{stockTotal}</p>
                <p className={`text-[10px] ${stockBas > 0 ? 'font-semibold text-danger-clair' : 'text-sable/40'}`}>{stockBas > 0 ? t('admin.stock_bas_nb', { n: stockBas }) : t('admin.stock_sain')}</p>
              </div>
            </div>
          </Carte>
        )
      })}
    </div>
  )
}

function AbonnesAdmin() {
  const t = useT()
  const db = useDB()
  return (
    <div className="flex flex-col gap-3">
      {db.abonnements.map((a) => {
        const te = terrasseDe(db, a.terrasseId)
        const org = te ? db.organisations.find((o) => o.id === te.organisationId) : null
        const proprio = org ? utilisateurDe(db, org.proprietaireId) : null
        return (
          <Carte key={a.id}>
            <div className="flex items-center justify-between">
              <div>
                <p className="font-bold text-white">{te?.nom}</p>
                <p className="text-xs text-sable/50">{proprio?.nom} · {te ? nbTablesActives(db, te.id) : 0} {t('proprio.onglet_tables').toLowerCase()} · {PLANS.find((p) => p.code === a.plan)?.nom} {t(`tranche.${a.tranche.toLowerCase()}`)}</p>
              </div>
              <div className="text-right">
                <Pill ton={a.statut === 'ACTIF' ? 'vert' : a.statut === 'ESSAI' ? 'bleu' : a.statut === 'EN_GRACE' ? 'ambre' : 'rouge'}>
                  {a.statut === 'ACTIF' ? t('abo.statut_actif') : a.statut === 'ESSAI' ? t('admin.essai_j', { j: a.essaiFin ? joursRestants(a.essaiFin) : 0 }) : a.statut === 'EN_GRACE' ? t('admin.grace_court') : a.statut === 'LECTURE_SEULE' ? t('abo.statut_lecture') : t('abo.statut_suspendu')}
                </Pill>
                <p className="mt-1 text-xs text-sable/50">{t('admin.echeance', { date: dateCourte(a.periodeFin) })}</p>
              </div>
            </div>
          </Carte>
        )
      })}
    </div>
  )
}

function TarifsAdmin({ pin }: { pin: string }) {
  const t = useT()
  const db = useDB()
  const [edition, setEdition] = useState<{ plan: PlanCode; tranche: Tranche } | null>(null)
  const [prix, setPrix] = useState('')

  const tarifSel = edition ? db.plansTarifs.find((tf) => tf.plan === edition.plan && tf.tranche === edition.tranche) : null

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-sable/70">{t('admin.grille_info')}</p>
      {(['ESSENTIEL', 'PRO', 'BUSINESS', 'BOUTIQUE'] as PlanCode[]).map((plan) => (
        <Carte key={plan}>
          <div className="mb-2 flex items-center justify-between">
            <p className="font-bold text-white">{PLANS.find((p) => p.code === plan)?.nom}</p>
            {!PLANS.find((p) => p.code === plan)?.disponible && <Pill ton="bleu">{t('admin.non_publie')}</Pill>}
          </div>
          {(['PETITE', 'MOYENNE', 'GRANDE'] as Tranche[]).map((tranche) => {
            const tf = db.plansTarifs.find((x) => x.plan === plan && x.tranche === tranche)!
            return (
              <button
                key={tranche}
                onClick={() => { setEdition({ plan, tranche }); setPrix((tf.prixUsdCentimes / 100).toFixed(2)) }}
                className="flex w-full items-center justify-between border-b border-white/5 py-2.5 text-left last:border-0"
              >
                <p className="text-sm text-sable">{t(`tranche.${tranche.toLowerCase()}`)} <span className="text-xs text-sable/40">{t('admin.tables_range', { min: tf.tablesMin, max: tf.tablesMax ?? '∞' })}</span></p>
                <p className="font-mono text-sm font-bold text-white">{fmtUSD(tf.prixUsdCentimes)}<span className="font-normal text-sable/40">{t('admin.par_mois')}</span></p>
              </button>
            )
          })}
        </Carte>
      ))}

      <Feuille ouvert={!!edition} surFermer={() => setEdition(null)} titre={tarifSel ? t('admin.tarif_titre', { plan: PLANS.find((p) => p.code === tarifSel.plan)?.nom ?? tarifSel.plan, tranche: t(`tranche.${tarifSel.tranche.toLowerCase()}`) }) : ''}>
        <div className="flex flex-col gap-4">
          <label className="block">
            <span className="mb-1.5 block text-sm font-semibold text-sable">{t('admin.prix_mensuel')}</span>
            <SaisieNombre valeur={prix} onChange={setPrix} />
          </label>
          <GrosBouton onClick={async () => {
            try {
              // Les frais d'installation ne dépendent plus du plan (règle par type,
              // boucle 1) : on renvoie la valeur existante de la ligne, inchangée.
              await modifierTarif(edition!.plan, edition!.tranche, Math.round(parseFloat(prix.replace(',', '.')) * 100), tarifSel!.fraisInstallUsdCentimes, pin)
              toast.success(t('admin.tarif_ok'))
              setEdition(null)
            } catch (e) { toast.error(e instanceof Error ? e.message : t('commun.erreur')) }
          }}>
            {t('commun.enregistrer')}
          </GrosBouton>
        </div>
      </Feuille>
    </div>
  )
}
