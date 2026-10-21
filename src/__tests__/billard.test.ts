// ============================================================
// GBS — Logique pure du billard Vincaire (annexe §1) : défauts
// de configuration, règle du perdant, limite du vincaire, durée
// moyenne réelle, estimation d'attente, délai de présence.
// Aucune base de données : tests purs et instantanés.
// ============================================================

import { describe, expect, it } from 'vitest'
import {
  normaliserReferenceMobile,
  referenceMobileValide,
  CONFIG_BILLARD_DEFAUT,
  appelExpire,
  dureeMoyennePartiesMin,
  estimerAttenteMin,
  positionDansFile,
  statutApresDefaite,
  vincaireDoitSortir,
} from '@contracts/billard'

describe('CONFIG_BILLARD_DEFAUT — défauts de l\'annexe §1', () => {
  it('5 000 FC, RACHAT, vincaire illimité, présence 3 min', () => {
    expect(CONFIG_BILLARD_DEFAUT.prixTokenCdf).toBe(5000)
    expect(CONFIG_BILLARD_DEFAUT.reglePerdant).toBe('RACHAT')
    expect(CONFIG_BILLARD_DEFAUT.maxPartiesVincaire).toBeNull()
    expect(CONFIG_BILLARD_DEFAUT.delaiPresenceMin).toBe(3)
  })
})

describe('statutApresDefaite — règle du perdant', () => {
  it('RACHAT et SORTIE sortent le perdant ; FIN_FILE le remet en file', () => {
    expect(statutApresDefaite('RACHAT')).toBe('SORTI')
    expect(statutApresDefaite('SORTIE')).toBe('SORTI')
    expect(statutApresDefaite('FIN_FILE')).toBe('EN_FILE')
  })
})

describe('vincaireDoitSortir — limite de parties consécutives', () => {
  it('illimité (null) → jamais ; sinon à partir de la limite', () => {
    expect(vincaireDoitSortir(10, null)).toBe(false)
    expect(vincaireDoitSortir(2, 3)).toBe(false)
    expect(vincaireDoitSortir(3, 3)).toBe(true)
    expect(vincaireDoitSortir(4, 3)).toBe(true)
  })
})

describe('dureeMoyennePartiesMin — moyenne RÉELLE (pas fixe)', () => {
  const p = (debutMin: number, dureeMin: number | null) => ({
    debutLe: new Date(2026, 0, 1, 18, debutMin).toISOString(),
    finLe: dureeMin === null ? null : new Date(2026, 0, 1, 18, debutMin + dureeMin).toISOString(),
  })

  it('sans historique → défaut 10 min', () => {
    expect(dureeMoyennePartiesMin([])).toBe(10)
  })

  it('moyenne des parties terminées, parties en cours ignorées', () => {
    expect(dureeMoyennePartiesMin([p(0, 10), p(20, 20), p(50, null)])).toBe(15)
  })

  it('les durées aberrantes (> 4 h) sont écartées', () => {
    expect(dureeMoyennePartiesMin([p(0, 10), p(0, 600)])).toBe(10)
  })

  it('seules les 10 dernières parties comptent', () => {
    // 11 parties : la plus ancienne (60 min) sort de la fenêtre
    const onze = [p(0, 60), ...Array.from({ length: 10 }, () => p(0, 15))]
    expect(dureeMoyennePartiesMin(onze)).toBe(15)
  })
})

describe('estimerAttenteMin et positionDansFile', () => {
  it('attente = position × durée moyenne', () => {
    expect(estimerAttenteMin(3, 15)).toBe(45)
    expect(estimerAttenteMin(0, 15)).toBe(0)
  })

  it('position 1 = prochain à jouer ; -1 si absent', () => {
    const file = [{ id: 'a' }, { id: 'b' }, { id: 'c' }]
    expect(positionDansFile(file, 'a')).toBe(1)
    expect(positionDansFile(file, 'c')).toBe(3)
    expect(positionDansFile(file, 'z')).toBe(-1)
  })
})

describe('appelExpire — délai de présence après appel', () => {
  const appele = '2026-01-01T20:00:00.000Z'
  it('dans le délai → encore valide ; dépassé → absent', () => {
    expect(appelExpire(appele, 3, '2026-01-01T20:02:00.000Z')).toBe(false)
    expect(appelExpire(appele, 3, '2026-01-01T20:03:30.000Z')).toBe(true)
  })
})

describe('referenceMobileValide — référence Airtel Money déclarée (boucle 6)', () => {
  it('formats acceptés : alphanumérique 6-30, points et tirets', () => {
    expect(referenceMobileValide('CI251019.1432.A12345')).toBe(true)
    expect(referenceMobileValide('240875123')).toBe(true)
    expect(referenceMobileValide('AM-99281-X7')).toBe(true)
  })
  it('formats refusés : trop court, espaces, symboles', () => {
    expect(referenceMobileValide('12345')).toBe(false)
    expect(referenceMobileValide('REF AVEC ESPACE')).toBe(false)
    expect(referenceMobileValide('ref#12345')).toBe(false)
    expect(referenceMobileValide('')).toBe(false)
  })
  it('normalisation : trim + majuscules (unicité insensible à la casse)', () => {
    expect(normaliserReferenceMobile('  ci251019.a12345 ')).toBe('CI251019.A12345')
  })
})
