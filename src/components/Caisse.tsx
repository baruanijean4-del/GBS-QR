// ============================================================
// GBS — Bloc caisse : solde de la boutique + dépenses du jour
// Partagé entre le Pilotage du Propriétaire et le Tableau du
// Gérant. Le solde = ventes encaissées − dépôts validés −
// dépenses (voir soldeBoutique dans lib/store). Chaque dépense
// est enregistrée côté serveur avec motif obligatoire et audit.
// ============================================================

import { useState } from 'react'
import { MinusCircle, Wallet } from 'lucide-react'
import { toast } from 'sonner'
import { Carte, Feuille, GrosBouton, Money, SaisieNombre, classeSaisie } from './gbs'
import { fmtCDF, fmtUSD, heureLubu } from '@/lib/format'
import { depensesDuJour, enregistrerDepense, soldeBoutique, useDB, utilisateurDe } from '@/lib/store'
import { useT } from '@/i18n'

export function BlocCaisse({ terrasseId }: { terrasseId: string }) {
  const db = useDB()
  const t = useT()
  const [feuille, setFeuille] = useState(false)
  const [cdf, setCdf] = useState('')
  const [usd, setUsd] = useState('')
  const [motif, setMotif] = useState('')
  const [chargement, setChargement] = useState(false)

  const solde = soldeBoutique(db, terrasseId)
  const du_jour = depensesDuJour(db, terrasseId)
  const depJourCdf = du_jour.reduce((t, d) => t + d.montantCdf, 0)
  const depJourUsd = du_jour.reduce((t, d) => t + d.montantUsdCentimes, 0)

  const enregistrer = async () => {
    if (chargement) return
    const montantCdf = parseInt(cdf) || 0
    const montantUsdCentimes = Math.round((parseFloat(usd.replace(',', '.')) || 0) * 100)
    if (montantCdf <= 0 && montantUsdCentimes <= 0) {
      toast.error(t('caisse.montant_manquant'))
      return
    }
    if (motif.trim().length < 2) {
      toast.error(t('caisse.motif_manquant'))
      return
    }
    setChargement(true)
    try {
      await enregistrerDepense(terrasseId, montantCdf, montantUsdCentimes, motif.trim())
      toast.success(t('caisse.enregistree'))
      setFeuille(false)
      setCdf('')
      setUsd('')
      setMotif('')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t('commun.erreur'))
    } finally {
      setChargement(false)
    }
  }

  return (
    <>
      <Carte>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs uppercase tracking-widest text-sable/50">{t('caisse.solde')}</p>
            <div className="mt-1"><Money cdf={solde.cdf} usd={solde.usdCentimes} gros /></div>
            <p className="mt-1 text-xs text-sable/50">
              {t('caisse.depenses_jour', { montants: fmtCDF(depJourCdf) + (depJourUsd > 0 ? ` + ${fmtUSD(depJourUsd)}` : '') })}
              {' '}({du_jour.length} {t(du_jour.length > 1 ? 'caisse.sorties' : 'caisse.sortie')})
            </p>
          </div>
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-succes/15">
            <Wallet className="h-5 w-5 text-succes-clair" />
          </div>
        </div>
        <div className="mt-3">
          <GrosBouton petit ton="secondaire" onClick={() => setFeuille(true)}>
            <MinusCircle className="h-4 w-4" /> {t('caisse.enregistrer_depense')}
          </GrosBouton>
        </div>

        {/* Détail des dépenses du jour */}
        {du_jour.length > 0 && (
          <div className="mt-3 flex flex-col gap-1.5 border-t border-white/10 pt-3">
            {du_jour.map((d) => (
              <div key={d.id} className="flex items-center justify-between gap-2 text-sm">
                <p className="min-w-0 flex-1 truncate text-sable">
                  {d.motif} <span className="text-sable/40">· {utilisateurDe(db, d.saisiPar)?.nom ?? ''} · {heureLubu(d.creeLe)}</span>
                </p>
                <p className="shrink-0 font-mono font-semibold text-danger-clair">
                  −{d.montantCdf > 0 ? fmtCDF(d.montantCdf) : fmtUSD(d.montantUsdCentimes)}
                </p>
              </div>
            ))}
          </div>
        )}
      </Carte>

      <Feuille ouvert={feuille} surFermer={() => setFeuille(false)} titre={t('caisse.titre_feuille')}>
        <div className="flex flex-col gap-4">
          <p className="text-sm text-sable/70">
            {t('caisse.explication')}
          </p>
          <div className="grid grid-cols-2 gap-3">
            <SaisieNombre valeur={cdf} onChange={setCdf} placeholder={t('caisse.montant_fc')} />
            <input
              className={`${classeSaisie} font-mono`}
              inputMode="decimal"
              value={usd}
              onChange={(e) => setUsd(e.target.value)}
              placeholder={t('caisse.montant_usd')}
            />
          </div>
          <input className={classeSaisie} value={motif} onChange={(e) => setMotif(e.target.value)} placeholder={t('caisse.motif_ph')} />
          <GrosBouton charge={chargement} onClick={() => void enregistrer()}>
            <MinusCircle className="h-5 w-5" /> {t('caisse.enregistrer_depense')}
          </GrosBouton>
        </div>
      </Feuille>
    </>
  )
}
