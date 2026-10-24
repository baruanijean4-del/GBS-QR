// @vitest-environment jsdom
// ============================================================
// GBS — Vocabulaire métier : « chambre » pour un hôtel, « table » pour
// un restaurant ou une terrasse, « comptoir » pour une boutique…
// La langue ET le type d'établissement changent les mots ; les
// articles s'accordent (fr, pt) ; les variables {…} sont identiques
// dans les quatre langues.
// ============================================================

import { afterEach, describe, expect, it } from 'vitest'
import { act, cleanup, render, screen } from '@testing-library/react'
import fr from '@/i18n/fr.json'
import en from '@/i18n/en.json'
import pt from '@/i18n/pt.json'
import sw from '@/i18n/sw.json'
import { I18nProvider, assurerDico, useEtablissementCourant, useI18n, vocabulaireDe } from '@/i18n'
import type { TypeEtablissement } from '@contracts/types'

afterEach(cleanup)

describe('vocabulaireDe', () => {
  it('terrasse et restaurant : table', () => {
    expect(vocabulaireDe('fr', 'TERRASSE').zone).toBe('table')
    expect(vocabulaireDe('fr', 'RESTAURANT').Zones).toBe('Tables')
    expect(vocabulaireDe('en', 'RESTAURANT').zone).toBe('table')
    expect(vocabulaireDe('pt', 'RESTAURANT').zone).toBe('mesa')
    expect(vocabulaireDe('sw', 'RESTAURANT').zone).toBe('meza')
  })

  it('hôtel : chambre / room / quarto / chumba', () => {
    expect(vocabulaireDe('fr', 'GUEST_HOUSE').zone).toBe('chambre')
    expect(vocabulaireDe('en', 'GUEST_HOUSE').zones).toBe('rooms')
    expect(vocabulaireDe('pt', 'GUEST_HOUSE').zone).toBe('quarto')
    expect(vocabulaireDe('sw', 'GUEST_HOUSE').zones).toBe('vyumba')
  })

  it('boutique, pharmacie, salon : comptoir (pluriel compris)', () => {
    for (const type of ['BOUTIQUE', 'PHARMACIE', 'SALON', 'QUINCAILLERIE', 'AUTRE'] as TypeEtablissement[]) {
      expect(vocabulaireDe('fr', type).zone).toBe('comptoir')
      expect(vocabulaireDe('fr', type).zones).toBe('comptoirs')
    }
    expect(vocabulaireDe('en', 'BOUTIQUE').zones).toBe('counters')
    expect(vocabulaireDe('pt', 'BOUTIQUE').zones).toBe('balcões')
  })

  it('billard : billard / pool table', () => {
    expect(vocabulaireDe('fr', 'BILLARD').zone).toBe('billard')
    expect(vocabulaireDe('en', 'BILLARD').zone).toBe('pool table')
  })

  it('articles accordés en français : une table, une chambre, un comptoir, un billard', () => {
    expect(vocabulaireDe('fr', 'RESTAURANT')).toMatchObject({ un: 'une', le: 'la', ce: 'cette', du: 'de la', au: 'à la' })
    expect(vocabulaireDe('fr', 'GUEST_HOUSE')).toMatchObject({ un: 'une', ce: 'cette' })
    expect(vocabulaireDe('fr', 'BOUTIQUE')).toMatchObject({ un: 'un', le: 'le', ce: 'ce', du: 'du', au: 'au' })
    expect(vocabulaireDe('fr', 'BILLARD')).toMatchObject({ un: 'un', ce: 'ce' })
  })

  it('articles accordés en portugais : uma mesa, um quarto, um balcão', () => {
    expect(vocabulaireDe('pt', 'RESTAURANT')).toMatchObject({ un: 'uma', le: 'a', ce: 'esta', au: 'na' })
    expect(vocabulaireDe('pt', 'GUEST_HOUSE')).toMatchObject({ un: 'um', le: 'o', ce: 'este', au: 'no' })
  })

  it('swahili : démonstratif hii / hiki', () => {
    expect(vocabulaireDe('sw', 'GUEST_HOUSE').ce).toBe('hiki')
    expect(vocabulaireDe('sw', 'RESTAURANT').ce).toBe('hii')
  })

  it('types fusionnés : le vocabulaire est celui du type principal', () => {
    expect(vocabulaireDe('fr', 'GUEST_HOUSE', ['RESTAURANT']).zone).toBe('chambre')
    expect(vocabulaireDe('fr', 'RESTAURANT', ['GUEST_HOUSE']).zone).toBe('table')
  })
})

/** Petit écran de test : déclare l'établissement puis affiche des textes de l'app */
function Ecran({ type, secondaires }: { type?: TypeEtablissement; secondaires?: TypeEtablissement[] }) {
  const { t, setLangue } = useI18n()
  useEtablissementCourant(type ? { type, typesSecondaires: secondaires } : null)
  return (
    <div>
      <p data-testid="titre">{t('client.table', { numero: 3 })}</p>
      <p data-testid="ajout">{t('proprio.ajouter_table_titre')}</p>
      <p data-testid="archive">{t('proprio.archiver_titre')}</p>
      <p data-testid="liste">{t('gerant.tables_nb', { n: 4 })}</p>
      <button onClick={() => setLangue('en')}>en</button>
    </div>
  )
}

describe('t() suit le type de l\'établissement affiché', () => {
  it('restaurant : « Table 3 », « Ajouter une table », « Archiver cette table ? »', () => {
    localStorage.setItem('gbs-lang', 'fr')
    render(<I18nProvider><Ecran type="RESTAURANT" /></I18nProvider>)
    expect(screen.getByTestId('titre').textContent).toBe('Table 3')
    expect(screen.getByTestId('ajout').textContent).toBe('Ajouter une table')
    expect(screen.getByTestId('archive').textContent).toBe('Archiver cette table ?')
    expect(screen.getByTestId('liste').textContent).toBe('4 tables')
  })

  it('hôtel : « Chambre 3 », « Ajouter une chambre », « Archiver cette chambre ? »', () => {
    localStorage.setItem('gbs-lang', 'fr')
    render(<I18nProvider><Ecran type="GUEST_HOUSE" /></I18nProvider>)
    expect(screen.getByTestId('titre').textContent).toBe('Chambre 3')
    expect(screen.getByTestId('ajout').textContent).toBe('Ajouter une chambre')
    expect(screen.getByTestId('archive').textContent).toBe('Archiver cette chambre ?')
    expect(screen.getByTestId('liste').textContent).toBe('4 chambres')
  })

  it('boutique : « Comptoir 3 », « Ajouter un comptoir », « Archiver ce comptoir ? »', () => {
    localStorage.setItem('gbs-lang', 'fr')
    render(<I18nProvider><Ecran type="BOUTIQUE" /></I18nProvider>)
    expect(screen.getByTestId('titre').textContent).toBe('Comptoir 3')
    expect(screen.getByTestId('ajout').textContent).toBe('Ajouter un comptoir')
    expect(screen.getByTestId('archive').textContent).toBe('Archiver ce comptoir ?')
    expect(screen.getByTestId('liste').textContent).toBe('4 comptoirs')
  })

  it('aucun établissement déclaré : vocabulaire par défaut (table)', () => {
    localStorage.setItem('gbs-lang', 'fr')
    render(<I18nProvider><Ecran /></I18nProvider>)
    expect(screen.getByTestId('titre').textContent).toBe('Table 3')
  })

  it('la langue change aussi les mots : hôtel en anglais = « Room 3 »', async () => {
    localStorage.setItem('gbs-lang', 'fr')
    await assurerDico('en')
    render(<I18nProvider><Ecran type="GUEST_HOUSE" /></I18nProvider>)
    await act(async () => { screen.getByText('en').click(); await assurerDico('en') })
    expect(screen.getByTestId('titre').textContent).toBe('Room 3')
    expect(screen.getByTestId('ajout').textContent).toBe('Add a room')
    expect(screen.getByTestId('archive').textContent).toBe('Archive this room?')
    expect(screen.getByTestId('liste').textContent).toBe('4 rooms')
    localStorage.setItem('gbs-lang', 'fr')
  })
})

describe('cohérence des textes entre les 4 langues', () => {
  const dicos: Record<string, Record<string, string>> = { fr, en, pt, sw }
  const variables = (s: string) => [...new Set([...s.matchAll(/\{([A-Za-z_0-9]+)\}/g)].map((m) => m[1]))].sort()
  // Variables fournies automatiquement par t() (vocabulaire, articles fr/pt) : une langue peut
  // ne pas les utiliser ou les écrire autrement (Zone / zone). {s} = pluriel, propre à certaines langues.
  const ARTICLES = new Set(['un', 'le', 'ce', 'du', 'au'])
  const AUTOMATIQUES = new Set([...ARTICLES, 'zone', 'zones', 'Zone', 'Zones', 's'])

  it('chaque clé utilise les mêmes {variables} dans les quatre langues (vocabulaire automatique excepté)', () => {
    const ecarts: string[] = []
    for (const cle of Object.keys(fr)) {
      const ref = variables((fr as Record<string, string>)[cle]).filter((v) => !AUTOMATIQUES.has(v))
      for (const l of ['en', 'pt', 'sw']) {
        const v = variables(dicos[l][cle]).filter((x) => !AUTOMATIQUES.has(x))
        if (JSON.stringify(v) !== JSON.stringify(ref)) ecarts.push(`${cle} [${l}] ${JSON.stringify(v)} ≠ fr ${JSON.stringify(ref)}`)
      }
    }
    expect(ecarts).toEqual([])
  })

  it('les articles ne sont utilisés qu\'en français et en portugais', () => {
    for (const l of ['en', 'sw']) {
      for (const [cle, v] of Object.entries(dicos[l])) {
        for (const a of ['un', 'le', 'du', 'au']) expect(v, `${l}:${cle}`).not.toContain(`{${a}}`)
      }
    }
  })

  it('aucun texte ne laisse une variable de vocabulaire inconnue', () => {
    const connues = new Set(['zone', 'zones', 'Zone', 'Zones', ...ARTICLES])
    for (const [l, d] of Object.entries(dicos)) {
      for (const [cle, v] of Object.entries(d)) {
        for (const nom of variables(v)) {
          if (/^(zones?|Zones?)$/i.test(nom)) expect(connues.has(nom), `${l}:${cle} {${nom}}`).toBe(true)
        }
      }
    }
  })
})
