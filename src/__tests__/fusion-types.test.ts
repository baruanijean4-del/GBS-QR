// ============================================================
// GBS — Registre multi-métiers : type BILLARD et fusion 1-3 types
// (annexe « Expérience par type » + demande produit). Tests purs,
// sans base de données.
// ============================================================

import { describe, expect, it } from 'vitest'
import {
  aTablesDeSalle, categoriesPour, defFusionnee, fraisInstallationPour,
  tousLesTypes, TYPES_ETABLISSEMENT, TYPES_ZONE_UNIQUE,
} from '../../contracts/types'

describe('registre — type BILLARD (9e métier)', () => {
  it('a une définition complète centrée file Vincaire', () => {
    const def = TYPES_ETABLISSEMENT.BILLARD
    expect(def.modules).toContain('BILLARD_FILE')
    expect(def.modules).toContain('MENU') // les boissons restent vendues
    expect(def.qrAutorises).toEqual(['BILLARD'])
    expect(def.roles).toContain('BILLARDIER')
    expect(def.zoneUnique).toBe(false) // plusieurs billards possibles
    expect(def.fraisInstallationUsd).toBe(1000)
  })

  it('a ses catégories produit (parties, bières, boissons, snacks)', () => {
    const cats = categoriesPour('BILLARD')
    expect(cats.map((c) => c.code)).toContain('BILLARD')
    expect(cats.map((c) => c.code)).toContain('BIERES')
    expect(cats.length).toBeGreaterThanOrEqual(4)
  })

  it('n\'est ni zone unique ni catalogue à recherche', () => {
    expect(TYPES_ZONE_UNIQUE).not.toContain('BILLARD')
    expect(fraisInstallationPour('BILLARD')).toBe(1000)
  })
})

describe('aTablesDeSalle — tables numérotées ou comptoir unique', () => {
  it('faux pour les comptoirs : pharmacie, boutique, quincaillerie, salon, autre', () => {
    // Une pharmacie n'a pas de tables : le client scanne UN QR comptoir
    // et voit tout le catalogue (demande produit).
    expect(aTablesDeSalle('PHARMACIE')).toBe(false)
    expect(aTablesDeSalle('BOUTIQUE')).toBe(false)
    expect(aTablesDeSalle('QUINCAILLERIE')).toBe(false)
    expect(aTablesDeSalle('SALON')).toBe(false)
    expect(aTablesDeSalle('AUTRE')).toBe(false)
  })

  it('vrai pour les salles : terrasse, restaurant, hôtel, billard', () => {
    expect(aTablesDeSalle('TERRASSE')).toBe(true)
    expect(aTablesDeSalle('RESTAURANT')).toBe(true)
    expect(aTablesDeSalle('GUEST_HOUSE')).toBe(true)
    expect(aTablesDeSalle('BILLARD')).toBe(true) // zones = billards
  })
})

describe('defFusionnee — fusion de 2 ou 3 métiers', () => {
  it('mono-type : retourne la définition du registre à l\'identique', () => {
    expect(defFusionnee('TERRASSE')).toEqual(TYPES_ETABLISSEMENT.TERRASSE)
  })

  it('Terrasse + Billard : union des modules, QR et rôles', () => {
    const f = defFusionnee('TERRASSE', ['BILLARD'])
    expect(f.modules).toContain('CUISINE_BAR')   // terrasse
    expect(f.modules).toContain('BILLARD_FILE')  // billard
    expect(f.qrAutorises).toContain('ZONE')
    expect(f.qrAutorises).toContain('BILLARD')
    expect(f.roles).toContain('SERVEUSE')
    expect(f.roles).toContain('BILLARDIER')
    // Vocabulaire et frais du PRINCIPAL (règle de tarification inchangée)
    expect(f.zone.fr).toBe('table')
    expect(f.fraisInstallationUsd).toBe(1000)
  })

  it('Hôtel + Restaurant + Boutique : union complète, multi-zones', () => {
    const f = defFusionnee('GUEST_HOUSE', ['RESTAURANT', 'BOUTIQUE'])
    expect(f.modules).toContain('CHAMBRES')      // hôtel
    expect(f.modules).toContain('CUISINE_BAR')   // restaurant
    expect(f.modules).toContain('CREDIT_CLIENT') // boutique
    expect(f.zoneUnique).toBe(false)             // l'hôtel a plusieurs zones
    expect(f.rechercheProduit).toBe(true)        // la boutique l'apporte
    expect(f.zone.fr).toBe('chambre')            // vocabulaire du principal
  })

  it('Boutique + Salon (tous deux comptoir) : zone unique conservée', () => {
    const f = defFusionnee('BOUTIQUE', ['SALON'])
    expect(f.zoneUnique).toBe(true)
    expect(f.fraisInstallationUsd).toBe(500) // principal = boutique
    expect(f.modules).toContain('RENDEZ_VOUS') // salon
  })

  it('sans doublons et sans le principal dans les secondaires', () => {
    expect(tousLesTypes('TERRASSE', ['TERRASSE', 'BILLARD'])).toEqual(['TERRASSE', 'BILLARD'])
    const f = defFusionnee('TERRASSE', ['BILLARD', 'BILLARD'])
    expect(f.modules).toEqual([...new Set(f.modules)])
  })
})
