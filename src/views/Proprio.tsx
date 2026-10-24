// ============================================================
// GBS — Interface PROPRIÉTAIRE : espace unifié (s'il est aussi
// gérant), pilotage multi-terrasses, stock/prix (exclusif),
// équipe et invitations, tables et tranches, abonnement.
// ============================================================

import { useEffect, useId, useMemo, useState, lazy, Suspense } from 'react'
import { createPortal } from 'react-dom'
import {
  BadgeDollarSign, BedDouble, Boxes, Camera, CheckCircle2, ChefHat, ChevronDown, CircleAlert, CreditCard, Download,
  Globe, LayoutDashboard, Package, Pencil, Plus, Printer, QrCode, ScanBarcode, ScrollText, Store,
  Table2, Target, TicketCheck, TrendingUp, UsersRound, Wifi, WifiOff,
} from 'lucide-react'
import { PanneauBillards } from './Billard'
import { PanneauHotel } from './Hotel'
import { PanneauTraiteurProprio } from './Traiteur'
import { toast } from 'sonner'
import { BoutonDeconnexion, CoquilleRole, PorteRole } from '@/components/Coquille'
import { BlocCaisse } from '@/components/Caisse'
import { BlocBoundary } from '@/components/ErrorBoundary'

// Scanner chargé à la demande : @zxing (~450 Ko) hors du chunk principal
const ScanCodeBarres = lazy(() =>
  import('@/components/ScanCodeBarres').then((m) => ({ default: m.ScanCodeBarres }))
)
import {
  BoutonSupportWhatsApp, Carte, Confirmation, Etoiles, Feuille, GrosBouton, Money, Pill,
  SaisieNombre, classeSaisie,
} from '@/components/gbs'
import { dateHeure, dateCourte, fmtCDF, fmtUSD, heureLubu, ilYA, jourLubu, joursRestants, libelleRole } from '@/lib/format'
import { PLANS, plansPour, prixMensuelTerrasse, seuilSuivant, tarifDe, tranchePourTables, nbTablesActives } from '@/lib/pricing'
import {
  FournisseurPortee, ajusterStock, archiverTable, basculerAffectation, basculerProduitActif, chiffreAffaires, creerInvitation,
  creerProduit, creerTable, enregistrerCodeBarres, estProprietaire, marquerAlertesLues, masquerAvis,
  modifierPrix, organisationDe, rechercherParCodeBarres, revoquerAppareil, revoquerInvitation, rolesSur,
  soumettrePaiement, terrasseDe, terrassesDe, traiterDemandeStock, useDB, useSession, utilisateurDe, valeurStock, ventesDuJour,
  decalerJour, encaisseParServeuse, etatStock, picAffluence, ventesCumuleesJour, ventesSemaine, ventesSemainePrecedente,
} from '@/lib/store'
import { trpc } from '@/providers/trpc'
import { DepotsGerant, QRGerant, RapportJour } from './Gerant'
import {
  aTablesDeSalle, categoriesPour, defFusionnee, fraisInstallationPour, tousLesTypes, typeProduitParDefaut,
  TYPES_SANS_STOCK, type CategorieProduit, type RoleEtablissement, type TypeProduit,
} from '@contracts/types'
import { LOCALES, useI18n, useT, vocabulaireDe } from '@/i18n'
import { BoutonDemandePhoto } from '@/components/DemandePhoto'
import type { DB, Paiement, Portee, Produit, SessionLocale, Terrasse, TypeMouvement, Utilisateur } from '@/lib/types'

export function VueProprio() {
  const [session] = useSession()
  const portee: Portee = session ? { kind: 'staff' } : { kind: 'public' }
  return (
    <FournisseurPortee portee={portee}>
      <VueProprioInterne />
    </FournisseurPortee>
  )
}

function VueProprioInterne() {
  const t = useT()
  return (
    <PorteRole rolesVoulus={['PROPRIETAIRE']} indiceDemo={t('proprio.indice_demo')}>
      {({ moi, terrasse, session }) => <EspaceProprio moi={moi} terrasse={terrasse} session={session} />}
    </PorteRole>
  )
}

function EspaceProprio({ moi, terrasse, session }: { moi: Utilisateur; terrasse: Terrasse; session: SessionLocale }) {
  const { t, langue } = useI18n()
  const db = useDB()
  // Maquette Pilotage : nom + rôle + date du jour (heure de Lubumbashi)
  const dateJour = new Intl.DateTimeFormat(LOCALES[langue], {
    weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Africa/Lubumbashi',
  }).format(new Date())
  const [, setSession] = useSession()
  const [onglet, setOnglet] = useState('pilotage')
  const [choixTerrasse, setChoixTerrasse] = useState(false)

  const mesTerrasses = terrassesDe(db, moi.id).filter((t) => estProprietaire(db, moi.id, t.id))
  const roles = rolesSur(db, moi.id, terrasse.id)
  const aussiGerant = roles.includes('GERANT')
  // Onglet Billards seulement si l'établissement en exploite (file Vincaire)
  const aBillards = db.tables.some((ta) => ta.terrasseId === terrasse.id && ta.actif && !ta.archiveLe && ta.kind === 'BILLARD')
  // Onglet Hôtel seulement pour une guest house (chambres + séjours)
  const aChambres = tousLesTypes(terrasse.type, terrasse.typesSecondaires ?? []).includes('GUEST_HOUSE')
  // Onglet Traiteur seulement si l'établissement a une cuisine
  // (module CUISINE_BAR du registre : terrasse, restaurant, guest house)
  const aTraiteur = defFusionnee(terrasse.type, terrasse.typesSecondaires ?? []).modules.includes('CUISINE_BAR')
  // Établissement 100 % comptoir (pharmacie…) : l'onglet parle de
  // « Comptoirs », pas de « Tables » (une pharmacie n'a pas de table).
  const salle = tousLesTypes(terrasse.type, terrasse.typesSecondaires ?? []).some(aTablesDeSalle)

  const onglets = [
    { id: 'pilotage', label: t('proprio.onglet_pilotage'), icone: <LayoutDashboard className="h-6 w-6" /> },
    { id: 'carte', label: t('proprio.onglet_carte'), icone: <Package className="h-6 w-6" /> },
    { id: 'equipe', label: t('proprio.onglet_equipe'), icone: <UsersRound className="h-6 w-6" /> },
    { id: 'tables', label: salle ? t('proprio.onglet_tables') : t('proprio.onglet_comptoirs'), icone: <Table2 className="h-6 w-6" /> },
    ...(aBillards ? [{ id: 'billards', label: t('billard.onglet_gestion'), icone: <Target className="h-6 w-6" /> }] : []),
    ...(aChambres ? [{ id: 'hotel', label: t('hotel.onglet'), icone: <BedDouble className="h-6 w-6" /> }] : []),
    ...(aTraiteur ? [{ id: 'traiteur', label: t('proprio.onglet_traiteur'), icone: <ChefHat className="h-6 w-6" /> }] : []),
    ...(aussiGerant ? [{ id: 'qr', label: t('proprio.onglet_qr'), icone: <QrCode className="h-6 w-6" /> }] : []),
    { id: 'abo', label: t('proprio.onglet_abo'), icone: <CreditCard className="h-6 w-6" /> },
  ]

  return (
    <>
      <CoquilleRole
        titre={terrasse.nom}
        sousTitre={`${moi.nom} — ${t('role.proprietaire')}${aussiGerant ? t('proprio.aussi_gerant') : ''} · ${dateJour}`}
        droite={
          <div className="flex items-center gap-1">
            <button
              onClick={() => setChoixTerrasse(true)}
              className="flex h-11 items-center gap-1 rounded-full bg-white/8 px-3 text-sm font-semibold text-sable active:bg-white/15"
            >
              <Store className="h-4 w-4" /> {mesTerrasses.length} <ChevronDown className="h-4 w-4" />
            </button>
            <BoutonSupportWhatsApp />
            <BoutonDeconnexion />
          </div>
        }
        actif={onglet}
        onChange={setOnglet}
        onglets={onglets}
      >
        {/* Chaque onglet est un bloc protégé (Phase B.2) : un panneau
            qui plante laisse les autres onglets utilisables */}
        {onglet === 'pilotage' && <BlocBoundary><Pilotage terrasse={terrasse} acteurId={moi.id} mesTerrasses={mesTerrasses} moi={moi} /></BlocBoundary>}
        {onglet === 'carte' && <BlocBoundary><CarteProduits terrasseId={terrasse.id} /></BlocBoundary>}
        {onglet === 'equipe' && <BlocBoundary><Equipe terrasseId={terrasse.id} /></BlocBoundary>}
        {onglet === 'tables' && <BlocBoundary><Tables terrasseId={terrasse.id} /></BlocBoundary>}
        {onglet === 'billards' && aBillards && <BlocBoundary><PanneauBillards terrasseId={terrasse.id} avecConfig /></BlocBoundary>}
        {onglet === 'hotel' && aChambres && <BlocBoundary><PanneauHotel terrasseId={terrasse.id} mode="direction" /></BlocBoundary>}
        {onglet === 'traiteur' && aTraiteur && <BlocBoundary><PanneauTraiteurProprio terrasseId={terrasse.id} /></BlocBoundary>}
        {onglet === 'qr' && aussiGerant && <BlocBoundary><QRGerant terrasseId={terrasse.id} /></BlocBoundary>}
        {onglet === 'abo' && <BlocBoundary><AbonnementVue terrasseId={terrasse.id} /></BlocBoundary>}
      </CoquilleRole>

      <Feuille ouvert={choixTerrasse} surFermer={() => setChoixTerrasse(false)} titre={t('proprio.changer_terrasse')}>
        <div className="flex flex-col gap-2">
          {mesTerrasses.map((te) => {
            const v = ventesDuJour(db, te.id)
            return (
              <button
                key={te.id}
                onClick={() => { setSession({ ...session, terrasseId: te.id }); setChoixTerrasse(false) }}
                className={`flex items-center justify-between rounded-2xl border px-4 py-3 text-left ${te.id === terrasse.id ? 'border-ambre/60 bg-ambre/8' : 'border-white/10'}`}
              >
                <div>
                  <p className="font-bold text-white">{te.nom}</p>
                  <p className="text-xs text-sable/60">{t('proprio.terrasses_resume', { tables: nbTablesActives(db, te.id), ventes: v.nb, zones: vocabulaireDe(langue, te.type, te.typesSecondaires).zones })}</p>
                </div>
                <Money cdf={v.cdf} usd={v.usdCentimes} />
              </button>
            )
          })}
        </div>
      </Feuille>
    </>
  )
}

// ============================================================
// PILOTAGE
// ============================================================

/** Montant de carte de synthèse : CDF et USD empilés sur deux lignes
 *  (les totaux cumulés sont longs — un montant sur une ligne déborderait) */
function MoneyEmpile({ cdf, usd }: { cdf: number; usd: number }) {
  return (
    <div className="font-mono text-lg font-bold leading-tight text-white">
      {(cdf > 0 || usd <= 0) && <p>{fmtCDF(cdf)}</p>}
      {usd > 0 && <p>{fmtUSD(usd)}</p>}
    </div>
  )
}

/** Sparkline des ventes cumulées du jour (SVG inline, aucune librairie). */
function SparklineJour({ points }: { points: number[] }) {
  const id = useId()
  const L = 320
  const H = 48
  const max = Math.max(...points, 1)
  const n = Math.max(points.length, 2)
  const xy: [number, number][] = points.length === 0
    ? [[0, H - 6], [L, H - 6]]
    : points.map((v, i) => [(i / (n - 1)) * (L - 8), H - 6 - (v / max) * (H - 16)])
  const ligne = xy.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(1)} ${y.toFixed(1)}`).join(' ')
  const aire = `${ligne} L${xy[xy.length - 1][0].toFixed(1)} ${H} L${xy[0][0].toFixed(1)} ${H} Z`
  const [dx, dy] = xy[xy.length - 1]
  return (
    <svg viewBox={`0 0 ${L} ${H}`} className="mt-2 w-full" role="img" aria-hidden>
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="rgb(var(--ambre))" stopOpacity=".28" />
          <stop offset="1" stopColor="rgb(var(--ambre))" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={aire} fill={`url(#${id})`} />
      <path d={ligne} fill="none" stroke="rgb(var(--ambre))" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={dx} cy={dy} r="4" fill="rgb(var(--ambre))" />
    </svg>
  )
}

function Pilotage({ terrasse, acteurId, mesTerrasses, moi }: { terrasse: Terrasse; acteurId: string; mesTerrasses: Terrasse[]; moi: Utilisateur }) {
  const { t, langue } = useI18n()
  const db = useDB()
  // Horloge d'état (pureté React : Date.now() n'est jamais appelé
  // pendant le rendu). Rafraîchie toutes les 30 s — suffisant pour
  // l'affichage « en attente depuis N min ».
  const [maintenantMs, setMaintenantMs] = useState<number | null>(null)
  useEffect(() => {
    // setTimeout 0 : la première mise à jour est asynchrone (jamais de
    // setState synchrone dans un effet — react-hooks/set-state-in-effect).
    const premier = setTimeout(() => setMaintenantMs(Date.now()), 0)
    const horloge = setInterval(() => setMaintenantMs(Date.now()), 30_000)
    return () => { clearTimeout(premier); clearInterval(horloge) }
  }, [])
  const ventes = ventesDuJour(db, terrasse.id)
  const ca = chiffreAffaires(db, terrasse.id)
  const stock = valeurStock(db, terrasse.id)
  const consolide = mesTerrasses.reduce(
    (acc, te) => {
      const v = ventesDuJour(db, te.id)
      const c = chiffreAffaires(db, te.id)
      const s = valeurStock(db, te.id)
      return {
        cdf: acc.cdf + v.cdf, usd: acc.usd + v.usdCentimes, nb: acc.nb + v.nb,
        caCdf: acc.caCdf + c.cdf, caUsd: acc.caUsd + c.usdCentimes,
        stockCdf: acc.stockCdf + s.cdf, stockUsd: acc.stockUsd + s.usdCentimes,
      }
    },
    { cdf: 0, usd: 0, nb: 0, caCdf: 0, caUsd: 0, stockCdf: 0, stockUsd: 0 },
  )
  const alertes = db.alertes.filter((a) => a.terrasseId === terrasse.id).slice(0, 8)
  const demandes = db.demandesStock.filter((d) => d.terrasseId === terrasse.id && d.statut === 'EN_ATTENTE')
  const avisTerrasse = db.avis.filter((a) => a.terrasseId === terrasse.id && !a.masque)
  const serveuses = db.affectations.filter((a) => a.terrasseId === terrasse.id && a.role === 'SERVEUSE')
  const [masquerId, setMasquerId] = useState<string | null>(null)
  const [motifMasquage, setMotifMasquage] = useState('')

  // --- État de l'application : taux, connexion, abonnement (chips) ---
  const [enLigne, setEnLigne] = useState(() => (typeof navigator === 'undefined' ? true : navigator.onLine))
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
  const abo = db.abonnements.find((a) => a.terrasseId === terrasse.id)
  const chipAbo = !abo ? null
    : abo.statut === 'ESSAI' ? { texte: t('abo.statut_essai', { j: abo.essaiFin ? joursRestants(abo.essaiFin) : 0 }), ton: 'ambre' as const }
    : abo.statut === 'ACTIF' ? { texte: t('abo.statut_actif'), ton: 'succes' as const }
    : abo.statut === 'EN_GRACE' ? { texte: t('abo.statut_grace'), ton: 'ambre' as const }
    : { texte: abo.statut === 'LECTURE_SEULE' ? t('abo.statut_lecture') : t('abo.statut_suspendu'), ton: 'danger' as const }

  // --- Aujourd'hui : ventes (sparkline + comparaison au même jour J-7) ---
  const cumuls = useMemo(() => ventesCumuleesJour(db, terrasse.id), [db, terrasse.id])
  const jourM7 = decalerJour(jourLubu(), -7)
  const ventesM7 = ventesDuJour(db, terrasse.id, jourM7)
  const nomJourM7 = new Intl.DateTimeFormat(LOCALES[langue], { weekday: 'long', timeZone: 'Africa/Lubumbashi' }).format(new Date(`${jourM7}T12:00:00`))
  const pctJour = ventesM7.cdf > 0 ? Math.round(((ventes.cdf - ventesM7.cdf) / ventesM7.cdf) * 100) : null
  const derniereVente = useMemo(() => {
    const j = jourLubu()
    const servies = db.commandes.filter((c) => c.terrasseId === terrasse.id && c.statut === 'SERVIE' && c.servieLe && jourLubu(c.servieLe) === j)
    return servies.sort((a, b) => b.servieLe!.localeCompare(a.servieLe!))[0]?.servieLe ?? null
  }, [db, terrasse.id])

  // --- Stock : répartition bon état / bas / rupture (produits actifs) ---
  const etat = etatStock(db, terrasse.id)
  const nbActifs = etat.bon + etat.bas + etat.rupture

  // --- Cette semaine : 7 barres, meilleur jour, pic d'affluence ---
  const semaine = useMemo(() => ventesSemaine(db, terrasse.id), [db, terrasse.id])
  const semainePrec = useMemo(() => ventesSemainePrecedente(db, terrasse.id), [db, terrasse.id])
  const totalSemaine = semaine.reduce((s, j) => s + j.cdf, 0)
  const maxSemaine = Math.max(...semaine.map((j) => j.cdf), 1)
  const meilleur = semaine.filter((j) => j.cdf > 0).sort((a, b) => b.cdf - a.cdf)[0] ?? null
  const pctSemaine = semainePrec.cdf > 0 ? Math.round(((totalSemaine - semainePrec.cdf) / semainePrec.cdf) * 100) : null
  const pic = useMemo(() => picAffluence(db, terrasse.id), [db, terrasse.id])
  const fmtJourSemaine = (jour: string, style: 'narrow' | 'long') =>
    new Intl.DateTimeFormat(LOCALES[langue], { weekday: style, timeZone: 'Africa/Lubumbashi' }).format(new Date(`${jour}T12:00:00`))

  // --- En salle : tables occupées (commande active ou servie non payée) ---
  const tables = db.tables.filter((ta) => ta.terrasseId === terrasse.id && ta.actif && !ta.archiveLe).sort((a, b) => a.numero - b.numero)
  const occupees = new Set(
    db.commandes
      .filter((c) => c.terrasseId === terrasse.id && (c.statut === 'EN_ATTENTE' || c.statut === 'CONFIRMEE' || (c.statut === 'SERVIE' && !c.payeeLe)))
      .map((c) => c.tableId),
  )
  const commandesCours = db.commandes.filter((c) => c.terrasseId === terrasse.id && (c.statut === 'EN_ATTENTE' || c.statut === 'CONFIRMEE'))

  // --- Équipe en service : sessions ouvertes + encaissé du jour ---
  const sessionsOuvertes = db.sessionsService.filter((s) => s.terrasseId === terrasse.id && s.statut === 'OUVERTE')
  const encaisses = encaisseParServeuse(db, terrasse.id)
  const moyAvis = avisTerrasse.length ? avisTerrasse.reduce((s, a) => s + a.note, 0) / avisTerrasse.length : null

  // --- Dernières dépenses (toutes dates, 3 plus récentes) ---
  const dernieresDepenses = useMemo(
    () => db.depenses.filter((d) => d.terrasseId === terrasse.id).sort((a, b) => b.creeLe.localeCompare(a.creeLe)).slice(0, 3),
    [db, terrasse.id],
  )

  // --- À traiter : demandes de stock, clôtures à valider, commandes en attente, alertes ---
  const depotsAValider = db.depots.filter((d) => d.terrasseId === terrasse.id && d.statut === 'DECLARE')
  const attente = db.commandes.filter((c) => c.terrasseId === terrasse.id && c.statut === 'EN_ATTENTE')
  const minAttente = attente.length && maintenantMs !== null
    ? Math.max(1, Math.round((maintenantMs - Math.min(...attente.map((c) => new Date(c.creeLe).getTime()))) / 60000))
    : 0
  const rienATraiter = demandes.length === 0 && depotsAValider.length === 0 && attente.length === 0 && alertes.length === 0

  // Top produits DU JOUR (quantités vendues, commandes servies aujourd'hui)
  const top = useMemo(() => {
    const j = jourLubu()
    const compteur = new Map<string, { nom: string; qte: number }>()
    for (const c of db.commandes) {
      if (c.terrasseId !== terrasse.id || c.statut !== 'SERVIE' || !c.servieLe || jourLubu(c.servieLe) !== j) continue
      for (const l of c.lignes) {
        const e = compteur.get(l.produitId) ?? { nom: l.nom, qte: 0 }
        e.qte += l.quantite
        compteur.set(l.produitId, e)
      }
    }
    return Array.from(compteur.values()).sort((a, b) => b.qte - a.qte).slice(0, 5)
  }, [db, terrasse.id])

  return (
    <div className="flex flex-col gap-4 px-4 pt-4">
      {/* État : taux de change, connexion, abonnement */}
      <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" aria-label={t('pilotage.etat_app')}>
        {terrasse.parametres.tauxUsdCdf !== null && (
          <span className="inline-flex flex-none items-center gap-2 rounded-full border border-white/10 px-3 py-1.5 text-xs font-semibold text-white">
            <i className="h-2 w-2 rounded-full bg-succes" />
            {t('pilotage.chip_taux', { taux: terrasse.parametres.tauxUsdCdf.toLocaleString('fr-CD') })}
          </span>
        )}
        <span className="inline-flex flex-none items-center gap-2 rounded-full border border-white/10 px-3 py-1.5 text-xs font-semibold text-white">
          <i className={`h-2 w-2 rounded-full ${enLigne ? 'bg-succes' : 'bg-danger'}`} />
          {enLigne ? t('pilotage.en_ligne') : t('pilotage.hors_ligne')}
          {enLigne ? <Wifi className="h-3.5 w-3.5 text-sable/50" /> : <WifiOff className="h-3.5 w-3.5 text-danger-clair" />}
        </span>
        {chipAbo && (
          <span className="inline-flex flex-none items-center gap-2 rounded-full border border-white/10 px-3 py-1.5 text-xs font-semibold text-white">
            <i className={`h-2 w-2 rounded-full ${chipAbo.ton === 'succes' ? 'bg-succes' : chipAbo.ton === 'ambre' ? 'bg-ambre' : 'bg-danger'}`} />
            {chipAbo.texte}
          </span>
        )}
      </div>

      {/* Consolidé organisation */}
      {mesTerrasses.length > 1 && (
        <Carte classe="border-ambre/30 bg-ambre/5">
          <p className="text-xs uppercase tracking-widest text-sable/60">{t('proprio.consolide_titre')}</p>
          <div className="mt-1"><Money cdf={consolide.cdf} usd={consolide.usd} gros /></div>
          <p className="mt-1 text-xs text-sable/60">{t('proprio.consolide_resume', { nb: consolide.nb, terrasses: mesTerrasses.length })}</p>
          <div className="mt-3 grid grid-cols-2 gap-3 border-t border-ambre/20 pt-3">
            <div>
              <p className="text-xs uppercase tracking-widest text-sable/60">{t('proprio.ca_total')}</p>
              <div className="mt-0.5"><MoneyEmpile cdf={consolide.caCdf} usd={consolide.caUsd} /></div>
            </div>
            <div>
              <p className="text-xs uppercase tracking-widest text-sable/60">{t('proprio.valeur_stock')}</p>
              <div className="mt-0.5"><MoneyEmpile cdf={consolide.stockCdf} usd={consolide.stockUsd} /></div>
            </div>
          </div>
        </Carte>
      )}

      {/* ---------- Aujourd'hui ---------- */}
      <p className="text-xs font-bold uppercase tracking-widest text-sable/50">{t('pilotage.aujourdhui')}</p>
      <Carte>
        <div className="flex items-start gap-3">
          <span className="grid h-10 w-10 flex-none place-items-center rounded-full bg-ambre/15 text-ambre"><TrendingUp className="h-5 w-5" /></span>
          <div className="min-w-0 flex-1">
            <p className="text-xs uppercase tracking-widest text-sable/50">{t('gerant.ventes_jour')}</p>
            <div className="mt-1"><Money cdf={ventes.cdf} usd={ventes.usdCentimes} gros /></div>
            <p className="mt-1 text-xs text-sable/50">
              <b className="text-sable/80">{t(ventes.nb > 1 ? 'gerant.ventes_servies_pl' : 'gerant.ventes_servies_une', { n: ventes.nb })}</b>
              {derniereVente && <> · {t('pilotage.derniere_a', { h: heureLubu(derniereVente) })}</>}
              {pctJour !== null && (
                <span className={pctJour >= 0 ? 'text-succes-clair' : 'text-danger-clair'}>
                  {' '}{pctJour >= 0 ? '↑' : '↓'} {Math.abs(pctJour)} % {t('pilotage.vs_jour_dernier', { jour: nomJourM7 })}
                </span>
              )}
            </p>
            <SparklineJour points={cumuls} />
            <p className="mt-2 text-xs text-sable/40">{ventes.nb === 0 ? t('pilotage.aucune_vente_jour') : t('pilotage.zero_minuit')}</p>
          </div>
        </div>
      </Carte>

      <Carte>
        <div className="flex items-start gap-3">
          <span className="grid h-10 w-10 flex-none place-items-center rounded-full bg-info/15 text-info-clair"><Boxes className="h-5 w-5" /></span>
          <div className="min-w-0 flex-1">
            <p className="text-xs uppercase tracking-widest text-sable/50">{t('proprio.valeur_stock')}</p>
            <div className="mt-1"><Money cdf={stock.cdf} usd={stock.usdCentimes} gros /></div>
            <p className="mt-1 text-xs text-sable/50">
              {t(stock.references > 1 ? 'pilotage.produits_prix_vente_pl' : 'pilotage.produits_prix_vente_une', { n: stock.references })}
              {stock.usdCentimes > 0 && <> · ≈ {fmtUSD(stock.usdCentimes)}</>}
            </p>
            {nbActifs > 0 && (
              <>
                <div className="mt-2 flex h-2 overflow-hidden rounded-full" role="img" aria-label={`${etat.bon}/${etat.bas}/${etat.rupture}`}>
                  <i className="bg-info" style={{ width: `${(etat.bon / nbActifs) * 100}%` }} />
                  <i className="bg-ambre" style={{ width: `${(etat.bas / nbActifs) * 100}%` }} />
                  <i className="bg-danger" style={{ width: `${(etat.rupture / nbActifs) * 100}%` }} />
                </div>
                <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-sable/60">
                  <span className="inline-flex items-center gap-1.5"><i className="h-2 w-2 rounded-full bg-info" /><b className="text-white">{etat.bon}</b> {t('pilotage.stock_bon')}</span>
                  <span className="inline-flex items-center gap-1.5"><i className="h-2 w-2 rounded-full bg-ambre" /><b className="text-white">{etat.bas}</b> {t('pilotage.stock_bas')}</span>
                  <span className="inline-flex items-center gap-1.5"><i className="h-2 w-2 rounded-full bg-danger" /><b className="text-white">{etat.rupture}</b> {t('pilotage.stock_rupture')}</span>
                </div>
              </>
            )}
          </div>
        </div>
      </Carte>

      {/* Solde de la boutique + dépenses du jour (caisse) */}
            <BlocCaisse terrasseId={terrasse.id} afficherDeclaration={false} typeEtablissement={terrasse.type} />

      {/* Chiffre d'affaires cumulé (toutes dates) */}
      <Carte>
        <p className="text-xs uppercase tracking-widest text-sable/50">{t('proprio.ca')}</p>
        <div className="mt-1"><MoneyEmpile cdf={ca.cdf} usd={ca.usdCentimes} /></div>
        <p className="mt-1 text-xs text-sable/50">{t(ca.nb > 1 ? 'proprio.commandes_total_pl' : 'proprio.commandes_total_une', { n: ca.nb })}</p>
      </Carte>

      {/* ---------- À traiter ---------- */}
      <div className="flex items-center justify-between">
        <p className="text-xs font-bold uppercase tracking-widest text-sable/50">{t('pilotage.a_traiter')}</p>
        {alertes.some((a) => !a.lu) && (
          <button className="shrink-0 whitespace-nowrap text-xs font-semibold text-ambre underline underline-offset-2" onClick={async () => { try { await marquerAlertesLues(terrasse.id) } catch { /* silencieux */ } }}>
            {t('serveuse.tout_lu')}
          </button>
        )}
      </div>
      {rienATraiter && <p className="text-sm text-sable/50">{t('pilotage.rien_a_traiter')}</p>}
      {demandes.map((d) => {
        const p = db.produits.find((x) => x.id === d.produitId)
        const auteur = utilisateurDe(db, d.creePar)
        return (
          <Carte key={d.id}>
            <div className="mb-2 flex items-center justify-between">
              <p className="font-bold text-white">{p?.nom} × {d.quantite}</p>
              <Pill ton="ambre">{d.type === 'REAPPRO' ? t('demande.type_reappro') : d.type === 'PERTE' ? t('demande.type_perte') : t('demande.type_ecart')}</Pill>
            </div>
            <p className="mb-3 text-sm text-sable/70">{d.motif} — {auteur?.nom}, {ilYA(d.creeLe)}</p>
            <div className="flex gap-2">
              <GrosBouton petit ton="danger" onClick={async () => {
                try { await traiterDemandeStock(d.id, 'REFUSEE'); toast.success(t('proprio.demande_refusee')) }
                catch (e) { toast.error(e instanceof Error ? e.message : t('commun.erreur')) }
              }}>{t('proprio.refuser')}</GrosBouton>
              <GrosBouton petit onClick={async () => {
                try { await traiterDemandeStock(d.id, 'APPROUVEE'); toast.success(t('proprio.demande_approuvee')) }
                catch (e) { toast.error(e instanceof Error ? e.message : t('commun.erreur')) }
              }}>{t('proprio.approuver')}</GrosBouton>
            </div>
          </Carte>
        )
      })}
      {depotsAValider.map((d) => {
        const serveuse = utilisateurDe(db, d.serveuseId)
        const ecart = d.declareCdf - d.montantAttenduCdf
        return (
          <div key={d.id} className="flex items-center justify-between gap-3 rounded-2xl border border-white/8 bg-surface px-4 py-3">
            <div>
              <p className="font-semibold text-white">{t('pilotage.cloture_service', { nom: serveuse?.nom ?? '—' })}</p>
              <p className="text-xs text-sable/50">
                {t('pilotage.cloture_detail', { compte: fmtCDF(d.declareCdf), attendu: fmtCDF(d.montantAttenduCdf), ecart: `${ecart >= 0 ? '+' : '−'}${fmtCDF(Math.abs(ecart))}` })}
              </p>
            </div>
            <button
              className="shrink-0 rounded-xl bg-white/8 px-3 py-2 text-xs font-semibold text-sable active:bg-white/15"
              onClick={() => document.getElementById('pilotage-depots')?.scrollIntoView({ behavior: 'smooth' })}
            >
              {t('pilotage.voir_detail')}
            </button>
          </div>
        )
      })}
      {attente.length > 0 && (
        <div className="flex items-center gap-3 rounded-2xl border border-ambre/30 bg-ambre/8 px-4 py-3">
          <CircleAlert className="h-5 w-5 shrink-0 text-ambre" />
          <p className="text-sm text-white">{t(attente.length > 1 ? 'pilotage.commande_attente_pl' : 'pilotage.commande_attente_une', { n: attente.length, min: minAttente })}</p>
        </div>
      )}
      {alertes.map((a) => (
        <div key={a.id} className={`flex items-start gap-3 rounded-2xl border px-4 py-3 ${a.lu ? 'border-white/8 bg-surface/50' : a.type === 'ECART_CAISSE' || a.type === 'AVIS_NEGATIFS' ? 'border-danger/30 bg-danger/8' : 'border-ambre/30 bg-ambre/8'}`}>
          <CircleAlert className={`mt-0.5 h-5 w-5 shrink-0 ${a.type === 'ECART_CAISSE' || a.type === 'AVIS_NEGATIFS' ? 'text-danger-clair' : 'text-ambre'}`} />
          <div>
            <p className="text-sm text-white">{a.message}</p>
            <p className="mt-0.5 text-xs text-sable/50">{ilYA(a.creeLe)}</p>
          </div>
        </div>
      ))}

      {/* ---------- Cette semaine ---------- */}
      <p className="text-xs font-bold uppercase tracking-widest text-sable/50">{t('pilotage.cette_semaine')}</p>
      <Carte>
        <p className="font-mono text-2xl font-bold text-white">
          {fmtCDF(totalSemaine)}
          {pctSemaine !== null && (
            <span className={`ml-2 align-middle text-xs font-semibold ${pctSemaine >= 0 ? 'text-succes-clair' : 'text-danger-clair'}`}>
              {pctSemaine >= 0 ? '↑' : '↓'} {Math.abs(pctSemaine)} % {t('pilotage.vs_semaine_precedente')}
            </span>
          )}
        </p>
        <div className="mt-3 flex h-24 items-end gap-2" role="img" aria-label={fmtCDF(totalSemaine)}>
          {semaine.map((j, i) => (
            <div
              key={j.jour}
              className={`flex-1 rounded-t-lg ${i === 6 ? 'bg-ambre' : 'bg-info/30'}`}
              style={{ height: `${Math.max(6, Math.round((j.cdf / maxSemaine) * 100))}%` }}
            />
          ))}
        </div>
        <div className="mt-2 flex gap-2 text-center text-xs text-sable/50">
          {semaine.map((j, i) => (
            <span key={j.jour} className={`flex-1 uppercase ${i === 6 ? 'font-bold text-ambre' : ''}`}>{fmtJourSemaine(j.jour, 'narrow')}</span>
          ))}
        </div>
        {meilleur && (
          <p className="mt-3 text-xs text-sable/50">{t('pilotage.meilleur_jour', { jour: fmtJourSemaine(meilleur.jour, 'long'), montant: fmtCDF(meilleur.cdf) })}</p>
        )}
        {pic && (
          <p className="mt-1 text-xs text-sable/50">{t('pilotage.pic_affluence', { plage: t('pilotage.plage_horaire', { debut: pic.debut, fin: pic.fin }) })}</p>
        )}
      </Carte>

      {/* ---------- En salle (établissements avec tables) ---------- */}
      {tables.length > 0 && (
        <>
          <p className="text-xs font-bold uppercase tracking-widest text-sable/50">{t('pilotage.en_salle')}</p>
          <Carte>
            <p className="text-sm text-sable/70">
              <b className="text-white">{t('pilotage.tables_occupees', { n: occupees.size, total: tables.length })}</b>
              {' · '}{t(commandesCours.length > 1 ? 'pilotage.commandes_cours_pl' : 'pilotage.commandes_cours_une', { n: commandesCours.length })}
            </p>
            <div className="mt-3 grid grid-cols-6 gap-2" role="img" aria-label={t('pilotage.tables_occupees', { n: occupees.size, total: tables.length })}>
              {tables.map((ta) => (
                <span
                  key={ta.id}
                  className={`grid aspect-square place-items-center rounded-xl border font-mono text-sm font-bold ${
                    occupees.has(ta.id) ? 'border-ambre bg-ambre/15 text-ambre' : 'border-white/10 text-sable/40'
                  }`}
                >
                  {ta.numero}
                </span>
              ))}
            </div>
          </Carte>
        </>
      )}

      {/* ---------- Équipe en service ---------- */}
      <p className="text-xs font-bold uppercase tracking-widest text-sable/50">{t('pilotage.equipe_service')}</p>
      <Carte>
        {sessionsOuvertes.length === 0 && <p className="text-sm text-sable/50">{t('pilotage.personne_service')}</p>}
        {sessionsOuvertes.map((s) => {
          const serveuse = utilisateurDe(db, s.serveuseId)
          return (
            <div key={s.id} className="flex items-center justify-between border-b border-white/5 py-2 last:border-0">
              <div>
                <p className="font-semibold text-white">{serveuse?.nom ?? '—'}</p>
                <p className="text-xs text-sable/50">{t('pilotage.depot_fin_service')}</p>
              </div>
              <div className="text-right">
                <p className="font-mono font-bold text-white">{fmtCDF(encaisses.get(s.serveuseId) ?? 0)}</p>
                <p className="text-xs text-sable/50">{t('pilotage.encaisses')}</p>
              </div>
            </div>
          )
        })}
        <div className="flex items-center justify-between border-t border-white/5 pt-2">
          <div>
            <p className="font-semibold text-white">{t('proprio.avis_clients')}</p>
            <p className="text-xs text-sable/50">{moyAvis === null ? t('pilotage.aucun_avis') : t(avisTerrasse.length > 1 ? 'gerant.avis_nb' : 'gerant.avis_une', { n: avisTerrasse.length })}</p>
          </div>
          {moyAvis === null ? (
            <p className="font-mono font-bold text-sable/40">—</p>
          ) : (
            <div className="flex items-center gap-2">
              <Etoiles note={Math.round(moyAvis)} taille={4} />
              <span className="font-mono font-bold text-white">{moyAvis.toLocaleString(LOCALES[langue], { minimumFractionDigits: 1, maximumFractionDigits: 1 })}</span>
            </div>
          )}
        </div>
      </Carte>

      {/* ---------- Dernières dépenses ---------- */}
      <p className="text-xs font-bold uppercase tracking-widest text-sable/50">{t('pilotage.dernieres_depenses')}</p>
      {dernieresDepenses.length === 0 ? (
        <p className="text-sm text-sable/50">{t('pilotage.aucune_depense')}</p>
      ) : (
        <Carte>
          {dernieresDepenses.map((d) => {
            const auteur = utilisateurDe(db, d.saisiPar)
            return (
              <div key={d.id} className="flex items-center justify-between border-b border-white/5 py-2 last:border-0">
                <div>
                  <p className="font-semibold text-white">{d.motif}</p>
                  <p className="text-xs text-sable/50">{auteur?.nom ?? '—'} · {ilYA(d.creeLe)}</p>
                </div>
                <p className="font-mono font-bold text-white">{fmtCDF(d.montantCdf)}{d.montantUsdCentimes > 0 ? ` + ${fmtUSD(d.montantUsdCentimes)}` : ''}</p>
              </div>
            )
          })}
        </Carte>
      )}

      {/* ---------- Les plus vendus aujourd'hui ---------- */}
      {top.length > 0 && (
        <>
          <p className="text-xs font-bold uppercase tracking-widest text-sable/50">{t('pilotage.top_aujourdhui')}</p>
          <Carte>
            {top.map((tp, i) => (
              <div key={tp.nom} className="flex items-center justify-between border-b border-white/5 py-2 last:border-0">
                <p className="text-sm text-white"><span className="mr-2 font-mono text-ambre">{i + 1}.</span>{tp.nom}</p>
                <p className="font-mono font-bold text-white">{tp.qte}</p>
              </div>
            ))}
          </Carte>
        </>
      )}

      {/* État des serveuses (avis détaillés — exclusif Propriétaire) */}
      <p className="text-xs font-bold uppercase tracking-widest text-sable/50">{t('proprio.etat_serveuses')}</p>
      {serveuses.length === 0 && <p className="text-sm text-sable/50">{t('proprio.aucune_serveuse_aff')}</p>}
      {serveuses.map((aff) => {
        const s = utilisateurDe(db, aff.utilisateurId)
        const avisS = avisTerrasse.filter((a) => a.serveuseId === aff.utilisateurId)
        const moy = avisS.length ? avisS.reduce((x, a) => x + a.note, 0) / avisS.length : 0
        return (
          <Carte key={aff.id}>
            <div className="flex items-center justify-between">
              <div>
                <p className="font-bold text-white">{s?.nom}</p>
                <p className="text-xs text-sable/50">{t(avisS.length > 1 ? 'gerant.avis_nb' : 'gerant.avis_une', { n: avisS.length })}{aff.actif ? '' : ` · ${t('proprio.compte_desactive')}`}</p>
              </div>
              {avisS.length > 0 && (
                <div className="flex items-center gap-2">
                  <Etoiles note={Math.round(moy)} taille={4} />
                  <span className="font-mono font-bold text-white">{moy.toLocaleString(LOCALES[langue], { minimumFractionDigits: 1, maximumFractionDigits: 1 })}</span>
                </div>
              )}
            </div>
            {avisS.filter((a) => a.commentaire).slice(0, 3).map((a) => (
              <div key={a.id} className="mt-2 flex items-start justify-between gap-2 rounded-xl bg-white/5 px-3 py-2">
                <div>
                  <p className="text-sm text-white">« {a.commentaire} »</p>
                  <p className="text-xs text-sable/40">{a.note}/5 · {ilYA(a.creeLe)}</p>
                </div>
                <button className="text-xs font-semibold text-danger-clair underline underline-offset-2" onClick={() => setMasquerId(a.id)}>
                  {t('proprio.masquer')}
                </button>
              </div>
            ))}
          </Carte>
        )
      })}

      {/* Dépôts à valider (Propriétaire peut valider) — ancre des clôtures « À traiter » */}
      <p id="pilotage-depots" className="scroll-mt-24 text-xs font-bold uppercase tracking-widest text-sable/50">{t('proprio.depots')}</p>
      <DepotsGerant terrasseId={terrasse.id} acteurId={acteurId} />

      {/* Rapports : PDF du jour (terrasse), PDF global (organisation), export CSV */}
      <SectionRapports terrasse={terrasse} mesTerrasses={mesTerrasses} moi={moi} />

      {/* Journal d'audit filtrable (actions des membres de l'organisation) */}
      <JournalAudit />

      {/* Appareils connectés au compte (session glissante, révocation) */}
      <SectionAppareils />

      <Feuille ouvert={!!masquerId} surFermer={() => setMasquerId(null)} titre={t('proprio.masquer_titre')}>
        <p className="mb-3 text-sm text-sable/70">{t('proprio.masquer_regle')}</p>
        <input className={`${classeSaisie} mb-4`} value={motifMasquage} onChange={(e) => setMotifMasquage(e.target.value)} placeholder={t('proprio.masquer_ph')} />
        <GrosBouton ton="danger" onClick={async () => {
          try { await masquerAvis(masquerId!, motifMasquage); toast.success(t('proprio.avis_masque')); setMasquerId(null); setMotifMasquage('') }
          catch (e) { toast.error(e instanceof Error ? e.message : t('commun.erreur')) }
        }}>
          {t('proprio.masquer_def')}
        </GrosBouton>
      </Feuille>
    </div>
  )
}

// ============================================================
// RAPPORTS — PDF du jour (terrasse), PDF global, export CSV
// ============================================================

/** Export CSV (compatible Excel : BOM UTF-8 + séparateur « ; ») des ventes du jour */
function exporterCsvJour(db: DB, terrasses: Terrasse[], t: (cle: string, vars?: Record<string, string | number>) => string) {
  const j = jourLubu() // borne au jour (Africa/Lubumbashi), comme le rapport du jour
  exporterCsvPeriode(db, terrasses, j, j, t, 'proprio.csv_toast')
}

/** Export COMPLET des données de l'organisation (JSON horodaté) —
 *  réservé au propriétaire. HYGIÈNE STRICTE : les PIN sont exclus
 *  explicitement — ils ne doivent jamais figurer dans un export. */
function exporterComplet(
  db: DB, mesTerrasses: Terrasse[], moi: Utilisateur,
  t: (cle: string, vars?: Record<string, string | number>) => string,
) {
  const idsTerrasses = new Set(mesTerrasses.map((te) => te.id))
  const orgIds = new Set(mesTerrasses.map((te) => te.organisationId))
  const tablesOrg = db.tables.filter((x) => idsTerrasses.has(x.terrasseId))
  const idsTables = new Set(tablesOrg.map((x) => x.id))
  // Membres = affectés sur une terrasse de l'organisation + soi-même
  const idsMembres = new Set(
    db.affectations.filter((a) => idsTerrasses.has(a.terrasseId)).map((a) => a.utilisateurId),
  )
  idsMembres.add(moi.id)
  const donnees = {
    meta: {
      application: 'GBS / Nganda POS',
      dateExport: new Date().toISOString(),
      jourComptable: 'Africa/Lubumbashi (UTC+2)',
      version: db.version,
    },
    organisations: db.organisations.filter((o) => orgIds.has(o.id)),
    terrasses: mesTerrasses,
    // JAMAIS de PIN dans un export (règle sécurité permanente)
    utilisateurs: db.utilisateurs.filter((u) => idsMembres.has(u.id)).map((u) => {
      const copie: Partial<Utilisateur> = { ...u }
      delete (copie as { pin?: unknown }).pin
      return copie
    }),
    affectations: db.affectations.filter((x) => idsTerrasses.has(x.terrasseId)),
    tables: tablesOrg,
    produits: db.produits.filter((x) => idsTerrasses.has(x.terrasseId)),
    clientsSession: db.clientsSession.filter((x) => idsTables.has(x.tableId)),
    commandes: db.commandes.filter((x) => idsTerrasses.has(x.terrasseId)),
    sessionsService: db.sessionsService.filter((x) => idsTerrasses.has(x.terrasseId)),
    depots: db.depots.filter((x) => idsTerrasses.has(x.terrasseId)),
    depenses: db.depenses.filter((x) => idsTerrasses.has(x.terrasseId)),
    avis: db.avis.filter((x) => idsTerrasses.has(x.terrasseId)),
    demandesStock: db.demandesStock.filter((x) => idsTerrasses.has(x.terrasseId)),
    mouvementsStock: db.mouvementsStock.filter((x) => idsTerrasses.has(x.terrasseId)),
    alertes: db.alertes.filter((x) => idsTerrasses.has(x.terrasseId)),
    auditLog: db.auditLog.filter((x) => x.acteurId !== null && idsMembres.has(x.acteurId)),
    abonnements: db.abonnements.filter((x) => idsTerrasses.has(x.terrasseId)),
    paiements: db.paiements.filter((x) => idsTerrasses.has(x.terrasseId)),
    factures: db.factures.filter((x) => idsTerrasses.has(x.terrasseId)),
  }
  const url = URL.createObjectURL(new Blob([JSON.stringify(donnees, null, 2)], { type: 'application/json;charset=utf-8' }))
  const a = document.createElement('a')
  a.href = url
  a.download = `gbs-export-complet-${jourLubu()}.json`
  a.click()
  URL.revokeObjectURL(url)
  toast.success(t('proprio.export_complet_toast'))
}

/** Export CSV des ventes d'une période [début, fin] (jours Lubumbashi inclus).
 *  Même format que l'export du jour ; nom de fichier daté de la période. */
function exporterCsvPeriode(
  db: DB, terrasses: Terrasse[], debut: string, fin: string,
  t: (cle: string, vars?: Record<string, string | number>) => string,
  cleToast = 'proprio.csv_periode_toast',
) {
  const ids = new Set(terrasses.map((t) => t.id))
  const lignes = db.commandes
    .filter((c) => {
      if (!ids.has(c.terrasseId) || c.statut !== 'SERVIE' || !c.servieLe) return false
      const j = jourLubu(c.servieLe) // comparaison de jours « AAAA-MM-JJ » : chaînes triables
      return j >= debut && j <= fin
    })
    .sort((a, b) => a.servieLe!.localeCompare(b.servieLe!))
  const corps = lignes.map((c) => {
    const t = db.terrasses.find((x) => x.id === c.terrasseId)
    const table = db.tables.find((x) => x.id === c.tableId)
    const client = db.clientsSession.find((x) => x.id === c.clientSessionId)
    const detail = c.lignes.map((l) => `${l.quantite}× ${l.nom}`).join(', ').replaceAll('"', '""')
    return [dateHeure(c.servieLe!), t?.nom ?? '', table?.numero ?? '', client?.prenom ?? '',
      `"${detail}"`, c.totalCdf, (c.totalUsdCentimes / 100).toFixed(2)].join(';')
  })
  const csv = '﻿' + ['date_heure;etablissement;table;client;detail;total_cdf;total_usd', ...corps].join('\n')
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
  const a = document.createElement('a')
  a.href = url
  a.download = debut === fin ? `gbs-ventes-${debut}.csv` : `gbs-ventes-${debut}_au_${fin}.csv`
  a.click()
  URL.revokeObjectURL(url)
  toast.success(t(cleToast, { n: lignes.length }))
}

function SectionRapports({ terrasse, mesTerrasses, moi }: { terrasse: Terrasse; mesTerrasses: Terrasse[]; moi: Utilisateur }) {
  const t = useT()
  const db = useDB()
  // Une seule zone d'impression à la fois : on monte celle choisie puis on imprime
  const [impression, setImpression] = useState<'jour' | 'global' | null>(null)
  // Export sur période libre (jours Lubumbashi, bornes incluses) — défaut : aujourd'hui
  const [debut, setDebut] = useState(jourLubu())
  const [fin, setFin] = useState(jourLubu())
  const imprimer = (quoi: 'jour' | 'global') => {
    setImpression(quoi)
    setTimeout(() => window.print(), 60) // laisse React monter la zone avant l'impression
  }
  const exporterPeriode = () => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(debut) || !/^\d{4}-\d{2}-\d{2}$/.test(fin) || debut > fin) {
      toast.error(t('proprio.periode_invalide'))
      return
    }
    exporterCsvPeriode(db, mesTerrasses, debut, fin, t)
  }
  return (
    <>
      <p className="text-xs font-bold uppercase tracking-widest text-sable/50">{t('proprio.rapports')}</p>
      <div className="grid grid-cols-3 gap-2">
        <GrosBouton petit ton="secondaire" onClick={() => imprimer('jour')}>
          <Printer className="h-4 w-4" /> {t('proprio.du_jour')}
        </GrosBouton>
        <GrosBouton petit ton="secondaire" onClick={() => imprimer('global')}>
          <Printer className="h-4 w-4" /> {t('proprio.global')}
        </GrosBouton>
        <GrosBouton petit ton="secondaire" onClick={() => exporterCsvJour(db, mesTerrasses, t)}>
          <Download className="h-4 w-4" /> CSV
        </GrosBouton>
      </div>
      {/* Export sur période libre : deux dates (jour comptable de Lubumbashi) + CSV */}
      <Carte>
        <p className="mb-2 text-sm font-bold text-white">{t('proprio.periode_titre')}</p>
        <div className="flex items-end gap-2">
          <label className="flex-1">
            <span className="mb-1 block text-xs text-sable/60">{t('proprio.periode_debut')}</span>
            <input type="date" className={classeSaisie} value={debut} max={fin} onChange={(e) => setDebut(e.target.value)} />
          </label>
          <label className="flex-1">
            <span className="mb-1 block text-xs text-sable/60">{t('proprio.periode_fin')}</span>
            <input type="date" className={classeSaisie} value={fin} min={debut} onChange={(e) => setFin(e.target.value)} />
          </label>
          <GrosBouton petit ton="secondaire" onClick={exporterPeriode}>
            <Download className="h-4 w-4" /> CSV
          </GrosBouton>
        </div>
      </Carte>
      {/* Export complet : toutes les données de l'organisation en JSON
          (sauvegarde propriétaire — les PIN n'y figurent jamais) */}
      <GrosBouton ton="secondaire" onClick={() => exporterComplet(db, mesTerrasses, moi, t)}>
        <Download className="h-4 w-4" /> {t('proprio.export_complet')}
      </GrosBouton>
      {impression === 'jour' && <RapportJour terrasseId={terrasse.id} />}
      {impression === 'global' && <RapportGlobal terrasses={mesTerrasses} />}
    </>
  )
}

/** Rapport journalier GLOBAL (toutes les terrasses de l'organisation), imprimable → PDF */
function RapportGlobal({ terrasses }: { terrasses: Terrasse[] }) {
  const { t, langue } = useI18n()
  const db = useDB()
  const dateJour = new Intl.DateTimeFormat(LOCALES[langue], { timeZone: 'Africa/Lubumbashi', dateStyle: 'full' }).format(new Date())
  const lignes = terrasses.map((t) => {
    const ventes = ventesDuJour(db, t.id)
    // Dépôts du jour uniquement (cohérent avec le titre « rapport journalier »)
    const depots = db.depots.filter((d) => d.terrasseId === t.id && jourLubu(d.declareLe) === jourLubu())
    return { t, ventes, depose: depots.reduce((s, d) => s + d.declareCdf, 0) }
  })
  const totCdf = lignes.reduce((s, l) => s + l.ventes.cdf, 0)
  const totUsd = lignes.reduce((s, l) => s + l.ventes.usdCentimes, 0)
  const totNb = lignes.reduce((s, l) => s + l.ventes.nb, 0)

  // Portal au niveau <body> : seul ce bloc s'imprime (#root est masqué au print)
  return createPortal(
    <div className="zone-impression hidden print:block">
      <h1 style={{ fontSize: 22, fontWeight: 800 }}>{t('proprio.rapport_global_titre')}</h1>
      <p style={{ marginTop: 4 }}>{dateJour} · {t(terrasses.length > 1 ? 'proprio.etablissements_pl' : 'proprio.etablissements_une', { n: terrasses.length })}</p>
      <hr style={{ margin: '12px 0' }} />
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <tbody>
          <tr><td>{t('proprio.commandes_servies_total')}</td><td style={{ textAlign: 'right', fontWeight: 700 }}>{totNb}</td></tr>
          <tr><td>{t('proprio.ventes_cdf_total')}</td><td style={{ textAlign: 'right', fontWeight: 700 }}>{fmtCDF(totCdf)}</td></tr>
          <tr><td>{t('proprio.ventes_usd_total')}</td><td style={{ textAlign: 'right', fontWeight: 700 }}>{(totUsd / 100).toFixed(2)} $</td></tr>
        </tbody>
      </table>
      {lignes.map(({ t: te, ventes, depose }) => (
        <div key={te.id} style={{ marginTop: 16, pageBreakInside: 'avoid' }}>
          <h2 style={{ fontSize: 16, fontWeight: 800 }}>{te.nom} — {te.adresse}</h2>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, marginTop: 6 }}>
            <tbody>
              <tr style={{ borderBottom: '1px solid #ddd' }}>
                <td style={{ padding: '4px 0' }}>{t('gerant.commandes_servies')}</td>
                <td style={{ textAlign: 'right', fontWeight: 700 }}>{ventes.nb}</td>
              </tr>
              <tr style={{ borderBottom: '1px solid #ddd' }}>
                <td style={{ padding: '4px 0' }}>{t('proprio.ventes')}</td>
                <td style={{ textAlign: 'right', fontWeight: 700 }}>{fmtCDF(ventes.cdf)}{ventes.usdCentimes > 0 ? ` + ${(ventes.usdCentimes / 100).toFixed(2)} $` : ''}</td>
              </tr>
              <tr style={{ borderBottom: '1px solid #ddd' }}>
                <td style={{ padding: '4px 0' }}>{t('gerant.depose_jour')}</td>
                <td style={{ textAlign: 'right' }}>{fmtCDF(depose)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      ))}
      <p style={{ marginTop: 16, fontSize: 12 }}>{t('proprio.rapport_global_pied')}</p>
    </div>,
    document.body,
  )
}

// ============================================================
// APPAREILS CONNECTÉS — sessions du compte (session glissante)
// Le propriétaire voit ses appareils et déconnecte à distance
// ceux qu'il ne reconnaît pas (téléphone perdu, vol…).
// ============================================================

function SectionAppareils() {
  const t = useT()
  const appareils = trpc.gbs.mesAppareils.useQuery(undefined, { retry: false, refetchOnWindowFocus: false })
  const liste = appareils.data ?? []
  return (
    <>
      <p className="text-xs font-bold uppercase tracking-widest text-sable/50">{t('proprio.appareils_titre')}</p>
      <p className="-mt-2 text-xs text-sable/50">{t('proprio.appareils_detail')}</p>
      <Carte>
        {appareils.isLoading && <p className="text-sm text-sable/50">{t('commun.chargement')}</p>}
        {!appareils.isLoading && liste.length === 0 && (
          <p className="text-sm text-sable/50">{t('proprio.appareils_aucun')}</p>
        )}
        {liste.map((a) => (
          <div key={a.sessionId} className="flex items-center justify-between gap-2 border-b border-white/5 py-2 last:border-0">
            <div>
              <p className="text-sm font-semibold text-white">
                {a.courant ? t('proprio.appareil_courant') : t('proprio.appareil_autre')}
              </p>
              <p className="text-xs text-sable/50">
                {t('proprio.appareil_activite', { il: ilYA(a.derniereActiviteLe) })} · {t('proprio.appareil_ouvert', { il: ilYA(a.creeLe) })}
              </p>
            </div>
            {!a.courant && (
              <button
                className="shrink-0 text-xs font-semibold text-danger-clair underline underline-offset-2"
                onClick={async () => {
                  try {
                    await revoquerAppareil(a.sessionId)
                    toast.success(t('proprio.appareil_revoque'))
                    await appareils.refetch()
                  } catch (e) { toast.error(e instanceof Error ? e.message : t('commun.erreur')) }
                }}
              >
                {t('proprio.appareil_revoquer')}
              </button>
            )}
          </div>
        ))}
      </Carte>
    </>
  )
}

// ============================================================
// JOURNAL D'AUDIT — filtrable (exclusif Propriétaire, côté serveur)
// ============================================================

function JournalAudit() {
  const t = useT()
  const db = useDB()
  const [filtre, setFiltre] = useState('')
  const entrees = db.auditLog
    .filter((a) => !filtre.trim() || `${a.action} ${a.details}`.toLowerCase().includes(filtre.trim().toLowerCase()))
    .sort((a, b) => b.creeLe.localeCompare(a.creeLe))
    .slice(0, 30)

  return (
    <>
      <div className="flex items-center justify-between">
        <p className="text-xs font-bold uppercase tracking-widest text-sable/50">{t('proprio.journal_audit')}</p>
        <ScrollText className="h-4 w-4 text-sable/40" />
      </div>
      <input
        className={classeSaisie}
        value={filtre}
        onChange={(e) => setFiltre(e.target.value)}
        placeholder={t('proprio.filtrer_ph')}
      />
      {entrees.length === 0 && (
        <p className="text-sm text-sable/50">{t('proprio.aucune_ecriture', { filtre: filtre ? t('proprio.pour_filtre') : '' })}</p>
      )}
      {entrees.map((a) => {
        const acteur = utilisateurDe(db, a.acteurId)
        return (
          <div key={a.id} className="rounded-2xl border border-white/8 bg-surface/60 px-4 py-3">
            <div className="flex items-center justify-between gap-2">
              <p className="font-mono text-xs font-bold text-ambre">{a.action}</p>
              <p className="text-xs text-sable/40">{ilYA(a.creeLe)}</p>
            </div>
            <p className="mt-1 text-sm text-white">{a.details}</p>
            <p className="mt-0.5 text-xs text-sable/50">
              {acteur?.nom ?? t('proprio.systeme')}{a.roleActif ? t('proprio.role_prefix', { role: libelleRole(a.roleActif) }) : ''}
            </p>
          </div>
        )
      })}
    </>
  )
}

// ============================================================
// CARTE — stock et prix (exclusif Propriétaire)
// ============================================================

function CarteProduits({ terrasseId }: { terrasseId: string }) {
  const t = useT()
  const db = useDB()
  const [edition, setEdition] = useState<Produit | null>(null)
  const [ajout, setAjout] = useState(false)
  const produits = db.produits.filter((p) => p.terrasseId === terrasseId)
  const mouvements = db.mouvementsStock.filter((m) => m.terrasseId === terrasseId).slice(0, 10)
  const categories = Array.from(new Set(produits.map((p) => p.categorie)))

  return (
    <div className="flex flex-col gap-3 px-4 pt-4">
      <div className="flex items-center justify-between">
        <p className="rounded-2xl bg-ambre/10 px-4 py-2 text-xs font-semibold text-ambre">
          {t('proprio.stock_regle')}
        </p>
        <button onClick={() => setAjout(true)} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-ambre text-sur-ambre active:bg-ambre-actif" aria-label={t('proprio.ajouter_produit')}>
          <Plus className="h-5 w-5" />
        </button>
      </div>

      {categories.map((cat) => (
        <div key={cat}>
          <p className="mb-2 text-xs font-bold uppercase tracking-widest text-sable/50">{cat}</p>
          {produits.filter((p) => p.categorie === cat).map((p) => {
            const dispo = p.stock - p.stockReserve
            return (
              <div key={p.id} className={`mb-2 flex items-center gap-3 rounded-2xl border border-white/8 bg-surface px-4 py-3 ${!p.actif ? 'opacity-40' : ''}`}>
                <div className="min-w-0 flex-1">
                  <p className="font-semibold text-white">{p.nom} {!p.actif && <span className="text-xs text-danger-clair">{t('proprio.retire')}</span>}</p>
                  <div className="flex items-center gap-2">
                    <Money cdf={p.prixCdf} usd={p.prixUsdCentimes} />
                    {dispo <= p.seuilAlerte && p.actif && <Pill ton="rouge">{t('proprio.bas')}</Pill>}
                  </div>
                </div>
                <div className="text-right">
                  <p className="font-mono text-lg font-bold text-white">{dispo}</p>
                  <p className="text-xs text-sable/50">/ {p.stock}</p>
                </div>
                <button onClick={() => setEdition(p)} className="flex h-11 w-11 items-center justify-center rounded-full bg-white/8 text-sable transition-colors focus-visible:ring-2 focus-visible:ring-ambre/60 active:bg-white/15" aria-label={t('proprio.modifier')}>
                  <Pencil className="h-4 w-4" />
                </button>
              </div>
            )
          })}
        </div>
      ))}

      {mouvements.length > 0 && (
        <>
          <p className="mt-2 text-xs font-bold uppercase tracking-widest text-sable/50">{t('proprio.journal_mouvements')}</p>
          {mouvements.map((m) => {
            const p = db.produits.find((x) => x.id === m.produitId)
            return (
              <div key={m.id} className="flex items-center justify-between rounded-xl border border-white/8 bg-surface/50 px-3 py-2 text-sm">
                <div>
                  <p className="text-white">{p?.nom} <span className="text-sable/50">· {m.motif}</span></p>
                  <p className="text-xs text-sable/40">{t(`mouvement.${m.type.toLowerCase()}`)} · {ilYA(m.creeLe)}</p>
                </div>
                <p className={`font-mono font-bold ${m.quantite >= 0 ? 'text-succes-clair' : 'text-danger-clair'}`}>{m.quantite > 0 ? '+' : ''}{m.quantite}</p>
              </div>
            )
          })}
        </>
      )}

      {/* Formulaires produit = blocs protégés (Phase B.2) : un plantage
          du formulaire ne ferme pas la carte ni ne perd l'écran */}
      {edition && <BlocBoundary><FeuilleEdition produit={edition} surFermer={() => setEdition(null)} /></BlocBoundary>}
      {ajout && <BlocBoundary><FeuilleAjout terrasseId={terrasseId} surFermer={() => setAjout(false)} /></BlocBoundary>}
    </div>
  )
}

function FeuilleEdition({ produit, surFermer }: { produit: Produit; surFermer: () => void }) {
  const t = useT()
  const [cdf, setCdf] = useState(String(produit.prixCdf || ''))
  const [usd, setUsd] = useState(produit.prixUsdCentimes ? (produit.prixUsdCentimes / 100).toFixed(2) : '')
  const [type, setType] = useState<TypeMouvement>('ENTREE')
  const [qte, setQte] = useState('')
  const [motif, setMotif] = useState('')

  return (
    <Feuille ouvert surFermer={surFermer} titre={produit.nom}>
      <div className="flex flex-col gap-4">
        {/* Photo du produit (menu client) : toujours une URL, posée par le super-admin après demande */}
        <div className="rounded-2xl border border-white/10 p-3">
          <div className="flex items-center gap-4">
            {produit.photoUrl ? (
              <img src={produit.photoThumbnailUrl ?? produit.photoUrl} alt={produit.nom} className="h-16 w-16 rounded-xl object-cover" />
            ) : (
              <div className="flex h-16 w-16 items-center justify-center rounded-xl bg-white/5 text-sable/40">
                <Camera className="h-6 w-6" />
              </div>
            )}
            <div className="min-w-0 flex-1">
              <p className="text-sm font-bold text-white">{t('proprio.photo_produit')}</p>
              <p className="text-xs text-sable/60">
                {t('proprio.photo_source', { source: produit.photoSource === 'UPLOAD' || produit.photoSource === 'URL' ? t('proprio.photo_perso') : t('proprio.photo_generique') })}
              </p>
            </div>
          </div>
          <div className="mt-3">
            <BoutonDemandePhoto cible="PRODUIT" cibleId={produit.id} terrasseId={produit.terrasseId} libelle={produit.nom} />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="mb-1.5 block text-sm font-semibold text-sable">{t('proprio.prix_fc')}</span>
            <SaisieNombre valeur={cdf} onChange={setCdf} placeholder="0" />
          </label>
          <label className="block">
            <span className="mb-1.5 block text-sm font-semibold text-sable">{t('proprio.prix_usd')}</span>
            <input className={`${classeSaisie} font-mono`} inputMode="decimal" value={usd} onChange={(e) => setUsd(e.target.value)} placeholder="0,00" />
          </label>
        </div>
        <GrosBouton petit ton="secondaire" onClick={async () => {
          try {
            await modifierPrix(produit.id, parseInt(cdf) || 0, Math.round((parseFloat(usd.replace(',', '.')) || 0) * 100))
            toast.success(t('proprio.prix_ok'))
          } catch (e) { toast.error(e instanceof Error ? e.message : t('commun.erreur')) }
        }}>
          {t('proprio.enregistrer_prix')}
        </GrosBouton>

        <div className="border-t border-white/10 pt-4">
          <p className="mb-2 text-sm font-bold text-white">{t('proprio.ecriture_stock')} <span className="font-normal text-sable/50">{t('proprio.stock_actuel', { n: produit.stock })}</span></p>
          <div className="mb-3 grid grid-cols-4 gap-1.5">
            {(['ENTREE', 'PERTE', 'INVENTAIRE', 'AJUSTEMENT'] as const).map((ty) => (
              <button
                key={ty}
                onClick={() => setType(ty)}
                className={`rounded-xl py-2 text-[11px] font-bold ${type === ty ? 'bg-ambre text-sur-ambre' : 'bg-white/8 text-sable'}`}
              >
                {ty === 'ENTREE' ? t('mouvement.entree') : ty === 'PERTE' ? t('mouvement.perte') : ty === 'INVENTAIRE' ? t('mouvement.inventaire') : t('mouvement.ajustement')}
              </button>
            ))}
          </div>
          <div className="mb-3 grid grid-cols-2 gap-3">
            <label className="block">
              <span className="mb-1.5 block text-sm font-semibold text-sable">
                {type === 'INVENTAIRE' ? t('proprio.stock_reel') : type === 'AJUSTEMENT' ? t('proprio.quantite_pm') : t('proprio.quantite')}
              </span>
              <input className={`${classeSaisie} font-mono`} inputMode="numeric" value={qte} onChange={(e) => setQte(e.target.value)} placeholder="0" />
            </label>
            <label className="block">
              <span className="mb-1.5 block text-sm font-semibold text-sable">{t('proprio.motif_obligatoire')}</span>
              <input className={classeSaisie} value={motif} onChange={(e) => setMotif(e.target.value)} placeholder={t('proprio.motif_ph')} />
            </label>
          </div>
          <GrosBouton petit onClick={async () => {
            try {
              await ajusterStock(produit.id, type, parseInt(qte) || 0, motif)
              toast.success(t('proprio.stock_ok'))
              setQte(''); setMotif('')
            } catch (e) { toast.error(e instanceof Error ? e.message : t('commun.erreur')) }
          }}>
            <Package className="h-5 w-5" /> {t('proprio.appliquer_stock')}
          </GrosBouton>
        </div>

        <GrosBouton petit ton="danger" onClick={async () => {
          try { await basculerProduitActif(produit.id); toast.success(produit.actif ? t('proprio.produit_retire') : t('proprio.produit_remis')); surFermer() }
          catch (e) { toast.error(e instanceof Error ? e.message : t('commun.erreur')) }
        }}>
          {produit.actif ? t('proprio.retirer_carte') : t('proprio.remettre_carte')}
        </GrosBouton>
      </div>
    </Feuille>
  )
}

function FeuilleAjout({ terrasseId, surFermer }: { terrasseId: string; surFermer: () => void }) {
  const t = useT()
  const { langue } = useI18n()
  const db = useDB()
  const terrasse = terrasseDe(db, terrasseId)
  const [nom, setNom] = useState('')
  // Catégorie choisie (libellé FR stocké en base) — défaut : la
  // première catégorie du métier (une pharmacie propose
  // « Médicaments », pas « Divers »).
  const [categorie, setCategorie] = useState<string>('')
  const [cdf, setCdf] = useState('')
  const [stock, setStock] = useState('')
  // --- Champs adaptatifs (boucle 3) ---
  const [unite, setUnite] = useState('')
  const [capacite, setCapacite] = useState('')
  const [duree, setDuree] = useState('')
  const [lot, setLot] = useState('')
  const [peremption, setPeremption] = useState('')
  // --- Scan code-barres ---
  const [scan, setScan] = useState(false)
  const [codeBarres, setCodeBarres] = useState<string | null>(null)
  const [sourceScan, setSourceScan] = useState<'LOCAL' | 'OPEN_FOOD_FACTS' | 'INCONNU' | null>(null)
  const [recherche, setRecherche] = useState(false)
  const [variante, setVariante] = useState('')
  const [consignable, setConsignable] = useState(false)
  const [casier, setCasier] = useState<number | undefined>(undefined)
  const [photoScan, setPhotoScan] = useState<string | null>(null)

  // Catégories du ou des métiers de l'établissement (registre fusionné),
  // + celles déjà utilisées (libellés libres historiques), + « Divers ».
  const categoriesRef = useMemo(() => {
    if (!terrasse) return []
    const vues = new Map<string, CategorieProduit>()
    for (const ty of tousLesTypes(terrasse.type, terrasse.typesSecondaires ?? [])) {
      for (const c of categoriesPour(ty)) {
        if (!vues.has(c.nomFr)) vues.set(c.nomFr, c)
      }
    }
    return [...vues.values()].sort((a, b) => a.ordreAffichage - b.ordreAffichage)
  }, [terrasse])
  const utilisees = Array.from(new Set(
    db.produits.filter((p) => p.terrasseId === terrasseId).map((p) => p.categorie),
  )).filter((u) => u && u !== 'Divers' && !categoriesRef.some((c) => c.nomFr === u))
  const categorieEffective = categorie || categoriesRef[0]?.nomFr || 'Divers'

  // Nature du produit déduite de la catégorie : pilote les champs
  // affichés (capacité pour une chambre, durée pour un service…)
  const catChoisie = categoriesRef.find((c) => c.nomFr === categorieEffective)
  const typeProduit: TypeProduit = catChoisie ? typeProduitParDefaut(catChoisie.code) : 'MARCHANDISE'
  const sansStock = TYPES_SANS_STOCK.includes(typeProduit)
  const avecPeremption = defFusionnee(
    terrasse?.type ?? 'TERRASSE', terrasse?.typesSecondaires ?? [],
  ).modules.includes('LOTS_PEREMPTION')

  /** Libellé de catégorie dans la langue de l'utilisateur */
  const nomCat = (c: CategorieProduit) => (langue === 'en' ? c.nomEn : langue === 'pt' ? c.nomPt : c.nomFr)

  /** Après un scan : référentiel local puis Open Food Facts (côté serveur) */
  async function auScan(code: string) {
    setScan(false)
    setCodeBarres(code)
    setRecherche(true)
    setSourceScan(null)
    try {
      const r = await rechercherParCodeBarres(code)
      if (r) {
        setNom(r.nom)
        if (r.categorie) setCategorie(r.categorie)
        if (r.variante) setVariante(r.variante)
        setConsignable(r.consignable)
        setCasier(r.bouteillesParCasier ?? undefined)
        setPhotoScan(r.photoUrl)
        if (r.prixCdfMoyen) setCdf(String(r.prixCdfMoyen))
        setSourceScan(r.source)
      } else {
        // Inconnu partout : saisie manuelle, le code sera mémorisé à l'enregistrement
        setSourceScan('INCONNU')
      }
    } catch {
      setSourceScan('INCONNU') // réseau coupé : on ne bloque jamais l'ajout
    } finally {
      setRecherche(false)
    }
  }

  const enregistrer = async () => {
    // Validations adaptatives (le serveur les impose aussi)
    if (typeProduit === 'CHAMBRE' && !(parseInt(capacite) >= 1)) {
      toast.error(t('proprio.capacite_requise'))
      return
    }
    if (typeProduit === 'SERVICE' && !(parseInt(duree) >= 1)) {
      toast.error(t('proprio.duree_requise'))
      return
    }
    try {
      await creerProduit(terrasseId, nom, categorieEffective, parseInt(cdf) || 0, 0, sansStock ? 0 : parseInt(stock) || 0, 6, {
        codeBarres: codeBarres ?? undefined,
        variante: variante || undefined,
        consignable,
        bouteillesParCasier: casier,
        photoUrl: photoScan && (photoScan.startsWith("http") || photoScan.startsWith("/uploads/")) ? photoScan : undefined,
        typeProduit,
        unite: unite.trim() || undefined,
        capacite: typeProduit === 'CHAMBRE' ? parseInt(capacite) : undefined,
        dureeMinutes: typeProduit === 'SERVICE' ? parseInt(duree) : undefined,
        lot: lot.trim() || undefined,
        datePeremption: peremption || undefined,
      })
      // Code inconnu du référentiel : on le mémorise pour les prochains scans
      if (codeBarres && sourceScan === 'INCONNU') {
        void enregistrerCodeBarres({
          codeBarres, nom, categorie: categorieEffective,
          variante: variante || undefined,
          consignable, bouteillesParCasier: casier,
          prixCdfMoyen: parseInt(cdf) || undefined,
        }).catch(() => { /* silencieux : l'ajout du produit est déjà fait */ })
      }
      toast.success(t('proprio.produit_ajoute'))
      surFermer()
    } catch (e) { toast.error(e instanceof Error ? e.message : t('commun.erreur')) }
  }

  return (
    <Feuille ouvert surFermer={surFermer} titre={t('proprio.nouveau_produit')}>
      <div className="flex flex-col gap-4">
        <GrosBouton ton="secondaire" onClick={() => setScan(true)}>
          <ScanBarcode className="h-5 w-5" /> {t('proprio.scanner_cb')}
        </GrosBouton>

        {/* Résultat du scan : source + pré-remplissage */}
        {recherche && <p className="text-center text-sm text-sable/70">{t('proprio.recherche_code', { code: codeBarres ?? '' })}</p>}
        {sourceScan && !recherche && (
          <div className={`flex items-center gap-2 rounded-2xl px-4 py-2.5 text-sm font-semibold ${
            sourceScan === 'INCONNU' ? 'bg-ambre/10 text-ambre' : 'bg-emerald-500/10 text-emerald-400'
          }`}>
            {sourceScan === 'LOCAL' && <><CheckCircle2 className="h-4 w-4 shrink-0" /> {t('proprio.code_local', { code: codeBarres ?? '' })}</>}
            {sourceScan === 'OPEN_FOOD_FACTS' && <><Globe className="h-4 w-4 shrink-0" /> {t('proprio.code_off', { code: codeBarres ?? '' })}</>}
            {sourceScan === 'INCONNU' && <><CircleAlert className="h-4 w-4 shrink-0" /> {t('proprio.code_inconnu', { code: codeBarres ?? '' })}</>}
          </div>
        )}
        {photoScan && (
          <img src={photoScan} alt={nom} className="mx-auto h-24 w-24 rounded-2xl object-cover border border-white/10" />
        )}

        <input className={classeSaisie} value={nom} onChange={(e) => setNom(e.target.value)} placeholder={t('proprio.nom_produit_ph')} />

        {/* Catégories DU MÉTIER (registre fusionné), traduites ; la valeur
            envoyée reste le libellé français (convention de la base) */}
        <select
          className={`${classeSaisie} [&>option]:bg-surface`}
          value={categorieEffective}
          onChange={(e) => setCategorie(e.target.value)}
          aria-label={t('proprio.categorie_label')}
        >
          {categoriesRef.map((c) => <option key={c.nomFr} value={c.nomFr}>{nomCat(c)}</option>)}
          {utilisees.map((u) => <option key={u} value={u}>{u}</option>)}
          {!categoriesRef.some((c) => c.nomFr === 'Divers') && <option value="Divers">{t('proprio.divers')}</option>}
        </select>

        {variante !== '' && (
          <input className={classeSaisie} value={variante} onChange={(e) => setVariante(e.target.value)} placeholder={t('proprio.variante_ph')} />
        )}
        {consignable && (
          <p className="rounded-2xl bg-white/5 px-4 py-2.5 text-sm text-sable/80">
            {t('proprio.consigne')}{casier ? t('proprio.casier', { n: casier }) : ''}
          </p>
        )}

        {/* Champs par nature de produit */}
        {typeProduit === 'CHAMBRE' && (
          <div>
            <p className="mb-1 text-sm font-semibold text-sable/80">{t('proprio.capacite_label')}</p>
            <SaisieNombre valeur={capacite} onChange={setCapacite} placeholder={t('proprio.capacite_ph')} min={1} />
          </div>
        )}
        {typeProduit === 'SERVICE' && (
          <div>
            <p className="mb-1 text-sm font-semibold text-sable/80">{t('proprio.duree_label')}</p>
            <SaisieNombre valeur={duree} onChange={setDuree} placeholder={t('proprio.duree_ph')} min={1} />
          </div>
        )}
        {typeProduit === 'MARCHANDISE' && (
          <input className={classeSaisie} value={unite} onChange={(e) => setUnite(e.target.value)} placeholder={t('proprio.unite_ph')} />
        )}
        {typeProduit === 'MARCHANDISE' && avecPeremption && (
          <div className="grid grid-cols-2 gap-3">
            <input className={classeSaisie} value={lot} onChange={(e) => setLot(e.target.value)} placeholder={t('proprio.lot_ph')} />
            <input
              className={classeSaisie} type="date" value={peremption}
              onChange={(e) => setPeremption(e.target.value)} aria-label={t('proprio.peremption_label')}
            />
          </div>
        )}

        <div className={sansStock ? '' : 'grid grid-cols-2 gap-3'}>
          <SaisieNombre
            valeur={cdf} onChange={setCdf}
            placeholder={typeProduit === 'CHAMBRE'
              ? t('proprio.prix_nuit_ph')
              : typeProduit === 'SERVICE'
                ? t('proprio.prix_prestation_ph')
                : t('proprio.prix_fc_ph')}
          />
          {/* Services et parties de billard : jamais de stock */}
          {!sansStock && <SaisieNombre valeur={stock} onChange={setStock} placeholder={t('proprio.stock_initial_ph')} />}
        </div>
        <GrosBouton desactive={!nom.trim()} onClick={() => void enregistrer()}>
          <Plus className="h-5 w-5" /> {t('proprio.ajouter')}
        </GrosBouton>
      </div>

      {scan && (
        <Suspense fallback={<div className="fixed inset-0 z-[70] bg-black" />}>
          <ScanCodeBarres onScan={(code) => void auScan(code)} surFermer={() => setScan(false)} />
        </Suspense>
      )}
    </Feuille>
  )
}

// ============================================================
// ÉQUIPE — affectations et invitations
// ============================================================

function Equipe({ terrasseId }: { terrasseId: string }) {
  const t = useT()
  const db = useDB()
  const [invite, setInvite] = useState(false)
  const [role, setRole] = useState<RoleEtablissement>('SERVEUSE')
  const [nomPrevu, setNomPrevu] = useState('')
  const [codeCree, setCodeCree] = useState<string | null>(null)

  const equipe = db.affectations.filter((a) => a.terrasseId === terrasseId)
  const invitations = db.invitations.filter((i) => i.terrasseId === terrasseId && i.statut === 'ACTIVE' && i.expireLe > new Date().toISOString())
  const urlBase = window.location.origin + window.location.pathname
  // Rôles proposés = union des rôles des types de l'établissement (fusion)
  const terrasse = db.terrasses.find((x) => x.id === terrasseId)
  const rolesProposables = useMemo<readonly RoleEtablissement[]>(() => {
    const def = defFusionnee(
      (terrasse?.type ?? 'TERRASSE'),
      terrasse?.typesSecondaires ?? [],
    )
    // On filtre BILLARDIER selon le nombre de billards de l'établissement
    const nbBillards = db.tables.filter(
      (ta) => ta.terrasseId === terrasseId && ta.actif && !ta.archiveLe && ta.kind === 'BILLARD'
    ).length
    const estGrandEtablissement = nbBillards >= 3
    return def.roles.filter((r) => r !== 'BILLARDIER' || estGrandEtablissement)
  }, [terrasse, db, terrasseId])

  return (
    <div className="flex flex-col gap-3 px-4 pt-4">
      <GrosBouton onClick={() => setInvite(true)}>
        <TicketCheck className="h-5 w-5" /> {t('proprio.inviter')}
      </GrosBouton>

      <p className="text-xs font-bold uppercase tracking-widest text-sable/50">{t('proprio.equipe_terrasse')}</p>
      {equipe.map((a) => {
        const u = utilisateurDe(db, a.utilisateurId)
        return (
          <div key={a.id} className={`flex items-center gap-3 rounded-2xl border border-white/8 bg-surface px-4 py-3 ${!a.actif ? 'opacity-50' : ''}`}>
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-ambre/15 font-bold text-ambre">
              {u?.nom.split(' ').map((x) => x[0]).join('').slice(0, 2)}
            </div>
            <div className="flex-1">
              <p className="font-semibold text-white">{u?.nom}</p>
              <p className="text-xs text-sable/50">{t(`role.${a.role.toLowerCase()}`)}{!a.actif ? ` · ${t('proprio.desactive')}` : ''}</p>
            </div>
            <GrosBouton petit ton={a.actif ? 'danger' : 'secondaire'} onClick={async () => {
              try { await basculerAffectation(a.id); toast.success(a.actif ? t('proprio.acces_coupe') : t('proprio.acces_reactive')) }
              catch (e) { toast.error(e instanceof Error ? e.message : t('commun.erreur')) }
            }}>
              {a.actif ? t('proprio.desactiver') : t('proprio.reactiver')}
            </GrosBouton>
          </div>
        )
      })}
      <p className="text-xs text-sable/40">{t('proprio.equipe_note')}</p>

      {invitations.length > 0 && (
        <>
          <p className="mt-2 text-xs font-bold uppercase tracking-widest text-sable/50">{t('proprio.invitations_cours')}</p>
          {invitations.map((i) => (
            <div key={i.id} className="flex items-center justify-between rounded-2xl border border-ambre/30 bg-ambre/5 px-4 py-3">
              <div>
                <p className="font-mono text-lg font-bold tracking-widest text-ambre">{i.code}</p>
                <p className="text-xs text-sable/60">{t(`role.${i.role.toLowerCase()}`)}{i.nomPrevu ? t('proprio.prevu_pour', { nom: i.nomPrevu }) : ''}{t('proprio.expire_dans', { j: joursRestants(i.expireLe) })}</p>
              </div>
              <button className="text-sm font-semibold text-danger-clair underline underline-offset-2" onClick={async () => {
                try { await revoquerInvitation(i.id); toast.success(t('proprio.invitation_revoquee')) }
                catch (e) { toast.error(e instanceof Error ? e.message : t('commun.erreur')) }
              }}>
                {t('proprio.revoquer')}
              </button>
            </div>
          ))}
        </>
      )}

      <Feuille ouvert={invite} surFermer={() => { setInvite(false); setCodeCree(null) }} titre={codeCree ? t('proprio.code_cree') : t('proprio.nouvelle_invitation')}>
        {!codeCree ? (
          <div className="flex flex-col gap-4">
            <div className="grid grid-cols-2 gap-2">
              {rolesProposables.map((r) => (
                <button key={r} onClick={() => setRole(r)} className={`rounded-2xl py-3 font-bold ${role === r ? 'bg-ambre text-sur-ambre' : 'bg-white/8 text-sable'}`}>
                  {t(`role.${r.toLowerCase()}`)}
                </button>
              ))}
            </div>
            <input className={classeSaisie} value={nomPrevu} onChange={(e) => setNomPrevu(e.target.value)} placeholder={t('proprio.nom_prevu_ph')} />
            <GrosBouton onClick={async () => {
              try { setCodeCree(await creerInvitation(terrasseId, role, nomPrevu)) }
              catch (e) { toast.error(e instanceof Error ? e.message : t('commun.erreur')) }
            }}>
              {t('proprio.generer_code')}
            </GrosBouton>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-4 text-center">
            <p className="font-mono text-4xl font-black tracking-[0.3em] text-ambre">{codeCree}</p>
            <p className="text-sm text-sable/70">{t('proprio.code_info')}</p>
            <GrosBouton petit ton="secondaire" onClick={() => {
              navigator.clipboard?.writeText(`${urlBase}#/invitation`)
              toast.success(t('proprio.lien_copie'))
            }}>
              {t('proprio.copier_lien')}
            </GrosBouton>
          </div>
        )}
      </Feuille>
    </div>
  )
}

// ============================================================
// TABLES — création / archivage (modifie la tranche tarifaire)
// ============================================================

function Tables({ terrasseId }: { terrasseId: string }) {
  const t = useT()
  const db = useDB()
  const [confirmCreation, setConfirmCreation] = useState(false)
  const [archivage, setArchivage] = useState<string | null>(null)

  const terrasse = terrasseDe(db, terrasseId)
  // Établissement 100 % comptoir (pharmacie, boutique…) : le vocabulaire
  // « table » n'existe pas — on parle de comptoirs (registre annexe).
  const salle = terrasse
    ? tousLesTypes(terrasse.type, terrasse.typesSecondaires ?? []).some(aTablesDeSalle)
    : true

  const tables = db.tables.filter((t) => t.terrasseId === terrasseId)
  const actives = tables.filter((t) => t.actif)
  const trancheActuelle = tranchePourTables(actives.length)
  const trancheApres = tranchePourTables(actives.length + 1)
  const franchit = trancheActuelle !== trancheApres
  const abo = db.abonnements.find((a) => a.terrasseId === terrasseId)
  const historique = db.historiqueTranches.filter((h) => h.abonnementId === abo?.id)

  return (
    <div className="flex flex-col gap-3 px-4 pt-4">
      <Carte classe="!py-3">
        <div className="flex items-center justify-between">
          <div>
            <p className="font-bold text-white">
              {salle ? t('proprio.tables_actives_titre', { n: actives.length }) : t('proprio.comptoirs_actifs_titre', { n: actives.length })}
            </p>
            <p className="text-xs text-sable/60">
              {t('proprio.tranche_resume', { tranche: t(`tranche.${trancheActuelle.toLowerCase()}`), prix: abo ? fmtUSD(tarifDe(db, abo.plan, trancheActuelle).prixUsdCentimes) : '' })}
            </p>
          </div>
          <GrosBouton petit onClick={() => setConfirmCreation(true)}>
            <Plus className="h-4 w-4" /> {t('proprio.ajouter')}
          </GrosBouton>
        </div>
      </Carte>

      <div className="grid grid-cols-4 gap-2">
        {tables.map((ta) => (
          <button
            key={ta.id}
            disabled={!ta.actif}
            onClick={() => setArchivage(ta.id)}
            className={`flex flex-col items-center justify-center gap-0.5 rounded-2xl border py-3 text-center font-mono font-bold ${ta.actif ? 'border-white/10 bg-surface text-white active:border-danger/50' : 'border-white/5 text-sable/30 line-through'} ${ta.kind === 'BILLARD' ? 'border-ambre/40' : ''}`}
          >
            {ta.kind === 'BILLARD' && <Target className="h-3.5 w-3.5 text-ambre" />}
            {ta.numero}
          </button>
        ))}
      </div>
      <p className="text-xs text-sable/40">{salle ? t('proprio.archiver_consigne') : t('proprio.archiver_consigne_comptoir')}</p>

      {historique.length > 0 && (
        <>
          <p className="mt-2 text-xs font-bold uppercase tracking-widest text-sable/50">{t('proprio.changements_tranche')}</p>
          {historique.map((h) => (
            <div key={h.id} className="rounded-2xl border border-white/8 bg-surface/60 px-4 py-3 text-sm">
              <p className="text-white">{t('proprio.tranche_transition', { avant: t(`tranche.${h.ancienne.toLowerCase()}`), apres: t(`tranche.${h.nouvelle.toLowerCase()}`), n: h.nbTables })}</p>
              <p className="text-xs text-sable/50">{t('proprio.prorata_ligne', { montant: fmtUSD(h.prorataUsdCentimes), date: dateHeure(h.creeLe) })}</p>
            </div>
          ))}
        </>
      )}

      {/* Confirmation création : avertissement de tranche */}
      <Feuille
        ouvert={confirmCreation}
        surFermer={() => setConfirmCreation(false)}
        titre={salle ? t('proprio.ajouter_table_titre') : t('proprio.ajouter_comptoir_titre')}
      >
        {franchit ? (
          <div className="mb-4 rounded-2xl bg-ambre/10 p-4">
            <p className="font-bold text-ambre">{t('proprio.tranche_monte', { tranche: t(`tranche.${trancheApres.toLowerCase()}`) })}</p>
            <p className="mt-1 text-sm text-sable/80">
              {t('proprio.tranche_surcout', { montant: abo ? fmtUSD(tarifDe(db, abo.plan, trancheApres).prixUsdCentimes - tarifDe(db, abo.plan, trancheActuelle).prixUsdCentimes) : '' })}
            </p>
          </div>
        ) : (
          <p className="mb-4 text-sm text-sable/70">{t('proprio.tranche_stable', { tranche: t(`tranche.${trancheActuelle.toLowerCase()}`) })}</p>
        )}
        <GrosBouton onClick={async () => {
          try {
            const info = await creerTable(terrasseId)
            toast.success(info.trancheAvant !== info.trancheApres ? t('proprio.table_creee_tranche', { tranche: t(`tranche.${(info.trancheApres as string).toLowerCase()}`), montant: fmtUSD(info.prorata) }) : salle ? t('proprio.table_creee') : t('proprio.comptoir_cree'))
            setConfirmCreation(false)
          } catch (e) { toast.error(e instanceof Error ? e.message : t('commun.erreur')) }
        }}>
          {t('proprio.confirmer_creation')}
        </GrosBouton>
      </Feuille>

      <Confirmation
        ouvert={!!archivage}
        titre={salle ? t('proprio.archiver_titre') : t('proprio.archiver_titre_comptoir')}
        message={salle ? t('proprio.archiver_message') : t('proprio.archiver_message_comptoir')}
        danger
        surAnnuler={() => setArchivage(null)}
        surConfirmer={async () => {
          try { await archiverTable(archivage!); toast.success(t('proprio.table_archivee')) }
          catch (e) { toast.error(e instanceof Error ? e.message : t('commun.erreur')) }
          setArchivage(null)
        }}
      />
    </div>
  )
}

// ============================================================
// ABONNEMENT — cycle de vie, plan, paiement mobile money
// ============================================================

function AbonnementVue({ terrasseId }: { terrasseId: string }) {
  const t = useT()
  const db = useDB()
  const [payer, setPayer] = useState(false)
  const [methode, setMethode] = useState<Paiement['methode']>('M_PESA')
  const [reference, setReference] = useState('')
  const [annuel, setAnnuel] = useState(false)

  const terrasse = terrasseDe(db, terrasseId)!
  const abo = db.abonnements.find((a) => a.terrasseId === terrasseId)
  if (!abo) return null
  const nbTables = nbTablesActives(db, terrasseId)
  const tranche = tranchePourTables(nbTables)
  const mensuel = prixMensuelTerrasse(db, terrasseId)
  const seuil = seuilSuivant(db, terrasseId)
  const paiements = db.paiements.filter((p) => p.terrasseId === terrasseId)
  const factures = db.factures.filter((f) => f.terrasseId === terrasseId)
  const org = organisationDe(db, terrasse.organisationId)
  const nbTerrasses = db.terrasses.filter((t) => t.organisationId === org?.id).length

  const STATUTS: Record<string, { label: string; ton: 'vert' | 'ambre' | 'rouge' | 'bleu' | 'neutre' }> = {
    ESSAI: { label: t('abo.statut_essai', { j: abo.essaiFin ? joursRestants(abo.essaiFin) : 0 }), ton: 'bleu' },
    ACTIF: { label: t('abo.statut_actif'), ton: 'vert' },
    EN_GRACE: { label: t('abo.statut_grace'), ton: 'ambre' },
    LECTURE_SEULE: { label: t('abo.statut_lecture'), ton: 'rouge' },
    SUSPENDU: { label: t('abo.statut_suspendu'), ton: 'rouge' },
  }
  const st = STATUTS[abo.statut]
  // Installation unique selon le type d'établissement (5 $ boutique/salon, 10 $ sinon)
  const montantDu = (annuel ? mensuel * 10 : mensuel) + abo.prorataDuUsdCentimes + (abo.fraisInstallPayes ? 0 : fraisInstallationPour(abo.typeEtablissement ?? terrasse.type))

  return (
    <div className="flex flex-col gap-4 px-4 pt-4">
      <Carte classe={abo.statut === 'LECTURE_SEULE' || abo.statut === 'SUSPENDU' ? 'border-danger/40' : abo.statut === 'EN_GRACE' ? 'border-ambre/40' : ''}>
        <div className="mb-3 flex items-center justify-between">
          <p className="font-bold text-white">{t('abo.plan_ligne', { plan: PLANS.find((p) => p.code === abo.plan)?.nom ?? abo.plan })}</p>
          <Pill ton={st.ton}>{st.label}</Pill>
        </div>
        <div className="grid grid-cols-2 gap-2 text-sm">
          <div className="rounded-xl bg-white/5 p-3">
            <p className="text-xs text-sable/50">{t('abo.tranche')}</p>
            <p className="font-bold text-white">{t('abo.tranche_tables', { tranche: t(`tranche.${tranche.toLowerCase()}`), n: nbTables })}</p>
          </div>
          <div className="rounded-xl bg-white/5 p-3">
            <p className="text-xs text-sable/50">{t('abo.prix_mois')}</p>
            <p className="font-mono font-bold text-white">{fmtUSD(mensuel)}</p>
          </div>
          <div className="rounded-xl bg-white/5 p-3">
            <p className="text-xs text-sable/50">{t('abo.echeance')}</p>
            <p className="font-bold text-white">{dateCourte(abo.periodeFin)}</p>
          </div>
          <div className="rounded-xl bg-white/5 p-3">
            <p className="text-xs text-sable/50">{t('abo.seuil_suivant')}</p>
            <p className="font-bold text-white">{seuil ? t('abo.seuil_valeur', { n: seuil.tables, montant: fmtUSD(seuil.surcoutCentimes) }) : t('abo.tranche_max')}</p>
          </div>
        </div>
        {nbTerrasses >= 3 && (
          <p className="mt-2 rounded-xl bg-succes/10 px-3 py-2 text-xs font-semibold text-succes-clair">
            {t('abo.remise_multi', { pct: nbTerrasses >= 5 ? '25 %' : '15 %', n: nbTerrasses })}
          </p>
        )}
        {abo.prorataDuUsdCentimes > 0 && (
          <p className="mt-2 text-xs text-sable/60">{t('abo.prorata_du', { montant: fmtUSD(abo.prorataDuUsdCentimes) })}</p>
        )}
        <div className="mt-4">
          <GrosBouton onClick={() => setPayer(true)}>
            <BadgeDollarSign className="h-5 w-5" /> {t('abo.payer_mobile', { montant: fmtUSD(montantDu) })}
          </GrosBouton>
        </div>
      </Carte>

      {/* Plans proposés selon le type d'établissement (feuille de route 3 ans) */}
      <p className="text-xs font-bold uppercase tracking-widest text-sable/50">{t('abo.changer_plan')}</p>
      <div className="grid grid-cols-3 gap-2">
        {plansPour(terrasse.type ?? 'TERRASSE').map((p) => {
          const actif = abo.plan === p.code
          return (
            <div key={p.code} className={`rounded-2xl border p-3 text-center ${actif ? 'border-ambre/60 bg-ambre/8' : 'border-white/10'}`}>
              <p className="font-bold text-white">{p.nom}</p>
              <p className="mt-0.5 font-mono text-sm text-sable">{fmtUSD(tarifDe(db, p.code, tranche).prixUsdCentimes)}<span className="text-xs">/m</span></p>
              {actif ? (
                <p className="mt-1 text-[11px] font-bold text-ambre">{t('abo.plan_actuel')}</p>
              ) : p.disponible ? (
                <p className="mt-1 text-[11px] text-sable/50">{t('abo.disponible')}</p>
              ) : (
                <p className="mt-1 text-[11px] font-semibold text-info">{t('abo.annee_bientot', { annee: p.annee ?? '' })}</p>
              )}
            </div>
          )
        })}
      </div>
      <p className="text-xs text-sable/40">{t('abo.feuille_route')}</p>

      {/* Historique */}
      {paiements.length > 0 && <p className="text-xs font-bold uppercase tracking-widest text-sable/50">{t('abo.paiements')}</p>}
      {paiements.slice(0, 5).map((p) => (
        <div key={p.id} className="flex items-center justify-between rounded-2xl border border-white/8 bg-surface/60 px-4 py-3">
          <div>
            <p className="font-semibold text-white">{fmtUSD(p.montantUsdCentimes)} · {p.methode.replace('_', ' ')}</p>
            <p className="text-xs text-sable/50">{t('abo.ref_ligne', { reference: p.reference, date: dateHeure(p.creeLe) })}</p>
          </div>
          <Pill ton={p.statut === 'VALIDE' ? 'vert' : p.statut === 'REJETE' ? 'rouge' : 'ambre'}>
            {p.statut === 'VALIDE' ? t('paiement.statut_valide') : p.statut === 'REJETE' ? t('paiement.statut_rejete') : t('paiement.statut_verification')}
          </Pill>
        </div>
      ))}

      {factures.length > 0 && <p className="text-xs font-bold uppercase tracking-widest text-sable/50">{t('abo.factures')}</p>}
      {factures.slice(0, 5).map((f) => (
        <div key={f.id} className="flex items-center justify-between rounded-2xl border border-white/8 bg-surface/60 px-4 py-3">
          <div>
            <p className="font-mono font-semibold text-white">{f.numero}</p>
            <p className="text-xs text-sable/50">{PLANS.find((p) => p.code === f.plan)?.nom} · {t('abo.facture_ligne', { tranche: t(`tranche.${f.tranche.toLowerCase()}`) })} · {dateCourte(f.creeLe)}</p>
          </div>
          <p className="font-mono font-bold text-white">{fmtUSD(f.montantUsdCentimes)}</p>
        </div>
      ))}

      {/* Feuille paiement */}
      <Feuille ouvert={payer} surFermer={() => setPayer(false)} titre={t('abo.payer_titre')}>
        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-3 gap-2">
            {([['M_PESA', 'M-Pesa'], ['AIRTEL_MONEY', 'Airtel'], ['ORANGE_MONEY', 'Orange']] as const).map(([m, label]) => (
              <button key={m} onClick={() => setMethode(m)} className={`rounded-2xl py-3 text-sm font-bold ${methode === m ? 'bg-ambre text-sur-ambre' : 'bg-white/8 text-sable'}`}>
                {label}
              </button>
            ))}
          </div>
          <label className="flex cursor-pointer items-center gap-3 rounded-2xl border border-white/10 px-4 py-3">
            <input type="checkbox" checked={annuel} onChange={(e) => setAnnuel(e.target.checked)} className="h-5 w-5 accent-ambre" />
            <div>
              <p className="text-sm font-semibold text-white">{t('abo.payer_annee')}</p>
              <p className="text-xs text-sable/60">{t('abo.dix_mois')}</p>
            </div>
          </label>
          <div className="rounded-2xl bg-white/5 p-4 text-center">
            <p className="text-xs text-sable/50">{t('abo.montant_envoyer')}{!abo.fraisInstallPayes ? t('abo.inclut_install') : ''}</p>
            <p className="font-mono text-2xl font-black text-white">{fmtUSD(montantDu)}</p>
            {terrasse.parametres.tauxUsdCdf !== null && (
              <p className="mt-1 text-xs text-sable/50">{t('abo.equivalent_fc', { montant: (montantDu * terrasse.parametres.tauxUsdCdf / 100).toLocaleString('fr-CD') })}</p>
            )}
          </div>
          <label className="block">
            <span className="mb-1.5 block text-sm font-semibold text-sable">{t('abo.reference_label')}</span>
            <input className={`${classeSaisie} font-mono`} value={reference} onChange={(e) => setReference(e.target.value)} placeholder={t('abo.reference_ph')} />
          </label>
          <GrosBouton onClick={async () => {
            try {
              await soumettrePaiement(terrasseId, methode, reference, annuel)
              toast.success(t('abo.paiement_soumis'))
              setPayer(false)
              setReference('')
            } catch (e) { toast.error(e instanceof Error ? e.message : t('commun.erreur')) }
          }}>
            {t('abo.soumettre')}
          </GrosBouton>
          <p className="text-center text-xs text-sable/40">{t('abo.validation_note')}</p>
        </div>
      </Feuille>
    </div>
  )
}
