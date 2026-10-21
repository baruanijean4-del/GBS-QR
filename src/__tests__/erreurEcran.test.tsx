// @vitest-environment jsdom
// ============================================================
// GBS — Écran de secours des boundaries (Phase B.3 / test E.1)
//
// L'écran d'erreur doit afficher les bons textes en FR, EN et PT
// SANS dépendre d'aucun mécanisme i18n (le chargement des
// traductions peut être la cause du plantage), avec :
// - code d'erreur court visible (ERR-XXXX) ;
// - lien WhatsApp support +243 974 480 803, code pré-rempli ;
// - bouton « Réessayer » qui réaffiche SANS recharger ;
// - honnêteté : file hors-ligne → message « gardées sur cet
//   appareil » à la place de « en sécurité sur le serveur ».
// ============================================================

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { ErrorBoundary } from '@/components/ErrorBoundary'

// React 19 + jsdom : act() exige ce drapeau global
;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

/** Composant qui lève une erreur au rendu (simule un écran qui plante) */
function Explosif({ message }: { message: string }): never {
  throw new TypeError(message)
}

let conteneur: HTMLDivElement
let racine: Root

/** Monte le boundary avec l'enfant explosif, dans la langue demandée */
async function monter(langue: 'fr' | 'en' | 'pt') {
  localStorage.setItem('gbs-lang', langue)
  conteneur = document.createElement('div')
  document.body.appendChild(conteneur)
  await act(async () => {
    racine = createRoot(conteneur)
    racine.render(
      <ErrorBoundary>
        <Explosif message="boom de test" />
      </ErrorBoundary>,
    )
  })
  return conteneur
}

beforeEach(() => {
  localStorage.clear()
  sessionStorage.clear()
  document.body.innerHTML = ''
})

afterEach(async () => {
  if (racine) await act(async () => racine.unmount())
  conteneur?.remove()
})

describe('ErrorBoundary — écran de secours 3 langues (autonome, sans i18n)', () => {
  it('FR : textes français, code court, WhatsApp avec code pré-rempli', async () => {
    const el = await monter('fr')
    expect(el.textContent).toContain('Une erreur est survenue')
    expect(el.textContent).toContain('Vos données sont en sécurité sur le serveur')
    expect(el.textContent).toContain('Réessayer')
    expect(el.textContent).toContain("Recharger l'application")
    // Code court affiché
    const code = /ERR-[0-9A-Z]{4}/.exec(el.textContent ?? '')?.[0]
    expect(code).toBeTruthy()
    expect(el.textContent).toContain(`Code d'erreur : ${code}`)
    // Lien WhatsApp avec le code pré-rempli
    const lien = el.querySelector('a[href*="wa.me"]') as HTMLAnchorElement
    expect(lien.href).toContain('wa.me/243974480803')
    expect(decodeURIComponent(lien.href)).toContain(code!)
  })

  it('EN : textes anglais quand gbs-lang = en', async () => {
    const el = await monter('en')
    expect(el.textContent).toContain('Something went wrong')
    expect(el.textContent).toContain('Your data is safe on the server')
    expect(el.textContent).toContain('Try again')
    expect(el.textContent).toContain('Reload the app')
    expect(el.textContent).toContain('Error code: ERR-')
    expect(el.textContent).toContain('Contact support')
  })

  it('PT : textes portugais (européen) quand gbs-lang = pt', async () => {
    const el = await monter('pt')
    expect(el.textContent).toContain('Ocorreu um erro')
    expect(el.textContent).toContain('Os seus dados estão seguros no servidor')
    expect(el.textContent).toContain('Tentar novamente')
    expect(el.textContent).toContain('Recarregar a aplicação')
    expect(el.textContent).toContain('Código do erro: ERR-')
    expect(el.textContent).toContain('Contactar o suporte')
  })

  it('repli français quand la langue est absente ou inconnue', async () => {
    localStorage.setItem('gbs-lang', 'pt') // sera écrasé par une valeur invalide
    localStorage.setItem('gbs-lang', 'xx')
    const el = await monter('fr')
    localStorage.removeItem('gbs-lang')
    expect(el.textContent).toContain('Une erreur est survenue')
  })

  it('file hors-ligne non vide → message honnête « gardées sur cet appareil »', async () => {
    localStorage.setItem('gbs.outbox', JSON.stringify([{ token: 't', lignes: [] }]))
    const el = await monter('fr')
    expect(el.textContent).toContain('Vos actions en attente sont gardées sur cet appareil.')
    expect(el.textContent).not.toContain('en sécurité sur le serveur')
  })

  it('file hors-ligne vide → message serveur classique', async () => {
    localStorage.setItem('gbs.outbox', '[]')
    const el = await monter('fr')
    expect(el.textContent).toContain('en sécurité sur le serveur')
  })

  it('« Réessayer » réaffiche le contenu SANS recharger la page', async () => {
    localStorage.setItem('gbs-lang', 'fr')
    conteneur = document.createElement('div')
    document.body.appendChild(conteneur)
    let exploser = true
    function Capricieux() {
      if (exploser) throw new TypeError('boom temporaire')
      return <p>contenu sain</p>
    }
    await act(async () => {
      racine = createRoot(conteneur)
      racine.render(
        <ErrorBoundary>
          <Capricieux />
        </ErrorBoundary>,
      )
    })
    expect(conteneur.textContent).toContain('Une erreur est survenue')
    // L'enfant ne plante plus : « Réessayer » doit le réafficher
    exploser = false
    const bouton = [...conteneur.querySelectorAll('button')].find((b) =>
      b.textContent?.includes('Réessayer'),
    )!
    await act(async () => {
      bouton.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    expect(conteneur.textContent).toContain('contenu sain')
    expect(conteneur.textContent).not.toContain('Une erreur est survenue')
  })

  it('un seul bouton principal orange (Réessayer), Recharger en secondaire', async () => {
    const el = await monter('fr')
    const principaux = [...el.querySelectorAll('button')].filter((b) => b.className.includes('bg-ambre'))
    expect(principaux).toHaveLength(1)
    expect(principaux[0].textContent).toContain('Réessayer')
  })
})
