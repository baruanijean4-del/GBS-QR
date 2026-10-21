// @vitest-environment jsdom
// ============================================================
// GBS — Test du correctif racine (Phase B)
//
// Cause racine (Phase A) : le drapeau anti-boucle « récupération
// chunk » était réarmé à CHAQUE démarrage (main.tsx), donc un
// échec de chargement persistant provoquait des rechargements en
// boucle jusqu'à l'écran « Une erreur est survenue ».
//
// Ce test est ROUGE avant le correctif (le module n'existe pas /
// la boucle est possible) et VERT après : la récupération ne se
// déclenche qu'UNE fois par session, même si l'erreur revient
// après rechargement.
// ============================================================

import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  codeCourtErreur,
  estErreurChargementModule,
  reinitialiserRecuperation,
  tenterRecuperationChunk,
} from '@/lib/recuperation'

/** Faux déclencheurs injectés (le vrai module utilise window/caches) */
function fauxDeclencheurs() {
  return {
    recharger: vi.fn(),
    viderCaches: vi.fn(async () => {}),
    desinscrireSw: vi.fn(async () => {}),
  }
}

beforeEach(() => {
  sessionStorage.clear()
})

describe('estErreurChargementModule', () => {
  it('reconnaît les messages des navigateurs courants', () => {
    expect(estErreurChargementModule('Failed to fetch dynamically imported module: https://x/assets/a.js')).toBe(true)
    expect(estErreurChargementModule('error loading dynamically imported module: https://x/assets/a.js')).toBe(true)
    expect(estErreurChargementModule('Importing a module script failed.')).toBe(true) // Safari
    expect(estErreurChargementModule('ChunkLoadError: Loading chunk 42 failed.')).toBe(true)
  })

  it("ignore les erreurs métier (pas de récupération à tort)", () => {
    expect(estErreurChargementModule('Cannot read properties of undefined')).toBe(false)
    expect(estErreurChargementModule('Session expirée ou invalide')).toBe(false)
    expect(estErreurChargementModule('')).toBe(false)
  })
})

describe('tenterRecuperationChunk — UNE seule fois, jamais de boucle', () => {
  it('déclenche la récupération au premier échec de chunk', async () => {
    const d = fauxDeclencheurs()
    const lancee = await tenterRecuperationChunk(d)
    expect(lancee).toBe(true)
    expect(d.desinscrireSw).toHaveBeenCalledTimes(1)
    expect(d.viderCaches).toHaveBeenCalledTimes(1)
    expect(d.recharger).toHaveBeenCalledTimes(1)
  })

  it('ne se répète JAMAIS dans la même session, même après un redémarrage de l’app', async () => {
    const d = fauxDeclencheurs()
    // 1er échec de chunk → récupération
    expect(await tenterRecuperationChunk(d)).toBe(true)
    // L'app redémarre (rechargement) : AUCUN code au boot ne doit réarmer
    // le drapeau (c'était le bug racine). L'erreur revient → écran stable,
    // PAS de second rechargement automatique.
    expect(await tenterRecuperationChunk(d)).toBe(false)
    expect(await tenterRecuperationChunk(d)).toBe(false)
    expect(d.recharger).toHaveBeenCalledTimes(1)
  })

  it('les sessions d’onglets sont indépendantes (sessionStorage)', async () => {
    const d = fauxDeclencheurs()
    await tenterRecuperationChunk(d)
    // Nouvel onglet = sessionStorage vide → une nouvelle récupération est permise
    sessionStorage.clear()
    expect(await tenterRecuperationChunk(d)).toBe(true)
    expect(d.recharger).toHaveBeenCalledTimes(2)
  })

  it('l’action manuelle (Réessayer / Recharger) réarme la récupération', async () => {
    const d = fauxDeclencheurs()
    await tenterRecuperationChunk(d)
    expect(await tenterRecuperationChunk(d)).toBe(false)
    reinitialiserRecuperation() // clic utilisateur sur « Réessayer »
    expect(await tenterRecuperationChunk(d)).toBe(true)
    expect(d.recharger).toHaveBeenCalledTimes(2)
  })
})

describe('codeCourtErreur', () => {
  it('produit un code court stable au format ERR-XXXX', () => {
    const e = new TypeError('Cannot read properties of undefined')
    const code = codeCourtErreur(e)
    expect(code).toMatch(/^ERR-[0-9A-Z]{4}$/)
    // Déterministe : la même erreur donne le même code (utile au support)
    expect(codeCourtErreur(new TypeError('Cannot read properties of undefined'))).toBe(code)
  })

  it('ne produit JAMAIS de caractère hors alphabet (couvre tous les indices)', () => {
    // Régression : un alphabet de 30 symboles indexé sur 5 bits (0-31)
    // laissait passer « undefined » dans le code (ERR-Hundefin…).
    for (let i = 0; i < 500; i++) {
      const code = codeCourtErreur(new Error(`erreur n°${i}`))
      expect(code).toMatch(/^ERR-[0-9A-HJKMNP-TV-Z]{4}$/)
      expect(code).not.toContain('undefined')
    }
  })

  it('distingue deux erreurs différentes', () => {
    expect(codeCourtErreur(new Error('a'))).not.toBe(codeCourtErreur(new Error('b')))
  })

  it('accepte les valeurs non-Error sans planter', () => {
    expect(codeCourtErreur('chaîne brute')).toMatch(/^ERR-/)
    expect(codeCourtErreur(undefined)).toMatch(/^ERR-/)
    expect(codeCourtErreur({ bizarre: true })).toMatch(/^ERR-/)
  })
})
