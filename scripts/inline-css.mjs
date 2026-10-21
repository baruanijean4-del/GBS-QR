// ============================================================
// GBS — Inlining du CSS critique (boucle 7, budget performance)
//
// La feuille de style principale (~8 Ko gzip) est insérée en ligne
// dans index.html : un aller-retour réseau de moins avant le premier
// rendu (render-blocking-resources Lighthouse). Les url() du CSS sont
// toutes absolues (/fonts/…) — elles restent valides en ligne.
// La CSP autorise le style en ligne (style-src 'self' 'unsafe-inline').
// Le fichier .css reste émis sur disque (référencé nulle part, inerte).
// Lancé entre `vite build` et `versionner-sw` : le pré-cache lit alors
// un index.html autonome (HTML + CSS + JS vital = la coque complète).
// ============================================================

import { readFileSync, writeFileSync, statSync } from 'node:fs'
import path from 'node:path'

const DIST = path.resolve(import.meta.dirname, '../dist/public')
const INDEX = path.join(DIST, 'index.html')

const html = readFileSync(INDEX, 'utf8')
const cible = /<link rel="stylesheet"[^>]*href="\/(assets\/[^"]+\.css)"[^>]*>/
const trouve = html.match(cible)

if (!trouve) {
  console.error('[inline-css] ÉCHEC : aucune feuille de style trouvée dans index.html — build arrêté.')
  process.exit(1)
}

const css = readFileSync(path.join(DIST, trouve[1]), 'utf8')
// Garde : aucune url() relative ne survivrait à l'inlining (résolution
// contre le document au lieu du fichier CSS)
const relative = css.match(/url\((?!['"]?(?:\/|https?:|data:))[^)]+\)/)
if (relative) {
  console.error(`[inline-css] ÉCHEC : url() relative détectée (${relative[0]}) — build arrêté.`)
  process.exit(1)
}

const nouveau = html.replace(cible, `<style>\n${css}\n</style>`)
writeFileSync(INDEX, nouveau)

console.log(
  `[inline-css] ${trouve[1]} inline dans index.html ` +
    `(${(statSync(path.join(DIST, trouve[1])).size / 1024).toFixed(1)} Ko) — un aller-retour de moins.`,
)
