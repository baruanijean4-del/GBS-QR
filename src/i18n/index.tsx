// ============================================================
// GBS — Socle i18n (français, anglais, português d'Angola)
// - Dictionnaires plats (clés pointées) chargés depuis les JSON.
// - Repli : langue choisie → anglais → français → clé affichée.
// - Choix mémorisé : localStorage « gbs-lang » ; à la première
//   visite, langue du navigateur si supportée, sinon français.
// - Si l'utilisateur est connecté, la langue est aussi mémorisée
//   sur son organisation (organisations.langue) — voir store.tsx.
// L'écran d'erreur (ErreurEcran.tsx) reste volontairement
// INDÉPENDANT de ce socle (il doit marcher même si tout casse).
// ============================================================

import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useState, type ReactNode } from 'react'
import { defFusionnee, type TypeEtablissement } from '@contracts/types'
import fr from './fr.json'

export type Langue = 'fr' | 'en' | 'pt' | 'sw'
export const LANGUES: readonly Langue[] = ['fr', 'en', 'pt', 'sw']

/** Locale Intl par langue — dates, nombres et notes suivent la langue choisie. */
export const LOCALES: Record<Langue, string> = { fr: 'fr-FR', en: 'en-GB', pt: 'pt-PT', sw: 'sw-CD' }

/** Chaîne de repli par langue : pt descend par l'anglais ; le swahili
 *  retombe directement sur le français (langue véhiculaire d'ici). */
const REPLIS: Record<Langue, Langue[]> = {
  fr: [],
  en: ['fr'],
  pt: ['en', 'fr'],
  sw: ['fr'],
}

/* Boucle 7 (budget JS) : seul le français — référence et repli final — est
 * dans le bundle initial ; l'anglais et le portugais sont chargés à la
 * demande puis gardés en mémoire. Le service worker pré-cache tous les
 * chunks : la bascule reste instantanée et possible hors-ligne. */
const DICOS: Record<Langue, Record<string, string>> = {
  fr: fr as Record<string, string>,
  en: {},
  pt: {},
  sw: {},
}

const CHARGEURS: Record<'en' | 'pt' | 'sw', () => Promise<{ default: Record<string, string> }>> = {
  en: () => import('./en.json') as Promise<{ default: Record<string, string> }>,
  pt: () => import('./pt.json') as Promise<{ default: Record<string, string> }>,
  sw: () => import('./sw.json') as Promise<{ default: Record<string, string> }>,
}

const PROMESSES: Partial<Record<Langue, Promise<void>>> = {}

/** Charge le dictionnaire d'une langue une seule fois (le portugais charge
 *  aussi l'anglais, son repli intermédiaire) ; sans-opération pour le fr. */
export function assurerDico(l: Langue): Promise<void> {
  if (l === 'fr') return Promise.resolve()
  PROMESSES[l] ||= (async () => {
    const chargements: Promise<void>[] = [
      CHARGEURS[l]().then((m) => { DICOS[l] = m.default }),
    ]
    if (l === 'pt') chargements.push(CHARGEURS.en().then((m) => { DICOS.en = m.default }))
    await Promise.all(chargements)
  })()
  return PROMESSES[l]!
}


// ------------------------------------------------------------
// Vocabulaire métier : le registre TYPES_ETABLISSEMENT nomme la zone de
// vente de chaque type (table, chambre, comptoir, billard) dans les 4
// langues. t() injecte automatiquement, pour l'établissement affiché :
//   {zone} {zones} {Zone} {Zones}  — le mot (minuscule / majuscule initiale)
//   {un} {le} {ce} {du} {au}       — articles accordés (fr, pt) ; {ce} aussi
//                                    en swahili (hii / hiki)
// Les textes évitent les accords d'adjectifs (« assignée ») : on écrit
// « {Zone} {numero} : … » plutôt que « {Zone} assigné(e) ».
// ------------------------------------------------------------

/** Établissement affiché (type principal + types fusionnés) */
export interface EtablissementCourant { type: TypeEtablissement; secondaires: TypeEtablissement[] }

const FEMININS_FR = new Set(['table', 'chambre'])
const FEMININS_PT = new Set(['mesa'])
const CACHE_VOCAB = new Map<string, Record<string, string>>()

/** Variables de vocabulaire pour un établissement (TERRASSE → « table » par défaut). */
export function vocabulaireDe(
  langue: Langue, type: TypeEtablissement = 'TERRASSE', secondaires: readonly TypeEtablissement[] = [],
): Record<string, string> {
  const cle = `${langue}|${type}|${secondaires.join(',')}`
  const connu = CACHE_VOCAB.get(cle)
  if (connu) return connu
  const def = defFusionnee(type, secondaires)
  const zone = def.zone[langue]
  const zones = def.zones[langue]
  const maj = (s: string) => s.charAt(0).toLocaleUpperCase(LOCALES[langue]) + s.slice(1)
  const f = langue === 'fr' ? FEMININS_FR.has(def.zone.fr) : langue === 'pt' ? FEMININS_PT.has(def.zone.pt) : false
  const choix = (si: string, sinon: string) => (f ? si : sinon)
  const v: Record<string, string> = { zone, zones, Zone: maj(zone), Zones: maj(zones), un: '', le: '', ce: '', du: '', au: '' }
  if (langue === 'fr') Object.assign(v, { un: choix('une', 'un'), le: choix('la', 'le'), ce: choix('cette', 'ce'), du: choix('de la', 'du'), au: choix('à la', 'au') })
  if (langue === 'pt') Object.assign(v, { un: choix('uma', 'um'), le: choix('a', 'o'), ce: choix('esta', 'este'), du: choix('da', 'do'), au: choix('na', 'no') })
  if (langue === 'sw') v.ce = def.zone.sw === 'chumba' ? 'hiki' : 'hii'
  CACHE_VOCAB.set(cle, v)
  return v
}

/** Traduction avec chaîne de repli : langue → REPLIS[langue]… → clé brute */
function traduireDepuis(langue: Langue, cle: string, vars?: Record<string, string | number>): string {
  let texte: string | undefined = DICOS[langue][cle]
  for (const repli of REPLIS[langue]) {
    if (texte !== undefined) break
    texte = DICOS[repli][cle]
  }
  texte ??= cle
  if (vars) {
    for (const [k, v] of Object.entries(vars)) {
      texte = texte.replaceAll(`{${k}}`, String(v))
    }
  }
  return texte
}

/** La valeur lue (stockage, navigateur) est-elle une langue supportée ? */
function estLangue(v: string): v is Langue {
  return v === 'fr' || v === 'en' || v === 'pt' || v === 'sw'
}

const CLE_STOCKAGE = 'gbs-lang'

// Langue active en mémoire : setLangue la met à jour SYNCHRONEMENT pour que
// traduire()/langueCourante() (hors React : format.ts, PDF) suivent le choix
// dès le rendu déclenché — localStorage n'est écrit que dans l'effet, après.
let langueActive: Langue | null = null

/** Langue de la toute première visite : navigateur si supporté, sinon fr */
function langueInitiale(): Langue {
  try {
    const stockee = localStorage.getItem(CLE_STOCKAGE)
    if (stockee && estLangue(stockee)) return stockee
  } catch { /* stockage indisponible */ }
  const nav = (navigator.language || 'fr').slice(0, 2).toLowerCase()
  return estLangue(nav) ? nav : 'fr'
}

export interface I18n {
  langue: Langue
  /** Change la langue (mémorisée sur l'appareil ; synchronisée sur
   *  l'organisation par le store quand une session existe). */
  setLangue: (l: Langue) => void
  /** Traduit une clé ; {vars} interpolées ; repli pt→en→fr→clé. Le vocabulaire
   *  de l'établissement affiché ({zone}, {Zones}…) est ajouté automatiquement. */
  t: (cle: string, vars?: Record<string, string | number>) => string
  /** Établissement affiché (null = vocabulaire par défaut) — voir useEtablissementCourant */
  definirEtablissement: (e: EtablissementCourant | null) => void
}

const ContexteI18n = createContext<I18n | null>(null)

export function I18nProvider({ children }: { children: ReactNode }) {
  const [langue, setLangueEtat] = useState<Langue>(() => {
    langueActive = langueInitiale()
    return langueActive
  })
  // Re-rendu quand un dictionnaire paresseux finit de charger
  const [versionDicos, setVersionDicos] = useState(0)
  // Établissement affiché : choisit le vocabulaire (table / chambre / comptoir…)
  const [etab, setEtab] = useState<EtablissementCourant | null>(null)
  const definirEtablissement = useCallback((e: EtablissementCourant | null) => {
    setEtab((avant) => {
      const cle = (x: EtablissementCourant | null) => (x ? `${x.type}|${x.secondaires.join(',')}` : '')
      return cle(avant) === cle(e) ? avant : e
    })
  }, [])

  useEffect(() => {
    document.documentElement.lang = langue
    try {
      localStorage.setItem(CLE_STOCKAGE, langue)
    } catch { /* le choix ne survit pas au rechargement : acceptable */ }
  }, [langue])

  // Première visite en en/pt : charge le dictionnaire de la langue mémorisée
  // (repli français affiché pendant ce bref chargement), puis re-rendu.
  useEffect(() => {
    void assurerDico(langue).then(() => setVersionDicos((v) => v + 1))
    // Uniquement au montage — les bascules suivantes passent par setLangue
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const valeur = useMemo<I18n>(() => ({
    langue,
    setLangue: (l: Langue) => {
      // Le français est synchrone (déjà en mémoire) ; les autres langues
      // basculent dès que leur dictionnaire est chargé (pré-caché par le SW).
      if (l === 'fr') { langueActive = l; setLangueEtat(l); return }
      void assurerDico(l).then(() => { langueActive = l; setLangueEtat(l) })
    },
    t: (cle, vars) => traduireDepuis(langue, cle, { ...vocabulaireDe(langue, etab?.type, etab?.secondaires), ...vars }),
    definirEtablissement,
    // versionDicos : force le recalcul de t après chargement paresseux
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [langue, versionDicos, etab, definirEtablissement])

  return <ContexteI18n.Provider value={valeur}>{children}</ContexteI18n.Provider>
}

/** Accès au socle i18n — disponible partout sous I18nProvider (toute l'app). */
export function useI18n(): I18n {
  const ctx = useContext(ContexteI18n)
  if (!ctx) throw new Error('useI18n hors de I18nProvider')
  return ctx
}

/** Raccourci : fonction de traduction seule. */
export function useT(): I18n['t'] {
  return useI18n().t
}

/**
 * Déclare l'établissement affiché par l'écran : tous les t() en dessous parlent
 * « table », « chambre », « comptoir » ou « billard » selon son type.
 * À appeler UNE fois par écran (garde d'accès staff, vue client).
 */
export function useEtablissementCourant(
  terrasse: { type: TypeEtablissement; typesSecondaires?: TypeEtablissement[] } | null | undefined,
): void {
  const { definirEtablissement } = useI18n()
  const cle = terrasse ? `${terrasse.type}|${(terrasse.typesSecondaires ?? []).join(',')}` : ''
  useLayoutEffect(() => {
    definirEtablissement(terrasse ? { type: terrasse.type, secondaires: terrasse.typesSecondaires ?? [] } : null)
    return () => definirEtablissement(null)
    // cle résume le type et les types fusionnés
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cle, definirEtablissement])
}

/** Langue actuellement choisie — lecture hors React (format.ts, PDF). */
export function langueCourante(): Langue {
  if (langueActive) return langueActive
  try {
    const stockee = localStorage.getItem(CLE_STOCKAGE)
    if (stockee && estLangue(stockee)) return stockee
  } catch { /* stockage indisponible */ }
  return 'fr'
}

/** Traduction hors React (même repli que le hook) — formatage, rapports PDF. */
export function traduire(cle: string, vars?: Record<string, string | number>): string {
  return traduireDepuis(langueCourante(), cle, { ...vocabulaireDe(langueCourante()), ...vars })
}
