// ============================================================
// GBS — Panneau gérant des remises de caisse (FUSION)
//  1. Déclarations de caisse (réceptionniste hôtel) — remises.ts
//  2. Remises de note (serveuse) — notes.ts (historique)
//  3. Paramètres anti-fraude (plafond note, token sur note)
// ============================================================

import { useState } from 'react'
import { CircleAlert, Settings, Wallet, Coins, ReceiptText } from 'lucide-react'
import { toast } from 'sonner'
import { Carte, Chargement, Feuille, GrosBouton, Pill, SaisieNombre, Vide, classeSaisie } from '@/components/gbs'
import { fmtCDF, fmtUSD, ilYA } from '@/lib/format'
import {
  useDB, validerRemiseNote, utilisateurDe,
  declarerCaisse, listerRemisesEnAttente, validerCaisse, contesterCaisse,
  ouEstLArgent,
} from '@/lib/store'
import { useT } from '@/i18n'
import { trpc } from '@/providers/trpc'

export function PanneauRemisesGerant({ terrasseId }: { terrasseId: string }) {
  const t = useT()
  const db = useDB()
  const [remiseChoisie, setRemiseChoisie] = useState<string | null>(null)
  const [remiseCaisseChoisie, setRemiseCaisseChoisie] = useState<string | null>(null)
  const [depotChoisi, setDepotChoisi] = useState<string | null>(null)
  const [plafond, setPlafond] = useState<string>(() => {
    const ter = db.terrasses.find((x) => x.id === terrasseId)
    return (ter as any)?.notePlafondCdf ? String((ter as any).notePlafondCdf) : ''
  })

  // --- Source 1 : remises de note (existant) ---
  const remisesNote = trpc.notes.remisesEnAttente.useQuery({ terrasseId }, { refetchInterval: 5000 })
  // --- Source 2 : déclarations de caisse (nouveau) ---
  const remisesCaisse = trpc.remises.listerEnAttente.useQuery({ terrasseId }, { refetchInterval: 5000 })

  const configMutation = trpc.notes.configurerNote.useMutation()
  const terrasse = db.terrasses.find((x) => x.id === terrasseId)
  const [tokenSurNote, setTokenSurNote] = useState<boolean>((terrasse as any)?.tokenSurNote ?? false)

  if (remisesNote.isPending || remisesCaisse.isPending) return <Chargement />
  if (remisesNote.error || !remisesNote.data) {
    return <Vide icone={<CircleAlert className="h-8 w-8" />} titre={t('note.indisponible')} detail={t('note.indisponible_d')} />
  }

  const configurer = async () => {
    try {
      await configMutation.mutateAsync({
        terrasseId,
        notePlafondCdf: plafond.trim() ? parseInt(plafond) : null,
        tokenSurNote,
      })
      toast.success(t('note.config_enregistree'))
    } catch (e) { toast.error(e instanceof Error ? e.message : t('commun.erreur')) }
  }

  // Résolution du nom de l'employé pour les déclarations de caisse
  const nomEmploye = (employeId: string) => utilisateurDe(db, employeId)?.nom ?? '—'

  return (
    <div className="flex flex-col gap-4 px-4 pt-4">
      {/* ---------- OÙ EST L'ARGENT ? (vue Gérant) ---------- */}
      {(() => {
        const etat = ouEstLArgent(db, terrasseId)
        const totalCash = etat.cashParEmploye.reduce((s, e) => s + e.cdf, 0)
        return (
          <Carte classe="border-ambre/30">
            <p className="mb-2 flex items-center gap-2 font-bold text-white">
              <Coins className="h-5 w-5 text-ambre" /> Où est l'argent ?
            </p>
            {etat.cashParEmploye.length > 0 ? (
              <>
                <p className="text-xs text-sable/60 mb-1">Cash en main (non remis)</p>
                {etat.cashParEmploye.map((e) => (
                  <div key={e.nom} className="flex justify-between text-sm py-0.5">
                    <span className="text-white">{e.nom}</span>
                    <span className="font-mono font-bold text-ambre">{fmtCDF(e.cdf)}</span>
                  </div>
                ))}
                <p className="mt-1 text-xs text-sable/50">Total : <b>{fmtCDF(totalCash)}</b></p>
              </>
            ) : (
              <p className="text-xs text-sable/60">Aucun cash en main.</p>
            )}
            {etat.declarationsEnAttente > 0 && (
              <p className="mt-2 text-sm text-ambre">
                <b>{etat.declarationsEnAttente}</b> déclaration(s) en attente de validation.
              </p>
            )}
            {etat.notesImpayees.nb > 0 && (
              <p className="mt-1 text-sm text-danger-clair">
                <b>{etat.notesImpayees.nb}</b> note(s) impayée(s) : {fmtCDF(etat.notesImpayees.cdf)}
                {etat.notesImpayees.usd > 0 ? ` + ${fmtUSD(etat.notesImpayees.usd)}` : ''}
              </p>
            )}
          </Carte>
        )
      })()}

      {/* ---------- SECTION 1 : Déclarations de caisse (remises.ts) ---------- */}
      <p className="text-xs font-bold uppercase tracking-widest text-sable/50">{t('note.remises_caisse_titre')}</p>
      {remisesCaisse.data.length === 0 ? (
        <Vide icone={<Coins className="h-8 w-8" />} titre={t('note.aucune_remise_caisse')} detail={t('note.aucune_remise_caisse_d')} />
      ) : (
        remisesCaisse.data.map((r) => (
          <button key={r.id} onClick={() => setRemiseCaisseChoisie(r.id)} className="text-left">
            <Carte classe="active:bg-white/5">
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-bold text-white">{nomEmploye(r.employeId)}</p>
                  <p className="text-xs text-sable/55">{ilYA(r.creeLe)}</p>
                </div>
                <div className="text-right">
                  <Pill ton="ambre">{t('note.a_valider')}</Pill>
                  <p className="mt-1 text-sm font-bold text-white">
                    {r.attenduCdf > 0 ? fmtCDF(r.attenduCdf) : ''}{r.attenduCdf > 0 && r.attenduUsd > 0 ? ' + ' : ''}{r.attenduUsd > 0 ? fmtUSD(r.attenduUsd) : ''}
                  </p>
                </div>
              </div>
            </Carte>
          </button>
        ))
      )}

      {/* ---------- SECTION 2 : Remises de note (notes.ts, existant) ---------- */}
      <p className="text-xs font-bold uppercase tracking-widest text-sable/50 mt-2">{t('note.remises_titre')}</p>
      {remisesNote.data.length === 0 ? (
        <Vide icone={<Wallet className="h-8 w-8" />} titre={t('note.aucune_remise')} detail={t('note.aucune_remise_d')} />
      ) : (
        remisesNote.data.map((r) => (
          <button key={r.id} onClick={() => setRemiseChoisie(r.id)} className="text-left">
            <Carte classe="active:bg-white/5">
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-bold text-white">{r.employeNom}</p>
                  <p className="text-xs text-sable/55">{ilYA(r.creeLe)}</p>
                </div>
                <div className="text-right">
                  <Pill ton="ambre">{t('note.a_valider')}</Pill>
                  <p className="mt-1 text-sm font-bold text-white">
                    {r.attenduCdf > 0 ? fmtCDF(r.attenduCdf) : ''}{r.attenduCdf > 0 && r.attenduUsd > 0 ? ' + ' : ''}{r.attenduUsd > 0 ? fmtUSD(r.attenduUsd) : ''}
                  </p>
                </div>
              </div>
            </Carte>
          </button>
        ))
      )}

      {/* ---------- SECTION 2.5 : Dépôts serveuses (depots) ---------- */}
      <p className="text-xs font-bold uppercase tracking-widest text-sable/50 mt-2">{t('note.depots_serveuses_titre')}</p>
      {(() => {
        const depots = db.depots.filter((d) => d.terrasseId === terrasseId && d.statut === 'DECLARE')
        if (depots.length === 0) {
          return <Vide icone={<Wallet className="h-8 w-8" />} titre={t('note.aucun_depot')} detail={t('note.aucun_depot_d')} />
        }
        return depots.map((d) => {
          const employe = utilisateurDe(db, d.serveuseId)
          const ecart = d.declareCdf !== d.montantAttenduCdf || d.declareUsdCentimes !== d.montantAttenduUsdCentimes
          return (
            <button key={d.id} onClick={() => setDepotChoisi(d.id)} className="text-left">
              <Carte classe={`active:bg-white/5 ${ecart ? 'border-danger/40' : ''}`}>
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-bold text-white">{employe?.nom ?? '—'}</p>
                    <p className="text-xs text-sable/55">{ilYA(d.declareLe)} · {d.typeDepot === 'CHAMBRE' ? 'Chambre' : 'Commandes'}</p>
                  </div>
                  <div className="text-right">
                    <Pill ton={ecart ? 'danger' : 'ambre'}>{t('note.a_valider')}</Pill>
                    <p className="mt-1 text-sm font-bold text-white">
                      {d.montantAttenduCdf > 0 ? fmtCDF(d.montantAttenduCdf) : ''}{d.montantAttenduCdf > 0 && d.montantAttenduUsdCentimes > 0 ? ' + ' : ''}{d.montantAttenduUsdCentimes > 0 ? fmtUSD(d.montantAttenduUsdCentimes) : ''}
                    </p>
                  </div>
                </div>
              </Carte>
            </button>
          )
        })
      })()}
      {/* ---------- SECTION 3 : Paramètres anti-fraude (existant) ---------- */}
      <Carte>
        <p className="mb-2 flex items-center gap-2 font-bold text-white"><Settings className="h-5 w-5 text-ambre" /> {t('note.config_titre')}</p>
        <p className="mb-1 text-sm font-semibold text-sable">{t('note.config_plafond')}</p>
        <p className="mb-2 text-xs text-sable/60">{t('note.config_plafond_d')}</p>
        <SaisieNombre valeur={plafond} onChange={setPlafond} placeholder={t('note.config_plafond_ph')} />
        <label className="mt-4 flex items-center justify-between gap-3">
          <span>
            <span className="block text-sm font-semibold text-sable">{t('note.config_token')}</span>
            <span className="block text-xs text-sable/60">{t('note.config_token_d')}</span>
          </span>
          <input
            type="checkbox"
            className="h-6 w-6 accent-ambre"
            checked={tokenSurNote}
            onChange={(e) => setTokenSurNote(e.target.checked)}
            aria-label={t('note.config_token')}
          />
        </label>
        <div className="mt-4">
          <GrosBouton onClick={() => void configurer()}>{t('commun.enregistrer')}</GrosBouton>
        </div>
      </Carte>

      {/* ---------- Feuille 1 : Validation remise de caisse ---------- */}
      <Feuille
        ouvert={!!remiseCaisseChoisie}
        surFermer={() => setRemiseCaisseChoisie(null)}
        titre={t('note.valider_remise_caisse')}
      >
        {remiseCaisseChoisie && (
          <ValidationRemiseCaisse
            remise={remisesCaisse.data.find((r) => r.id === remiseCaisseChoisie)!}
            nomEmploye={nomEmploye(remisesCaisse.data.find((r) => r.id === remiseCaisseChoisie)!.employeId)}
            onFait={() => { setRemiseCaisseChoisie(null); void remisesCaisse.refetch() }}
          />
        )}
      </Feuille>

      {/* ---------- Feuille 2 : Validation remise de note (existant) ---------- */}
      <Feuille
        ouvert={!!remiseChoisie}
        surFermer={() => setRemiseChoisie(null)}
        titre={t('note.valider_remise')}
      >
        {remiseChoisie && (
          <ValidationRemise
            remise={remisesNote.data.find((r) => r.id === remiseChoisie)!}
            onFait={() => { setRemiseChoisie(null); void remisesNote.refetch() }}
          />
        )}
      </Feuille>
    </div>
  )
}

// ============================================================
// Validation d'une déclaration de caisse (remises.ts)
// ============================================================
function ValidationRemiseCaisse({ remise, nomEmploye, onFait }: {
  remise: { id: string; attenduCdf: number; attenduUsd: number }
  nomEmploye: string
  onFait: () => void
}) {
  const t = useT()
  const [recuCdf, setRecuCdf] = useState(String(remise.attenduCdf))
  const [recuUsd, setRecuUsd] = useState((remise.attenduUsd / 100).toFixed(2))
  const [motif, setMotif] = useState('')

  const cdf = parseInt(recuCdf) || 0
  const usd = Math.round((parseFloat(recuUsd.replace(',', '.')) || 0) * 100)
  const ecart = cdf !== remise.attenduCdf || usd !== remise.attenduUsd

  const valider = async () => {
    if (ecart && !motif.trim()) { toast.error(t('note.motif_requis')); return }
    try {
      await validerCaisse(remise.id, cdf, usd, motif.trim())
      toast.success(t(ecart ? 'note.remise_ecart' : 'note.remise_validee'))
      onFait()
    } catch (e) { toast.error(e instanceof Error ? e.message : t('commun.erreur')) }
  }

  const contester = async () => {
    if (!motif.trim()) { toast.error(t('note.motif_requis')); return }
    try {
      await contesterCaisse(remise.id, motif.trim())
      toast.success(t('note.remise_contestee'))
      onFait()
    } catch (e) { toast.error(e instanceof Error ? e.message : t('commun.erreur')) }
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-sable/80">{t('note.remise_de', { nom: nomEmploye })}</p>
      <p className="flex justify-between text-sm">
        <span className="text-sable/70">{t('note.remise_attendu')}</span>
        <b className="text-white">
          {remise.attenduCdf > 0 ? fmtCDF(remise.attenduCdf) : ''}{remise.attenduCdf > 0 && remise.attenduUsd > 0 ? ' + ' : ''}{remise.attenduUsd > 0 ? fmtUSD(remise.attenduUsd) : ''}
        </b>
      </p>
      <p className="text-sm font-semibold text-sable">{t('note.remise_recu')}</p>
      <div className="flex gap-2">
        <div className="flex-1"><SaisieNombre valeur={recuCdf} onChange={setRecuCdf} placeholder={t('note.montant_cdf')} /></div>
        <div className="flex-1">
          <input
            className={`${classeSaisie} font-mono`}
            inputMode="decimal"
            value={recuUsd}
            onChange={(e) => setRecuUsd(e.target.value)}
            placeholder={t('note.montant_usd')}
            aria-label={t('note.montant_usd')}
          />
        </div>
      </div>
      {ecart && (
        <>
          <p className="rounded-xl bg-danger/10 px-3 py-2 text-sm font-semibold text-danger-clair">{t('note.ecart_detecte')}</p>
          <input
            className={classeSaisie}
            value={motif}
            onChange={(e) => setMotif(e.target.value)}
            placeholder={t('note.remise_motif_ph')}
            aria-label={t('note.remise_motif_ph')}
          />
        </>
      )}
      <div className="flex gap-2">
        <GrosBouton ton="secondaire" onClick={() => void contester()}>
          {t('note.contester')}
        </GrosBouton>
        <GrosBouton ton={ecart ? 'danger' : 'primaire'} onClick={() => void valider()}>
          {ecart ? t('note.valider_avec_ecart') : t('note.valider_remise')}
        </GrosBouton>
      </div>
    </div>
  )
}

// ============================================================
// Validation d'une remise de note (notes.ts) — INCHANGÉ
// ============================================================
function ValidationRemise({ remise, onFait }: {
  remise: { id: string; employeNom: string; attenduCdf: number; attenduUsd: number }
  onFait: () => void
}) {
  const t = useT()
  const [recuCdf, setRecuCdf] = useState(String(remise.attenduCdf))
  const [recuUsd, setRecuUsd] = useState((remise.attenduUsd / 100).toFixed(2))
  const [motif, setMotif] = useState('')

  const cdf = parseInt(recuCdf) || 0
  const usd = Math.round((parseFloat(recuUsd.replace(',', '.')) || 0) * 100)
  const ecart = cdf !== remise.attenduCdf || usd !== remise.attenduUsd

  const valider = async () => {
    if (ecart && !motif.trim()) { toast.error(t('note.motif_requis')); return }
    try {
      await validerRemiseNote(remise.id, cdf, usd, motif.trim())
      toast.success(t(ecart ? 'note.remise_ecart' : 'note.remise_validee'))
      onFait()
    } catch (e) { toast.error(e instanceof Error ? e.message : t('commun.erreur')) }
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-sable/80">{t('note.remise_de', { nom: remise.employeNom })}</p>
      <p className="flex justify-between text-sm">
        <span className="text-sable/70">{t('note.remise_attendu')}</span>
        <b className="text-white">
          {remise.attenduCdf > 0 ? fmtCDF(remise.attenduCdf) : ''}{remise.attenduCdf > 0 && remise.attenduUsd > 0 ? ' + ' : ''}{remise.attenduUsd > 0 ? fmtUSD(remise.attenduUsd) : ''}
        </b>
      </p>
      <p className="text-sm font-semibold text-sable">{t('note.remise_recu')}</p>
      <div className="flex gap-2">
        <div className="flex-1"><SaisieNombre valeur={recuCdf} onChange={setRecuCdf} placeholder={t('note.montant_cdf')} /></div>
        <div className="flex-1">
          <input
            className={`${classeSaisie} font-mono`}
            inputMode="decimal"
            value={recuUsd}
            onChange={(e) => setRecuUsd(e.target.value)}
            placeholder={t('note.montant_usd')}
            aria-label={t('note.montant_usd')}
          />
        </div>
      </div>
      {ecart && (
        <>
          <p className="rounded-xl bg-danger/10 px-3 py-2 text-sm font-semibold text-danger-clair">{t('note.ecart_detecte')}</p>
          <input
            className={classeSaisie}
            value={motif}
            onChange={(e) => setMotif(e.target.value)}
            placeholder={t('note.remise_motif_ph')}
            aria-label={t('note.remise_motif_ph')}
          />
        </>
      )}
      <GrosBouton ton={ecart ? 'danger' : 'primaire'} onClick={() => void valider()}>
        {ecart ? t('note.valider_avec_ecart') : t('note.valider_remise')}
      </GrosBouton>
    </div>
  )
}
