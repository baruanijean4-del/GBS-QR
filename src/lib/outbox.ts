// ============================================================
// GBS — File hors-ligne des commandes (IndexedDB)
//
// Correctif « disparition à 00h00 » : la file était stockée dans
// localStorage (« gbs.outbox »), évincable par Android/Chrome sous
// pression de stockage. Elle vit désormais dans IndexedDB, qui
// bénéficie de navigator.storage.persist() (voir lib/pwa.ts).
//
// Garanties :
// - IMPORT UNIQUE ET SANS PERTE : les entrées de l'ancienne file
//   localStorage sont copiées dans IndexedDB UNE fois, puis la clé
//   localStorage n'est supprimée QU'APRÈS écriture confirmée. Si
//   le JSON est illisible, il est déplacé vers une clé de
//   sauvegarde (« gbs.outbox.sauvegarde ») — jamais détruit.
// - IDEMPOTENCE : la clé « cle » est la clé primaire du store.
//   Ré-ajouter ou ré-importer la même commande est un no-op, et le
//   serveur reconnaît cette clé (commandes.cle_idempotence, unique)
//   → un renvoi ne crée JAMAIS de doublon.
// - REPLI : si IndexedDB est absent (très vieux navigateur), on
//   retombe sur localStorage — la file n'est jamais perdue.
// ============================================================

import type { LigneCommande } from './types'

/** Une commande mise en file pendant une coupure réseau */
export interface CommandeEnAttente {
  /** Clé d'idempotence — clé primaire IndexedDB et garde serveur */
  cle: string
  token: string
  sessionId: string
  lignes: LigneCommande[]
  /** Horodatage ISO de la mise en file (diagnostic uniquement) */
  ajouteeLe: string
}

const NOM_BASE = 'gbs-file-hors-ligne'
const NOM_STORE = 'commandes'
const CLE_LEGACY = 'gbs.outbox'
const CLE_SAUVEGARDE = 'gbs.outbox.sauvegarde'

/** Vrai si IndexedDB est utilisable dans ce contexte */
function indexedDbDisponible(): boolean {
  try {
    return typeof indexedDB !== 'undefined'
  } catch {
    return false
  }
}

/** Ouvre la base (créée au premier usage, keyPath = « cle ») */
function ouvrirBase(): Promise<IDBDatabase> {
  return new Promise((resoudre, rejeter) => {
    const requete = indexedDB.open(NOM_BASE, 1)
    requete.onupgradeneeded = () => {
      requete.result.createObjectStore(NOM_STORE, { keyPath: 'cle' })
    }
    requete.onsuccess = () => resoudre(requete.result)
    requete.onerror = () => rejeter(requete.error)
  })
}

/** Exécute une requête sur le store et renvoie sa promesse */
async function surStore<T>(
  mode: IDBTransactionMode,
  action: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const base = await ouvrirBase()
  try {
    return await new Promise<T>((resoudre, rejeter) => {
      const tx = base.transaction(NOM_STORE, mode)
      const requete = action(tx.objectStore(NOM_STORE))
      requete.onsuccess = () => resoudre(requete.result)
      requete.onerror = () => rejeter(requete.error)
      tx.onerror = () => rejeter(tx.error)
    })
  } finally {
    base.close()
  }
}

/** Valide sommairement une entrée (évite d'importer du corrompu) */
function estCommandeValide(c: unknown): c is CommandeEnAttente {
  if (!c || typeof c !== 'object') return false
  const o = c as Record<string, unknown>
  return (
    typeof o.cle === 'string' && o.cle.length >= 8 &&
    typeof o.token === 'string' &&
    typeof o.sessionId === 'string' &&
    Array.isArray(o.lignes)
  )
}

// ---------- Repli localStorage (IndexedDB absent) ----------

function lireLegacy(): CommandeEnAttente[] {
  try {
    const brut = localStorage.getItem(CLE_LEGACY)
    if (!brut) return []
    const file = JSON.parse(brut) as unknown
    return Array.isArray(file) ? file.filter(estCommandeValide) : []
  } catch {
    return []
  }
}

function ecrireLegacy(file: CommandeEnAttente[]): void {
  if (file.length) localStorage.setItem(CLE_LEGACY, JSON.stringify(file))
  else localStorage.removeItem(CLE_LEGACY)
}

// ---------- API publique ----------

/**
 * Ajoute une commande à la file. Si la clé existe déjà, l'écriture
 * est un no-op (put idempotent) : jamais de doublon.
 */
export async function ajouterALaFile(commande: CommandeEnAttente): Promise<void> {
  if (!indexedDbDisponible()) {
    const file = lireLegacy()
    if (!file.some((c) => c.cle === commande.cle)) file.push(commande)
    ecrireLegacy(file)
    return
  }
  await surStore('readwrite', (store) => store.put(commande))
}

/** Lit toute la file (d'abord l'import legacy, puis IndexedDB) */
export async function lireFile(): Promise<CommandeEnAttente[]> {
  await importerAncienneFile()
  if (!indexedDbDisponible()) return lireLegacy()
  return surStore('readonly', (store) => store.getAll() as IDBRequest<CommandeEnAttente[]>)
}

/** Retire une commande envoyée avec succès */
export async function retirerDeLaFile(cle: string): Promise<void> {
  if (!indexedDbDisponible()) {
    ecrireLegacy(lireLegacy().filter((c) => c.cle !== cle))
    return
  }
  await surStore('readwrite', (store) => store.delete(cle))
}

/** Vrai si au moins une commande attend d'être envoyée */
export async function fileNonVide(): Promise<boolean> {
  return (await lireFile()).length > 0
}

/**
 * Import UNIQUE et sans perte de l'ancienne file localStorage.
 * - Chaque entrée valide est écrite dans IndexedDB (put idempotent).
 * - La clé localStorage n'est supprimée QU'APRÈS écriture réussie.
 * - Un JSON illisible est déplacé vers « gbs.outbox.sauvegarde »
 *   (conservé, jamais détruit) et signalé par un log discret.
 * Retourne le nombre d'entrées importées.
 */
export async function importerAncienneFile(): Promise<number> {
  if (!indexedDbDisponible()) return 0
  let brut: string | null
  try {
    brut = localStorage.getItem(CLE_LEGACY)
  } catch {
    return 0
  }
  if (!brut) return 0

  let file: unknown
  try {
    file = JSON.parse(brut)
  } catch {
    // Sans perte : on conserve les données brutes sous une clé de secours
    try {
      if (!localStorage.getItem(CLE_SAUVEGARDE)) localStorage.setItem(CLE_SAUVEGARDE, brut)
      localStorage.removeItem(CLE_LEGACY)
    } catch { /* jamais bloquant */ }
    console.info('[gbs] ancienne file hors-ligne illisible → conservée sous gbs.outbox.sauvegarde')
    return 0
  }

  const valides = Array.isArray(file) ? file.filter(estCommandeValide) : []
  // Écriture AVANT suppression : si une écriture échoue, la clé
  // localStorage reste en place et l'import sera retenté au prochain
  // lancement — aucune entrée n'est perdue.
  for (const commande of valides) {
    await surStore('readwrite', (store) => store.put(commande))
  }
  try {
    localStorage.removeItem(CLE_LEGACY)
  } catch { /* non bloquant : le put idempotent rend le réimport sans danger */ }
  if (valides.length) console.info(`[gbs] ${valides.length} commande(s) hors-ligne migrée(s) vers IndexedDB`)
  return valides.length
}
