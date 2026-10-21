// ============================================================
// GBS — Interface SERVEUSE : commandes de ses tables, fin de
// service, dépôt de caisse, sa note et ses avis (anonymes).
// ============================================================

import { useMemo, useState } from 'react'
import { Bell, CircleAlert, CircleCheck, CirclePlay, CircleStop, ClipboardList, HandCoins, Inbox, ReceiptText, Star, Table2, Target, Wallet } from 'lucide-react'
import { PanneauBillards } from './Billard'
import { PanneauNotes } from './NotesStaff'
import { toast } from 'sonner'
import { BoutonDeconnexion, CoquilleRole, PorteRole } from '@/components/Coquille'
import { BadgeCmd, Carte, Confirmation, Etoiles, GrosBouton, Money, Pill, SaisieNombre, Vide, classeSaisie } from '@/components/gbs'
import { dateHeure, fmtCDF, fmtUSD, heureLubu, ilYA } from '@/lib/format'
import { LOCALES, useI18n, useT } from '@/i18n'
import {
  FournisseurPortee, attenduSession, cloturerSession, confirmerCommande, declarerDepot,
  impayesSession, marquerAlertesLues, marquerPayee, marquerServie, ouvrirSessionService, sessionOuverte,
  tablesDeServeuse, useDB, useSession,
} from '@/lib/store'
import type { Commande, Portee, Terrasse, Utilisateur } from '@/lib/types'

export function VueServeuse() {
  const [session] = useSession()
  const portee: Portee = session ? { kind: 'staff' } : { kind: 'public' }
  return (
    <FournisseurPortee portee={portee}>
      <VueServeuseInterne />
    </FournisseurPortee>
  )
}

function VueServeuseInterne() {
  const t = useT()
  return (
    <PorteRole rolesVoulus={['SERVEUSE', 'BILLARDIER']} indiceDemo={t('serveuse.indice_demo')}>
      {({ moi, terrasse }) => <EspaceServeuse moi={moi} terrasse={terrasse} />}
    </PorteRole>
  )
}

function EspaceServeuse({ moi, terrasse }: { moi: Utilisateur; terrasse: Terrasse }) {
  const t = useT()
  const db = useDB()
  const [onglet, setOnglet] = useState('commandes')

  const mesTables = tablesDeServeuse(db, moi.id)
  // Onglet Billards seulement si l'établissement en exploite (file Vincaire)
  const aBillards = db.tables.some((ta) => ta.terrasseId === terrasse.id && ta.actif && !ta.archiveLe && ta.kind === 'BILLARD')

  const commandes = useMemo(() => {
    return db.commandes
      .filter((c) => c.terrasseId === terrasse.id && c.statut !== 'ANNULEE')
      .filter((c) => mesTables.includes(c.tableId))
      .sort((a, b) => b.creeLe.localeCompare(a.creeLe))
  }, [db, terrasse, mesTables])

  const enAttente = commandes.filter((c) => c.statut === 'EN_ATTENTE').length
  const notifsNonLues = db.alertes.filter((a) => a.terrasseId === terrasse.id && !a.lu).length

  return (
    <CoquilleRole
      titre={terrasse.nom}
      sousTitre={`${moi.nom} — ${t('role.serveuse')}`}
      droite={<BoutonDeconnexion />}
      actif={onglet}
      onChange={setOnglet}
      onglets={[
        { id: 'commandes', label: t('serveuse.onglet_commandes'), icone: <Bell className="h-6 w-6" />, badge: enAttente },
        { id: 'tables', label: t('serveuse.onglet_tables'), icone: <Table2 className="h-6 w-6" /> },
        ...(aBillards ? [{ id: 'billards', label: t('billard.onglet_gestion'), icone: <Target className="h-6 w-6" /> }] : []),
        { id: 'caisse', label: t('serveuse.onglet_caisse'), icone: <Wallet className="h-6 w-6" /> },
        { id: 'notes', label: t('serveuse.onglet_notes'), icone: <ReceiptText className="h-6 w-6" /> },
        { id: 'note', label: t('serveuse.onglet_note'), icone: <Star className="h-6 w-6" /> },
        { id: 'notifs', label: t('serveuse.onglet_notifs'), icone: <Inbox className="h-6 w-6" />, badge: notifsNonLues },
      ]}
    >
      {onglet === 'commandes' && <OngletCommandes commandes={commandes} />}
      {onglet === 'tables' && <OngletMesTables mesTables={mesTables} commandes={commandes} />}
      {onglet === 'billards' && aBillards && <PanneauBillards terrasseId={terrasse.id} />}
      {/* (panneau sans config : la config reste au gérant/propriétaire) */}
      {onglet === 'caisse' && <OngletCaisse terrasseId={terrasse.id} serveuseId={moi.id} />}
      {onglet === 'notes' && <PanneauNotes terrasseId={terrasse.id} />}
      {onglet === 'note' && <OngletMaNote serveuseId={moi.id} terrasseId={terrasse.id} />}
      {onglet === 'notifs' && <OngletNotifs terrasseId={terrasse.id} serveuseId={moi.id} />}
    </CoquilleRole>
  )
}

// ---------- Commandes ----------

function OngletCommandes({ commandes }: { commandes: Commande[] }) {
  const t = useT()
  const db = useDB()
  // Tri par ancienneté : la commande qui attend le plus longtemps passe en premier
  const actives = commandes
    .filter((c) => c.statut === 'EN_ATTENTE' || c.statut === 'CONFIRMEE')
    .sort((a, b) => a.creeLe.localeCompare(b.creeLe))
  const servies = commandes.filter((c) => c.statut === 'SERVIE')

  // Cash servi mais pas encore encaissé : tant qu'elle n'a pas marqué
  // « payée », le client concerné ne peut pas passer de nouvelle commande
  const impayees = commandes.filter((c) => c.statut === 'SERVIE' && !c.payeeLe)
  const aEncaisserCdf = impayees.reduce((t, c) => t + c.totalCdf, 0)
  const aEncaisserUsd = impayees.reduce((t, c) => t + c.totalUsdCentimes, 0)

  const encaisser = async (commandeId: string, numero?: number) => {
    try { await marquerPayee(commandeId); toast.success(t('serveuse.payee_toast', { numero: numero ?? '?' })) }
    catch (e) { toast.error(e instanceof Error ? e.message : t('commun.erreur')) }
  }

  if (commandes.length === 0) {
    return <Vide icone={<ClipboardList className="h-8 w-8" />} titre={t('serveuse.vide_commandes')} detail={t('serveuse.vide_commandes_d')} />
  }

  return (
    <div className="flex flex-col gap-3 px-4 pt-4">
      {impayees.length > 0 && (
        <div className="flex items-center gap-3 rounded-2xl border border-ambre/40 bg-ambre/10 px-4 py-3">
          <HandCoins className="h-6 w-6 shrink-0 text-ambre" />
          <div>
            <p className="text-sm font-bold text-white">
              {t('serveuse.a_encaisser')} {fmtCDF(aEncaisserCdf)}{aEncaisserUsd > 0 ? ` + ${fmtUSD(aEncaisserUsd)}` : ''}
            </p>
            <p className="text-xs text-sable/60">
              {t(impayees.length > 1 ? 'serveuse.impayees_pl' : 'serveuse.impayees_une', { n: impayees.length })}
            </p>
          </div>
        </div>
      )}
      {actives.map((c) => {
        const table = db.tables.find((t) => t.id === c.tableId)
        const client = db.clientsSession.find((x) => x.id === c.clientSessionId)
        return (
          <Carte key={c.id} classe="anim-arrivee">
            <div className="mb-2 flex items-center justify-between">
              <p className="text-lg font-bold text-white">
                {t('serveuse.table_mot')} {table?.numero} <span className="text-sm font-normal text-sable/60">· {client?.prenom}</span>
              </p>
              <BadgeCmd statut={c.statut} />
            </div>
            <div className="mb-3 flex flex-col gap-1">
              {c.lignes.map((l) => (
                <div key={l.produitId} className="flex justify-between text-sm">
                  <span className="text-white"><b className="font-mono">{l.quantite}×</b> {l.nom}</span>
                  <Money cdf={l.prixCdf * l.quantite} usd={l.prixUsdCentimes * l.quantite} />
                </div>
              ))}
            </div>
            <div className="flex items-center justify-between border-t border-white/8 pt-3">
              <div>
                <Money cdf={c.totalCdf} usd={c.totalUsdCentimes} gros />
                <p className="text-xs text-sable/50">{ilYA(c.creeLe)}</p>
              </div>
              {c.statut === 'EN_ATTENTE' ? (
                <GrosBouton petit onClick={async () => {
                  try { await confirmerCommande(c.id); toast.success(t('serveuse.confirmee_toast', { numero: table?.numero ?? '?' })) }
                  catch (e) { toast.error(e instanceof Error ? e.message : t('commun.erreur')) }
                }}>
                  {t('serveuse.confirmer')}
                </GrosBouton>
              ) : (
                <GrosBouton petit ton="primaire" onClick={async () => {
                  try { await marquerServie(c.id); toast.success(t('serveuse.servie_toast', { numero: table?.numero ?? '?' })) }
                  catch (e) { toast.error(e instanceof Error ? e.message : t('commun.erreur')) }
                }}>
                  <CircleCheck className="h-5 w-5" /> {t('serveuse.servie')}
                </GrosBouton>
              )}
            </div>
            {/* Paiement cash : encaissable dès la confirmation (comptoir) ; tant
                qu'une SERVIE n'est pas payée, le client ne peut pas recommander */}
            {c.statut === 'CONFIRMEE' && (
              <div className="mt-2 flex items-center justify-between">
                {c.payeeLe
                  ? <Pill ton="vert">{t('serveuse.payee_pill')}</Pill>
                  : <p className="text-xs text-sable/60">{t('serveuse.pas_payee')}</p>}
                {!c.payeeLe && (
                  <button
                    className="text-xs font-semibold text-ambre underline underline-offset-2"
                    onClick={() => encaisser(c.id, table?.numero)}
                  >
                    {t('serveuse.encaisser_maintenant')}
                  </button>
                )}
              </div>
            )}
          </Carte>
        )
      })}

      {servies.length > 0 && (
        <>
          <p className="mt-2 text-xs font-bold uppercase tracking-widest text-sable/50">{t('serveuse.servies_jour')}</p>
          {servies.slice(0, 8).map((c) => {
            const table = db.tables.find((t) => t.id === c.tableId)
            const client = db.clientsSession.find((x) => x.id === c.clientSessionId)
            return (
              <div key={c.id} className="flex items-center justify-between rounded-2xl border border-white/8 bg-surface/60 px-4 py-3">
                <div>
                  <p className="font-semibold text-white">{t('serveuse.table_mot')} {table?.numero} <span className="text-sm font-normal text-sable/60">· {client?.prenom}</span></p>
                  <p className="text-xs text-sable/50">{c.servieLe ? heureLubu(c.servieLe) : ''}</p>
                </div>
                <div className="flex items-center gap-3">
                  <Money cdf={c.totalCdf} usd={c.totalUsdCentimes} />
                  {c.payeeLe ? (
                    <Pill ton="vert">{t('serveuse.payee_pill')}</Pill>
                  ) : (
                    <GrosBouton petit onClick={() => encaisser(c.id, table?.numero)}>
                      <HandCoins className="h-4 w-4" /> {t('serveuse.encaisser')}
                    </GrosBouton>
                  )}
                </div>
              </div>
            )
          })}
        </>
      )}
    </div>
  )
}

// ---------- Mes tables ----------

function OngletMesTables({ mesTables, commandes }: { mesTables: string[]; commandes: Commande[] }) {
  const t = useT()
  const db = useDB()
  if (mesTables.length === 0) {
    return <Vide icone={<Table2 className="h-8 w-8" />} titre={t('serveuse.aucune_table')} detail={t('serveuse.aucune_table_d')} />
  }
  return (
    <div className="grid grid-cols-2 gap-3 px-4 pt-4">
      {mesTables.map((tableId) => {
        const table = db.tables.find((t) => t.id === tableId)
        const actives = commandes.filter((c) => c.tableId === tableId && (c.statut === 'EN_ATTENTE' || c.statut === 'CONFIRMEE'))
        return (
          <Carte key={tableId} classe="text-center">
            <p className="font-mono text-3xl font-black text-white">{table?.numero}</p>
            <p className="mt-1 text-xs text-sable/60">{t('serveuse.table_mot')}</p>
            {actives.length > 0 ? (
              <div className="mt-2"><Pill ton="ambre">{t(actives.length > 1 ? 'serveuse.commandes_nb' : 'serveuse.commande_une', { n: actives.length })}</Pill></div>
            ) : (
              <div className="mt-2"><Pill ton="vert">{t('serveuse.libre')}</Pill></div>
            )}
          </Carte>
        )
      })}
    </div>
  )
}

// ---------- Ma caisse : session + dépôt ----------

function OngletCaisse({ terrasseId, serveuseId }: { terrasseId: string; serveuseId: string }) {
  const t = useT()
  const db = useDB()
  const [cdf, setCdf] = useState('')
  const [usd, setUsd] = useState('')
  const [motifEcart, setMotifEcart] = useState('')
  const [confirmerCloture, setConfirmerCloture] = useState(false)

  const session = sessionOuverte(db, terrasseId, serveuseId)
  const mesSessions = db.sessionsService
    .filter((s) => s.terrasseId === terrasseId && s.serveuseId === serveuseId)
    .sort((a, b) => b.ouverteLe.localeCompare(a.ouverteLe))
  const derniereCloturee = mesSessions.find((s) => s.statut === 'CLOTUREE' && !db.depots.some((d) => d.sessionId === s.id))
  const attendu = session ? attenduSession(db, session) : null

  // Écart en direct entre le cash compté et l'attendu de la session clôturée
  const attenduCloture = derniereCloturee ? attenduSession(db, derniereCloturee) : null
  const cdfSaisi = parseInt(cdf) || 0
  const usdSaisi = Math.round((parseFloat(usd.replace(',', '.')) || 0) * 100)
  const ecart = attenduCloture ? (cdfSaisi - attenduCloture.cdf) !== 0 || (usdSaisi - attenduCloture.usdCentimes) !== 0 : false

  return (
    <div className="flex flex-col gap-4 px-4 pt-4">
      {/* Session en cours */}
      <Carte>
        <p className="mb-3 font-bold text-white">{t('serveuse.session_service')}</p>
        {session ? (
          <div className="flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <Pill ton="vert">{t('serveuse.session_ouverte')}</Pill>
              <p className="text-sm text-sable/60">{t('serveuse.depuis', { heure: heureLubu(session.ouverteLe) })}</p>
            </div>
            <div className="rounded-2xl bg-white/5 p-4 text-center">
              <p className="text-xs uppercase tracking-widest text-sable/50">{t('serveuse.cash_attendu')}</p>
              <div className="mt-1"><Money cdf={attendu?.cdf ?? 0} usd={attendu?.usdCentimes ?? 0} gros /></div>
              <p className="mt-1 text-xs text-sable/50">{t('serveuse.servies_vous')}</p>
            </div>
            <GrosBouton ton="danger" onClick={() => setConfirmerCloture(true)}>
              <CircleStop className="h-5 w-5" /> {t('serveuse.terminer_service')}
            </GrosBouton>
          </div>
        ) : (
          <GrosBouton onClick={async () => {
            try { await ouvrirSessionService(terrasseId); toast.success(t('serveuse.ouvert_toast')) }
            catch (e) { toast.error(e instanceof Error ? e.message : t('commun.erreur')) }
          }}>
            <CirclePlay className="h-5 w-5" /> {t('serveuse.ouvrir_session')}
          </GrosBouton>
        )}
      </Carte>

      {/* Dépôt à déclarer */}
      {derniereCloturee && (
        <Carte classe="border-ambre/30">
          <p className="mb-1 font-bold text-white">{t('serveuse.depot_a_declarer')}</p>
          <p className="mb-3 text-sm text-sable/60">{t('serveuse.session_terminee', { heure: heureLubu(derniereCloturee.clotureeLe!) })}</p>
          <div className="mb-4 rounded-2xl bg-white/5 p-3 text-center">
            <p className="text-xs text-sable/50">{t('serveuse.attendu_appli')}</p>
            <Money cdf={attenduSession(db, derniereCloturee).cdf} usd={attenduSession(db, derniereCloturee).usdCentimes} gros />
          </div>
          <div className="mb-3 grid grid-cols-2 gap-3">
            <label className="block">
              <span className="mb-1 block text-xs font-semibold text-sable">{t('serveuse.cash_fc')}</span>
              <SaisieNombre valeur={cdf} onChange={setCdf} placeholder="0" />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-semibold text-sable">{t('serveuse.cash_usd')}</span>
              <input
                type="number" inputMode="decimal" step="0.01" min="0"
                className="w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3.5 font-mono text-base text-white outline-none focus:border-ambre/60"
                value={usd} onChange={(e) => setUsd(e.target.value)} placeholder="0,00"
              />
            </label>
          </div>
          {/* Écart : la serveuse le signale elle-même, avec motif obligatoire */}
          {ecart && (cdf !== '' || usd !== '') && (
            <div className="mb-3 rounded-2xl border border-danger/40 bg-danger/8 p-3">
              <p className="mb-2 text-sm font-bold text-danger-clair">
                {t('serveuse.ecart')} {cdfSaisi - attenduCloture!.cdf !== 0 && `${cdfSaisi - attenduCloture!.cdf > 0 ? '+' : '−'}${Math.abs(cdfSaisi - attenduCloture!.cdf).toLocaleString('fr-CD')} FC`}
                {cdfSaisi - attenduCloture!.cdf !== 0 && usdSaisi - attenduCloture!.usdCentimes !== 0 && ' · '}
                {usdSaisi - attenduCloture!.usdCentimes !== 0 && `${usdSaisi - attenduCloture!.usdCentimes > 0 ? '+' : '−'}${(Math.abs(usdSaisi - attenduCloture!.usdCentimes) / 100).toFixed(2)} $`}
              </p>
              <input
                className={classeSaisie}
                value={motifEcart}
                onChange={(e) => setMotifEcart(e.target.value)}
                placeholder={t('serveuse.motif_ecart_ph')}
              />
            </div>
          )}
          <GrosBouton
            ton={ecart ? 'danger' : 'primaire'}
            desactive={ecart && !motifEcart.trim()}
            onClick={async () => {
              try {
                await declarerDepot(derniereCloturee.id, cdfSaisi, usdSaisi, ecart ? motifEcart.trim() : undefined)
                setCdf(''); setUsd(''); setMotifEcart('')
                toast.success(ecart ? t('serveuse.ecart_toast') : t('serveuse.depot_toast'))
              } catch (e) { toast.error(e instanceof Error ? e.message : t('commun.erreur')) }
            }}
          >
            <HandCoins className="h-5 w-5" /> {ecart ? t('serveuse.signaler_ecart') : t('serveuse.confirmer_depot')}
          </GrosBouton>
        </Carte>
      )}

      {/* Historique des dépôts */}
      {db.depots.filter((d) => d.serveuseId === serveuseId).length > 0 && (
        <>
          <p className="text-xs font-bold uppercase tracking-widest text-sable/50">{t('serveuse.mes_depots')}</p>
          {db.depots.filter((d) => d.serveuseId === serveuseId).slice(0, 6).map((d) => {
            // Écart par devise (additionner FC et centimes USD créerait des faux négatifs)
            const ecart = d.declareCdf !== d.montantAttenduCdf || d.declareUsdCentimes !== d.montantAttenduUsdCentimes
            return (
              <div key={d.id} className="flex items-center justify-between rounded-2xl border border-white/8 bg-surface/60 px-4 py-3">
                <div>
                  <Money cdf={d.declareCdf} usd={d.declareUsdCentimes} />
                  <p className="text-xs text-sable/50">{dateHeure(d.declareLe)}{ecart ? ` · ${t('serveuse.ecart_mot')}` : ''}</p>
                </div>
                <Pill ton={d.statut === 'VALIDE' ? 'vert' : d.statut === 'CONTESTE' ? 'rouge' : 'ambre'}>
                  {d.statut === 'VALIDE' ? t('depot.statut_valide') : d.statut === 'CONTESTE' ? t('depot.statut_conteste') : t('depot.statut_attente')}
                </Pill>
              </div>
            )
          })}
        </>
      )}

      <Confirmation
        ouvert={confirmerCloture}
        titre={t('serveuse.cloture_titre')}
        message={(() => {
          // Avertit si du cash servi n'a pas encore été encaissé : il
          // comptera comme écart au dépôt (la responsabilité reste à la serveuse)
          const imp = session ? impayesSession(db, session) : { nb: 0, cdf: 0, usdCentimes: 0 }
          const base = t('serveuse.cloture_base')
          if (imp.nb === 0) return base
          const montants = `${fmtCDF(imp.cdf)}${imp.usdCentimes > 0 ? ` + ${fmtUSD(imp.usdCentimes)}` : ''}`
          return `${t(imp.nb > 1 ? 'serveuse.cloture_warn_pl' : 'serveuse.cloture_warn_une', { n: imp.nb, montants })} ${base}`
        })()}
        surAnnuler={() => setConfirmerCloture(false)}
        surConfirmer={async () => {
          try { await cloturerSession(session!.id); toast.success(t('serveuse.cloture_toast')) }
          catch (e) { toast.error(e instanceof Error ? e.message : t('commun.erreur')) }
          setConfirmerCloture(false)
        }}
      />
    </div>
  )
}

// ---------- Notifications (boîte de réception de la serveuse) ----------

function OngletNotifs({ terrasseId, serveuseId }: { terrasseId: string; serveuseId: string }) {
  const t = useT()
  const db = useDB()
  const alertes = db.alertes
    .filter((a) => a.terrasseId === terrasseId)
    .sort((a, b) => b.creeLe.localeCompare(a.creeLe))
    .slice(0, 15)
  const mesDepots = db.depots
    .filter((d) => d.serveuseId === serveuseId)
    .sort((a, b) => b.declareLe.localeCompare(a.declareLe))
    .slice(0, 5)

  return (
    <div className="flex flex-col gap-3 px-4 pt-4">
      {alertes.some((a) => !a.lu) && (
        <button
          className="self-end text-xs font-semibold text-ambre underline underline-offset-2"
          onClick={async () => { try { await marquerAlertesLues(terrasseId) } catch { /* silencieux */ } }}
        >
          {t('serveuse.tout_lu')}
        </button>
      )}

      {/* Suivi de ses dépôts : validé ou contesté par le gérant */}
      {mesDepots.length > 0 && (
        <>
          <p className="text-xs font-bold uppercase tracking-widest text-sable/50">{t('serveuse.mes_depots')}</p>
          {mesDepots.map((d) => (
            <div key={d.id} className="flex items-center justify-between rounded-2xl border border-white/8 bg-surface/60 px-4 py-3">
              <div>
                <Money cdf={d.declareCdf} usd={d.declareUsdCentimes} />
                <p className="text-xs text-sable/50">{dateHeure(d.declareLe)}{d.motifContest ? ` — ${d.motifContest}` : ''}</p>
              </div>
              <Pill ton={d.statut === 'VALIDE' ? 'vert' : d.statut === 'CONTESTE' ? 'rouge' : 'ambre'}>
                {d.statut === 'VALIDE' ? t('depot.statut_valide') : d.statut === 'CONTESTE' ? t('depot.statut_conteste') : t('depot.statut_attente')}
              </Pill>
            </div>
          ))}
        </>
      )}

      <p className="text-xs font-bold uppercase tracking-widest text-sable/50">{t('serveuse.notifs_terrasse')}</p>
      {alertes.length === 0 && (
        <Vide icone={<Inbox className="h-8 w-8" />} titre={t('serveuse.aucune_notif')} detail={t('serveuse.aucune_notif_d')} />
      )}
      {alertes.map((a) => (
        <div key={a.id} className={`flex items-start gap-3 rounded-2xl border px-4 py-3 ${a.lu ? 'border-white/8 bg-surface/50' : a.type === 'ECART_CAISSE' ? 'border-danger/30 bg-danger/8' : 'border-ambre/30 bg-ambre/8'}`}>
          <CircleAlert className={`mt-0.5 h-5 w-5 shrink-0 ${a.type === 'ECART_CAISSE' ? 'text-danger-clair' : 'text-ambre'}`} />
          <div>
            <p className="text-sm text-white">{a.message}</p>
            <p className="mt-0.5 text-xs text-sable/50">{ilYA(a.creeLe)}</p>
          </div>
        </div>
      ))}
    </div>
  )
}

// ---------- Ma note (commentaires anonymes) ----------

function OngletMaNote({ serveuseId, terrasseId }: { serveuseId: string; terrasseId: string }) {
  const { t, langue } = useI18n()
  const db = useDB()
  const mesAvis = db.avis.filter((a) => a.serveuseId === serveuseId && a.terrasseId === terrasseId && !a.masque)
  const moyenne = mesAvis.length ? mesAvis.reduce((s, a) => s + a.note, 0) / mesAvis.length : 0

  return (
    <div className="flex flex-col gap-4 px-4 pt-4">
      <Carte classe="text-center">
        <p className="font-mono text-5xl font-black text-white">{mesAvis.length ? moyenne.toLocaleString(LOCALES[langue], { minimumFractionDigits: 1, maximumFractionDigits: 1 }) : '—'}</p>
        <div className="mt-2 flex justify-center"><Etoiles note={Math.round(moyenne)} /></div>
        <p className="mt-2 text-sm text-sable/60">{t(mesAvis.length > 1 ? 'serveuse.avis_nb' : 'serveuse.avis_une', { n: mesAvis.length })}</p>
      </Carte>
      {mesAvis.filter((a) => a.commentaire).map((a) => (
        <div key={a.id} className="rounded-2xl border border-white/8 bg-surface/60 px-4 py-3">
          <Etoiles note={a.note} taille={4} />
          <p className="mt-1 text-sm text-white">« {a.commentaire} »</p>
          <p className="mt-1 text-xs text-sable/40">{t('serveuse.client_anonyme')} · {ilYA(a.creeLe)}</p>
        </div>
      ))}
      {mesAvis.length === 0 && (
        <Vide icone={<Star className="h-8 w-8" />} titre={t('serveuse.pas_avis')} detail={t('serveuse.pas_avis_d')} />
      )}
    </div>
  )
}
