// ============================================================
// Tests de la grille tarifaire divisée par deux (boucle 1) :
// prix mensuels, frais d'installation par type d'établissement,
// cohérence de la copie client (GRILLE_INITIALE).
// ============================================================

import { describe, expect, it } from 'vitest'
import { fraisInstallationPour, TYPES_ZONE_UNIQUE, type TypeEtablissement } from '@contracts/types'
import { GRILLE_INITIALE, tarifDe, tranchePourTables } from '@/lib/pricing'
import type { DB } from '@/lib/types'

const TOUS_LES_TYPES: TypeEtablissement[] = [
  'TERRASSE', 'GUEST_HOUSE', 'BOUTIQUE', 'RESTAURANT',
  'PHARMACIE', 'SALON', 'AUTRE', 'QUINCAILLERIE', 'BILLARD',
]

describe('fraisInstallationPour — règle par type (boucle 1)', () => {
  it('5 $ (500 centimes) pour une boutique ou un salon', () => {
    expect(fraisInstallationPour('BOUTIQUE')).toBe(500)
    expect(fraisInstallationPour('SALON')).toBe(500)
  })

  it('10 $ (1000 centimes) pour tous les autres types', () => {
    for (const type of TOUS_LES_TYPES.filter((t) => t !== 'BOUTIQUE' && t !== 'SALON')) {
      expect(fraisInstallationPour(type), `${type} doit payer 1000`).toBe(1000)
    }
  })

  it('les 9 types couverts — aucun ne tombe sur un montant inattendu', () => {
    for (const type of TOUS_LES_TYPES) {
      expect([500, 1000]).toContain(fraisInstallationPour(type))
    }
    expect(TOUS_LES_TYPES).toHaveLength(9)
    // Comparaison triée : l'ordre suit désormais le registre TYPES_ETABLISSEMENT
    expect([...TYPES_ZONE_UNIQUE].sort()).toEqual(['AUTRE', 'BOUTIQUE', 'QUINCAILLERIE', 'SALON'])
  })
})

describe('GRILLE_INITIALE — prix divisés par deux (centimes USD)', () => {
  const prix = (plan: string, tranche: string) =>
    GRILLE_INITIALE.find((l) => l.plan === plan && l.tranche === tranche)?.prixUsdCentimes

  it('ESSENTIEL : 10 $ / 15 $ / 20 $ selon la taille', () => {
    expect(prix('ESSENTIEL', 'PETITE')).toBe(1000)
    expect(prix('ESSENTIEL', 'MOYENNE')).toBe(1500)
    expect(prix('ESSENTIEL', 'GRANDE')).toBe(2000)
  })

  it('PRO : 17,50 $ / 25 $ / 35 $ selon la taille', () => {
    expect(prix('PRO', 'PETITE')).toBe(1750)
    expect(prix('PRO', 'MOYENNE')).toBe(2500)
    expect(prix('PRO', 'GRANDE')).toBe(3500)
  })

  it('BUSINESS : 25 $ / 37,50 $ / 50 $ selon la taille', () => {
    expect(prix('BUSINESS', 'PETITE')).toBe(2500)
    expect(prix('BUSINESS', 'MOYENNE')).toBe(3750)
    expect(prix('BUSINESS', 'GRANDE')).toBe(5000)
  })

  it('BOUTIQUE : 5 $/mois, zone unique', () => {
    expect(prix('BOUTIQUE', 'PETITE')).toBe(500)
    const boutique = GRILLE_INITIALE.find((l) => l.plan === 'BOUTIQUE')!
    expect(boutique.tablesMin).toBe(1)
    expect(boutique.tablesMax).toBe(1)
  })

  it('la grille compte exactement 10 lignes, sans ancienne valeur', () => {
    expect(GRILLE_INITIALE).toHaveLength(10)
    const prixTous = GRILLE_INITIALE.map((l) => l.prixUsdCentimes)
    // Anciennes valeurs de plans : 1000 (BOUTIQUE), 2000/3000/4000 (ESSENTIEL),
    // 3500/5000/7000 (PRO), 5000/7500/10000 (BUSINESS) — plus aucune à son ancien niveau
    expect(prixTous).not.toContain(3000)
    expect(prixTous).not.toContain(4000)
    expect(prixTous).not.toContain(7000)
    expect(prixTous).not.toContain(7500)
    expect(prixTous).not.toContain(10000)
  })

  it('tarifDe retrouve chaque ligne dans une base minimale', () => {
    const db = { plansTarifs: GRILLE_INITIALE } as unknown as DB
    expect(tarifDe(db, 'ESSENTIEL', 'PETITE').prixUsdCentimes).toBe(1000)
    expect(tarifDe(db, 'BUSINESS', 'GRANDE').prixUsdCentimes).toBe(5000)
  })

  it('les bornes de tranches sont inchangées (1-9, 10-19, 20+)', () => {
    expect(tranchePourTables(1)).toBe('PETITE')
    expect(tranchePourTables(9)).toBe('PETITE')
    expect(tranchePourTables(10)).toBe('MOYENNE')
    expect(tranchePourTables(19)).toBe('MOYENNE')
    expect(tranchePourTables(20)).toBe('GRANDE')
  })
})
