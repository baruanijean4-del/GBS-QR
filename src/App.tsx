// ============================================================
// GBS — Routeur principal (fragments #/... — tout part de « / »)
// Chaque route est enfermée dans sa PageBoundary (Phase B.2) :
// une page qui plante laisse les autres pages utilisables.
// ============================================================

import { Suspense, lazy } from 'react'
import { Toaster } from 'sonner'
import { useRoute } from '@/lib/router'
import { PageBoundary } from '@/components/ErrorBoundary'
import { BandeauMaj, BanniereHorsLigne } from '@/components/StatutApp'
import { Chargement } from '@/components/gbs'
import { Accueil } from '@/views/Home'

/* Boucle 7 (budget JS) : seuls l'accueil et la coque sont dans le bundle
 * initial (premier contact, LCP). Les formulaires d'entrée (inscription,
 * invitation, connexion) et les écrans staff sont chargés à la demande.
 * Tous les chunks sont pré-cachés par le service worker : la navigation
 * reste possible hors-ligne. */
const NouvelEtablissement = lazy(() => import('@/views/Portes').then((m) => ({ default: m.NouvelEtablissement })))
const Invitation = lazy(() => import('@/views/Portes').then((m) => ({ default: m.Invitation })))
const Connexion = lazy(() => import('@/views/Portes').then((m) => ({ default: m.Connexion })))
const VueClient = lazy(() => import('@/views/Client').then((m) => ({ default: m.VueClient })))
const VueServeuse = lazy(() => import('@/views/Serveuse').then((m) => ({ default: m.VueServeuse })))
const VueGerant = lazy(() => import('@/views/Gerant').then((m) => ({ default: m.VueGerant })))
const VueProprio = lazy(() => import('@/views/Proprio').then((m) => ({ default: m.VueProprio })))
const VueAdmin = lazy(() => import('@/views/Admin').then((m) => ({ default: m.VueAdmin })))
const VueHotel = lazy(() => import('@/views/Hotel').then((m) => ({ default: m.VueHotel })))
const VueTraiteur = lazy(() => import('@/views/Traiteur').then((m) => ({ default: m.VueTraiteur })))

export default function App() {
  const route = useRoute()

  let page: React.ReactNode
  if (route.startsWith('/t/')) {
    page = <VueClient token={route.slice(3)} />
  } else {
    switch (route) {
      case '/nouveau':
        page = <NouvelEtablissement />
        break
      case '/invitation':
        page = <Invitation />
        break
      case '/connexion':
        page = <Connexion />
        break
      case '/s':
        page = <VueServeuse />
        break
      case '/g':
        page = <VueGerant />
        break
      case '/p':
        page = <VueProprio />
        break
      case '/h':
        page = <VueHotel />
        break
      case '/cuisine':
        page = <VueTraiteur />
        break
      case '/admin':
        page = <VueAdmin />
        break
      default:
        page = <Accueil />
    }
  }

  return (
    <>
      {/* Frontière de page : une erreur de rendu n'emporte que
          cette route ; naviguer ailleurs réarme la frontière */}
      <PageBoundary route={route.startsWith('/t/') ? '/t/:token' : route}>
        {/* Filet des écrans paresseux : repli léger pendant le chargement
            du chunk (pré-caché par le SW — quasi instantané) */}
        <Suspense fallback={<Chargement />}>
          {page}
        </Suspense>
      </PageBoundary>
      {/* « Hors-ligne » (bannière discrète) ≠ « erreur » (écran de secours) */}
      <BanniereHorsLigne />
      {/* Mise à jour proposée, jamais imposée sans prévenir */}
      <BandeauMaj />
      <Toaster theme="dark" position="top-center" toastOptions={{ style: { background: 'rgb(var(--surface))', border: '1px solid rgba(255,255,255,0.1)', color: 'rgb(var(--creme))' } }} />
    </>
  )
}
