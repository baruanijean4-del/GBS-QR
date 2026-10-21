// ============================================================
// GBS — Taux de change par établissement : tests de la logique PURE
// (docs/REGLE-TAUX-CHANGE.md). Couvre : bornes de saisie, alerte de
// variation, alerte de fréquence, établissement sans taux
// (mono-devise), équivalent affiché au taux de la vente.
// Les tests de droits par rôle, de taux figé en base et
// d'historique journal_audit viennent APRÈS validation de la
// migration 0016 (proposée, non appliquée).
// ============================================================

import { describe, expect, it } from 'vitest'
import {
  CONFIG_TAUX_DEFAUT,
  aUnTaux,
  doitAlerterFrequence,
  doitAlerterVariation,
  equivalentAffichageCdf,
  erreurSaisieTaux,
  libelleTauxClient,
  variationTauxPct,
} from '@contracts/taux'

describe('erreurSaisieTaux — bornes anti-faute de frappe', () => {
  it('taux normal accepté', () => {
    expect(erreurSaisieTaux(2800)).toBeNull()
  })
  it('zéro, négatif, non entier : refusés', () => {
    expect(erreurSaisieTaux(0)).toBe('invalide')
    expect(erreurSaisieTaux(-2800)).toBe('invalide')
    expect(erreurSaisieTaux(2800.5)).toBe('invalide')
    expect(erreurSaisieTaux(Number.NaN)).toBe('invalide')
  })
  it('au-delà du plafond : refusé (faute de frappe)', () => {
    expect(erreurSaisieTaux(28_000)).toBe('plafond') // un zéro de trop
    expect(erreurSaisieTaux(10_000)).toBeNull() // plafond inclus
    expect(erreurSaisieTaux(10_001)).toBe('plafond')
  })
  it('plafond configurable par établissement', () => {
    expect(erreurSaisieTaux(28_000, 50_000)).toBeNull()
  })
})

describe('doitAlerterVariation — variation brusque', () => {
  it('variation > seuil (défaut 5 %) : alerte propriétaire', () => {
    expect(doitAlerterVariation(2800, 3000)).toBe(true) // +7,1 %
  })
  it('variation ≤ seuil : silence', () => {
    expect(doitAlerterVariation(2800, 2900)).toBe(false) // +3,6 %
  })
  it('première fixation (ancien null) : jamais d\'alerte', () => {
    expect(doitAlerterVariation(null, 2800)).toBe(false)
  })
  it('seuil configurable', () => {
    expect(doitAlerterVariation(2800, 2900, 3)).toBe(true) // seuil 3 %
  })
  it('variationTauxPct : valeur exacte', () => {
    expect(variationTauxPct(2000, 2200)).toBe(10)
  })
})

describe('doitAlerterFrequence — changements répétés le même jour', () => {
  it('plus de 3 changements (défaut) : alerte', () => {
    expect(doitAlerterFrequence(4)).toBe(true)
    expect(doitAlerterFrequence(3)).toBe(false)
  })
  it('plafond configurable', () => {
    expect(doitAlerterFrequence(2, 1)).toBe(true)
  })
})

describe('établissement SANS taux — mono-devise strict', () => {
  it('aUnTaux : null → false (bouton FC/$ masqué, aucune conversion)', () => {
    expect(aUnTaux({ tauxUsdCdf: null })).toBe(false)
    expect(aUnTaux({ tauxUsdCdf: 2800 })).toBe(true)
  })
  it('pas de libellé client ni d\'équivalent sans taux', () => {
    expect(libelleTauxClient(null)).toBeNull()
    expect(equivalentAffichageCdf(300, null)).toBeNull()
  })
})

describe('équivalent affiché — au taux DE LA VENTE, jamais additionné', () => {
  it('3,00 $ vendus à 2 800 FC → 8 400 FC affichés', () => {
    expect(equivalentAffichageCdf(300, 2800)).toBe(8400)
  })
  it('le même montant vendu à un autre taux garde SON taux', () => {
    expect(equivalentAffichageCdf(300, 2500)).toBe(7500) // vente d\'époque
  })
  it('libellé client formaté', () => {
    expect(libelleTauxClient(2800)).toContain('2')
    expect(libelleTauxClient(2800)).toContain('FC')
  })
})

describe('CONFIG_TAUX_DEFAUT — valeurs de la règle', () => {
  it('5 %, 3 changements/jour, plafond 10 000 FC', () => {
    expect(CONFIG_TAUX_DEFAUT.alerteVariationPct).toBe(5)
    expect(CONFIG_TAUX_DEFAUT.alerteMaxParJour).toBe(3)
    expect(CONFIG_TAUX_DEFAUT.plafondCdf).toBe(10_000)
  })
})
