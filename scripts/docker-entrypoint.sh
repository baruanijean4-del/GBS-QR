#!/bin/sh
# Entrypoint Docker â€” initialise le schÃ©ma de faÃ§on sÃ»re, puis lance le serveur.
#
# RÃ¨gles :
#  - Base vide  â†’ on applique les migrations versionnÃ©es (drizzle-kit migrate),
#    jamais `push --force` aveuglÃ©ment sur une base existante.
#  - Base existante â†’ on ne touche Ã  rien (les migrations se gÃ¨rent Ã  la main,
#    voir db/migrations/README.md).
#  - Si DATABASE_URL est absent ou la vÃ©rification Ã©choue, on dÃ©marre quand mÃªme
#    le serveur : l'erreur de connexion remontera via l'API.
set -e

echo "[entrypoint] vÃ©rification du schÃ©ma de baseâ€¦"

if [ -z "$DATABASE_URL" ]; then
  echo "[entrypoint] DATABASE_URL absent â€” dÃ©marrage sans initialisation de schÃ©ma."
else
  BASE_VIDE=$(node -e '
    const postgres = require("postgres");
    const sql = postgres(process.env.DATABASE_URL, { prepare: false });
    sql`
      SELECT COUNT(*)::int AS n
      FROM information_schema.tables
      WHERE table_schema = ${"public"}
        AND table_name = ${"organisations"}
    `.then((r) => {
      console.log(r[0].n === 0 ? "oui" : "non");
      return sql.end();
    }).catch((e) => {
      console.error("[entrypoint] vÃ©rification impossible :", e.message);
      console.log("inconnu");
      return sql.end().catch(() => {});
    });
  ')
  echo "[entrypoint] base vide : $BASE_VIDE"

  if [ "$BASE_VIDE" = "oui" ]; then
    echo "[entrypoint] application des migrations initialesâ€¦"
    npx --no-install drizzle-kit migrate
    echo "[entrypoint] migrations appliquÃ©es."
  fi
fi

echo "[entrypoint] dÃ©marrage du serveurâ€¦"
exec node dist/boot.js
