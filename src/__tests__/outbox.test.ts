// @vitest-environment jsdom
// ============================================================
// GBS — File hors-ligne IndexedDB (correctif « disparition 00h00 »)
//
// Verrouille les garanties du correctif 2 :
//  - une commande en attente SURVIT à la fermeture et à la
//    réouverture de l'application (module rechargé, base conservée) ;
//  - l'import de l'ancienne file localStorage est UNIQUE et SANS
//    PERTE (clé supprimée seulement après écriture confirmée) ;
//  - la clé d'idempotence empêche tout doublon au ré-ajout ;
//  - un JSON illisible est conservé (clé de sauvegarde), pas détruit.
// ============================================================

import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const CLE_LEGACY = 'gbs.outbox'
const CLE_SAUVEGARDE = 'gbs.outbox.sauvegarde'

const LIGNE = { produitId: 'prod_1', quantite: 2, nom: 'Primus', prixUnitaire: 3000 } as never

function commande(cle: string) {
  return {
    cle,
    token: 'tok_table1',
    sessionId: 'sess_1',
    lignes: [LIGNE],
    ajouteeLe: new Date().toISOString(),
  }
}

async function moduleFrais() {
  // Simule une RÉOUVERTURE de l'app : le module est rechargé de zéro,
  // seule la base IndexedDB (globale) survit — comme sur le téléphone.
  vi.resetModules()
  return import('@/lib/outbox')
}

beforeEach(async () => {
  localStorage.clear()
  // Vide le store entre les tests
  const { lireFile, retirerDeLaFile } = await moduleFrais()
  for (const c of await lireFile()) await retirerDeLaFile(c.cle)
})

describe('outbox IndexedDB', () => {
  it('une commande en attente survit à la fermeture et à la réouverture', async () => {
    const avant = await moduleFrais()
    await avant.ajouterALaFile(commande('cle_survie_01'))

    // « Fermeture » puis « réouverture » : module rechargé à neuf
    const apres = await moduleFrais()
    const file = await apres.lireFile()

    expect(file).toHaveLength(1)
    expect(file[0].cle).toBe('cle_survie_01')
    expect(file[0].lignes).toHaveLength(1)
  })

  it('importe les anciennes entrées localStorage, une seule fois, sans perte', async () => {
    localStorage.setItem(CLE_LEGACY, JSON.stringify([commande('cle_anc_1'), commande('cle_anc_2')]))
    const outbox = await moduleFrais()

    const importees = await outbox.importerAncienneFile()

    expect(importees).toBe(2)
    // Clé legacy supprimée APRÈS écriture confirmée
    expect(localStorage.getItem(CLE_LEGACY)).toBeNull()
    const file = await outbox.lireFile()
    expect(file.map((c) => c.cle).sort()).toEqual(['cle_anc_1', 'cle_anc_2'])

    // UNIQUE : un second import ne rajoute rien
    expect(await outbox.importerAncienneFile()).toBe(0)
    expect(await outbox.lireFile()).toHaveLength(2)
  })

  it('la clé d’idempotence rend le ré-ajout sans effet (jamais de doublon)', async () => {
    const outbox = await moduleFrais()
    await outbox.ajouterALaFile(commande('cle_double_01'))
    await outbox.ajouterALaFile(commande('cle_double_01'))

    expect(await outbox.lireFile()).toHaveLength(1)
  })

  it('un legacy illisible est conservé sous la clé de sauvegarde', async () => {
    localStorage.setItem(CLE_LEGACY, '{corrompu…')
    const outbox = await moduleFrais()

    const importees = await outbox.importerAncienneFile()

    expect(importees).toBe(0)
    expect(localStorage.getItem(CLE_LEGACY)).toBeNull()
    expect(localStorage.getItem(CLE_SAUVEGARDE)).toBe('{corrompu…') // rien de détruit
  })

  it('retirerDeLaFile ne retire que la commande visée', async () => {
    const outbox = await moduleFrais()
    await outbox.ajouterALaFile(commande('cle_a'))
    await outbox.ajouterALaFile(commande('cle_b'))

    await outbox.retirerDeLaFile('cle_a')

    const file = await outbox.lireFile()
    expect(file).toHaveLength(1)
    expect(file[0].cle).toBe('cle_b')
  })

  it('fileNonVide reflète le contenu réel', async () => {
    const outbox = await moduleFrais()
    expect(await outbox.fileNonVide()).toBe(false)
    await outbox.ajouterALaFile(commande('cle_c'))
    expect(await outbox.fileNonVide()).toBe(true)
  })
})
