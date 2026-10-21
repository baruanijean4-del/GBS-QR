// ============================================================
// GBS — Journal d'erreurs côté client (Phase B.6)
//
// Chaque erreur interceptée (boundary, window.onerror,
// unhandledrejection) est envoyée au serveur qui la range dans
// la table erreurs_client. Fin de la cécité de production :
// le support retrouve les erreurs par leur code court.
//
// HYGIÈNE STRICTE : on n'envoie QUE des champs techniques —
// message, pile tronquée, route, version, langue, identifiants
// opaques. JAMAIS de PIN, mot de passe, jeton de session ni
// contenu de formulaire. Le serveur rejette de toute façon
// toute charge contenant une clé surprise (schéma strict).
// ============================================================

import { codeCourtErreur } from './recuperation'
import { langueErreur } from './langueErreur'
import { lireSession } from './sessionLocale'
import { idAppareil } from './appareil'

/** Version de l'app injectée au build (vite.config.ts), « dev » sinon */
function versionApp(): string {
  try {
    return (import.meta.env.VITE_GBS_VERSION as string | undefined) ?? 'dev'
  } catch {
    return 'dev'
  }
}

/** Route courante lisible (routeur hash maison : « #/p »…) */
function routeCourante(): string {
  try {
    return (window.location.hash || window.location.pathname || '/').slice(0, 200)
  } catch {
    return '/'
  }
}

// Une même famille d'erreur n'est envoyée qu'UNE fois par session
// d'onglet : inutile de spammer le serveur si une erreur se répète
// en boucle (le comptage exact reste visible côté serveur via les
// autres appareils).
const dejaEnvoyees = new Set<string>()

/** Charge technique envoyée au serveur — aucune donnée sensible */
export interface ChargeErreur {
  codeCourt: string
  message: string
  stack?: string
  route: string
  version: string
  langue: string
  appareilId: string
  utilisateurId?: string
  etablissementId?: string
}

/** Construit la charge sanitizée (piles et messages tronqués) */
export function construireCharge(
  erreur: unknown,
  contexte?: { composant?: string; etablissementId?: string },
): ChargeErreur {
  const messageBrut =
    erreur instanceof Error ? erreur.message : typeof erreur === 'string' ? erreur : 'Erreur inconnue'
  const pileBrute = erreur instanceof Error ? (erreur.stack ?? '') : ''
  // La pile de composants React est jointe à la pile JS (troncature serveur : 4000)
  const pileComplete = contexte?.composant
    ? `${pileBrute}\n--- composants ---${contexte.composant}`
    : pileBrute
  const session = lireSession()
  return {
    codeCourt: codeCourtErreur(erreur),
    message: messageBrut.slice(0, 1000),
    ...(pileComplete ? { stack: pileComplete.slice(0, 4000) } : {}),
    route: routeCourante(),
    version: versionApp(),
    langue: langueErreur(),
    appareilId: idAppareil(),
    // Identifiants opaques UNIQUEMENT si une session existe — le jeton,
    // lui, ne part JAMAIS (il reste dans l'en-tête des appels API).
    ...(session?.utilisateurId ? { utilisateurId: session.utilisateurId } : {}),
    ...(contexte?.etablissementId ? { etablissementId: contexte.etablissementId } : {}),
  }
}

/**
 * Envoie l'erreur au journal serveur. Meilleur effort : réseau coupé,
 * serveur en panne, limite atteinte → silence (jamais de boucle
 * d'erreur provoquée par le journal lui-même).
 */
export function journaliserErreur(
  erreur: unknown,
  contexte?: { composant?: string; etablissementId?: string },
): void {
  try {
    const charge = construireCharge(erreur, contexte)
    if (dejaEnvoyees.has(charge.codeCourt)) return
    dejaEnvoyees.add(charge.codeCourt)
    void fetch('/api/erreurs', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(charge),
      keepalive: true, // survit à un rechargement déclenché juste après
    }).catch(() => {
      // Journal indisponible : l'erreur reste visible en console
    })
  } catch {
    // Le journal ne doit JAMAIS faire planter l'app
  }
}

let branche = false

/**
 * Branche les deux derniers filets de sécurité : erreurs JS hors
 * React (window.onerror) et promesses rejetées non rattrapées
 * (unhandledrejection). Idempotent.
 */
export function brancherJournalGlobal(): void {
  if (branche) return
  branche = true
  window.addEventListener('error', (e) => {
    journaliserErreur(e.error ?? e.message)
  })
  window.addEventListener('unhandledrejection', (e) => {
    journaliserErreur(e.reason)
  })
}
