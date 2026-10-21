// ============================================================
// GBS — Jour comptable Africa/Lubumbashi (correctif 3)
//
// Horloge simulée aux 4 instants demandés (23h59, 00h01, 01h59,
// 02h01 heure locale) + service de nuit à cheval sur minuit.
// Lubumbashi = UTC+2 fixe (pas d'heure d'été).
// ============================================================

import { describe, expect, it } from 'vitest'
import { jourComptable, plageUtcDuJourLocal } from '../../api/lib/jourComptable'

// Instants UTC correspondant aux heures LOCALES demandées
const H = {
  '23h59': new Date('2026-10-19T21:59:00.000Z'), // 23h59 locales le 19
  '00h01': new Date('2026-10-18T22:01:00.000Z'), // 00h01 locales le 19
  '01h59': new Date('2026-10-18T23:59:00.000Z'), // 01h59 locales le 19
  '02h01': new Date('2026-10-19T00:01:00.000Z'), // 02h01 locales le 19
}

describe('jourComptable (Africa/Lubumbashi)', () => {
  it('23h59 locales → encore le jour J', () => {
    expect(jourComptable(H['23h59'])).toBe('2026-10-19')
  })

  it('00h01 locales → le jour J (alors qu’UTC est encore à J-1)', () => {
    expect(jourComptable(H['00h01'])).toBe('2026-10-19')
  })

  it('01h59 locales → le jour J (UTC : 23h59 la veille)', () => {
    expect(jourComptable(H['01h59'])).toBe('2026-10-19')
  })

  it('02h01 locales → le jour J (UTC vient de basculer à J)', () => {
    expect(jourComptable(H['02h01'])).toBe('2026-10-19')
  })

  it('minuit pile locales (22:00 UTC) → bascule au jour suivant', () => {
    expect(jourComptable(new Date('2026-10-18T22:00:00.000Z'))).toBe('2026-10-19')
    expect(jourComptable(new Date('2026-10-18T21:59:59.000Z'))).toBe('2026-10-18')
  })
})

describe('plageUtcDuJourLocal', () => {
  it('minuit local = 22:00 UTC la veille ; plage de 24 h exactement', () => {
    const p = plageUtcDuJourLocal('2026-10-19')
    expect(p.debut).toBe('2026-10-18T22:00:00.000Z')
    expect(p.fin).toBe('2026-10-19T22:00:00.000Z')
  })

  it('service de nuit à cheval sur minuit : chaque vente sur SON jour comptable', () => {
    const jour19 = plageUtcDuJourLocal('2026-10-19')
    const jour20 = plageUtcDuJourLocal('2026-10-20')
    // Vente à 23h30 locales le 19 (= 21:30 UTC) → jour du 19
    const vente2330 = '2026-10-19T21:30:00.000Z'
    // Vente à 00h30 locales le 20 (= 22:30 UTC le 19) → jour du 20
    const vente0030 = '2026-10-19T22:30:00.000Z'
    // Vente à 01h30 locales le 20 (= 23:30 UTC le 19) → jour du 20
    const vente0130 = '2026-10-19T23:30:00.000Z'
    const dans = (iso: string, p: { debut: string; fin: string }) => iso >= p.debut && iso < p.fin

    expect(dans(vente2330, jour19)).toBe(true)
    expect(dans(vente2330, jour20)).toBe(false)
    expect(dans(vente0030, jour19)).toBe(false)
    expect(dans(vente0030, jour20)).toBe(true)
    expect(dans(vente0130, jour19)).toBe(false)
    expect(dans(vente0130, jour20)).toBe(true)
  })

  it('cohérence : le jour comptable de chaque borne est bien le jour demandé', () => {
    const p = plageUtcDuJourLocal('2026-10-19')
    expect(jourComptable(new Date(p.debut))).toBe('2026-10-19')
    expect(jourComptable(new Date(new Date(p.fin).getTime() - 1))).toBe('2026-10-19')
    expect(jourComptable(new Date(p.fin))).toBe('2026-10-20')
  })
})
