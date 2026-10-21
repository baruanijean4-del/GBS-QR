// @vitest-environment jsdom
// ============================================================
// GBS — Agrégats du pilotage propriétaire (maquette « GBS —
// Pilotage ») : semaine glissante, comparaison J-7, répartition
// du stock, pic d'affluence, sparkline, encaissé par serveuse.
// Tous les calculs sont bornés au fuseau Africa/Lubumbashi.
// ============================================================

import { describe, expect, it } from 'vitest'
import {
  decalerJour, encaisseParServeuse, etatStock, picAffluence,
  ventesCumuleesJour, ventesSemaine, ventesSemainePrecedente,
} from '@/lib/store'
import { jourLubu } from '@/lib/format'
import type { Commande, DB, Produit } from '@/lib/types'

const TID = 'ter_1'

/** DB minimale : toutes les collections vides sauf celles fournies */
function dbPartielle(part: Partial<DB>): DB {
  return {
    organisations: [], utilisateurs: [], terrasses: [], affectations: [],
    tables: [], produits: [], tableServeuse: [], clientsSession: [],
    commandes: [], sessionsService: [], depots: [], depenses: [], avis: [],
    invitations: [], demandesStock: [], alertes: [], mouvementsStock: [],
    auditLog: [], plansTarifs: [], abonnements: [], historiqueTranches: [],
    paiements: [], factures: [], catalogueProduits: [], compteurFacture: 0,
    version: 1,
    ...part,
  }
}

let seq = 0
/** Commande servie à une heure précise d'un jour Lubumbashi donné */
function servie(jour: string, heure: number, totalCdf: number, extra: Partial<Commande> = {}): Commande {
  seq += 1
  // Lubumbashi = UTC+2 : on vise l'heure locale demandée en UTC explicite
  // (le suffixe Z rend le test indépendant du fuseau de la machine)
  const servieLe = `${jour}T${String((heure + 22) % 24).padStart(2, '0')}:00:00Z`
  return {
    id: `cmd_${seq}`, terrasseId: TID, tableId: 'tab_1', clientSessionId: 'cli_1',
    statut: 'SERVIE', lignes: [], totalCdf, totalUsdCentimes: 0,
    cleIdempotence: `cle_${seq}`, creeLe: servieLe, confirmeeLe: servieLe,
    servieLe, annuleLe: null, motifAnnulation: null, serviePar: null,
    payeeLe: null, payeePar: null, ...extra,
  }
}

function produit(stock: number, seuilAlerte: number, actif = true): Produit {
  seq += 1
  return {
    id: `prd_${seq}`, terrasseId: TID, nom: `P${seq}`, categorie: 'Boissons',
    prixCdf: 1000, prixUsdCentimes: 50, stock, stockReserve: 0, seuilAlerte,
    actif, photoUrl: null, photoThumbnailUrl: null, photoSource: null,
    variante: null, consignable: false, bouteillesParCasier: null, codeBarres: null,
    typeProduit: null, unite: null, dureeMinutes: null, capacite: null,
    lot: null, datePeremption: null,
  }
}

describe('ventesSemaine — 7 derniers jours, aujourd’hui en dernier', () => {
  it('retourne 7 jours glissants avec les bons totaux', () => {
    const aujourdhui = jourLubu()
    const hier = decalerJour(aujourdhui, -1)
    const db = dbPartielle({ commandes: [servie(aujourdhui, 14, 5000), servie(aujourdhui, 15, 3000), servie(hier, 12, 2000)] })
    const sem = ventesSemaine(db, TID)
    expect(sem).toHaveLength(7)
    expect(sem[6].jour).toBe(aujourdhui)
    expect(sem[6].cdf).toBe(8000)
    expect(sem[5].cdf).toBe(2000)
    expect(sem[0].cdf).toBe(0)
  })

  it('ignore les commandes non servies et les autres terrasses', () => {
    const aujourdhui = jourLubu()
    const db = dbPartielle({ commandes: [
      servie(aujourdhui, 14, 5000, { statut: 'EN_ATTENTE', servieLe: null }),
      servie(aujourdhui, 14, 5000, { terrasseId: 'ter_autre' }),
    ] })
    expect(ventesSemaine(db, TID)[6].cdf).toBe(0)
  })
})

describe('ventesSemainePrecedente — base de comparaison J-13 → J-7', () => {
  it('ne compte que les 7 jours avant la semaine courante', () => {
    const aujourdhui = jourLubu()
    const db = dbPartielle({ commandes: [
      servie(decalerJour(aujourdhui, -8), 14, 1000),  // semaine précédente : compte
      servie(decalerJour(aujourdhui, -13), 14, 500),  // limite basse : compte
      servie(decalerJour(aujourdhui, -14), 14, 9000), // trop vieux : ignoré
      servie(aujourdhui, 14, 7000),                   // cette semaine : ignoré
    ] })
    expect(ventesSemainePrecedente(db, TID).cdf).toBe(1500)
  })
})

describe('decalerJour — arithmétique de jours sans bord de fuseau', () => {
  it('recule et avance correctement', () => {
    expect(decalerJour('2026-10-11', -7)).toBe('2026-10-04')
    expect(decalerJour('2026-10-01', -1)).toBe('2026-09-30')
    expect(decalerJour('2026-12-31', 1)).toBe('2027-01-01')
  })
})

describe('etatStock — rupture / bas / bon état (actifs seulement)', () => {
  it('classe chaque produit actif dans le bon seau', () => {
    const db = dbPartielle({ produits: [
      produit(0, 6),       // rupture
      produit(5, 6),       // bas (≤ seuil)
      produit(20, 6),      // bon état
      produit(0, 6, false), // inactif : ignoré
    ] })
    expect(etatStock(db, TID)).toEqual({ bon: 1, bas: 1, rupture: 1 })
  })
})

describe('picAffluence — plage de 2 h la plus dense', () => {
  it('trouve le pic du soir (20 h – 22 h)', () => {
    const aujourdhui = jourLubu()
    const db = dbPartielle({ commandes: [
      servie(aujourdhui, 20, 100), servie(aujourdhui, 20, 100),
      servie(aujourdhui, 21, 100), servie(aujourdhui, 9, 100),
    ] })
    expect(picAffluence(db, TID)).toEqual({ debut: 20, fin: 22 })
  })

  it('moins de 3 ventes sur la semaine → null (pas assez de données)', () => {
    const aujourdhui = jourLubu()
    const db = dbPartielle({ commandes: [servie(aujourdhui, 20, 100), servie(aujourdhui, 21, 100)] })
    expect(picAffluence(db, TID)).toBeNull()
  })

  it('ignore les ventes de plus de 7 jours', () => {
    const aujourdhui = jourLubu()
    const vieux = decalerJour(aujourdhui, -10)
    const db = dbPartielle({ commandes: [servie(vieux, 20, 100), servie(vieux, 20, 100), servie(vieux, 21, 100)] })
    expect(picAffluence(db, TID)).toBeNull()
  })
})

describe('ventesCumuleesJour — points de la sparkline', () => {
  it('cumul chronologique des ventes servies du jour', () => {
    const aujourdhui = jourLubu()
    const db = dbPartielle({ commandes: [
      servie(aujourdhui, 16, 700),
      servie(aujourdhui, 10, 1000),
      servie(aujourdhui, 12, 300),
    ] })
    expect(ventesCumuleesJour(db, TID)).toEqual([1000, 1300, 2000])
  })
})

describe('encaisseParServeuse — encaissé du jour par personne', () => {
  it('additionne par payeePar, jour courant uniquement', () => {
    const aujourdhui = jourLubu()
    const hier = decalerJour(aujourdhui, -1)
    const db = dbPartielle({ commandes: [
      servie(aujourdhui, 14, 1000, { payeeLe: new Date().toISOString(), payeePar: 'usr_a' }),
      servie(aujourdhui, 15, 2000, { payeeLe: new Date().toISOString(), payeePar: 'usr_a' }),
      servie(aujourdhui, 15, 500, { payeeLe: new Date().toISOString(), payeePar: 'usr_b' }),
      servie(hier, 15, 9999, { payeeLe: `${hier}T20:00:00`, payeePar: 'usr_a' }), // hier : ignoré
      servie(aujourdhui, 15, 777), // non payée : ignorée
    ] })
    const map = encaisseParServeuse(db, TID)
    expect(map.get('usr_a')).toBe(3000)
    expect(map.get('usr_b')).toBe(500)
    expect(map.get('usr_inconnu')).toBeUndefined()
  })
})
