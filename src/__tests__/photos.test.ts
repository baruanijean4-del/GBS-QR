// ============================================================
// GBS — Photos : toujours une adresse (URL) https, jamais un fichier.
// Test pur (aucune base).
// ============================================================

import { describe, expect, it } from 'vitest'
import { URL_PHOTO_MAX, urlPhotoValide } from '@contracts/photos'

describe('urlPhotoValide', () => {
  it('accepte un lien https complet', () => {
    expect(urlPhotoValide('https://res.cloudinary.com/demo/image/upload/primus.jpg')).toBe(true)
    expect(urlPhotoValide('https://i.ibb.co/abc123/bouteille.png')).toBe(true)
    expect(urlPhotoValide('  https://exemple.com/photo.webp  ')).toBe(true) // espaces autour ignorés
  })

  it('refuse http (contenu mixte dans la PWA) et les autres protocoles', () => {
    expect(urlPhotoValide('http://exemple.com/photo.jpg')).toBe(false)
    expect(urlPhotoValide('ftp://exemple.com/photo.jpg')).toBe(false)
    expect(urlPhotoValide('javascript:alert(1)')).toBe(false)
    expect(urlPhotoValide('data:image/png;base64,iVBORw0KGgo=')).toBe(false)
  })

  it('refuse le vide, un texte quelconque et un lien incomplet', () => {
    expect(urlPhotoValide('')).toBe(false)
    expect(urlPhotoValide('   ')).toBe(false)
    expect(urlPhotoValide('photo.jpg')).toBe(false)
    expect(urlPhotoValide('https://')).toBe(false)
    expect(urlPhotoValide('https://localhost/photo.jpg')).toBe(false) // pas de nom de domaine public
  })

  it('refuse les identifiants dans le lien (user:mot-de-passe@)', () => {
    expect(urlPhotoValide('https://admin:secret@exemple.com/photo.jpg')).toBe(false)
  })

  it(`refuse au-delà de ${URL_PHOTO_MAX} caractères (colonne varchar(500))`, () => {
    const base = 'https://exemple.com/'
    expect(urlPhotoValide(base + 'a'.repeat(URL_PHOTO_MAX - base.length))).toBe(true)
    expect(urlPhotoValide(base + 'a'.repeat(URL_PHOTO_MAX - base.length + 1))).toBe(false)
  })
})
