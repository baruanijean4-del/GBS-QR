#!/bin/sh
# Entrypoint Docker — initialise le schéma de façon sûre, puis lance le serveur.
#
# Règles :
#  - Base vide  → on applique les migrations versionnées (drizzle-kit migrate),
#    jamais `push --force` aveuglément sur une base existante.
#  - Base existante → on ne touche à rien (les migrations se gèrent à la main,
#    voir db/migrations/README.md).
#  - Si DATABASE_URL est absent ou la vérification échoue, on démarre quand même
#    le serveur : l'erreur de connexion remontera via l'API.
set -e

echo "[entrypoint] vérification du schéma de base…"

if [ -z "$DATABASE_URL" ]; then
  echo "[entrypoint] DATABASE_URL absent — démarrage sans initialisation de schéma."
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
      console.error("[entrypoint] vérification impossible :", e.message);
      console.log("inconnu");
      return sql.end().catch(() => {});
    });
  ')
  echo "[entrypoint] base vide : $BASE_VIDE"

  if [ "$BASE_VIDE" = "oui" ]; then
    echo "[entrypoint] application des migrations initiales…"
    npx drizzle-kit migrate
    echo "[entrypoint] migrations appliquées."
  fi
fi

echo "[entrypoint] démarrage du serveur…"
exec node dist/boot.js
