// @vitest-environment jsdom
// ============================================================
// GBS — Validation tolérante des réponses API (Phase B.7 / E.6)
//
// Une réponse API avec des champs null, absents, NaN ou d'un
// type inattendu ne doit entraîner AUCUNE erreur d'affichage :
// assainirDb garantit tableaux, nombres finis et chaînes.
// ============================================================

import { describe, expect, it } from 'vitest'
import { assainirDb } from '@/lib/validation'

describe('assainirDb — aucune donnée défectueuse ne casse l’affichage', () => {
  it('une réponse vide ou non-objet donne des collections vides utilisables', () => {
    for (const casDeTest of [null, undefined, 42, 'chaîne', []]) {
      const db = assainirDb(casDeTest)
      expect(Array.isArray(db.produits)).toBe(true)
      expect(Array.isArray(db.commandes)).toBe(true)
      expect(Array.isArray(db.terrasses)).toBe(true)
      expect(db.version).toBe(1)
    }
  })

  it('les collections null/absentes deviennent des tableaux vides (.map sûr)', () => {
    const db = assainirDb({ produits: null, commandes: undefined, terrasses: 'corrompu' })
    expect(() => db.produits.map((p) => p.nom)).not.toThrow()
    expect(db.produits).toEqual([])
    expect(db.commandes).toEqual([])
    expect(db.terrasses).toEqual([])
  })

  it('un élément corrompu est écarté, les autres survivent', () => {
    const db = assainirDb({
      produits: [
        { id: 'p1', nom: 'Primus', prixCdf: 5000 },
        null,
        'pas un objet',
        { id: 'p2', nom: 'Skol', prixCdf: 3000 },
      ],
    })
    expect(db.produits).toHaveLength(2)
    expect(db.produits.map((p) => p.nom)).toEqual(['Primus', 'Skol'])
  })

  it('prix null, stock NaN, montants textuels : défauts sûrs, jamais NaN affiché', () => {
    const db = assainirDb({
      produits: [
        {
          id: 'p1',
          nom: null, // chaîne absente
          prixCdf: null, // → 0
          prixUsdCentimes: '2,50', // texte toléré → 2.5
          stock: Number.NaN, // NaN → 0
          stockReserve: undefined,
          seuilAlerte: Infinity, // non fini → 0
        },
      ],
      commandes: [
        { id: 'c1', statut: null, totalCdf: 'corrompu', totalUsdCentimes: Number.NaN, lignes: null },
      ],
    })
    const p = db.produits[0]
    expect(p.nom).toBe('')
    expect(p.prixCdf).toBe(0)
    expect(p.prixUsdCentimes).toBe(2.5)
    expect(p.stock).toBe(0)
    expect(p.stockReserve).toBe(0)
    expect(p.seuilAlerte).toBe(0)
    const c = db.commandes[0]
    expect(c.totalCdf).toBe(0)
    expect(Number.isNaN(c.totalUsdCentimes)).toBe(false)
    expect(c.statut).toBe('EN_ATTENTE')
    // lignes null → tableau garanti : .map au rendu ne plantera pas
    expect(Array.isArray(c.lignes)).toBe(true)
    expect(c.lignes).toEqual([])
  })

  it('les lignes de commande défectueuses sont réparées ou écartées', () => {
    const db = assainirDb({
      commandes: [
        {
          id: 'c1',
          lignes: [
            { produitId: 'p1', nom: 'Primus', quantite: '2', prixCdf: 5000, prixUsdCentimes: 0 },
            null,
            { produitId: 'p2', nom: null, quantite: Number.NaN },
          ],
        },
      ],
    })
    const lignes = db.commandes[0].lignes
    expect(lignes).toHaveLength(2)
    expect(lignes[0].quantite).toBe(2)
    expect(lignes[1].nom).toBe('')
    expect(lignes[1].quantite).toBe(0)
  })

  it('les valeurs VALIDES ne sont jamais modifiées', () => {
    const entree = {
      version: 3,
      compteurFacture: 42,
      produits: [
        {
          id: 'p1', terrasseId: 't1', nom: 'Primus 65cl', categorie: 'Bières',
          prixCdf: 6500, prixUsdCentimes: 250, stock: 48, stockReserve: 3,
          seuilAlerte: 12, actif: true, photoUrl: null, variante: 'Normal',
          consignable: true, bouteillesParCasier: 24, codeBarres: '6123456789012',
        },
      ],
      terrasses: [
        {
          id: 't1', nom: 'Chez Marie', adresse: 'Av. Kasa-Vubu', type: 'TERRASSE',
          parametres: { seuilEcartCdf: 5000, seuilEcartUsdCentimes: 200, tauxUsdCdf: 2850 },
        },
      ],
    }
    const db = assainirDb(JSON.parse(JSON.stringify(entree)))
    expect(db.version).toBe(3)
    expect(db.compteurFacture).toBe(42)
    expect(db.produits[0]).toMatchObject(entree.produits[0])
    expect(db.terrasses[0].nom).toBe('Chez Marie')
    expect(db.terrasses[0].parametres.tauxUsdCdf).toBe(2850)
  })

  it('les paramètres de terrasse absents/corrompus reçoivent des défauts sûrs', () => {
    const db = assainirDb({
      terrasses: [{ id: 't1', nom: 'X', parametres: null }, { id: 't2', nom: 'Y' }],
    })
    // Règle taux : un taux corrompu est réparé à NULL (mono-devise) —
    // on masque le bouton FC/$ plutôt que d'inventer un taux.
    expect(db.terrasses[0].parametres.tauxUsdCdf).toBeNull()
    expect(db.terrasses[1].parametres.seuilEcartCdf).toBe(5000)
  })

  it('un champ INATTENDU en plus ne casse rien (conservé, ignoré par l’UI)', () => {
    const db = assainirDb({
      produits: [{ id: 'p1', nom: 'X', champFutur: { complexe: [1, 2] } }],
      nouvelleCollection: [{ bidule: true }],
    })
    expect(db.produits).toHaveLength(1)
    expect((db.produits[0] as unknown as Record<string, unknown>).champFutur).toEqual({ complexe: [1, 2] })
  })
})
