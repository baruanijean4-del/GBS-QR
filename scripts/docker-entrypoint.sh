#!/bin/sh
set -e

echo "[entrypoint] vérification du schéma de base…"

DB_EMPTY=$(node -e "
const postgres = require('postgres');
const sql = postgres(process.env.DATABASE_URL, { ssl: 'require', max: 1 });
sql`SELECT count(*)::int AS n FROM information_schema.tables WHERE table_schema = 'public'`
  .then(r => { console.log(r[0].n === 0 ? 'oui' : 'non'); return sql.end(); })
  .catch(e => { console.error(e.message); process.exit(1); });
" 2>/dev/null || echo "erreur")

echo "[entrypoint] base vide : $DB_EMPTY"

if [ "$DB_EMPTY" = "oui" ]; then
    echo "[entrypoint] application des migrations initiales…"
    ./node_modules/.bin/drizzle-kit migrate
    echo "[entrypoint] migrations appliquées."
else
    echo "[entrypoint] base existante — migrations non appliquées automatiquement."
fi

echo "[entrypoint] démarrage du serveur…"
exec node dist/boot.js