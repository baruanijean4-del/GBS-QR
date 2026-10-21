#!/usr/bin/env node
// ============================================================
// GBS — Injection de la version dans le service worker (Phase B.5)
//
// Exécuté APRÈS `vite build` et AVANT la compression gzip :
// 1. calcule l'empreinte du contenu construit (change à chaque
//    modification réelle des assets → purge garantie des vieux
//    caches, fini l'incrément manuel oublié) ;
// 2. génère la liste de pré-cache (coque applicative réelle :
//    HTML, JS/CSS d'entrée, polices, icônes — le hors-ligne
//    fonctionne dès la première visite) ;
// 3. écrit dist/public/sw.js final + dist/public/version.json.
//
// Échoue le build si un placeholder survit : un SW non versionné
// ne doit JAMAIS partir en production.
// ============================================================

import { createHash } from 'node:crypto'
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import path from 'node:path'

const RACINE = path.resolve(import.meta.dirname, '..')
const DIST = path.join(RACINE, 'dist', 'public')
const GABARIT = path.join(RACINE, 'public', 'sw.js')

// La coque pré-cachée = EXACTEMENT ce que index.html référence
// (script module + feuille de style d'entrée) + polices + icônes +
// manifest. Les chunks paresseux lourds (PDF, scanner code-barres)
// ne sont PAS pré-cachés : données mobiles coûteuses à Lubumbashi —
// ils seront mis en cache au premier usage (voir sw.js, /assets/).

/** Liste récursive relative (séparateurs '/') d'un dossier */
function lister(dossier, prefixe) {
  const abs = path.join(DIST, dossier)
  try {
    return readdirSync(abs, { withFileTypes: true }).flatMap((entree) => {
      const rel = `${prefixe}${entree.name}`
      return entree.isDirectory() ? lister(path.join(dossier, entree.name), `${rel}/`) : [rel]
    })
  } catch {
    return []
  }
}

// ---------- 1. Empreinte de version ----------

const fichiersEmpreinte = ['index.html', ...lister('assets', 'assets/')].sort()
const hachage = createHash('sha256')
for (const rel of fichiersEmpreinte) {
  const abs = path.join(DIST, rel)
  hachage.update(rel)
  hachage.update(readFileSync(abs))
}
const version = hachage.digest('base64url').slice(0, 12)

// ---------- 2. Liste de pré-cache ----------

// Boucle 7 : le pré-cache est scindé en deux — le vital (coque de
// rendu) est installé tout de suite ; les icônes lourdes et les polices
// sont pré-cachées au repos, après le premier affichage (message
// PRECACHER_LE_RESTE envoyé par src/lib/pwa.ts). Le hors-ligne reste
// complet, quelques secondes après le premier chargement.
const coqueStatique = [
  './',
  './manifest.webmanifest',
  './icons/favicon-32.png',
]

const coqueDifferee = [
  './icons/icon.svg',
  './icons/maskable.svg',
  './icons/apple-touch-icon.png',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-192.png',
  './icons/icon-maskable-512.png',
  ...lister('fonts', 'fonts/').filter((f) => f.endsWith('.woff2')).map((f) => `./${f}`),
]

// Assets de la coque : lus dans le HTML construit (source de vérité)
const html = readFileSync(path.join(DIST, 'index.html'), 'utf8')
const assetsCoque = [
  ...new Set(
    [...html.matchAll(/(?:src|href)="\/(assets\/[^"]+\.(?:js|css))"/g)].map((m) => `./${m[1]}`),
  ),
]
if (assetsCoque.length === 0) {
  console.error('[versionner-sw] ÉCHEC : aucun asset référencé dans index.html — build arrêté.')
  process.exit(1)
}

const precache = [...coqueStatique, ...assetsCoque]

// ---------- 3. Écriture du SW final ----------

let sw = readFileSync(GABARIT, 'utf8')
// Remplacement des formes COMPLÈTES et uniques (String.replace ne
// remplace que la 1re occurrence : le commentaire d'en-tête cite
// aussi les marqueurs, il ne faut pas y toucher).
sw = sw.replace("const VERSION = '__GBS_VERSION__'", `const VERSION = ${JSON.stringify(version)}`)
sw = sw.replace('const PRE_CACHE = __GBS_PRECACHE__', `const PRE_CACHE = ${JSON.stringify(precache, null, 2)}`)
sw = sw.replace(
  'const PRE_CACHE_DIFFERE = __GBS_PRECACHE_DIFFERE__',
  `const PRE_CACHE_DIFFERE = ${JSON.stringify(coqueDifferee, null, 2)}`,
)

// Garde : les deux injections du CODE ont dû avoir lieu (les
// commentaires du gabarit citent aussi les marqueurs, on vérifie
// donc les formes exactes du code injecté).
if (
  !sw.includes(`const VERSION = "${version}"`) ||
  sw.includes('PRE_CACHE = __GBS_PRECACHE__') ||
  sw.includes('PRE_CACHE_DIFFERE = __GBS_PRECACHE_DIFFERE__')
) {
  console.error('[versionner-sw] ÉCHEC : injection incomplète — build arrêté.')
  process.exit(1)
}

writeFileSync(path.join(DIST, 'sw.js'), sw)
writeFileSync(
  path.join(DIST, 'version.json'),
  JSON.stringify({ version, genereLe: new Date().toISOString() }),
)

const taille = (f) =>
  f === './' ? statSync(path.join(DIST, 'index.html')).size : statSync(path.join(DIST, f.slice(2))).size
console.log(
  `[versionner-sw] version ${version} — ${precache.length} fichiers vitaux ` +
    `(${(precache.reduce((n, f) => n + taille(f), 0) / 1024).toFixed(0)} Ko bruts) + ` +
    `${coqueDifferee.length} différés (${(coqueDifferee.reduce((n, f) => n + taille(f), 0) / 1024).toFixed(0)} Ko), ` +
    `${fichiersEmpreinte.length - 1} assets empreintés.`,
)
