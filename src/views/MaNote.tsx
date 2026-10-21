// ============================================================
// GBS — Onglet « Ma note » du client (ANNEXE-2 §4).
//
// Une seule note par client, tous espaces confondus (terrasse,
// restaurant, billard, hôtel) : lignes groupées par espace, totaux
// FC / $, « demander l'addition », historique des notes réglées.
// « Payer pour quelqu'un » (ANNEXE-3) : proposition par numéro de
// table — et, côté bénéficiaire, acceptation/refus de la proposition
// reçue (jamais l'identité du payeur).
// ============================================================

import { useState } from 'react'
import { BedDouble, Beer, CircleAlert, HandCoins, Martini, ReceiptText, Store, UtensilsCrossed } from 'lucide-react'
import { toast } from 'sonner'
import { Carte, Chargement, Confirmation, GrosBouton, Pill, Vide, classeSaisie } from '@/components/gbs'
import type { EspaceNote, LigneNoteVue, NoteVue } from '@contracts/notes'
import { fmtCDF, fmtUSD, ilYA } from '@/lib/format'
import {
  deciderPriseEnChargeClienteNote, demanderAdditionNote, proposerPriseEnChargeNote,
} from '@/lib/store'
import { trpc } from '@/providers/trpc'
import { useT } from '@/i18n'

const ICONE_ESPACE: Record<EspaceNote, typeof Beer> = {
  TERRASSE: Beer,
  RESTAURANT: UtensilsCrossed,
  BILLARD: Martini,
  HOTEL: BedDouble,
  COMPTOIR: Store,
}

function Ligne({ l }: { l: LigneNoteVue }) {
  const t = useT()
  const barree = l.statut === 'ANNULEE'
  return (
    <div className={`flex items-center justify-between gap-3 py-1.5 ${barree ? 'opacity-45 line-through' : ''}`}>
      <div className="min-w-0">
        <p className="truncate text-sm text-white">
          {l.quantite > 1 ? `${l.quantite} × ` : ''}{l.libelle}
        </p>
        {l.detailStatut && !barree && <p className="text-xs text-sable/55">{l.detailStatut}</p>}
        {l.priseEnChargeId && <p className="text-xs font-semibold text-info-clair">{t('note.payee_par_tiers')}</p>}
      </div>
      <p className="shrink-0 text-sm font-bold text-sable">
        {l.montantCdf > 0 ? fmtCDF(l.montantCdf) : fmtUSD(l.montantUsd)}
      </p>
    </div>
  )
}

function BlocNote({ note, action }: { note: NoteVue; action?: React.ReactNode }) {
  const t = useT()
  const parEspace = new Map<EspaceNote, LigneNoteVue[]>()
  for (const l of note.lignes) {
    const liste = parEspace.get(l.espace) ?? []
    liste.push(l)
    parEspace.set(l.espace, liste)
  }
  return (
    <Carte classe="mb-4">
      <div className="mb-2 flex items-center justify-between">
        <p className="text-xs text-sable/55">{ilYA(note.ouverteLe)}</p>
        <Pill ton={note.statut === 'REGLEE' ? 'vert' : note.statut === 'A_REGLER' ? 'ambre' : 'neutre'}>
          {t(`note.statut_${note.statut.toLowerCase()}`)}
        </Pill>
      </div>
      {[...parEspace.entries()].map(([espace, lignes]) => {
        const Icone = ICONE_ESPACE[espace] ?? ReceiptText
        return (
          <div key={espace} className="mb-3">
            <p className="mb-1 flex items-center gap-1.5 text-xs font-bold uppercase tracking-widest text-sable/50">
              <Icone className="h-3.5 w-3.5" /> {t(`note.espace_${espace.toLowerCase()}`)}
            </p>
            <div className="divide-y divide-white/5">
              {lignes.map((l) => <Ligne key={l.id} l={l} />)}
            </div>
          </div>
        )
      })}
      <div className="mt-2 space-y-1 border-t border-white/10 pt-3 text-sm">
        <p className="flex justify-between text-sable/70">
          <span>{t('note.total')}</span>
          <b className="text-white">{note.totalCdf > 0 ? fmtCDF(note.totalCdf) : ''}{note.totalCdf > 0 && note.totalUsd > 0 ? ' + ' : ''}{note.totalUsd > 0 ? fmtUSD(note.totalUsd) : ''}</b>
        </p>
        {(note.encaisseCdf > 0 || note.encaisseUsd > 0) && (
          <p className="flex justify-between text-succes">
            <span>{t('note.deja_paye')}</span>
            <b>{note.encaisseCdf > 0 ? fmtCDF(note.encaisseCdf) : ''}{note.encaisseCdf > 0 && note.encaisseUsd > 0 ? ' + ' : ''}{note.encaisseUsd > 0 ? fmtUSD(note.encaisseUsd) : ''}</b>
          </p>
        )}
        {(note.resteCdf > 0 || note.resteUsd > 0) && (
          <p className="flex justify-between text-base text-ambre">
            <span className="font-bold">{t('note.reste')}</span>
            <b>{note.resteCdf > 0 ? fmtCDF(note.resteCdf) : ''}{note.resteCdf > 0 && note.resteUsd > 0 ? ' + ' : ''}{note.resteUsd > 0 ? fmtUSD(note.resteUsd) : ''}</b>
          </p>
        )}
      </div>
      {action}
    </Carte>
  )
}

export function OngletMaNote({ sessionId }: { sessionId: string }) {
  const t = useT()
  const [tableCible, setTableCible] = useState('')
  const [confirmeAddition, setConfirmeAddition] = useState(false)
  const vue = trpc.notes.voirMaNote.useQuery(
    { clientSessionId: sessionId },
    { refetchInterval: 5000 }, // la note bouge sans recharger (commande confirmée, encaissement…)
  )

  if (vue.isPending) return <Chargement label={t('note.chargement')} />
  if (vue.error || !vue.data) {
    return (
      <div className="px-4 pt-4">
        <Vide icone={<CircleAlert className="h-8 w-8" />} titre={t('note.indisponible')} detail={t('note.indisponible_d')} />
      </div>
    )
  }
  const { note, historique, priseEnChargeRecue } = vue.data
  const reste = note ? note.resteCdf > 0 || note.resteUsd > 0 : false

  const demanderAddition = async () => {
    try {
      await demanderAdditionNote(sessionId)
      setConfirmeAddition(false)
      toast.success(t('note.addition_envoyee'))
      void vue.refetch()
    } catch (e) { toast.error(e instanceof Error ? e.message : t('commun.erreur')) }
  }
  const proposer = async () => {
    try {
      await proposerPriseEnChargeNote(sessionId, tableCible.trim())
      setTableCible('')
      toast.success(t('note.proposition_envoyee'))
    } catch (e) { toast.error(e instanceof Error ? e.message : t('commun.erreur')) }
  }
  const decider = async (accepter: boolean) => {
    if (!priseEnChargeRecue) return
    try {
      await deciderPriseEnChargeClienteNote(sessionId, priseEnChargeRecue.id, accepter)
      toast.success(t(accepter ? 'note.prise_acceptee' : 'note.prise_refusee'))
      void vue.refetch()
    } catch (e) { toast.error(e instanceof Error ? e.message : t('commun.erreur')) }
  }

  return (
    <div className="px-4 pt-4">
      {/* ANNEXE-3 : « quelqu'un propose de payer pour vous » —
          jamais l'identité du payeur. */}
      {priseEnChargeRecue && (
        <Carte classe="mb-4 border border-info/40 bg-info/10">
          <p className="mb-1 flex items-center gap-2 text-sm font-bold text-info-clair">
            <HandCoins className="h-5 w-5" /> {t('note.prise_recue')}
          </p>
          <p className="mb-3 text-sm text-sable/80">
            {t('note.prise_recue_d', {
              montant: `${priseEnChargeRecue.montantCdf > 0 ? fmtCDF(priseEnChargeRecue.montantCdf) : ''}${priseEnChargeRecue.montantCdf > 0 && priseEnChargeRecue.montantUsd > 0 ? ' + ' : ''}${priseEnChargeRecue.montantUsd > 0 ? fmtUSD(priseEnChargeRecue.montantUsd) : ''}`,
            })}
          </p>
          <div className="flex gap-2">
            <div className="flex-1"><GrosBouton onClick={() => void decider(true)}>{t('note.accepter')}</GrosBouton></div>
            <div className="flex-1"><GrosBouton ton="secondaire" onClick={() => void decider(false)}>{t('note.refuser')}</GrosBouton></div>
          </div>
        </Carte>
      )}

      {note ? (
        <BlocNote
          note={note}
          action={reste ? (
            <div className="mt-3">
              <GrosBouton
                desactive={note.statut === 'A_REGLER'}
                onClick={() => setConfirmeAddition(true)}
              >
                {note.statut === 'A_REGLER' ? t('note.addition_demandee') : t('note.demander_addition')}
              </GrosBouton>
            </div>
          ) : undefined}
        />
      ) : (
        <Vide icone={<ReceiptText className="h-8 w-8" />} titre={t('note.vide')} detail={t('note.vide_d')} />
      )}

      {/* ANNEXE-3 : « je paie pour la table N » */}
      <Carte classe="mb-4">
        <p className="mb-1 text-sm font-bold text-white">{t('note.payer_pour')}</p>
        <p className="mb-3 text-xs text-sable/60">{t('note.payer_pour_d')}</p>
        <div className="flex items-center gap-2">
          <input
            className={`${classeSaisie} flex-1`}
            value={tableCible}
            onChange={(e) => setTableCible(e.target.value)}
            placeholder={t('note.table_ph')}
            inputMode="numeric"
            aria-label={t('note.payer_pour')}
          />
          <div className="w-28 shrink-0">
            <GrosBouton petit desactive={!tableCible.trim()} onClick={() => void proposer()}>
              {t('note.envoyer')}
            </GrosBouton>
          </div>
        </div>
      </Carte>

      {historique.length > 0 && (
        <>
          <h2 className="mb-2 text-xs font-bold uppercase tracking-widest text-sable/50">{t('note.historique')}</h2>
          {historique.map((n) => <BlocNote key={n.id} note={n} />)}
        </>
      )}

      <Confirmation
        ouvert={confirmeAddition}
        titre={t('note.demander_addition')}
        message={t('note.addition_confirm')}
        surConfirmer={() => void demanderAddition()}
        surAnnuler={() => setConfirmeAddition(false)}
      />
    </div>
  )
}
