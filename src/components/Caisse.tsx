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
import { depensesDuJour, enregistrerDepense, soldeBoutique, useDB, utilisateurDe, declarerCaisse } from '@/lib/store'
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
        <DeclarerCaisse terrasseId={terrasseId} />

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

// ============================================================
// Déclaration de caisse (réceptionniste) — bloc ajouté sous le solde
// Règle GBS : « Là où l'argent disparaît, GBS le voit. »
// ============================================================
export function DeclarerCaisse({ terrasseId }: { terrasseId: string }) {
  const db = useDB()
  const t = useT()
  const solde = soldeBoutique(db, terrasseId)
  const [ouvert, setOuvert] = useState(false)
  const [recuCdf, setRecuCdf] = useState(String(solde.cdf))
  const [recuUsd, setRecuUsd] = useState((solde.usdCentimes / 100).toFixed(2))
  const [motif, setMotif] = useState('')
  const [chargement, setChargement] = useState(false)
  const [fait, setFait] = useState(false)

  const recuCdfNum = parseInt(recuCdf) || 0
  const recuUsdNum = Math.round((parseFloat(recuUsd.replace(',', '.')) || 0) * 100)
  const ecartCdf = recuCdfNum - solde.cdf
  const ecartUsd = recuUsdNum - solde.usdCentimes
  const aEcart = ecartCdf !== 0 || ecartUsd !== 0

  const declarer = async () => {
    if (chargement) return
    if (aEcart && motif.trim().length < 3) {
      toast.error(t('caisse.motif_ecart'))
      return
    }
    setChargement(true)
    try {
      await declarerCaisse(terrasseId, solde.cdf, solde.usdCentimes, recuCdfNum, recuUsdNum, aEcart ? motif.trim() : undefined)
      toast.success(t('caisse.en_attente_validation'))
      setFait(true)
      setOuvert(false)
      setMotif('')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t('commun.erreur'))
    } finally {
      setChargement(false)
    }
  }

  return (
    <Carte>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs uppercase tracking-widest text-sable/50">{t('caisse.declarer_titre')}</p>
          <p className="mt-1 text-xs text-sable/60">
            {t('caisse.attendu')} : <Money cdf={solde.cdf} usd={solde.usdCentimes} />
          </p>
        </div>
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-ambre/15">
          <Wallet className="h-5 w-5 text-ambre" />
        </div>
      </div>

      {fait ? (
        <p className="mt-3 text-sm text-succes-clair">✓ {t('caisse.en_attente_validation')}</p>
      ) : !ouvert ? (
        <div className="mt-3">
          <GrosBouton petit onClick={() => setOuvert(true)}>
            {t('caisse.declarer')}
          </GrosBouton>
        </div>
      ) : (
        <div className="mt-3 flex flex-col gap-3">
          <div className="grid grid-cols-2 gap-3">
            <SaisieNombre valeur={recuCdf} onChange={setRecuCdf} placeholder={t('caisse.recu_cdf')} />
            <input
              className={`${classeSaisie} font-mono`}
              inputMode="decimal"
              value={recuUsd}
              onChange={(e) => setRecuUsd(e.target.value)}
              placeholder={t('caisse.recu_usd')}
            />
          </div>
          {aEcart && (
            <>
              <p className="text-sm font-semibold text-ambre">
                {t('caisse.ecart')} : {ecartCdf > 0 ? '+' : ''}{fmtCDF(ecartCdf)} / {ecartUsd > 0 ? '+' : ''}{fmtUSD(ecartUsd)}
              </p>
              <input className={classeSaisie} value={motif} onChange={(e) => setMotif(e.target.value)} placeholder={t('caisse.motif_ecart')} />
            </>
          )}
          <div className="flex gap-2">
            <GrosBouton petit ton="secondaire" onClick={() => setOuvert(false)}>
              {t('commun.annuler')}
            </GrosBouton>
            <GrosBouton petit charge={chargement} onClick={() => void declarer()} desactive={aEcart && motif.trim().length < 3}>
              {t('caisse.declarer')}
            </GrosBouton>
          </div>
        </div>
      )}
    </Carte>
  )
}
