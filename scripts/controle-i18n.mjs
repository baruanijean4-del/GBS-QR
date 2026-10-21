// ============================================================
// GBS — Contrôle i18n (boucle 5) :
//  1. parité des clés entre fr.json, en.json et pt.json ;
//  2. aucune valeur vide ;
//  3. chaque clé t('...') utilisée dans src/ existe dans fr.json ;
//  4. aucune chaîne visible en dur avec accents dans le JSX
//     (hors commentaires et hors écran d'erreur, volontairement
//     indépendant du socle i18n).
// Usage : node scripts/controle-i18n.mjs  (exit 1 si un écart)
// ============================================================

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'

const RACINE = new URL('..', import.meta.url).pathname
const SRC = join(RACINE, 'src')

const fr = JSON.parse(readFileSync(join(SRC, 'i18n/fr.json'), 'utf8'))
const en = JSON.parse(readFileSync(join(SRC, 'i18n/en.json'), 'utf8'))
const pt = JSON.parse(readFileSync(join(SRC, 'i18n/pt.json'), 'utf8'))

let erreurs = 0
const ko = (msg) => { console.error(`  ✗ ${msg}`); erreurs += 1 }

// ---------- 1. Parité des clés ----------
const clesFr = new Set(Object.keys(fr))
for (const [nom, dico] of [['en', en], ['pt', pt]]) {
  for (const cle of Object.keys(dico)) {
    if (!clesFr.has(cle)) ko(`clé ${nom}-seule : ${cle}`)
  }
  for (const cle of clesFr) {
    if (!(cle in dico)) ko(`clé manquante en ${nom} : ${cle}`)
  }
}
console.log(`1. Parité : ${clesFr.size} clés par langue`)

// ---------- 2. Aucune valeur vide ----------
for (const [nom, dico] of [['fr', fr], ['en', en], ['pt', pt]]) {
  for (const [cle, valeur] of Object.entries(dico)) {
    if (typeof valeur !== 'string' || valeur.trim() === '') ko(`valeur vide (${nom}) : ${cle}`)
  }
}
console.log('2. Valeurs vides : aucune')

// ---------- 3. Clés utilisées présentes ----------
function* fichiers(dossier) {
  for (const nom of readdirSync(dossier)) {
    const p = join(dossier, nom)
    if (statSync(p).isDirectory()) yield* fichiers(p)
    else if (/\.(tsx?|mts)$/.test(nom)) yield p
  }
}

const utilises = new Map() // clé → premier fichier
// t('cle') et t(`cle.prefixe.${...}`) — les gabarits sont vérifiés par préfixe
const RE_SIMPLE = /\bt\(\s*'([a-z0-9_.]+)'/g
const RE_GABARIT = /\bt\(\s*`([a-z0-9_.]+)\.\$\{/g
const contenus = []
for (const f of fichiers(SRC)) {
  const texte = readFileSync(f, 'utf8')
  contenus.push([f, texte])
  for (const m of texte.matchAll(RE_SIMPLE)) {
    if (!utilises.has(m[1])) utilises.set(m[1], f)
  }
  for (const m of texte.matchAll(RE_GABARIT)) {
    if (!utilises.has(m[1] + '.*')) utilises.set(m[1] + '.*', f)
  }
}
for (const [cle, f] of utilises) {
  if (cle.endsWith('.*')) {
    const prefixe = cle.slice(0, -1)
    if (![...clesFr].some((c) => c.startsWith(prefixe))) {
      ko(`préfixe inconnu : ${cle} (${relative(RACINE, f)})`)
    }
  } else if (!clesFr.has(cle)) {
    ko(`clé absente de fr.json : ${cle} (${relative(RACINE, f)})`)
  }
}
console.log(`3. Clés utilisées : ${utilises.size} référencées, toutes présentes`)

// ---------- 4. Chaînes visibles en dur (accents + français sans accent) ----------
// Exemptés : l'écran d'erreur (indépendant par conception), les tests
// (descriptions et assertions, jamais rendues dans l'app).
const EXEMPTS = ['ErreurEcran.tsx']
const RE_ACCENT = /[àâäçéèêëîïôöùûüÉÈÀ]/
// Marqueurs de français sans accent qui ne devraient jamais apparaître dans
// le JSX visible (attrapés après retrait des commentaires et du code).
const RE_FR_SANS_ACCENT = />\s*(?:de la|du|en direct|et|avec|pour|votre|vos|aucun|aucune)\s+[a-zà-ÿ]/i
for (const [f, texte] of contenus) {
  if (EXEMPTS.some((x) => f.endsWith(x))) continue
  if (f.includes(`${sep}__tests__${sep}`)) continue
  // On retire les commentaires // et /* */ et les blocs {/* */} avant de chercher
  const sansCommentaires = texte
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1')
  const lignes = sansCommentaires.split('\n')
  for (let i = 0; i < lignes.length; i++) {
    const l = lignes[i]
    const accentuee = RE_ACCENT.test(l)
    const francaisNu = RE_FR_SANS_ACCENT.test(l) && !/[a-z]\(/.test(l.split('>')[1] ?? '')
    if (!accentuee && !francaisNu) continue
    // Tolérés : types/imports, logs techniques console, filtre ignoreErrors
    if (/^\s*(import|export type|type |interface )/.test(l)) continue
    if (/console\.(log|warn|error|info)/.test(l)) continue
    if (/ignoreErrors/.test(l)) continue
    ko(`${accentuee ? 'accent' : 'français sans accent'} en dur : ${relative(RACINE, f)}:${i + 1} — ${l.trim().slice(0, 90)}`)
  }
}
console.log('4. Chaînes en dur : contrôlées')

if (erreurs > 0) {
  console.error(`\n${erreurs} écart(s) i18n.`)
  process.exit(1)
}
console.log('\nContrôle i18n : tout est vert.')
