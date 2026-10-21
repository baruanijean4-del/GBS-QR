// ============================================================
// GBS — Récupération après un déploiement (chunk JS disparu)
//
// Contexte (cause racine trouvée en Phase A) : après un
// redéploiement, un onglet encore ouvert réclame d'anciens chunks
// JS qui n'existent plus côté serveur (« Failed to fetch
// dynamically imported module »). La bonne réaction : mettre à
// jour le service worker, vider les caches et recharger — UNE
// SEULE FOIS.
//
// Le bug : le drapeau anti-boucle (sessionStorage) était réarmé
// à chaque démarrage de l'app (main.tsx). Si l'échec persistait
// (hors-ligne, cache désynchronisé), l'app rechargeait en boucle
// puis restait figée sur l'écran d'erreur. Désormais, le drapeau
// n'est JAMAIS retiré automatiquement : seule une action
// utilisateur (Réessayer / Recharger) le réarme.
// ============================================================

/** Clé sessionStorage : survit au rechargement, meurt avec l'onglet */
const CLE_RECUP = 'gbs_recup_chunk'

/**
 * Vrai si le message d'erreur signale un chunk/module JS introuvable
 * (formulations Chrome, Firefox, Safari et webpack/Vite).
 */
export function estErreurChargementModule(message: string): boolean {
  if (!message) return false
  const m = message.toLowerCase()
  return (
    m.includes('dynamically imported module') ||
    m.includes('importing a module script failed') ||
    m.includes('chunkloaderror') ||
    m.includes('failed to fetch')
  )
}

/** Actions réelles du navigateur (injectables en test) */
export interface Declencheurs {
  recharger: () => void
  viderCaches: () => Promise<void>
  desinscrireSw: () => Promise<void>
}

/** Désinscrit tous les service workers de l'origine */
async function desinscrireSwReel(): Promise<void> {
  try {
    if (!('serviceWorker' in navigator)) return
    const regs = await navigator.serviceWorker.getRegistrations()
    await Promise.all(regs.map((r) => r.unregister()))
  } catch {
    // La désinscription est un meilleur effort : ne jamais bloquer
  }
}

/** Vide tous les caches HTTP de l'origine (Cache Storage API) */
async function viderCachesReel(): Promise<void> {
  try {
    if (!('caches' in window)) return
    const cles = await caches.keys()
    await Promise.all(cles.map((c) => caches.delete(c)))
  } catch {
    // Meilleur effort, idem
  }
}

const declencheursReels: Declencheurs = {
  recharger: () => window.location.reload(),
  viderCaches: viderCachesReel,
  desinscrireSw: desinscrireSwReel,
}

/**
 * Tente la récupération automatique après un chunk disparu.
 * Retourne true si la récupération part (l'app va recharger),
 * false si elle a DÉJÀ eu lieu dans cette session — l'appelant
 * affiche alors l'écran d'erreur stable au lieu de boucler.
 *
 * Ordre volontaire : le drapeau est posé AVANT toute action,
 * donc même un plantage en cours de route ne peut pas boucler.
 */
export async function tenterRecuperationChunk(
  d: Declencheurs = declencheursReels,
): Promise<boolean> {
  try {
    if (sessionStorage.getItem(CLE_RECUP)) return false // déjà tenté : stop
    sessionStorage.setItem(CLE_RECUP, '1')
  } catch {
    // sessionStorage indisponible (mode privé strict…) : on tente quand
    // même une fois — sans drapeau, on accepte le risque d'un second
    // rechargement plutôt que de laisser l'utilisateur bloqué.
  }
  await d.desinscrireSw()
  await d.viderCaches()
  d.recharger()
  return true
}

/**
 * Réarme la récupération automatique. Appelée UNIQUEMENT par une
 * action utilisateur explicite (boutons « Réessayer » et
 * « Recharger l'application » de l'écran d'erreur) — jamais au
 * démarrage de l'app (c'était le bug racine).
 */
export function reinitialiserRecuperation(): void {
  try {
    sessionStorage.removeItem(CLE_RECUP)
  } catch {
    // Rien à réarmer
  }
}

/**
 * Rechargement « dur » demandé par l'utilisateur depuis l'écran
 * d'erreur : désinscrit le service worker, vide les caches, puis
 * recharge. L'utilisateur repart toujours sur une base propre.
 */
export async function rechargerApplication(): Promise<void> {
  reinitialiserRecuperation()
  await desinscrireSwReel()
  await viderCachesReel()
  window.location.reload()
}

// ------------------------------------------------------------
// Code d'erreur court (ex. ERR-7K2F) — stable pour une même
// erreur : le client le lit au support, le support le retrouve
// dans le journal serveur (table erreurs_client).
// ------------------------------------------------------------

/** Alphabet base32 de Crockford (32 symboles — I, L, O, U exclus) */
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'

/** Empreinte FNV-1a 32 bits : minuscule, déterministe, sans dépendance */
function fnv1a(texte: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < texte.length; i++) {
    h ^= texte.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

/**
 * Code court lisible au téléphone, dérivé du SEUL message : une même
 * famille d'erreur donne le même code quel que soit l'endroit où elle
 * est levée (la pile complète, elle, est stockée dans le journal
 * serveur pour le diagnostic détaillé).
 */
export function codeCourtErreur(erreur: unknown): string {
  let message: string
  if (erreur instanceof Error) {
    message = erreur.message
  } else {
    try {
      message = typeof erreur === 'string' ? erreur : JSON.stringify(erreur) ?? String(erreur)
    } catch {
      message = String(erreur)
    }
  }
  const h = fnv1a(message)
  let code = ''
  for (let i = 0; i < 4; i++) code += ALPHABET[(h >>> (i * 5)) & 31]
  return `ERR-${code}`
}
