// ============================================================
// GBS — Grille tarifaire : plans × tranches de tables
// Valeurs initiales stockées en base (plans_tarifs), modifiables
// par le super-admin — jamais en dur dans les calculs.
// ============================================================

import type { DB, PlanCode, PlanTarif, Tranche, TypeEtablissement } from './types'
import { TYPES_ZONE_UNIQUE } from '@contracts/types'
import { traduire } from '@/i18n'

export const PLANS: { code: PlanCode; nom: string; annee: number; disponible: boolean }[] = [
  { code: 'ESSENTIEL', nom: 'Essentiel', annee: 1, disponible: true },
  { code: 'PRO', nom: 'Pro', annee: 2, disponible: false },
  { code: 'BUSINESS', nom: 'Business', annee: 3, disponible: false },
  { code: 'BOUTIQUE', nom: 'Boutique', annee: 0, disponible: true },
]

/** Description du contenu d'un plan, dans la langue courante (boucle 5). */
export function contenuPlan(code: PlanCode): string {
  return traduire(`plan.desc_${code.toLowerCase()}`)
}

/** Plans proposés selon le type d'établissement : les types à zone unique
 *  (boutique, salon, autre, quincaillerie) ne voient que le plan Boutique. */
export function plansPour(type: TypeEtablissement) {
  const zoneUnique = TYPES_ZONE_UNIQUE.includes(type)
  return PLANS.filter((p) => (zoneUnique ? p.code === 'BOUTIQUE' : p.code !== 'BOUTIQUE'))
}

/** Grille initiale (USD en centimes) — copiée dans la base au seed.
 *  Grille divisée par deux (boucle 1) : ESSENTIEL 10/15/20 $,
 *  PRO 17,50/25/35 $, BUSINESS 25/37,50/50 $, BOUTIQUE 5 $.
 *  L'installation dépend du type d'établissement (fraisInstallationPour) ;
 *  fraisInstallUsdCentimes n'est plus qu'une valeur de référence. */
export const GRILLE_INITIALE: PlanTarif[] = [
  // Petite : 1 à 9 tables
  { plan: 'ESSENTIEL', tranche: 'PETITE', tablesMin: 1, tablesMax: 9, prixUsdCentimes: 1000, fraisInstallUsdCentimes: 1000 },
  { plan: 'PRO', tranche: 'PETITE', tablesMin: 1, tablesMax: 9, prixUsdCentimes: 1750, fraisInstallUsdCentimes: 1000 },
  { plan: 'BUSINESS', tranche: 'PETITE', tablesMin: 1, tablesMax: 9, prixUsdCentimes: 2500, fraisInstallUsdCentimes: 1000 },
  // Moyenne : 10 à 19 tables
  { plan: 'ESSENTIEL', tranche: 'MOYENNE', tablesMin: 10, tablesMax: 19, prixUsdCentimes: 1500, fraisInstallUsdCentimes: 1000 },
  { plan: 'PRO', tranche: 'MOYENNE', tablesMin: 10, tablesMax: 19, prixUsdCentimes: 2500, fraisInstallUsdCentimes: 1000 },
  { plan: 'BUSINESS', tranche: 'MOYENNE', tablesMin: 10, tablesMax: 19, prixUsdCentimes: 3750, fraisInstallUsdCentimes: 1000 },
  // Grande : 20 tables et plus
  { plan: 'ESSENTIEL', tranche: 'GRANDE', tablesMin: 20, tablesMax: null, prixUsdCentimes: 2000, fraisInstallUsdCentimes: 1000 },
  { plan: 'PRO', tranche: 'GRANDE', tablesMin: 20, tablesMax: null, prixUsdCentimes: 3500, fraisInstallUsdCentimes: 1000 },
  { plan: 'BUSINESS', tranche: 'GRANDE', tablesMin: 20, tablesMax: null, prixUsdCentimes: 5000, fraisInstallUsdCentimes: 1000 },
  // Boutique de quartier : 5 USD/mois, 1 zone de vente
  { plan: 'BOUTIQUE', tranche: 'PETITE', tablesMin: 1, tablesMax: 1, prixUsdCentimes: 500, fraisInstallUsdCentimes: 500 },
]

export const TRANCHES_ORDRE: Tranche[] = ['PETITE', 'MOYENNE', 'GRANDE']

export const NOMS_TRANCHE: Record<Tranche, string> = {
  PETITE: 'Petite',
  MOYENNE: 'Moyenne',
  GRANDE: 'Grande',
}

/** Tranche d'une terrasse selon son nombre de tables ACTIVES */
export function tranchePourTables(nbTables: number): Tranche {
  if (nbTables >= 20) return 'GRANDE'
  if (nbTables >= 10) return 'MOYENNE'
  return 'PETITE'
}

export function tarifDe(db: DB, plan: PlanCode, tranche: Tranche): PlanTarif {
  const t = db.plansTarifs.find((p) => p.plan === plan && p.tranche === tranche)
  if (!t) throw new Error(`Tarif manquant : ${plan}/${tranche}`)
  return t
}

/** Remise multi-terrasses de l'organisation : -25 % dès 5, -15 % dès 3 */
export function remiseMulti(nbTerrasses: number): number {
  if (nbTerrasses >= 5) return 0.25
  if (nbTerrasses >= 3) return 0.15
  return 0
}

/** Prix mensuel d'une terrasse : tranche puis remise multi-terrasses */
export function prixMensuelTerrasse(db: DB, terrasseId: string): number {
  const terrasse = db.terrasses.find((t) => t.id === terrasseId)
  if (!terrasse) return 0
  const abo = db.abonnements.find((a) => a.terrasseId === terrasseId)
  if (!abo) return 0
  const nbTables = db.tables.filter((t) => t.terrasseId === terrasseId && t.actif).length
  const nbTerrasses = db.terrasses.filter((t) => t.organisationId === terrasse.organisationId).length
  const base = tarifDe(db, abo.plan, tranchePourTables(nbTables)).prixUsdCentimes
  return Math.round(base * (1 - remiseMulti(nbTerrasses)))
}

/** Seuil de la tranche suivante (nombre de tables) et surcoût associé */
export function seuilSuivant(db: DB, terrasseId: string): { tables: number; surcoutCentimes: number } | null {
  const abo = db.abonnements.find((a) => a.terrasseId === terrasseId)
  if (!abo) return null
  const nbTables = db.tables.filter((t) => t.terrasseId === terrasseId && t.actif).length
  const tranche = tranchePourTables(nbTables)
  if (tranche === 'PETITE') {
    return {
      tables: 10,
      surcoutCentimes: tarifDe(db, abo.plan, 'MOYENNE').prixUsdCentimes - tarifDe(db, abo.plan, 'PETITE').prixUsdCentimes,
    }
  }
  if (tranche === 'MOYENNE') {
    return {
      tables: 20,
      surcoutCentimes: tarifDe(db, abo.plan, 'GRANDE').prixUsdCentimes - tarifDe(db, abo.plan, 'MOYENNE').prixUsdCentimes,
    }
  }
  return null
}

/** Nombre de tables actives d'une terrasse */
export function nbTablesActives(db: DB, terrasseId: string): number {
  return db.tables.filter((t) => t.terrasseId === terrasseId && t.actif).length
}
