// ============================================================
// GBS — Mini-routeur par fragment (#/...) : toutes les pages
// restent accessibles depuis « / » (hébergement statique).
// ============================================================

import { useEffect, useState } from 'react'

export function lireRoute(): string {
  const h = window.location.hash
  return h.startsWith('#') ? h.slice(1) || '/' : '/'
}

export function naviguer(vers: string) {
  window.location.hash = vers
}

export function useRoute(): string {
  const [route, setRoute] = useState(lireRoute)
  useEffect(() => {
    const f = () => setRoute(lireRoute())
    window.addEventListener('hashchange', f)
    return () => window.removeEventListener('hashchange', f)
  }, [])
  return route
}
