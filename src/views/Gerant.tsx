// ============================================================
// GBS — Interface GÉRANT : tableau de bord, validation des
// dépôts, stock en lecture seule, QR codes, demandes de stock,
// assignation serveuse ↔ table, rapport du jour.
// ============================================================

import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import QRCode from 'qrcode'
import {
  BedDouble, ChefHat, CircleAlert, ClipboardList, Download, HandCoins, LayoutDashboard, Printer,
  QrCode, ReceiptText, RefreshCw, Star, Target, UserRound, UsersRound, Wallet,
} from 'lucide-react'
import { PanneauBillards } from './Billard'
import { PanneauNotes } from './NotesStaff'
import { PanneauRemisesGerant } from './RemisesGerant'
import { PanneauHotel } from './Hotel'
import { PanneauPlansTraiteur } from './Traiteur'
import { toast } from 'sonner'
import { BoutonDeconnexion, CoquilleRole, PorteRole } from '@/components/Coquille'
import { BlocCaisse } from '@/components/Caisse'
import {
  BoutonSupportWhatsApp, Carte, Etoiles, Feuille, GrosBouton, Money, Pill, QR, SaisieNombre, Vide, classeSaisie,
} from '@/components/gbs'
import { dateHeure, fmtCDF, fmtUSD, heureLubu, ilYA } from '@/lib/format'
import { defFusionnee, tousLesTypes } from '@contracts/types'
import { LOCALES, useI18n, useT } from '@/i18n'
import {
  FournisseurPortee, assignerServeuse, creerDemandeStock, exporterComptabiliteJour, marquerAlertesLues,
  jourLubu, serveuseDeTable, tablesDeServeuse, terrasseDe, useDB, useSession, utilisateurDe,
  validerDepot, ventesDuJour,
} from '@/lib/store'
import type { Portee, Terrasse, Utilisateur } from '@/lib/types'

export function VueGerant() {
  const [session] = useSession()
  const portee: Portee = session ? { kind: 'staff' } : { kind: 'public' }
  return (
    <FournisseurPortee portee={portee}>
      <VueGerantInterne />
    </FournisseurPortee>
  )
}

function VueGerantInterne() {
  const t = useT()
  return (
    <PorteRole rolesVoulus={['GERANT']} indiceDemo={t('gerant.indice_demo')}>
      {({ moi, terrasse }) => <EspaceGerant moi={moi} terrasse={terrasse} />}
    </PorteRole>
  )
}

function EspaceGerant({ moi, terrasse }: { moi: Utilisateur; terrasse: Terrasse }) {
  const t = useT()
  const db = useDB()
  const [onglet, setOnglet] = useState('tableau')

  const depotsEnAttente = db.depots.filter((d) => d.terrasseId === terrasse.id && d.statut === 'DECLARE' && d.serveuseId !== moi.id).length
  const alertesNonLues = db.alertes.filter((a) => a.terrasseId === terrasse.id && !a.lu).length
  // Onglet Billards seulement si l'établissement en exploite
  const aBillards = db.tables.some((ta) => ta.terrasseId === terrasse.id && ta.actif && !ta.archiveLe && ta.kind === 'BILLARD')
  // Onglet Hôtel seulement pour une guest house
  const aChambres = tousLesTypes(terrasse.type, terrasse.typesSecondaires ?? []).includes('GUEST_HOUSE')
  // Onglet Traiteur seulement si l'établissement a une cuisine
  // (module CUISINE_BAR du registre : terrasse, restaurant, guest house)
  const aTraiteur = defFusionnee(terrasse.type, terrasse.typesSecondaires ?? []).modules.includes('CUISINE_BAR')

  return (
    <CoquilleRole
      titre={terrasse.nom}
      sousTitre={`${moi.nom} — ${t('role.gerant')}`}
      droite={
        <div className="flex items-center gap-1">
          <BoutonSupportWhatsApp />
          <BoutonDeconnexion />
        </div>
      }
      actif={onglet}
      onChange={setOnglet}
      onglets={[
        { id: 'tableau', label: t('gerant.onglet_tableau'), icone: <LayoutDashboard className="h-6 w-6" />, badge: alertesNonLues },
        { id: 'depots', label: t('gerant.onglet_depots'), icone: <Wallet className="h-6 w-6" />, badge: depotsEnAttente },
        { id: 'stock', label: t('gerant.onglet_stock'), icone: <ClipboardList className="h-6 w-6" /> },
        ...(aBillards ? [{ id: 'billards', label: t('billard.onglet_gestion'), icone: <Target className="h-6 w-6" /> }] : []),
        ...(aChambres ? [{ id: 'hotel', label: t('hotel.onglet'), icone: <BedDouble className="h-6 w-6" /> }] : []),
        { id: 'qr', label: t('gerant.onglet_qr'), icone: <QrCode className="h-6 w-6" /> },
        { id: 'serveuses', label: t('gerant.onglet_serveuses'), icone: <Star className="h-6 w-6" /> },
        { id: 'notes', label: t('gerant.onglet_notes'), icone: <ReceiptText className="h-6 w-6" /> },
        { id: 'remises', label: t('gerant.onglet_remises'), icone: <HandCoins className="h-6 w-6" /> },
        ...(aTraiteur ? [{ id: 'traiteur', label: t('gerant.onglet_traiteur'), icone: <ChefHat className="h-6 w-6" /> }] : []),
      ]}
    >
      {onglet === 'tableau' && <TableauGerant terrasseId={terrasse.id} alertesNonLues={alertesNonLues} />}
      {onglet === 'billards' && aBillards && <PanneauBillards terrasseId={terrasse.id} avecConfig />}
      {onglet === 'hotel' && aChambres && <PanneauHotel terrasseId={terrasse.id} mode="direction" />}
      {onglet === 'depots' && <DepotsGerant terrasseId={terrasse.id} acteurId={moi.id} />}
      {onglet === 'stock' && <StockGerant terrasseId={terrasse.id} />}
      {onglet === 'qr' && <QRGerant terrasseId={terrasse.id} />}
      {onglet === 'serveuses' && <ServeusesGerant terrasseId={terrasse.id} />}
      {onglet === 'notes' && <PanneauNotes terrasseId={terrasse.id} />}
      {onglet === 'remises' && <PanneauRemisesGerant terrasseId={terrasse.id} />}
      {onglet === 'traiteur' && aTraiteur && <PanneauPlansTraiteur terrasseId={terrasse.id} />}
    </CoquilleRole>
  )
}

// ---------- Tableau de bord ----------

function TableauGerant({ terrasseId, alertesNonLues }: { terrasseId: string; alertesNonLues: number }) {
  const t = useT()
  const db = useDB()
  const ventes = ventesDuJour(db, terrasseId)
  const enCours = db.commandes.filter((c) => c.terrasseId === terrasseId && (c.statut === 'EN_ATTENTE' || c.statut === 'CONFIRMEE'))
  const alertes = db.alertes.filter((a) => a.terrasseId === terrasseId).slice(0, 6)
  const sessionsOuvertes = db.sessionsService.filter((s) => s.terrasseId === terrasseId && s.statut === 'OUVERTE')
  // Cash servi non encore encaissé : les clients concernés sont bloqués
  // pour toute nouvelle commande tant que ce n'est pas marqué « payée »
  const impayees = db.commandes.filter((c) => c.terrasseId === terrasseId && c.statut === 'SERVIE' && !c.payeeLe)
  const impCdf = impayees.reduce((t, c) => t + c.totalCdf, 0)
  const impUsd = impayees.reduce((t, c) => t + c.totalUsdCentimes, 0)
  void alertesNonLues

  return (
    <div className="flex flex-col gap-4 px-4 pt-4">
      <div className="grid grid-cols-2 gap-3">
        <Carte>
          <p className="text-xs uppercase tracking-widest text-sable/50">{t('gerant.ventes_jour')}</p>
          <div className="mt-1"><Money cdf={ventes.cdf} usd={ventes.usdCentimes} gros /></div>
          <p className="mt-1 text-xs text-sable/50">{t(ventes.nb > 1 ? 'gerant.ventes_servies_pl' : 'gerant.ventes_servies_une', { n: ventes.nb })}</p>
        </Carte>
        <Carte>
          <p className="text-xs uppercase tracking-widest text-sable/50">{t('gerant.en_cours')}</p>
          <p className="mt-1 font-mono text-xl font-bold text-white">{enCours.length}</p>
          <p className="mt-1 text-xs text-sable/50">{t(sessionsOuvertes.length > 1 ? 'gerant.sessions_pl' : 'gerant.sessions_une', { n: sessionsOuvertes.length })}</p>
        </Carte>
      </div>

      {/* Solde de la boutique + dépenses du jour (caisse) */}
      <BlocCaisse terrasseId={terrasseId} />

      {impayees.length > 0 && (
        <div className="flex items-center gap-3 rounded-2xl border border-ambre/40 bg-ambre/10 px-4 py-3">
          <HandCoins className="h-6 w-6 shrink-0 text-ambre" />
          <p className="text-sm text-white">
            <b>{t('gerant.non_encaisse')} {fmtCDF(impCdf)}{impUsd > 0 ? ` + ${fmtUSD(impUsd)}` : ''}</b>
            {' '}— {t(impayees.length > 1 ? 'gerant.impayees_pl' : 'gerant.impayees_une', { n: impayees.length })}
          </p>
        </div>
      )}

      {enCours.length > 0 && (
        <>
          <p className="text-xs font-bold uppercase tracking-widest text-sable/50">{t('gerant.commandes_en_cours')}</p>
          {enCours.map((c) => {
            const table = db.tables.find((t) => t.id === c.tableId)
            const client = db.clientsSession.find((x) => x.id === c.clientSessionId)
            return (
              <div key={c.id} className="flex items-center justify-between rounded-2xl border border-white/8 bg-surface px-4 py-3">
                <div>
                  <p className="font-semibold text-white">{t('serveuse.table_mot')} {table?.numero} · {client?.prenom}</p>
                  <p className="text-xs text-sable/50">{c.statut === 'EN_ATTENTE' ? t('gerant.a_confirmer') : t('gerant.confirmee')} · {ilYA(c.creeLe)}</p>
                </div>
                <Money cdf={c.totalCdf} usd={c.totalUsdCentimes} />
              </div>
            )
          })}
        </>
      )}

      <div className="flex items-center justify-between">
        <p className="text-xs font-bold uppercase tracking-widest text-sable/50">{t('gerant.alertes')}</p>
        <div className="flex items-center gap-3">
          {alertes.some((a) => !a.lu) && (
            <button
              className="shrink-0 whitespace-nowrap text-xs font-semibold text-ambre underline underline-offset-2"
              onClick={async () => { try { await marquerAlertesLues(terrasseId) } catch { /* silencieux */ } }}
            >
              {t('serveuse.tout_lu')}
            </button>
          )}
          <GrosBouton petit ton="secondaire" onClick={() => window.print()}>
            <Printer className="h-4 w-4" /> {t('gerant.rapport_jour')}
          </GrosBouton>
          <BoutonExportCSV terrasseId={terrasseId} />
        </div>
      </div>
      {alertes.length === 0 && <p className="text-sm text-sable/50">{t('gerant.aucune_alerte')}</p>}
      {alertes.map((a) => (
        <div key={a.id} className={`flex items-start gap-3 rounded-2xl border px-4 py-3 ${a.lu ? 'border-white/8 bg-surface/50' : a.type === 'ECART_CAISSE' ? 'border-danger/30 bg-danger/8' : 'border-ambre/30 bg-ambre/8'}`}>
          <CircleAlert className={`mt-0.5 h-5 w-5 shrink-0 ${a.type === 'ECART_CAISSE' ? 'text-danger-clair' : 'text-ambre'}`} />
          <div>
            <p className="text-sm text-white">{a.message}</p>
            <p className="mt-0.5 text-xs text-sable/50">{ilYA(a.creeLe)}</p>
          </div>
        </div>
      ))}

      <RapportJour terrasseId={terrasseId} />
    </div>
  )
}

/** Rapport journalier (imprimable → PDF) de la terrasse — aussi utilisé par le Propriétaire */
/** Export comptable CSV de la journée (billard, hôtel, commandes,
 *  dépenses) — téléchargement direct, compatible Excel FR. */
function BoutonExportCSV({ terrasseId }: { terrasseId: string }) {
  const t = useT()
  const [enCours, setEnCours] = useState(false)
  const exporter = async () => {
    setEnCours(true)
    try {
      const jour = jourLubu()
      const r = await exporterComptabiliteJour(terrasseId, jour)
      const blob = new Blob([r.csv], { type: 'text/csv;charset=utf-8' })
      const a = document.createElement('a')
      a.href = URL.createObjectURL(blob)
      a.download = `gbs-export-${jour}.csv`
      a.click()
      URL.revokeObjectURL(a.href)
      toast.success(t('gerant.export_csv_ok', { net: fmtCDF(r.totaux.netCdf) }))
    } catch (e) { toast.error(e instanceof Error ? e.message : t('commun.erreur')) }
    finally { setEnCours(false) }
  }
  return (
    <GrosBouton petit ton="secondaire" desactive={enCours} charge={enCours} onClick={() => void exporter()}>
      <Download className="h-4 w-4" /> {t('gerant.export_csv')}
    </GrosBouton>
  )
}

export function RapportJour({ terrasseId }: { terrasseId: string }) {
  const { t, langue } = useI18n()
  const db = useDB()
  const terrasse = terrasseDe(db, terrasseId)!
  const ventes = ventesDuJour(db, terrasseId)
  const commandes = db.commandes.filter((c) => c.terrasseId === terrasseId && c.statut === 'SERVIE')
  const sessionOuverte = db.sessionsService.some((s) => s.terrasseId === terrasseId && s.statut === 'OUVERTE')
  // Dépôts du jour uniquement (heure de Lubumbashi) : un rapport journalier ne doit pas cumuler l'historique
  const depots = db.depots.filter((d) => d.terrasseId === terrasseId && jourLubu(d.declareLe) === jourLubu())
  const totalDepose = depots.reduce((s, d) => s + d.declareCdf, 0)
  const dateJour = new Intl.DateTimeFormat(LOCALES[langue], { timeZone: 'Africa/Lubumbashi', dateStyle: 'full' }).format(new Date())

  // Portal au niveau <body> : à l'impression, #root est masqué et seul ce bloc s'imprime
  return createPortal(
    <div className="zone-impression hidden print:block">
      <h1 style={{ fontSize: 22, fontWeight: 800 }}>{t('gerant.rapport_titre')}</h1>
      <p style={{ marginTop: 4 }}>{terrasse.nom} — {terrasse.adresse}</p>
      <p>{dateJour} · <b>{sessionOuverte ? t('gerant.provisoire') : t('gerant.definitif')}</b></p>
      <hr style={{ margin: '12px 0' }} />
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <tbody>
          <tr><td>{t('gerant.commandes_servies')}</td><td style={{ textAlign: 'right', fontWeight: 700 }}>{ventes.nb}</td></tr>
          <tr><td>{t('gerant.ventes_cdf')}</td><td style={{ textAlign: 'right', fontWeight: 700 }}>{fmtCDF(ventes.cdf)}</td></tr>
          <tr><td>{t('gerant.ventes_usd')}</td><td style={{ textAlign: 'right', fontWeight: 700 }}>{(ventes.usdCentimes / 100).toFixed(2)} $</td></tr>
          <tr><td>{t('gerant.depose_jour')}</td><td style={{ textAlign: 'right' }}>{fmtCDF(totalDepose)}</td></tr>
        </tbody>
      </table>
      <hr style={{ margin: '12px 0' }} />
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
        <thead>
          <tr style={{ borderBottom: '1px solid #000' }}>
            <th style={{ textAlign: 'left', padding: '4px 0' }}>{t('gerant.col_heure')}</th>
            <th style={{ textAlign: 'left' }}>{t('gerant.col_table')}</th>
            <th style={{ textAlign: 'left' }}>{t('gerant.col_detail')}</th>
            <th style={{ textAlign: 'right' }}>{t('gerant.col_montant')}</th>
          </tr>
        </thead>
        <tbody>
          {commandes.map((c) => {
            const table = db.tables.find((t) => t.id === c.tableId)
            return (
              <tr key={c.id} style={{ borderBottom: '1px solid #ddd' }}>
                <td style={{ padding: '4px 0' }}>{c.servieLe ? heureLubu(c.servieLe) : ''}</td>
                <td>{table?.numero}</td>
                <td>{c.lignes.map((l) => `${l.quantite}× ${l.nom}`).join(', ')}</td>
                <td style={{ textAlign: 'right' }}>{c.totalCdf > 0 ? fmtCDF(c.totalCdf) : ''}{c.totalCdf > 0 && c.totalUsdCentimes > 0 ? ' + ' : ''}{c.totalUsdCentimes > 0 ? `${(c.totalUsdCentimes / 100).toFixed(2)} $` : ''}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
      <p style={{ marginTop: 16, fontSize: 12 }}>{t('gerant.rapport_pied')}</p>
    </div>,
    document.body,
  )
}

// ---------- Validation des dépôts ----------

export function DepotsGerant({ terrasseId, acteurId }: { terrasseId: string; acteurId: string }) {
  const t = useT()
  const db = useDB()
  const [contestDepot, setContestDepot] = useState<string | null>(null)
  const [motif, setMotif] = useState('')
  const depots = db.depots.filter((d) => d.terrasseId === terrasseId)
  const enAttente = depots.filter((d) => d.statut === 'DECLARE')
  const historique = depots.filter((d) => d.statut !== 'DECLARE')

  return (
    <div className="flex flex-col gap-3 px-4 pt-4">
      {enAttente.length === 0 && historique.length === 0 && (
        <Vide icone={<HandCoins className="h-8 w-8" />} titre={t('gerant.aucun_depot')} detail={t('gerant.aucun_depot_d')} />
      )}
      {enAttente.map((d) => {
        const serveuse = utilisateurDe(db, d.serveuseId)
        const ecartCdf = d.declareCdf - d.montantAttenduCdf
        const ecartUsd = d.declareUsdCentimes - d.montantAttenduUsdCentimes
        const propre = d.serveuseId === acteurId
        return (
          <Carte key={d.id} classe={Math.abs(ecartCdf) > 0 || Math.abs(ecartUsd) > 0 ? 'border-danger/40' : ''}>
            <div className="mb-2 flex items-center justify-between">
              <p className="font-bold text-white">{serveuse?.nom}</p>
              <Pill ton="ambre">{t('gerant.a_valider')}</Pill>
            </div>
            <div className="mb-3 grid grid-cols-2 gap-2 text-sm">
              <div className="rounded-xl bg-white/5 p-3">
                <p className="text-xs text-sable/50">{t('gerant.attendu')}</p>
                <Money cdf={d.montantAttenduCdf} usd={d.montantAttenduUsdCentimes} />
              </div>
              <div className="rounded-xl bg-white/5 p-3">
                <p className="text-xs text-sable/50">{t('gerant.declare')}</p>
                <Money cdf={d.declareCdf} usd={d.declareUsdCentimes} />
              </div>
            </div>
            {(ecartCdf !== 0 || ecartUsd !== 0) && (
              <p className={`mb-3 rounded-xl px-3 py-2 text-sm font-bold ${ecartCdf < 0 || ecartUsd < 0 ? 'bg-danger/15 text-danger-clair' : 'bg-succes/15 text-succes-clair'}`}>
                {t('gerant.ecart')} {ecartCdf !== 0 && `${ecartCdf > 0 ? '+' : '−'}${fmtCDF(Math.abs(ecartCdf))}`}{ecartCdf !== 0 && ecartUsd !== 0 && ' · '}{ecartUsd !== 0 && `${ecartUsd > 0 ? '+' : '−'}${(Math.abs(ecartUsd) / 100).toFixed(2)} $`}
              </p>
            )}
            <p className="mb-3 text-xs text-sable/50">{t('gerant.declare_ilya', { ilya: ilYA(d.declareLe) })}</p>
            {propre ? (
              <p className="rounded-xl bg-white/5 px-3 py-2 text-center text-sm text-sable/60">{t('gerant.propre_depot')}</p>
            ) : (
              <div className="flex gap-2">
                <GrosBouton petit ton="danger" onClick={() => setContestDepot(d.id)}>{t('gerant.contester')}</GrosBouton>
                <GrosBouton petit onClick={async () => {
                  try { await validerDepot(d.id, 'VALIDE'); toast.success(t('gerant.depot_valide')) }
                  catch (e) { toast.error(e instanceof Error ? e.message : t('commun.erreur')) }
                }}>
                  {t('gerant.valider')}
                </GrosBouton>
              </div>
            )}
          </Carte>
        )
      })}

      {historique.length > 0 && <p className="mt-2 text-xs font-bold uppercase tracking-widest text-sable/50">{t('gerant.historique')}</p>}
      {historique.slice(0, 8).map((d) => {
        const serveuse = utilisateurDe(db, d.serveuseId)
        return (
          <div key={d.id} className="flex items-center justify-between rounded-2xl border border-white/8 bg-surface/60 px-4 py-3">
            <div>
              <p className="font-semibold text-white">{serveuse?.nom}</p>
              <p className="text-xs text-sable/50">{dateHeure(d.declareLe)}{d.motifContest ? ` — ${d.motifContest}` : ''}</p>
            </div>
            <div className="text-right">
              <Money cdf={d.declareCdf} usd={d.declareUsdCentimes} />
              <div className="mt-1"><Pill ton={d.statut === 'VALIDE' ? 'vert' : 'rouge'}>{d.statut === 'VALIDE' ? t('depot.statut_valide') : t('depot.statut_conteste')}</Pill></div>
            </div>
          </div>
        )
      })}

      <Feuille ouvert={!!contestDepot} surFermer={() => setContestDepot(null)} titre={t('gerant.contester_titre')}>
        <p className="mb-3 text-sm text-sable/70">{t('gerant.contester_motif')}</p>
        <textarea className={`${classeSaisie} mb-4 min-h-20`} value={motif} onChange={(e) => setMotif(e.target.value)} placeholder={t('gerant.contester_ph')} />
        <GrosBouton ton="danger" onClick={async () => {
          try { await validerDepot(contestDepot!, 'CONTESTE', motif); toast.success(t('gerant.depot_conteste')); setContestDepot(null); setMotif('') }
          catch (e) { toast.error(e instanceof Error ? e.message : t('commun.erreur')) }
        }}>
          {t('gerant.confirmer_contestation')}
        </GrosBouton>
      </Feuille>
    </div>
  )
}

// ---------- Stock (lecture seule) + demandes ----------

export function StockGerant({ terrasseId }: { terrasseId: string }) {
  const t = useT()
  const db = useDB()
  const [demandeProduit, setDemandeProduit] = useState<string | null>(null)
  const [quantite, setQuantite] = useState('24')
  const [motif, setMotif] = useState('')
  const produits = db.produits.filter((p) => p.terrasseId === terrasseId && p.actif)
  const demandes = db.demandesStock.filter((d) => d.terrasseId === terrasseId)

  return (
    <div className="flex flex-col gap-3 px-4 pt-4">
      <p className="rounded-2xl bg-info/10 px-4 py-3 text-sm text-info-clair">
        {t('gerant.stock_info')}
      </p>
      {produits.map((p) => {
        const dispo = p.stock - p.stockReserve
        return (
          <div key={p.id} className="flex items-center gap-3 rounded-2xl border border-white/8 bg-surface px-4 py-3">
            <div className="min-w-0 flex-1">
              <p className="font-semibold text-white">{p.nom}</p>
              <div className="flex items-center gap-2">
                <Money cdf={p.prixCdf} usd={p.prixUsdCentimes} />
                {dispo <= p.seuilAlerte && <Pill ton="rouge">{t('gerant.stock_bas')}</Pill>}
              </div>
            </div>
            <div className="text-right">
              <p className="font-mono text-lg font-bold text-white">{dispo}</p>
              <p className="text-xs text-sable/50">{t('gerant.dispo')}</p>
            </div>
            <button
              onClick={() => { setDemandeProduit(p.id); setMotif(t('gerant.motif_reappro', { nom: p.nom })) }}
              className="flex h-11 w-11 items-center justify-center rounded-full bg-white/8 text-sable transition-colors focus-visible:ring-2 focus-visible:ring-ambre/60 active:bg-white/15"
              aria-label={t('gerant.demander_reappro')}
            >
              <RefreshCw className="h-4 w-4" />
            </button>
          </div>
        )
      })}

      {demandes.length > 0 && <p className="mt-2 text-xs font-bold uppercase tracking-widest text-sable/50">{t('gerant.mes_demandes')}</p>}
      {demandes.slice(0, 6).map((d) => {
        const p = db.produits.find((x) => x.id === d.produitId)
        return (
          <div key={d.id} className="flex items-center justify-between rounded-2xl border border-white/8 bg-surface/60 px-4 py-3">
            <div>
              <p className="font-semibold text-white">{p?.nom} × {d.quantite}</p>
              <p className="text-xs text-sable/50">{ilYA(d.creeLe)}</p>
            </div>
            <Pill ton={d.statut === 'APPROUVEE' ? 'vert' : d.statut === 'REFUSEE' ? 'rouge' : 'ambre'}>
              {d.statut === 'APPROUVEE' ? t('demande.statut_approuvee') : d.statut === 'REFUSEE' ? t('demande.statut_refusee') : t('depot.statut_attente')}
            </Pill>
          </div>
        )
      })}

      <Feuille ouvert={!!demandeProduit} surFermer={() => setDemandeProduit(null)} titre={t('gerant.demande_titre')}>
        <div className="flex flex-col gap-4">
          <label className="block">
            <span className="mb-1.5 block text-sm font-semibold text-sable">{t('gerant.quantite')}</span>
            <SaisieNombre valeur={quantite} onChange={setQuantite} />
          </label>
          <label className="block">
            <span className="mb-1.5 block text-sm font-semibold text-sable">{t('gerant.motif')}</span>
            <input className={classeSaisie} value={motif} onChange={(e) => setMotif(e.target.value)} />
          </label>
          <GrosBouton onClick={async () => {
            try {
              await creerDemandeStock(terrasseId, demandeProduit!, parseInt(quantite) || 0, 'REAPPRO', motif)
              toast.success(t('gerant.demande_envoyee'))
              setDemandeProduit(null)
            } catch (e) { toast.error(e instanceof Error ? e.message : t('commun.erreur')) }
          }}>
            {t('gerant.envoyer_demande')}
          </GrosBouton>
        </div>
      </Feuille>
    </div>
  )
}

// ---------- Serveuses : notes moyennes (lecture seule, sans commentaires) ----------

export function ServeusesGerant({ terrasseId }: { terrasseId: string }) {
  const { t, langue } = useI18n()
  const db = useDB()
  const serveuses = db.affectations
    .filter((a) => a.terrasseId === terrasseId && a.role === 'SERVEUSE')
    .map((a) => ({ aff: a, u: utilisateurDe(db, a.utilisateurId) }))
    .filter((x) => x.u)
  const sessionsOuvertes = db.sessionsService.filter((s) => s.terrasseId === terrasseId && s.statut === 'OUVERTE')

  if (serveuses.length === 0) {
    return <Vide icone={<Star className="h-8 w-8" />} titre={t('gerant.aucune_serveuse')} detail={t('gerant.aucune_serveuse_d')} />
  }
  return (
    <div className="flex flex-col gap-3 px-4 pt-4">
      <p className="rounded-2xl bg-info/10 px-4 py-3 text-sm text-info-clair">
        {t('gerant.notes_info')}
      </p>
      {serveuses.map(({ aff, u }) => {
        const avis = db.avis.filter((a) => a.terrasseId === terrasseId && a.serveuseId === u!.id && !a.masque)
        const moy = avis.length ? avis.reduce((s, a) => s + a.note, 0) / avis.length : 0
        const enService = sessionsOuvertes.some((s) => s.serveuseId === u!.id)
        const nbTables = tablesDeServeuse(db, u!.id).length
        return (
          <Carte key={aff.id} classe={!aff.actif ? 'opacity-50' : ''}>
            <div className="flex items-center justify-between">
              <div>
                <p className="font-bold text-white">{u!.nom}</p>
                <p className="text-xs text-sable/50">
                  {enService ? t('gerant.en_service') : t('gerant.hors_service')} · {t(nbTables > 1 ? 'gerant.tables_nb' : 'gerant.table_une', { n: nbTables })}{!aff.actif ? ` · ${t('gerant.desactivee')}` : ''}
                </p>
              </div>
              {avis.length > 0 ? (
                <div className="text-right">
                  <div className="flex items-center gap-2">
                    <Etoiles note={Math.round(moy)} taille={4} />
                    <span className="font-mono font-bold text-white">{moy.toLocaleString(LOCALES[langue], { minimumFractionDigits: 1, maximumFractionDigits: 1 })}</span>
                  </div>
                  <p className="mt-0.5 text-xs text-sable/50">{t(avis.length > 1 ? 'gerant.avis_nb' : 'gerant.avis_une', { n: avis.length })}</p>
                </div>
              ) : (
                <Pill ton="neutre">{t('gerant.pas_avis')}</Pill>
              )}
            </div>
          </Carte>
        )
      })}
    </div>
  )
}

// ---------- QR codes + assignations ----------

export function QRGerant({ terrasseId }: { terrasseId: string }) {
  const t = useT()
  const db = useDB()
  const [assignation, setAssignation] = useState<string | null>(null)
  const [qrsImpression, setQrsImpression] = useState<Record<string, string>>({})
  const terrasse = terrasseDe(db, terrasseId)!
  // Fusionner les tables et les chambres pour l'affichage des QR
  const chambres = (db as any).chambres?.filter((c: any) => c.terrasseId === terrasseId) ?? []
  const tables = db.tables.filter((t) => t.terrasseId === terrasseId && t.actif)
  const toutesLesZones = [
    ...tables.map((t) => ({ id: t.id, numero: t.numero, tokenQr: t.tokenQr, kind: t.kind, estChambre: false })),
    ...chambres.map((c: any) => ({ id: c.id, numero: c.numero, tokenQr: c.tokenQr, kind: 'CHAMBRE', estChambre: true })),
  ]
  const serveuses = db.affectations
    .filter((a) => a.terrasseId === terrasseId && a.role === 'SERVEUSE' && a.actif)
    .map((a) => utilisateurDe(db, a.utilisateurId)!)
  const urlBase = window.location.origin + window.location.pathname

  // QR en data-URL pour l'impression (générés localement, sans réseau)
  useEffect(() => {
    let annule = false
    const generer = async () => {
      const sortie: Record<string, string> = {}
      for (const table of toutesLesZones) {
        sortie[table.id] = await QRCode.toDataURL(`${urlBase}#/t/${table.tokenQr}`, { width: 220, margin: 1 })
      }
      if (!annule) setQrsImpression(sortie)
    }
    generer()
    return () => {
      annule = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [toutesLesZones.map((table) => table.id + table.tokenQr).join(',')])

  const tableEnCours = tables.find((t) => t.id === assignation)

  return (
    <div className="flex flex-col gap-3 px-4 pt-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-sable/70">{t('gerant.tables_actives', { n: toutesLesZones.length })}</p>
        <GrosBouton petit ton="secondaire" onClick={() => window.print()}>
          <Printer className="h-4 w-4" /> {t('gerant.imprimer')}
        </GrosBouton>
      </div>

      <div className="grid grid-cols-2 gap-3">
        {toutesLesZones.map((table) => {
          const serveuse = utilisateurDe(db, serveuseDeTable(db, table.id))
          return (
            <Carte key={table.id} classe="flex flex-col items-center gap-2 text-center">
              <p className="font-mono text-xl font-black text-white">{t('serveuse.table_mot')} {table.numero}</p>
              <div className="rounded-xl bg-white p-1.5">
              <div className="relative rounded-xl bg-white p-1.5">
                <QR valeur={`${urlBase}#/t/${table.tokenQr}`} taille={110} />
                <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                  <div className="rounded-lg bg-white p-1">
                    <img src="/icons/icon.svg" alt="GBS" className="h-6 w-6" />
                  </div>
                </div>
              </div>
              </div>
              <p className="text-xs text-sable/60">
                {serveuse ? serveuse.nom : t('gerant.non_assignee')}
              </p>
              <div className="flex w-full gap-2 pas-impression">
                <button
                  onClick={() => setAssignation(table.id)}
                  className="flex h-10 flex-1 items-center justify-center rounded-xl bg-white/8 text-sable active:bg-white/15"
                  aria-label={t('gerant.assigner_aria')}
                >
                  <UsersRound className="h-4 w-4" />
                </button>
                <button
                  onClick={async () => {
                    try { await regenererQrSafe(table.id, t('gerant.qr_regenere')) } catch (e) { toast.error(e instanceof Error ? e.message : t('commun.erreur')) }
                  }}
                  className="flex h-10 flex-1 items-center justify-center rounded-xl bg-white/8 text-sable active:bg-white/15"
                  aria-label={t('gerant.regenerer_aria')}
                >
                  <RefreshCw className="h-4 w-4" />
                </button>
              </div>
            </Carte>
          )
        })}
      </div>

      <Feuille ouvert={!!assignation} surFermer={() => setAssignation(null)} titre={t('gerant.table_serveuse_titre', { numero: tableEnCours?.numero ?? '' })}>
        <div className="flex flex-col gap-2">
          {serveuses.map((s) => (
            <button
              key={s.id}
              onClick={async () => {
                try {
                  await assignerServeuse(assignation!, s.id)
                  toast.success(t('gerant.assignee_toast', { numero: tableEnCours?.numero ?? '?', nom: s.nom }))
                  setAssignation(null)
                } catch (e) { toast.error(e instanceof Error ? e.message : t('commun.erreur')) }
              }}
              className="flex items-center gap-3 rounded-2xl border border-white/10 px-4 py-3 text-left active:border-ambre/50"
            >
              <UserRound className="h-5 w-5 text-ambre" />
              <div>
                <p className="font-semibold text-white">{s.nom}</p>
                <p className="text-xs text-sable/50">{t(tablesDeServeuse(db, s.id).length > 1 ? 'gerant.assignees_pl' : 'gerant.assignees_une', { n: tablesDeServeuse(db, s.id).length })}</p>
              </div>
            </button>
          ))}
          <GrosBouton ton="secondaire" petit onClick={async () => {
            try { await assignerServeuse(assignation!, null); setAssignation(null); toast.success(t('gerant.assignation_retiree')) }
            catch (e) { toast.error(e instanceof Error ? e.message : t('commun.erreur')) }
          }}>
            {t('gerant.retirer_assignation')}
          </GrosBouton>
        </div>
      </Feuille>

      {/* Version imprimable : une grille de grands QR (portalée, seule à l'impression) */}
      {createPortal(
        <div className="zone-impression hidden print:block">
          <h1 style={{ fontSize: 22, fontWeight: 800 }}>{terrasse.nom} — {t('gerant.qr_titre_impression')}</h1>
          <p style={{ marginBottom: 12, fontSize: 13 }}>{t('gerant.qr_consigne_impression')}</p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16 }}>
            {tables.map((table) => (
              <div key={table.id} style={{ border: '1px solid #000', borderRadius: 12, padding: 12, textAlign: 'center' }}>
                <p style={{ fontSize: 20, fontWeight: 800 }}>{t('serveuse.table_mot')} {table.numero}</p>
                {qrsImpression[table.id] && (
                  <img src={qrsImpression[table.id]} width={150} height={150} style={{ margin: '8px auto' }} alt={t('gerant.qr_table_alt', { numero: table.numero })} />
                )}
                <p style={{ fontSize: 12 }}>{terrasse.nom}</p>
              </div>
            ))}
          </div>
        </div>,
        document.body,
      )}
    </div>
  )
}

import { regenererQr } from '@/lib/store'
async function regenererQrSafe(tableId: string, messageOk: string) {
  await regenererQr(tableId)
  toast.success(messageOk)
}
