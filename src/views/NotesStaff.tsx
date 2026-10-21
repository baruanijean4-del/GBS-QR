// ============================================================
// GBS — Panneau « Notes » du personnel (ANNEXE-2 §5) :
//  * notes ouvertes de l'organisation à encaisser (CASH → EN_MAIN,
//    MOBILE_MONEY → REMIS d'office), acomptes et pourboires ;
//  * « Ma caisse » : cash EN_MAIN + remise au receveur (§5.5) ;
//  * prises en charge en attente : la serveuse enregistre la décision
//    de la bénéficiaire — jamais l'identité du payeur (ANNEXE-3).
// ============================================================

import { useState } from 'react'
import { CircleAlert, HandCoins, ReceiptText, Wallet } from 'lucide-react'
import { toast } from 'sonner'
import { Carte, Chargement, Confirmation, Feuille, GrosBouton, Pill, SaisieNombre, Vide, classeSaisie } from '@/components/gbs'
import type { NoteVue } from '@contracts/notes'
import { fmtCDF, fmtUSD, ilYA } from '@/lib/format'
import {
  deciderPriseEnChargeStaff, encaisserNote, remettreCaisseNote,
} from '@/lib/store'
import { trpc } from '@/providers/trpc'
import { useT } from '@/i18n'

const TON_STATUT: Record<string, 'neutre' | 'ambre' | 'vert' | 'rouge' | 'bleu'> = {
  OUVERTE: 'neutre', A_REGLER: 'ambre', REGLEE: 'vert', LITIGE: 'rouge', FUSIONNEE: 'bleu',
}

function Montants({ cdf, usd, gras = false }: { cdf: number; usd: number; gras?: boolean }) {
  const morceaux: string[] = []
  if (cdf > 0) morceaux.push(fmtCDF(cdf))
  if (usd > 0) morceaux.push(fmtUSD(usd))
  return <span className={gras ? 'font-bold text-white' : 'text-sable'}>{morceaux.join(' + ') || '—'}</span>
}

export function PanneauNotes({ terrasseId }: { terrasseId: string }) {
  const t = useT()
  const [noteOuverte, setNoteOuverte] = useState<NoteVue | null>(null)
  const [confirmeRemise, setConfirmeRemise] = useState(false)

  const notes = trpc.notes.notesOuvertes.useQuery({ terrasseId }, { refetchInterval: 5000 })
  const caisse = trpc.notes.maCaisse.useQuery(undefined, { refetchInterval: 8000 })
  const prises = trpc.notes.prisesEnChargeEnCours.useQuery({ terrasseId }, { refetchInterval: 5000 })

  if (notes.isPending || caisse.isPending || prises.isPending) return <Chargement />
  if (notes.error || !notes.data || caisse.error || !caisse.data) {
    return <Vide icone={<CircleAlert className="h-8 w-8" />} titre={t('note.indisponible')} detail={t('note.indisponible_d')} />
  }

  const c = caisse.data
  const demandes = prises.data ?? []

  const remettre = async () => {
    try {
      await remettreCaisseNote(terrasseId)
      setConfirmeRemise(false)
      toast.success(t('note.remise_declaree'))
      void caisse.refetch()
    } catch (e) { toast.error(e instanceof Error ? e.message : t('commun.erreur')) }
  }
  const decider = async (id: string, accepter: boolean) => {
    try {
      await deciderPriseEnChargeStaff(id, accepter)
      toast.success(t(accepter ? 'note.prise_acceptee' : 'note.prise_refusee'))
      void prises.refetch()
      void notes.refetch()
    } catch (e) { toast.error(e instanceof Error ? e.message : t('commun.erreur')) }
  }

  return (
    <div className="flex flex-col gap-4 px-4 pt-4">
      {/* ---------- Ma caisse (§5.11) ---------- */}
      <Carte>
        <p className="mb-2 flex items-center gap-2 font-bold text-white"><Wallet className="h-5 w-5 text-ambre" /> {t('note.ma_caisse')}</p>
        <div className="mb-1 flex justify-between text-sm">
          <span className="text-sable/70">{t('note.en_main', { n: c.nbEnMain })}</span>
          <Montants cdf={c.enMainCdf} usd={c.enMainUsd} gras />
        </div>
        <div className="mb-3 flex justify-between text-sm">
          <span className="text-sable/70">{t('note.pourboires_jour')}</span>
          <Montants cdf={c.pourboiresCdf} usd={c.pourboiresUsd} />
        </div>
        <GrosBouton ton="secondaire" desactive={c.nbEnMain === 0} onClick={() => setConfirmeRemise(true)}>
          {t('note.remettre_caisse')}
        </GrosBouton>
      </Carte>

      {/* ---------- Prises en charge en attente (ANNEXE-3) ---------- */}
      {demandes.length > 0 && (
        <Carte>
          <p className="mb-2 flex items-center gap-2 font-bold text-white"><HandCoins className="h-5 w-5 text-info-clair" /> {t('note.pec_titre')}</p>
          <p className="mb-3 text-xs text-sable/60">{t('note.pec_d')}</p>
          <div className="flex flex-col gap-3">
            {demandes.map((p) => (
              <div key={p.id} className="rounded-2xl bg-white/5 p-3">
                <div className="mb-1 flex items-center justify-between">
                  <p className="text-sm font-bold text-white">{p.prenomBeneficiaire}</p>
                  <Pill ton={p.statut === 'EXPIREE' ? 'rouge' : 'ambre'}>
                    {p.statut === 'EXPIREE' ? t('note.pec_expiree') : ilYA(p.creeLe)}
                  </Pill>
                </div>
                <p className="mb-2 text-sm text-sable/70">
                  {t('note.pec_reste', { n: p.nbLignes })} — <Montants cdf={p.resteCdf} usd={p.resteUsd} gras />
                </p>
                <div className="flex gap-2">
                  <div className="flex-1"><GrosBouton petit onClick={() => void decider(p.id, true)}>{t('note.accepter')}</GrosBouton></div>
                  <div className="flex-1"><GrosBouton petit ton="secondaire" onClick={() => void decider(p.id, false)}>{t('note.refuser')}</GrosBouton></div>
                </div>
              </div>
            ))}
          </div>
        </Carte>
      )}

      {/* ---------- Notes ouvertes à encaisser ---------- */}
      <p className="text-xs font-bold uppercase tracking-widest text-sable/50">{t('note.a_encaisser')}</p>
      {notes.data.length === 0 ? (
        <Vide icone={<ReceiptText className="h-8 w-8" />} titre={t('note.aucune_ouverte')} detail={t('note.aucune_ouverte_d')} />
      ) : (
        notes.data.map((n) => (
          <button key={n.id} onClick={() => setNoteOuverte(n)} className="text-left">
            <Carte classe="active:bg-white/5">
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-bold text-white">{n.prenom}</p>
                  <p className="text-xs text-sable/55">{ilYA(n.ouverteLe)} — {t('note.nb_lignes', { n: n.lignes.filter((l) => l.statut !== 'ANNULEE').length })}</p>
                </div>
                <div className="text-right">
                  <Pill ton={TON_STATUT[n.statut] ?? 'neutre'}>{t(`note.statut_${n.statut.toLowerCase()}`)}</Pill>
                  <p className="mt-1 text-sm"><Montants cdf={n.resteCdf} usd={n.resteUsd} gras /></p>
                </div>
              </div>
            </Carte>
          </button>
        ))
      )}

      <Feuille ouvert={!!noteOuverte} surFermer={() => setNoteOuverte(null)} titre={noteOuverte?.prenom ?? ''}>
        {noteOuverte && (
          <EncaissementNote
            note={noteOuverte}
            onFait={() => { setNoteOuverte(null); void notes.refetch(); void caisse.refetch() }}
          />
        )}
      </Feuille>

      <Confirmation
        ouvert={confirmeRemise}
        titre={t('note.remettre_caisse')}
        message={t('note.remettre_confirm', { montant: `${c.enMainCdf > 0 ? fmtCDF(c.enMainCdf) : ''}${c.enMainCdf > 0 && c.enMainUsd > 0 ? ' + ' : ''}${c.enMainUsd > 0 ? fmtUSD(c.enMainUsd) : ''}` })}
        surConfirmer={() => void remettre()}
        surAnnuler={() => setConfirmeRemise(false)}
      />
    </div>
  )
}

// ---------- Encaissement d'une note (§5.2 : total ou acompte) ----------

function EncaissementNote({ note, onFait }: { note: NoteVue; onFait: () => void }) {
  const t = useT()
  const [cdf, setCdf] = useState(String(note.resteCdf || ''))
  const [usd, setUsd] = useState(note.resteUsd > 0 ? (note.resteUsd / 100).toFixed(2) : '')
  const [pourboire, setPourboire] = useState('')
  const [refMobile, setRefMobile] = useState('')
  const [mode, setMode] = useState<'CASH' | 'MOBILE_MONEY'>('CASH')

  const detail = trpc.notes.voirNote.useQuery({ noteId: note.id })

  const encaisser = async () => {
    const mCdf = parseInt(cdf) || 0
    const mUsd = Math.round((parseFloat(usd.replace(',', '.')) || 0) * 100)
    const pCdf = mode === 'CASH' ? parseInt(pourboire) || 0 : 0
    if (mCdf <= 0 && mUsd <= 0) { toast.error(t('note.montant_requis')); return }
    try {
      const r = await encaisserNote(note.id, mCdf, mUsd, mode, refMobile.trim() || undefined, pCdf, 0)
      toast.success(t(r.reglee ? 'note.note_soldee' : 'note.acompte_enregistre'))
      onFait()
    } catch (e) { toast.error(e instanceof Error ? e.message : t('commun.erreur')) }
  }

  return (
    <div className="flex flex-col gap-3">
      {detail.data && (
        <div className="max-h-48 overflow-y-auto rounded-2xl bg-white/5 p-3">
          {detail.data.lignes.filter((l) => l.statut !== 'ANNULEE').map((l) => (
            <div key={l.id} className="flex justify-between py-1 text-sm">
              <span className="text-sable/80">{l.quantite > 1 ? `${l.quantite} × ` : ''}{l.libelle}</span>
              <span className="text-sable">{l.montantCdf > 0 ? fmtCDF(l.montantCdf) : fmtUSD(l.montantUsd)}</span>
            </div>
          ))}
        </div>
      )}
      <p className="flex justify-between text-sm">
        <span className="text-sable/70">{t('note.reste')}</span>
        <Montants cdf={note.resteCdf} usd={note.resteUsd} gras />
      </p>
      <div className="flex gap-2">
        {(['CASH', 'MOBILE_MONEY'] as const).map((m) => (
          <button
            key={m}
            onClick={() => setMode(m)}
            className={`flex-1 rounded-2xl py-2.5 text-sm font-bold ${mode === m ? 'bg-ambre text-sur-ambre' : 'bg-white/8 text-sable'}`}
          >
            {m === 'CASH' ? t('note.mode_cash') : t('note.mode_mobile')}
          </button>
        ))}
      </div>
      <div className="flex gap-2">
        <div className="flex-1">
          <SaisieNombre valeur={cdf} onChange={setCdf} placeholder={t('note.montant_cdf')} />
        </div>
        <div className="flex-1">
          <input
            className={`${classeSaisie} font-mono`}
            inputMode="decimal"
            value={usd}
            onChange={(e) => setUsd(e.target.value)}
            placeholder={t('note.montant_usd')}
            aria-label={t('note.montant_usd')}
          />
        </div>
      </div>
      {mode === 'MOBILE_MONEY' && (
        <input
          className={classeSaisie}
          value={refMobile}
          onChange={(e) => setRefMobile(e.target.value)}
          placeholder={t('note.ref_mobile_ph')}
          aria-label={t('note.ref_mobile_ph')}
        />
      )}
      {mode === 'CASH' && (
        <SaisieNombre valeur={pourboire} onChange={setPourboire} placeholder={t('note.pourboire_ph')} />
      )}
      <GrosBouton onClick={() => void encaisser()}>{t('note.encaisser')}</GrosBouton>
    </div>
  )
}
