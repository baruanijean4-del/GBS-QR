/* ============================================================
   GBS — Service worker (PWA) — GABARIT VERSIONNÉ (Phase B.5)

   scripts/versionner-sw.mjs injecte à CHAQUE build :
   - __GBS_VERSION__  : empreinte du contenu (change à chaque
     modification des assets → les anciens caches sont purgés) ;
   - __GBS_PRECACHE__ : la liste réelle des fichiers de la coque
     (HTML, JS/CSS d'entrée, polices, icônes) — le hors-ligne
     fonctionne dès la première visite, y compris après un
     redéploiement.

   Règles :
   - JAMAIS de skipWaiting automatique : une nouvelle version
     attend le clic « Mettre à jour » (bandeau) — pas de
     rechargement sans prévenir l'utilisateur.
   - JAMAIS de cache pour l'API (/api/*) : les données métier
     (commandes, stock, caisse) restent toujours fraîches.
   ============================================================ */

const VERSION = '__GBS_VERSION__'
const CACHE = 'gbs-' + VERSION

// Coque applicative pré-cachée à l'installation (injectée au build) :
// le strict VITAL au premier rendu (HTML, JS, CSS, favicon).
const PRE_CACHE = __GBS_PRECACHE__
// Reste de la coque (icônes lourdes, polices) : pré-caché APRÈS le
// premier affichage, à la demande de la page (message PRECACHER_LE_RESTE,
// envoyé au repos — boucle 7 : le premier chargement ne doit pas payer
// ~900 Ko d'icônes et de polices sur un réseau mobile coûteux).
const PRE_CACHE_DIFFERE = __GBS_PRECACHE_DIFFERE__

self.addEventListener('install', (e) => {
  // Pré-cache TOLÉRANT : une ressource manquante ne doit pas faire
  // échouer toute l'installation (le SW s'activerait jamais sinon).
  e.waitUntil(
    caches.open(CACHE).then((c) =>
      Promise.allSettled(PRE_CACHE.map((ressource) => c.add(ressource))),
    ),
  )
  // PAS de self.skipWaiting() ici : la mise à jour attend le clic
  // « Mettre à jour » du bandeau (message SKIP_WAITING ci-dessous).
  // À la toute première installation (aucun SW actif), l'activation
  // suit son cours normal sans attendre.
})

self.addEventListener('activate', (e) => {
  // Nettoie les anciennes versions du cache (gbs-<autre version>)
  e.waitUntil(
    caches
      .keys()
      .then((cles) =>
        Promise.all(
          cles
            .filter((c) => c.startsWith('gbs-') && c !== CACHE)
            .map((c) => caches.delete(c)),
        ),
      )
      // La page est contrôlée SANS attendre le pré-cache différé :
      // le hors-ligne vital est prêt dès l'installation.
      .then(() => self.clients.claim()),
  )
})

// Clic « Mettre à jour » du bandeau : le nouveau worker prend le
// relais immédiatement, la page se recharge au controllerchange.
self.addEventListener('message', (e) => {
  if (e.data === 'SKIP_WAITING') self.skipWaiting()
  // Pré-cache différé (icônes lourdes, polices) : la page le demande
  // au repos, après le premier affichage — jamais pendant le rendu.
  if (e.data === 'PRECACHER_LE_RESTE') {
    e.waitUntil(
      caches.open(CACHE).then((c) =>
        Promise.allSettled(PRE_CACHE_DIFFERE.map((ressource) => c.add(ressource))),
      ),
    )
  }
})

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return
  const url = new URL(e.request.url)
  if (url.origin !== self.location.origin) return

  // API : réseau uniquement — aucune donnée métier en cache
  if (url.pathname.startsWith('/api/')) return

  // Navigations (pages) : réseau d'abord, repli sur la coque en cache
  if (e.request.mode === 'navigate') {
    e.respondWith(
      fetch(e.request)
        .then((r) => {
          const copie = r.clone()
          caches.open(CACHE).then((c) => c.put('./', copie))
          return r
        })
        .catch(() => caches.match('./')),
    )
    return
  }

  // Assets fingerprintés (/assets/*-HASH.js|css) : immuables par
  // construction → cache d'abord, réseau en repli (1re visite).
  // Gros chunks optionnels (PDF, scanner) : mis en cache au 1er usage,
  // ils ne sont PAS dans le pré-cache (données mobiles coûteuses).
  if (url.pathname.startsWith('/assets/')) {
    e.respondWith(
      caches.match(e.request).then(
        (enCache) =>
          enCache ||
          fetch(e.request).then((r) => {
            if (r.ok) {
              const copie = r.clone()
              caches.open(CACHE).then((c) => c.put(e.request, copie))
            }
            return r
          }),
      ),
    )
    return
  }

  // Autres statiques (polices, icônes, photos /uploads/ et /catalogue/) :
  // cache d'abord + MISE À JOUR EN ARRIÈRE-PLAN — la coque se rafraîchit
  // sans attendre le réseau (stale-while-revalidate).
  e.respondWith(
    caches.match(e.request).then((enCache) => {
      const reseau = fetch(e.request)
        .then((r) => {
          if (r.ok) {
            const copie = r.clone()
            caches.open(CACHE).then((c) => c.put(e.request, copie))
          }
          return r
        })
        .catch(() => enCache)
      return enCache || reseau
    }),
  )
})
