// ============================================================
// GBS — Composants partagés (thème nuit, gros boutons)
// ============================================================

import { useEffect, useRef, useState, type ReactNode } from 'react'
import QRCode from 'qrcode'
import { Check, ChevronLeft, Loader2, MessageCircle, Star, X } from 'lucide-react'
import { fmtCDF, fmtUSD } from '@/lib/format'
import { useT } from '@/i18n'
import { SelecteurLangue } from '@/components/SelecteurLangue'
import { WA_NUMERO } from '@/lib/contact'
import type { StatutCommande } from '@/lib/types'

// ---------- Support client WhatsApp ----------

/** Numéro WhatsApp du support plateforme — source unique : src/lib/contact.ts */
export const WHATSAPP_SUPPORT = WA_NUMERO

/**
 * Bouton d'en-tête « Support client » : ouvre une conversation WhatsApp
 * avec la plateforme dans un nouvel onglet (deeplink wa.me).
 */
export function BoutonSupportWhatsApp() {
  const t = useT()
  const message = encodeURIComponent(t('ui.support_whatsapp'))
  return (
    <a
      href={`https://wa.me/${WHATSAPP_SUPPORT}?text=${message}`}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={t('ui.support_aria')}
      title={t('ui.support_titre')}
      className="flex h-11 w-11 items-center justify-center rounded-full text-succes-clair active:bg-white/10"
    >
      <MessageCircle className="h-5 w-5" />
    </a>
  )
}

// ---------- Montant ----------

export function Money({ cdf = 0, usd = 0, gros = false }: { cdf?: number; usd?: number; gros?: boolean }) {
  const cls = `whitespace-nowrap ${gros ? 'font-mono text-xl font-bold text-white' : 'font-mono font-semibold text-white'}`
  if (cdf > 0 && usd > 0) {
    return (
      <span className={cls}>
        {fmtCDF(cdf)} <span className="text-sable/60 font-normal">+</span> {fmtUSD(usd)}
      </span>
    )
  }
  if (usd > 0) return <span className={cls}>{fmtUSD(usd)}</span>
  return <span className={cls}>{fmtCDF(cdf)}</span>
}

// ---------- Pastille de statut ----------

const COULEURS_CMD: Record<StatutCommande, { fond: string; texte: string; cle: string }> = {
  EN_ATTENTE: { fond: 'bg-ambre/15 text-ambre', texte: 'rgb(var(--ambre))', cle: 'statut.en_attente' },
  CONFIRMEE: { fond: 'bg-info/15 text-info-clair', texte: 'rgb(var(--info))', cle: 'statut.confirmee' },
  SERVIE: { fond: 'bg-succes/15 text-succes-clair', texte: 'rgb(var(--succes))', cle: 'statut.servie' },
  ANNULEE: { fond: 'bg-danger/15 text-danger-clair', texte: 'rgb(var(--danger))', cle: 'statut.annulee' },
}

export function BadgeCmd({ statut }: { statut: StatutCommande }) {
  const t = useT()
  const c = COULEURS_CMD[statut]
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ${c.fond}`}>
      <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: c.texte }} />
      {t(c.cle)}
    </span>
  )
}

export function Pill({ children, ton = 'neutre' }: { children: ReactNode; ton?: 'neutre' | 'ambre' | 'vert' | 'rouge' | 'bleu' }) {
  const tons = {
    neutre: 'bg-white/8 text-sable',
    ambre: 'bg-ambre/15 text-ambre',
    vert: 'bg-succes/15 text-succes-clair',
    rouge: 'bg-danger/15 text-danger-clair',
    bleu: 'bg-info/15 text-info-clair',
  }
  return <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold ${tons[ton]}`}>{children}</span>
}

// ---------- Boutons ----------

export function GrosBouton({
  children, onClick, ton = 'primaire', desactive = false, charge = false, petit = false, type = 'button',
}: {
  children: ReactNode
  onClick?: () => void
  ton?: 'primaire' | 'secondaire' | 'danger' | 'fantome'
  desactive?: boolean
  charge?: boolean
  petit?: boolean
  type?: 'button' | 'submit'
}) {
  const tons = {
    primaire: 'bg-ambre text-sur-ambre active:bg-ambre-actif disabled:bg-ambre/30 disabled:text-sur-ambre/40',
    secondaire: 'bg-white/10 text-white active:bg-white/15 disabled:opacity-40',
    danger: 'bg-danger/15 text-danger-clair border border-danger/30 active:bg-danger/25 disabled:opacity-40',
    fantome: 'text-sable active:bg-white/5 disabled:opacity-40',
  }
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={desactive || charge}
      className={`flex w-full items-center justify-center gap-2 rounded-2xl font-bold transition-colors focus-visible:ring-2 focus-visible:ring-ambre/60 ${petit ? 'min-h-11 px-4 text-sm' : 'min-h-14 px-5 text-base'} ${tons[ton]}`}
    >
      {charge && <Loader2 className="h-5 w-5 animate-spin motion-reduce:animate-none" />}
      {children}
    </button>
  )
}

// ---------- En-tête ----------

export function Entete({ titre, sousTitre, retour, droite }: { titre: string; sousTitre?: string; retour?: () => void; droite?: ReactNode }) {
  const t = useT()
  return (
    <header className="sticky top-0 z-30 border-b border-white/5 bg-encre/90 backdrop-blur-md">
      <div className="mx-auto flex min-h-16 max-w-[430px] items-center gap-3 px-4">
        {retour && (
          <button onClick={retour} className="-ml-2 flex h-11 w-11 items-center justify-center rounded-full text-sable active:bg-white/10" aria-label={t('commun.retour')}>
            <ChevronLeft className="h-6 w-6" />
          </button>
        )}
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-lg font-bold text-white">{titre}</h1>
          {sousTitre && <p className="truncate text-xs text-sable/70">{sousTitre}</p>}
        </div>
        {/* Boucle 5 : changement de langue possible depuis tout écran staff */}
        <SelecteurLangue compact />
        {droite}
      </div>
    </header>
  )
}

// ---------- Navigation basse ----------

export interface Onglet {
  id: string
  label: string
  icone: ReactNode
  badge?: number
}

export function NavBasse({ onglets, actif, onChange }: { onglets: Onglet[]; actif: string; onChange: (id: string) => void }) {
  return (
    <nav className="fixed inset-x-0 bottom-0 z-30 border-t border-white/5 bg-encre/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-md">
      <div className="mx-auto flex max-w-[430px]">
        {onglets.map((o) => (
          <button
            key={o.id}
            onClick={() => onChange(o.id)}
            className={`relative flex flex-1 flex-col items-center gap-1 py-2.5 text-[11px] font-semibold transition-colors ${
              actif === o.id ? 'text-ambre' : 'text-sable/60'
            }`}
          >
            <span className="relative">
              {o.icone}
              {!!o.badge && (
                <span className="absolute -right-2 -top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-danger px-1 text-[10px] font-bold text-encre">
                  {o.badge}
                </span>
              )}
            </span>
            {o.label}
            {actif === o.id && <span className="absolute top-0 h-0.5 w-8 rounded-full bg-ambre" />}
          </button>
        ))}
      </div>
    </nav>
  )
}

// ---------- Fenêtre modale (feuille basse mobile) ----------

export function Feuille({ ouvert, surFermer, titre, children }: { ouvert: boolean; surFermer: () => void; titre: string; children: ReactNode }) {
  const t = useT()
  if (!ouvert) return null
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center">
      {/* Fond : purement décoratif (clic = fermer). La fermeture reste
          possible au clavier via le bouton « Fermer » ci-dessous. */}
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={surFermer} aria-hidden="true" />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={titre}
        className="relative max-h-[88vh] w-full max-w-[430px] overflow-y-auto rounded-t-3xl border border-white/10 bg-surface p-5 pb-8 shadow-2xl sm:rounded-3xl"
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-bold text-white">{titre}</h2>
          <button onClick={surFermer} className="flex h-11 w-11 items-center justify-center rounded-full text-sable transition-colors focus-visible:ring-2 focus-visible:ring-ambre/60 active:bg-white/10" aria-label={t('commun.fermer')}>
            <X className="h-5 w-5" />
          </button>
        </div>
        {children}
      </div>
    </div>
  )
}

// ---------- Champs ----------

export function Champ({ label, children, aide }: { label: string; children: ReactNode; aide?: string }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-semibold text-sable">{label}</span>
      {children}
      {aide && <span className="mt-1 block text-xs text-sable/50">{aide}</span>}
    </label>
  )
}

export const classeSaisie =
  'w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3.5 text-base text-white placeholder:text-sable/40 outline-none transition-colors focus:border-ambre/60 focus-visible:ring-2 focus-visible:ring-ambre/50'

export function SaisieNombre({ valeur, onChange, placeholder, min = 0 }: { valeur: string; onChange: (v: string) => void; placeholder?: string; min?: number }) {
  return (
    <input
      type="number"
      inputMode="numeric"
      min={min}
      value={valeur}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className={`${classeSaisie} font-mono`}
    />
  )
}

// ---------- QR Code ----------

export function QR({ valeur, taille = 180 }: { valeur: string; taille?: number }) {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    if (ref.current) {
      QRCode.toCanvas(ref.current, valeur, {
        width: taille,
        margin: 2,
        // Canvas : les variables CSS ne s'y résolvent pas — hex littéral requis
        // (encre #14161d sur blanc, fidèle aux tokens --encre/--creme).
        color: { dark: '#14161d', light: '#ffffff' },
        errorCorrectionLevel: 'M',
      })
    }
  }, [valeur, taille])
  return <canvas ref={ref} className="rounded-xl" style={{ width: taille, height: taille }} />
}

// ---------- Étoiles ----------

export function Etoiles({ note, onChange, taille = 6 }: { note: number; onChange?: (n: number) => void; taille?: number }) {
  const t = useT()
  const [survol, setSurvol] = useState(0)
  return (
    <div className="flex gap-1">
      {[1, 2, 3, 4, 5].map((n) => {
        const remplie = n <= (onChange ? survol || note : note)
        return (
          <button
            key={n}
            type="button"
            disabled={!onChange}
            onClick={() => onChange?.(n)}
            onMouseEnter={() => onChange && setSurvol(n)}
            onMouseLeave={() => onChange && setSurvol(0)}
            className={`${onChange ? 'h-12 w-12' : ''} flex items-center justify-center rounded-full transition-transform ${onChange ? 'active:scale-90' : ''}`}
            aria-label={t(n > 1 ? 'ui.etoiles' : 'ui.etoile', { n })}
          >
            <Star
              style={{ width: taille * 4, height: taille * 4 }}
              className={remplie ? 'fill-ambre text-ambre' : 'text-sable/30'}
            />
          </button>
        )
      })}
    </div>
  )
}

// ---------- État vide ----------

export function Vide({ icone, titre, detail }: { icone: ReactNode; titre: string; detail?: string }) {
  return (
    <div className="flex flex-col items-center gap-3 py-14 text-center">
      <div className="flex h-16 w-16 items-center justify-center rounded-full bg-white/5 text-sable/50">{icone}</div>
      <p className="font-semibold text-sable">{titre}</p>
      {detail && <p className="max-w-60 text-sm text-sable/50">{detail}</p>}
    </div>
  )
}

// ---------- Carte ----------

export function Carte({ children, classe = '' }: { children: ReactNode; classe?: string }) {
  return <div className={`rounded-3xl border border-white/8 bg-surface p-4 ${classe}`}>{children}</div>
}

// ---------- Ligne de confirmation ----------

export function Confirmation({
  ouvert, titre, message, surConfirmer, surAnnuler, danger = false,
}: {
  ouvert: boolean
  titre: string
  message: string
  surConfirmer: () => void
  surAnnuler: () => void
  danger?: boolean
}) {
  const t = useT()
  if (!ouvert) return null
  return (
    <Feuille ouvert={ouvert} surFermer={surAnnuler} titre={titre}>
      <p className="mb-5 text-sable">{message}</p>
      <div className="flex gap-3">
        <GrosBouton ton="secondaire" onClick={surAnnuler}>{t('commun.annuler')}</GrosBouton>
        <GrosBouton ton={danger ? 'danger' : 'primaire'} onClick={surConfirmer}>
          <Check className="h-5 w-5" /> {t('commun.confirmer')}
        </GrosBouton>
      </div>
    </Feuille>
  )
}


// ---------- Écran de chargement (connexion au serveur) ----------

export function Chargement({ label }: { label?: string }) {
  const t = useT()
  const libelle = label ?? t('ui.connexion_serveur')
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-4 px-6">
      <Loader2 className="h-10 w-10 animate-spin text-ambre motion-reduce:animate-none" />
      <p className="text-sm font-semibold text-sable/70">{libelle}</p>
    </div>
  )
}
