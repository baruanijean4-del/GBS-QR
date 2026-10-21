// ============================================================
// GBS — Validation TOLÉRANTE des réponses API (Phase B.7)
//
// Contrat : un champ null, absent, NaN ou d'un type inattendu ne
// doit JAMAIS faire planter un écran (« .map sur undefined »,
// « NaN FC »…). Chaque collection du snapshot passe ici avant
// d'atteindre les vues : les tableaux sont garantis tableaux,
// les nombres garantis finis, les chaînes garanties chaînes.
//
// Choix technique : moteur maison ultra-léger (pas de librairie
// de schéma dans le bundle client — le budget JS initial de
// 170 Ko compressés est une exigence Phase D). Les valeurs
// VALIDES ne sont jamais modifiées ; seules les valeurs
// défectueuses reçoivent un défaut sûr.
// ============================================================

import type { DB } from './types'

// ---------- Helpers de réparation (valeurs valides inchangées) ----------

/** Nombre fini garanti (accepte « 12,5 » textuel, refuse NaN/Infinity) */
function nombreOu(v: unknown, defaut: number): number {
  if (typeof v === 'number') return Number.isFinite(v) ? v : defaut
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v.replace(/\s/g, '').replace(',', '.'))
    return Number.isFinite(n) ? n : defaut
  }
  return defaut
}

/** Chaîne garantie (null/objet → défaut ; nombre → son texte) */
function chaineOu(v: unknown, defaut: string): string {
  if (typeof v === 'string') return v
  if (typeof v === 'number' && Number.isFinite(v)) return String(v)
  return defaut
}

/** Booléen garanti */
function booleenOu(v: unknown, defaut: boolean): boolean {
  return typeof v === 'boolean' ? v : defaut
}

/** Tableau garanti */
function tableauOu(v: unknown): unknown[] {
  return Array.isArray(v) ? v : []
}

// ---------- Schémas déclaratifs des champs critiques ----------

interface Regle {
  reparer: (v: unknown) => unknown
}
const N = (defaut = 0): Regle => ({ reparer: (v) => nombreOu(v, defaut) })
/** Nombre OU null garanti (taux de change : null = mono-devise ;
 *  une valeur défectueuse devient null — on masque plutôt que
 *  d'inventer un taux). */
const NN = (): Regle => ({
  reparer: (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null),
})
const C = (defaut = ''): Regle => ({ reparer: (v) => chaineOu(v, defaut) })
const B = (defaut = false): Regle => ({ reparer: (v) => booleenOu(v, defaut) })
/** Sous-objet garanti (ex. terrasses.parametres) : objet + champs réparés */
const O = (sousSchema: Record<string, Regle>): Regle => ({
  reparer: (v) => {
    const brut = v && typeof v === 'object' && !Array.isArray(v) ? { ...(v as Record<string, unknown>) } : {}
    for (const [champ, regle] of Object.entries(sousSchema)) {
      brut[champ] = regle.reparer(brut[champ])
    }
    return brut
  },
})

/**
 * Par collection : les champs dont une valeur défectueuse casserait
 * l'affichage ou un calcul (montants, stocks, totaux, libellés
 * affichés, booléens de filtrage). Les autres champs passent tels
 * quels — un champ INATTENDU en plus ne casse rien.
 */
const SCHEMAS: Record<string, Record<string, Regle>> = {
  produits: {
    nom: C(), categorie: C(),
    prixCdf: N(), prixUsdCentimes: N(),
    stock: N(), stockReserve: N(), seuilAlerte: N(),
    actif: B(true), consignable: B(),
  },
  catalogueProduits: {
    nom: C(), categorie: C(), ordreAffichage: N(), actif: B(true), consignable: B(),
  },
  commandes: {
    statut: C('EN_ATTENTE'), totalCdf: N(), totalUsdCentimes: N(),
  },
  terrasses: {
    nom: C(), adresse: C(), type: C('TERRASSE'),
    // Paramètres imbriqués (seuils d'écart, taux de change — null =
    // établissement mono-devise, règle taux)
    parametres: O({ seuilEcartCdf: N(5000), seuilEcartUsdCentimes: N(200), tauxUsdCdf: NN() }),
  },
  organisations: { nom: C() },
  utilisateurs: { nom: C(), telephone: C() },
  affectations: { role: C(), actif: B(true) },
  tables: { numero: N(), kind: C('ZONE') },
  tableServeuse: { actif: B(true) },
  clientsSession: { prenom: C() },
  sessionsService: { statut: C('OUVERTE') },
  depots: {
    statut: C('DECLARE'),
    montantAttenduCdf: N(), montantAttenduUsdCentimes: N(),
    declareCdf: N(), declareUsdCentimes: N(),
  },
  depenses: { motif: C(), montantCdf: N(), montantUsdCentimes: N() },
  avis: { note: N(5), commentaire: C(), masque: B() },
  invitations: { code: C(), role: C(), statut: C('ACTIVE') },
  demandesStock: { type: C('REAPPRO'), motif: C(), statut: C('EN_ATTENTE'), quantite: N() },
  alertes: { type: C(), message: C(), lu: B() },
  mouvementsStock: { type: C(), motif: C(), quantite: N() },
  auditLog: { action: C(), details: C() },
  plansTarifs: {
    plan: C(), tranche: C(),
    prixUsdCentimes: N(), fraisInstallUsdCentimes: N(), tablesMin: N(),
  },
  abonnements: {
    plan: C(), tranche: C(), statut: C('ESSAI'),
    nbTablesMaxPeriode: N(), prorataDuUsdCentimes: N(), annuel: B(), fraisInstallPayes: B(),
  },
  historiqueTranches: { ancienne: C(), nouvelle: C(), nbTables: N(), prorataUsdCentimes: N() },
  paiements: {
    methode: C(), reference: C(), statut: C('EN_ATTENTE'), montantUsdCentimes: N(),
  },
  factures: { numero: C(), plan: C(), tranche: C(), montantUsdCentimes: N() },
}

/** Répare une ligne de commande (montants et quantité garantis) */
function assainirLigne(v: unknown): unknown {
  if (!v || typeof v !== 'object') return null
  const l = v as Record<string, unknown>
  return {
    ...l,
    nom: chaineOu(l.nom, ''),
    quantite: nombreOu(l.quantite, 0),
    prixCdf: nombreOu(l.prixCdf, 0),
    prixUsdCentimes: nombreOu(l.prixUsdCentimes, 0),
  }
}

/** Répare un élément de collection ; null si ce n'est pas un objet */
function assainirItem(v: unknown, schema: Record<string, Regle>): unknown {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null
  const item = { ...(v as Record<string, unknown>) }
  for (const [champ, regle] of Object.entries(schema)) {
    item[champ] = regle.reparer(item[champ])
  }
  // Cas particulier : les lignes d'une commande (itérées au rendu)
  if ('lignes' in item) {
    item.lignes = tableauOu(item.lignes)
      .map(assainirLigne)
      .filter((l) => l !== null)
  }
  return item
}

/**
 * Point d'entrée : garantit une DB utilisable QUOI QU'ARRIVE.
 * - donnée non-objet → collections vides ;
 * - collection absente/null/non-tableau → [] ;
 * - élément non-objet → écarté (les autres survivent) ;
 * - champ critique défectueux → défaut sûr.
 */
export function assainirDb(donnees: unknown): DB {
  const brut = donnees && typeof donnees === 'object' ? (donnees as Record<string, unknown>) : {}
  const sortie: Record<string, unknown> = {
    version: nombreOu(brut.version, 1),
    compteurFacture: nombreOu(brut.compteurFacture, 0),
  }
  for (const [collection, schema] of Object.entries(SCHEMAS)) {
    sortie[collection] = tableauOu(brut[collection])
      .map((item) => assainirItem(item, schema))
      .filter((item) => item !== null)
  }
  return sortie as unknown as DB
}
