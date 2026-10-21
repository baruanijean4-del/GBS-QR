// ============================================================
// GBS — Post-build : pré-compresse les assets statiques en gzip
// Génère un .gz à côté de chaque .js/.css/.html/… de dist/public.
// Le serveur (api/lib/vite.ts) sert la variante .gz aux clients
// qui acceptent gzip — zéro CPU de compression au runtime.
// (brotli non disponible dans CompressionStream sous Node 20,
//  le gain gzip reste ~70 % sur le bundle JS.)
// ============================================================

import fs from "fs";
import path from "path";
import zlib from "zlib";

const RACINE = path.resolve("dist", "public");
const EXTENSIONS = new Set([".js", ".css", ".html", ".svg", ".json", ".webmanifest", ".txt"]);

let nb = 0;
let avant = 0;
let apres = 0;

function marcher(dossier) {
  for (const entree of fs.readdirSync(dossier, { withFileTypes: true })) {
    const p = path.join(dossier, entree.name);
    if (entree.isDirectory()) {
      marcher(p);
    } else if (EXTENSIONS.has(path.extname(entree.name))) {
      const brut = fs.readFileSync(p);
      const gz = zlib.gzipSync(brut, { level: 9 });
      fs.writeFileSync(`${p}.gz`, gz);
      nb++;
      avant += brut.length;
      apres += gz.length;
    }
  }
}

marcher(RACINE);
console.log(
  `[postbuild] ${nb} assets pré-compressés : ${(avant / 1024).toFixed(0)} Ko → ${(apres / 1024).toFixed(0)} Ko ` +
  `(-${Math.round((1 - apres / avant) * 100)} %)`,
);
