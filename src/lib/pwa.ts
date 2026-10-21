// ============================================================
// GBS — Enregistrement du service worker + cycle de mise à jour
// (Phase B.5)
//
// Règles :
// - Uniquement en production (en dev, le cache gênerait le
//   rechargement à chaud).
// - JAMAIS de rechargement sans prévenir : quand une nouvelle
//   version du service worker est prête, on émet l'événement
//   « gbs:maj-prete » → le bandeau « Une nouvelle version est
//   prête. [Mettre à jour] » s'affiche ; le rechargement n'a
//   lieu qu'au clic (ou au prochain démarrage à froid).
// - Un chunk disparu (vite:preloadError) déclenche la
//   récupération automatique UNE fois (src/lib/recuperation.ts).
// ============================================================

import { tenterRecuperationChunk } from './recuperation'

/** Nom de l'événement diffusé quand une mise à jour est prête */
export const EVENEMENT_MAJ = 'gbs:maj-prete'

// ------------------------------------------------------------
// Persistance du stockage (correctif « disparition à 00h00 »)
//
// Sans navigator.storage.persist(), le stockage d'une PWA est
// évincable sous pression (Android/Chrome) : IndexedDB, cache et
// préférences peuvent être purgés — l'app installée semble alors
// « disparaître » et le téléphone repropose l'installation.
// Demandé UNE fois au premier lancement (drapeau localStorage) ;
// log discret du résultat ; JAMAIS de message pour l'utilisateur
// et jamais bloquant (un refus ne change rien au fonctionnement).
// ------------------------------------------------------------

const CLE_PERSIST_DEMANDEE = 'gbs.persistDemandee'

/**
 * Demande la persistance du stockage au premier lancement.
 * Retourne true/false si une demande a été faite, null si rien
 * à faire (déjà demandé, API absente, ou erreur — jamais levée).
 */
export async function demanderPersistanceStockage(): Promise<boolean | null> {
  try {
    if (typeof navigator === 'undefined') return null
    const gestionnaire = navigator.storage
    if (!gestionnaire?.persist) return null
    // Déjà demandée sur cet appareil → ne pas redemander à chaque lancement
    if (localStorage.getItem(CLE_PERSIST_DEMANDEE) === '1') return null
    localStorage.setItem(CLE_PERSIST_DEMANDEE, '1')
    const accordee = await gestionnaire.persist()
    // Log discret — uniquement la console, aucune interface
    console.info(`[gbs] stockage persistant : ${accordee ? 'accordé' : 'non accordé (non bloquant)'}`)
    return accordee
  } catch {
    return null // la persistance ne doit jamais bloquer le démarrage
  }
}

export function enregistrerServiceWorker(): void {
  if (import.meta.env.DEV) return
  if (!('serviceWorker' in navigator)) return

  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('/sw.js')
      .then((reg) => {
        // Pré-cache différé (icônes lourdes, polices — boucle 7) : envoyé
        // au repos pour ne jamais ralentir le premier affichage ; le SW
        // termine alors la coque hors-ligne en arrière-plan.
        const prechargerLeReste = () => {
          const envoyer = () => {
            if (navigator.serviceWorker.controller) {
              navigator.serviceWorker.controller.postMessage('PRECACHER_LE_RESTE')
            }
          }
          if ('requestIdleCallback' in window) {
            window.requestIdleCallback(envoyer, { timeout: 5000 })
          } else {
            setTimeout(envoyer, 3000)
          }
        }
        // Le worker contrôlant la page peut changer (première activation)
        if (navigator.serviceWorker.controller) {
          prechargerLeReste()
        } else {
          navigator.serviceWorker.addEventListener('controllerchange', prechargerLeReste, { once: true })
        }
        // Déjà un worker en attente au chargement (mis à jour pendant
        // que l'onglet était fermé ?) : le bandeau peut s'afficher
        // aussitôt — seulement si une version contrôle déjà la page.
        if (reg.waiting && navigator.serviceWorker.controller) {
          window.dispatchEvent(new Event(EVENEMENT_MAJ))
        }
        reg.addEventListener('updatefound', () => {
          const nouveau = reg.installing
          if (!nouveau) return
          nouveau.addEventListener('statechange', () => {
            // Nouvelle version installée alors qu'une ancienne pilote
            // encore la page → bandeau « Mettre à jour » (jamais de
            // rechargement automatique sans prévenir).
            if (nouveau.state === 'installed' && navigator.serviceWorker.controller) {
              window.dispatchEvent(new Event(EVENEMENT_MAJ))
            }
          })
        })
      })
      .catch(() => {
        // L'absence de service worker ne bloque jamais l'application
      })
  })

  // Après un redéploiement, un ancien onglet peut réclamer un chunk JS
  // qui n'existe plus (« Failed to fetch dynamically imported module »).
  // Vite émet vite:preloadError : récupération automatique UNE fois
  // (désinscription SW + vidage caches + rechargement), jamais de boucle.
  window.addEventListener('vite:preloadError', (e) => {
    e.preventDefault() // on gère nous-mêmes : pas de double réaction
    void tenterRecuperationChunk()
  })
}

let majEnCours = false

/**
 * Clic sur « Mettre à jour » : demande au nouveau service worker de
 * prendre le relais (SKIP_WAITING), puis recharge UNE fois quand il
 * contrôle la page. Appelé uniquement par le bandeau — toujours à
 * l'initiative de l'utilisateur.
 */
export async function appliquerMiseAJour(): Promise<void> {
  if (majEnCours) return
  majEnCours = true
  try {
    const reg = await navigator.serviceWorker.getRegistration()
    if (!reg?.waiting) {
      // Plus rien en attente (déjà appliquée ailleurs) : simple rechargement
      window.location.reload()
      return
    }
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      window.location.reload()
    })
    reg.waiting.postMessage('SKIP_WAITING')
  } catch {
    window.location.reload()
  }
}
