import { LANGUES, useI18n } from '@/i18n'

/**
 * Sélecteur de langue FR | EN | PT | SW (thème nuit).
 * Visible sur l'accueil, l'inscription, la connexion et l'en-tête
 * des espaces staff (variante compacte) — boucle 5.
 */
export function SelecteurLangue({ compact = false }: { compact?: boolean }) {
  const { langue, setLangue } = useI18n()
  return (
    <div className={`inline-flex rounded-full border border-white/10 bg-white/5 ${compact ? 'p-0.5' : 'p-1'}`} role="group" aria-label="Langue / Language / Idioma / Lugha">
      {LANGUES.map((l) => (
        <button
          key={l}
          type="button"
          onClick={() => setLangue(l)}
          aria-pressed={langue === l}
          className={`rounded-full font-bold uppercase transition ${
            compact ? 'px-2 py-1 text-[10px]' : 'px-3 py-1.5 text-xs'
          } ${langue === l ? 'bg-ambre text-encre' : 'text-sable/70 hover:text-white'}`}
        >
          {l}
        </button>
      ))}
    </div>
  )
}
