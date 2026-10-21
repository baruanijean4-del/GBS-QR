// ============================================================
// GBS — Formatage : montants, dates, fuseau Africa/Lubumbashi
// Les montants gardent le format « fr-CD » (règle produit : les
// affichages « 10 $ » / « 12 000 FC » ne changent pas). Les dates
// et le « il y a … » suivent la langue choisie (fr/en/pt).
// ============================================================

import { LOCALES, langueCourante, traduire } from '@/i18n'

/** Locale Intl de la langue courante (dates uniquement). */
function localeDates(): string {
  return LOCALES[langueCourante()]
}

const nfCDF = new Intl.NumberFormat('fr-CD', { maximumFractionDigits: 0 })
const nfUSD = new Intl.NumberFormat('fr-CD', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

/** 3000 → « 3 000 FC » */
export function fmtCDF(cdf: number): string {
  return `${nfCDF.format(cdf)} FC`
}

/** 250 → « 2,50 $ » */
export function fmtUSD(centimes: number): string {
  return `${nfUSD.format(centimes / 100)} $`
}

/** Affiche les deux devises si les deux sont non nulles */
export function fmtDouble(cdf: number, usdCentimes: number): string {
  const parts: string[] = []
  if (cdf > 0) parts.push(fmtCDF(cdf))
  if (usdCentimes > 0) parts.push(fmtUSD(usdCentimes))
  return parts.join(' + ') || fmtCDF(0)
}

/** Date du jour à Lubumbashi : « 2026-10-09 » */
export function jourLubu(d: Date | string = new Date()): string {
  return new Intl.DateTimeFormat('fr-CA', {
    timeZone: 'Africa/Lubumbashi',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(typeof d === 'string' ? new Date(d) : d)
}

/** « 14:32 » à Lubumbashi */
export function heureLubu(iso: string): string {
  return new Intl.DateTimeFormat(localeDates(), {
    timeZone: 'Africa/Lubumbashi',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(iso))
}

/** « 9 oct. » */
export function dateCourte(iso: string): string {
  return new Intl.DateTimeFormat(localeDates(), {
    timeZone: 'Africa/Lubumbashi',
    day: 'numeric',
    month: 'short',
  }).format(new Date(iso))
}

/** « 9 oct. 14:32 » */
export function dateHeure(iso: string): string {
  return `${dateCourte(iso)} ${heureLubu(iso)}`
}

/** « il y a 5 min » — suit la langue choisie */
export function ilYA(iso: string): string {
  const sec = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000))
  if (sec < 60) return traduire('temps.instant')
  const min = Math.floor(sec / 60)
  if (min < 60) return traduire('temps.minutes', { n: min })
  const h = Math.floor(min / 60)
  if (h < 24) return traduire('temps.heures', { n: h })
  const j = Math.floor(h / 24)
  return traduire('temps.jours', { n: j })
}

/** Nombre de jours entiers entre maintenant et une date ISO (arrondi sup.) */
export function joursRestants(iso: string): number {
  return Math.max(0, Math.ceil((new Date(iso).getTime() - Date.now()) / 86_400_000))
}

export function ajouterJours(iso: string, jours: number): string {
  const d = new Date(iso)
  d.setUTCDate(d.getUTCDate() + jours)
  return d.toISOString()
}

export function ajouterMois(iso: string, mois: number): string {
  const d = new Date(iso)
  d.setUTCMonth(d.getUTCMonth() + mois)
  return d.toISOString()
}

/** Identifiant court : « cmd_a1b2c3d4 » */
export function uid(prefixe: string): string {
  const alea = new Uint32Array(2)
  crypto.getRandomValues(alea)
  return `${prefixe}_${alea[0].toString(16)}${alea[1].toString(16)}`
}

/** Token QR opaque : 32 caractères hex */
export function tokenQR(): string {
  const b = new Uint8Array(16)
  crypto.getRandomValues(b)
  return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('')
}

/** Code invitation : 8 caractères non ambigus (pas de 0/O/1/I) */
export function codeInvitation(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  const b = new Uint8Array(8)
  crypto.getRandomValues(b)
  return Array.from(b, (x) => alphabet[x % alphabet.length]).join('')
}


/** « GERANT » → « Gérant » / « Manager » / « Gerente » selon la langue */
export function libelleRole(role: string): string {
  const cle = `role.${role.toLowerCase()}`
  const libelle = traduire(cle)
  return libelle === cle ? role.toLowerCase() : libelle
}
