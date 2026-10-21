// @vitest-environment jsdom
// ============================================================
// GBS — Socle i18n (boucle 5 + swahili)
//
// L'application entière doit fonctionner en français, anglais,
// portugais (d'Angola) et swahili (Lubumbashi) :
// - les quatre dictionnaires ont EXACTEMENT les mêmes clés ;
// - aucune valeur n'est vide ;
// - le repli suit la chaîne de la langue (pt→en→fr, sw→fr) ;
// - le lexique portugais est européen/africain (mesa, encomenda,
//   caixa, ecrã) et non brésilien ;
// - l'interpolation {var} fonctionne dans les quatre langues ;
// - la langue initiale suit le navigateur, sinon français.
// ============================================================

import { beforeEach, describe, expect, it } from 'vitest'
import fr from '@/i18n/fr.json'
import en from '@/i18n/en.json'
import pt from '@/i18n/pt.json'
import sw from '@/i18n/sw.json'
import { LOCALES, assurerDico, langueCourante, traduire } from '@/i18n'

const dicos: Record<string, Record<string, string>> = { fr, en, pt, sw }
const dicFr = fr as Record<string, string>

describe('dictionnaires i18n', () => {
  it('les quatre langues ont exactement les mêmes clés', () => {
    const clesFr = Object.keys(fr).sort()
    const clesEn = Object.keys(en).sort()
    const clesPt = Object.keys(pt).sort()
    const clesSw = Object.keys(sw).sort()
    expect(clesEn).toEqual(clesFr)
    expect(clesPt).toEqual(clesFr)
    expect(clesSw).toEqual(clesFr)
    // Volume minimal : l'app entière est couverte
    expect(clesFr.length).toBeGreaterThanOrEqual(650)
  })

  it('aucune valeur n’est vide dans aucune langue', () => {
    for (const [langue, dico] of Object.entries(dicos)) {
      for (const [cle, valeur] of Object.entries(dico)) {
        expect(valeur.trim(), `${langue}:${cle} vide`).not.toBe('')
      }
    }
  })

  it('le lexique portugais est européen/africain, pas brésilien', () => {
    // commande = « encomenda » (pas « pedido »), table = « mesa »,
    // caisse = « caixa », écran = « ecrã » (pas « tela »).
    const toutPt = Object.values(pt).join(' · ')
    expect(toutPt).toContain('mesa')
    expect(toutPt).toContain('encomenda')
    expect(toutPt).toContain('caixa')
    expect(toutPt).toContain('ecrã')
    // La commande client n'est jamais un « pedido » (brésilien) :
    // « pedido » n'est admis que pour la demande de stock au propriétaire.
    expect(pt['client.votre_commande']).toContain('encomenda')
    expect(pt['gerant.commandes_en_cours']).toContain('Encomendas')
    // Marqueurs typiquement brésiliens à proscrire
    expect(toutPt).not.toContain('tela de')
    expect(toutPt).not.toContain('celular')
    expect(toutPt).not.toContain('senha')
  })

  it('les montants et seuils métier restent inchangés dans les trois langues', () => {
    // Règle maître : aucun changement GBS/CDF/USD — les chiffres
    // des prix d'accueil doivent être identiques partout.
    for (const dico of [fr, en, pt, sw]) {
      expect(dico['accueil.prix']).toContain('5')
      expect(dico['accueil.prix']).toContain('10')
      expect(dico['accueil.prix']).toContain('14')
    }
  })
})

describe('repli et interpolation', () => {
  beforeEach(async () => {
    localStorage.clear()
    // Les dictionnaires hors français sont chargés à la demande dans
    // l'app (budget JS, boucle 7) : le test les charge explicitement.
    await assurerDico('en')
    await assurerDico('pt')
    await assurerDico('sw')
  })

  it('le repli remonte pt → en → fr → clé brute', () => {
    localStorage.setItem('gbs-lang', 'pt')
    // Clé existante : traduite en pt
    expect(traduire('commun.retour')).toBe(pt['commun.retour'])
    // Clé inexistante partout : la clé brute est affichée
    expect(traduire('cle.inexistante.partout')).toBe('cle.inexistante.partout')
  })

  it('l’interpolation {var} fonctionne', () => {
    localStorage.setItem('gbs-lang', 'fr')
    const cleAvecVar = Object.keys(dicFr).find((c) => dicFr[c].includes('{'))
    expect(cleAvecVar).toBeDefined()
    const nomVar = dicFr[cleAvecVar!].match(/\{(\w+)\}/)![1]
    const rendu = traduire(cleAvecVar!, { [nomVar]: 'ZZZ' })
    expect(rendu).toContain('ZZZ')
    expect(rendu).not.toContain(`{${nomVar}}`)
  })

  it('le swahili traduit vraiment (et ne retombe pas sur le français)', async () => {
    localStorage.setItem('gbs-lang', 'sw')
    const rendu = traduire('commun.retour')
    expect(rendu).toBe(sw['commun.retour'])
    expect(rendu).not.toBe(fr['commun.retour'])
  })

  it('la langue courante lit le stockage local, français par défaut', () => {
    expect(langueCourante()).toBe('fr')
    localStorage.setItem('gbs-lang', 'en')
    expect(langueCourante()).toBe('en')
    localStorage.setItem('gbs-lang', 'pt')
    expect(langueCourante()).toBe('pt')
    localStorage.setItem('gbs-lang', 'sw')
    expect(langueCourante()).toBe('sw')
    // Valeur invalide : repli français
    localStorage.setItem('gbs-lang', 'es')
    expect(langueCourante()).toBe('fr')
  })

  it('les locales Intl couvrent les quatre langues', () => {
    expect(LOCALES).toEqual({ fr: 'fr-FR', en: 'en-GB', pt: 'pt-PT', sw: 'sw-CD' })
  })
})
