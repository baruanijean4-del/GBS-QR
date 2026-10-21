// ============================================================
// GBS — Matrice RBAC pure (annexe §7) : permissions par rôle,
// seuils de remise, décision peutAvecRoles (surcharges comprises).
// Aucune base de données : tests purs et instantanés.
// ============================================================

import { describe, expect, it } from 'vitest'
import {
  PERMISSIONS_PAR_ROLE,
  SEUIL_REMISE_PAR_ROLE,
  permissionsParDefaut,
  seuilRemisePour,
  toutesLesActionsSensibles,
  type ActionSensible,
  type RoleEtablissement,
} from '@contracts/types'
import { peutAvecRoles } from '../../api/lib/permissions'

const ROLES: RoleEtablissement[] = [
  'GERANT', 'SERVEUSE', 'CAISSIER', 'CUISINE_BAR', 'BILLARDIER',
  'RECEPTIONNISTE', 'GOUVERNANTE', 'PHARMACIEN', 'VENDEUR', 'PRESTATAIRE',
  // Module traiteur (MODULE-TRAITEUR §9) : fiches de production et
  // bons de sortie — jamais de remise, jamais de montant.
  'CHEF', 'MAGASINIER',
]

describe('PERMISSIONS_PAR_ROLE — matrice de l\'annexe §7', () => {
  it('couvre les 12 rôles d\'établissement, sans action inconnue', () => {
    expect(Object.keys(PERMISSIONS_PAR_ROLE).sort()).toEqual([...ROLES].sort())
    const connues = new Set(toutesLesActionsSensibles())
    for (const r of ROLES) {
      for (const a of PERMISSIONS_PAR_ROLE[r]) expect(connues.has(a)).toBe(true)
    }
  })

  it('ordonnance : pharmacien uniquement parmi les employés (gérant exclu)', () => {
    for (const r of ROLES) {
      const ok = permissionsParDefaut(r).has('VALIDER_ORDONNANCE')
      expect(ok, `${r} ne doit ${r === 'PHARMACIEN' ? '' : 'PAS '}valider une ordonnance`).toBe(r === 'PHARMACIEN')
    }
  })

  it('token billard : serveuse et billardier (annexe), pas la cuisine', () => {
    expect(permissionsParDefaut('SERVEUSE').has('VALIDER_TOKEN_BILLARD')).toBe(true)
    expect(permissionsParDefaut('BILLARDIER').has('VALIDER_TOKEN_BILLARD')).toBe(true)
    expect(permissionsParDefaut('CUISINE_BAR').has('VALIDER_TOKEN_BILLARD')).toBe(false)
  })

  it('traiteur : chef et magasinier sans remise ni rapports (MODULE-TRAITEUR §9)', () => {
    expect(permissionsParDefaut('CHEF').has('REMISE')).toBe(false)
    expect(permissionsParDefaut('CHEF').has('VOIR_RAPPORTS')).toBe(false)
    expect(permissionsParDefaut('MAGASINIER').has('REMISE')).toBe(false)
    expect(permissionsParDefaut('MAGASINIER').has('VOIR_RAPPORTS')).toBe(false)
    expect(permissionsParDefaut('MAGASINIER').has('AJUSTER_STOCK')).toBe(true)
    expect(seuilRemisePour('CHEF')).toBe(0)
    expect(seuilRemisePour('MAGASINIER')).toBe(0)
  })

  it('gérer l\'équipe : aucun rôle d\'établissement (propriétaire seul)', () => {
    for (const r of ROLES) {
      expect(permissionsParDefaut(r).has('GERER_EQUIPE'), `${r} ne doit pas gérer l'équipe`).toBe(false)
    }
  })

  it('rapports et prix : gérant oui, employés non', () => {
    expect(permissionsParDefaut('GERANT').has('VOIR_RAPPORTS')).toBe(true)
    expect(permissionsParDefaut('GERANT').has('MODIFIER_PRIX')).toBe(true)
    for (const r of ROLES.filter((x) => x !== 'GERANT')) {
      expect(permissionsParDefaut(r).has('VOIR_RAPPORTS')).toBe(false)
      expect(permissionsParDefaut(r).has('MODIFIER_PRIX')).toBe(false)
    }
  })

  it('seuils de remise : gérant illimité, chiffre d\'affaires 5 %, cuisine 0', () => {
    expect(seuilRemisePour('GERANT')).toBeNull()
    expect(seuilRemisePour('SERVEUSE')).toBe(5)
    expect(seuilRemisePour('CUISINE_BAR')).toBe(0)
    for (const r of ROLES) {
      const seuil = SEUIL_REMISE_PAR_ROLE[r]
      expect(seuil === null || (seuil >= 0 && seuil <= 100)).toBe(true)
    }
  })
})

describe('peutAvecRoles — décision pure (rôles + surcharges)', () => {
  const VIDE = new Map<ActionSensible, boolean>()

  it('le propriétaire peut tout, sans surcharge possible à la baisse', () => {
    for (const a of toutesLesActionsSensibles()) {
      expect(peutAvecRoles(['PROPRIETAIRE'], a, VIDE)).toBe(true)
    }
    const refusee = new Map<ActionSensible, boolean>([['GERER_EQUIPE', false]])
    expect(peutAvecRoles(['PROPRIETAIRE'], 'GERER_EQUIPE', refusee)).toBe(true)
  })

  it('un employé suit la matrice ; un second rôle peut ajouter un droit', () => {
    expect(peutAvecRoles(['SERVEUSE'], 'VOIR_RAPPORTS', VIDE)).toBe(false)
    expect(peutAvecRoles(['SERVEUSE'], 'VALIDER_TOKEN_BILLARD', VIDE)).toBe(true)
    // Serveuse + pharmacienne (cumul) : l'ordonnance devient permise
    expect(peutAvecRoles(['SERVEUSE', 'PHARMACIEN'], 'VALIDER_ORDONNANCE', VIDE)).toBe(true)
  })

  it('une surcharge du propriétaire prime sur la matrice, dans les deux sens', () => {
    const accorder = new Map<ActionSensible, boolean>([['AJUSTER_STOCK', true]])
    expect(peutAvecRoles(['SERVEUSE'], 'AJUSTER_STOCK', accorder)).toBe(true)
    const retirer = new Map<ActionSensible, boolean>([['VALIDER_TOKEN_BILLARD', false]])
    expect(peutAvecRoles(['BILLARDIER'], 'VALIDER_TOKEN_BILLARD', retirer)).toBe(false)
  })

  it('CLIENT et SUPER_ADMIN ne donnent aucun droit d\'établissement', () => {
    expect(peutAvecRoles(['CLIENT'], 'REMISE', VIDE)).toBe(false)
    expect(peutAvecRoles(['SUPER_ADMIN'], 'VOIR_RAPPORTS', VIDE)).toBe(false)
    expect(peutAvecRoles([], 'REMISE', VIDE)).toBe(false)
  })
})
