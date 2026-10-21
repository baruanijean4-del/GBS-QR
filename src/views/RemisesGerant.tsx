// ============================================================
// GBS — Panneau gérant des remises de caisse et du paramétrage de
// la note (ANNEXE-2 §5.6 et §6).
//
//  * Validation PAR LE RECEVEUR : attendu (déclaré) vs reçu (compté) ;
//    tout écart exige un motif et alerte le propriétaire aussitôt.
//    Le receveur ne valide JAMAIS sa propre remise (contrôle serveur).
//  * Paramètres anti-fraude : plafond de note impayée (NULL = comportement
//    historique) et exception « token de billard sur la note ».
// ============================================================

import { useState } from 'react'
import { CircleAlert, Settings, Wallet } from 'lucide-react'
import { toast } from 'sonner'
import { Carte, Chargement, Feuille, GrosBouton, Pill, SaisieNombre, Vide, classeSaisie } from '@/components/gbs'
import { fmtCDF, fmtUSD, ilYA } from '@/lib/format'
import { useDB, validerRemiseNote } from '@/lib/store'
import { useT } from '@/i18n'
import { trpc } from '@/providers/trpc'

export function PanneauRemisesGerant({ terrasseId }: { terrasseId: string }) {
  const t = useT()
  const db = useDB()
  const [remiseChoisie, setRemiseChoisie] = useState<string | null>(null)
  const [plafond, setPlafond] = useState<string>(() => {
    const ter = db.terrasses.find((x) => x.id === terrasseId)
    return ter?.notePlafondCdf ? String(ter.notePlafondCdf) : ''
  })
  const remises = trpc.notes.remisesEnAttente.useQuery({ terrasseId }, { refetchInterval: 5000 })
  const configMutation = trpc.notes.configurerNote.useMutation()
  const terrasse = db.terrasses.find((x) => x.id === terrasseId)
  const [tokenSurNote, setTokenSurNote] = useState<boolean>(terrasse?.tokenSurNote ?? false)

  if (remises.isPending) return <Chargement />
  if (remises.error || !remises.data) {
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

  return (
    <div className="flex flex-col gap-4 px-4 pt-4">
      {/* ---------- Remises en attente de validation (§5.6) ---------- */}
      <p className="text-xs font-bold uppercase tracking-widest text-sable/50">{t('note.remises_titre')}</p>
      {remises.data.length === 0 ? (
        <Vide icone={<Wallet className="h-8 w-8" />} titre={t('note.aucune_remise')} detail={t('note.aucune_remise_d')} />
      ) : (
        remises.data.map((r) => (
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

      {/* ---------- Paramètres anti-fraude de la note (§6) ---------- */}
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

      <Feuille
        ouvert={!!remiseChoisie}
        surFermer={() => setRemiseChoisie(null)}
        titre={t('note.valider_remise')}
      >
        {remiseChoisie && (
          <ValidationRemise
            remise={remises.data.find((r) => r.id === remiseChoisie)!}
            onFait={() => { setRemiseChoisie(null); void remises.refetch() }}
          />
        )}
      </Feuille>
    </div>
  )
}

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
