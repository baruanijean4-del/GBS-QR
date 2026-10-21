// @vitest-environment jsdom
// ============================================================
// GBS — Persistance du stockage (correctif « disparition à 00h00 »)
//
// navigator.storage.persist() est demandé UNE fois au premier
// lancement, avec log discret, jamais de message ni de blocage.
// Ce test verrouille :
//  - la demande part au premier lancement (résultat true/false) ;
//  - elle ne repart JAMAIS au lancement suivant (drapeau) ;
//  - API absente ou erreur → null, aucune exception levée.
// ============================================================

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { demanderPersistanceStockage } from '@/lib/pwa'

const CLE = 'gbs.persistDemandee'

function simulerStorage(persist?: () => Promise<boolean>) {
  Object.defineProperty(navigator, 'storage', {
    value: persist ? { persist } : undefined,
    configurable: true,
  })
}

describe('demanderPersistanceStockage', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.restoreAllMocks()
  })

  it('demande la persistance au premier lancement et consigne le résultat', async () => {
    const persist = vi.fn(async () => true)
    simulerStorage(persist)
    const info = vi.spyOn(console, 'info').mockImplementation(() => {})

    const res = await demanderPersistanceStockage()

    expect(persist).toHaveBeenCalledTimes(1)
    expect(res).toBe(true)
    expect(info).toHaveBeenCalledOnce() // log discret, une seule ligne
  })

  it('consigne aussi un refus, sans jamais lever d’erreur', async () => {
    simulerStorage(async () => false)
    const info = vi.spyOn(console, 'info').mockImplementation(() => {})

    const res = await demanderPersistanceStockage()

    expect(res).toBe(false)
    expect(info).toHaveBeenCalledOnce()
  })

  it('ne redemande JAMAIS au lancement suivant (drapeau posé)', async () => {
    const persist = vi.fn(async () => true)
    simulerStorage(persist)
    vi.spyOn(console, 'info').mockImplementation(() => {})

    await demanderPersistanceStockage()
    localStorage.setItem(CLE, '1') // drapeau posé au 1er appel
    const second = await demanderPersistanceStockage()

    expect(persist).toHaveBeenCalledTimes(1)
    expect(second).toBeNull()
  })

  it('API absente (vieux navigateur) → null, silencieux', async () => {
    simulerStorage(undefined)

    const res = await demanderPersistanceStockage()

    expect(res).toBeNull()
  })

  it('persist() qui rejette → null, aucune exception propagée', async () => {
    simulerStorage(async () => {
      throw new Error('refus navigateur')
    })
    vi.spyOn(console, 'info').mockImplementation(() => {})

    const res = await demanderPersistanceStockage()

    expect(res).toBeNull()
  })
})
