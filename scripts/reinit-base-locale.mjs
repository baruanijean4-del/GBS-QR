// ============================================================
// GBS — Remise à zéro COMPLÈTE d'une base LOCALE en une commande :
//
//     node scripts/reinit-base-locale.mjs [--demo]
//     (ou : npm run db:reset / npm run db:reset:demo)
//
//   1. REFUSE toute URL *.neon.tech : ce script détruit le schéma —
//      il ne doit jamais viser une base cloud (règle « rien ne
//      touche la base de production, jamais »).
//   2. DROP SCHEMA public + drizzle CASCADE (base vierge réelle).
//   3. drizzle-kit migrate : rejoue les migrations 0000 → dernière.
//   4. Seed du référentiel (+ fixtures démo si --demo).
//
// DATABASE_URL : variable d'environnement prioritaire, sinon
// .env.local puis .env (la production n'est lue par AUCUN fichier
// de la copie locale — le garde-fou ci-dessus bloquerait de toute
// façon une URL neon.tech).
// ============================================================

import { readFileSync, existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import postgres from "postgres";

function lireEnv(fichier) {
  if (!existsSync(fichier)) return {};
  const out = {};
  for (const ligne of readFileSync(fichier, "utf8").split("\n")) {
    const m = ligne.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) out[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
  }
  return out;
}

const url =
  process.env.DATABASE_URL ??
  lireEnv(".env.local").DATABASE_URL ??
  lireEnv(".env").DATABASE_URL ??
  "";

if (!url) {
  console.error("DATABASE_URL introuvable (ni environnement, ni .env.local, ni .env).");
  process.exit(1);
}
if (url.includes(".neon.tech")) {
  console.error(
    "REFUS : DATABASE_URL pointe vers neon.tech — ce script détruit le schéma. " +
      "La copie locale utilise un PostgreSQL LOCAL (postgres://postgres:...@localhost:5432/gbs_local).",
  );
  process.exit(1);
}

const demo = process.argv.includes("--demo");
const sql = postgres(url, { max: 1 });

console.log("1/3 — Destruction du schéma (base vierge)…");
await sql.unsafe("DROP SCHEMA IF EXISTS public CASCADE");
await sql.unsafe("DROP SCHEMA IF EXISTS drizzle CASCADE");
await sql.unsafe("CREATE SCHEMA public");
await sql.end();

function lancer(commande, args) {
  const r = spawnSync(commande, args, { stdio: "inherit", shell: process.platform === "win32" });
  if (r.status !== 0) {
    console.error(`Échec : ${commande} ${args.join(" ")}`);
    process.exit(r.status ?? 1);
  }
}

console.log("2/3 — Migrations 0000 → dernière (drizzle-kit migrate)…");
lancer("npx", ["drizzle-kit", "migrate"]);

console.log("3/3 — Seed du référentiel" + (demo ? " + fixtures démo" : "") + "…");
lancer("npx", ["tsx", "db/seed.ts", ...(demo ? ["--avec-demo"] : [])]);

console.log("Base locale réinitialisée : migrations rejouées, seed appliqué.");
