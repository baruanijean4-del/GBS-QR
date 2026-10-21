#!/bin/sh
set -e

echo "[entrypoint] verification du schema de base..."

# Écrire le script JS dans un fichier temporaire pour éviter les problèmes de quoting shell
cat > /tmp/check-db.mjs <<'EOF'
import postgres from 'postgres';
const sql = postgres(process.env.DATABASE_URL, { ssl: 'require', max: 1 });
try {
  const result = await sql`SELECT count(*)::int AS n FROM information_schema.tables WHERE table_schema = 'public'`;
  console.log(result[0].n === 0 ? 'oui' : 'non');
} catch (e) {
  console.error(e.message);
  process.exit(1);
} finally {
  await sql.end();
}
EOF

DB_EMPTY=$(node /tmp/check-db.mjs 2>/dev/null || echo "erreur")
echo "[entrypoint] base vide : $DB_EMPTY"

if [ "$DB_EMPTY" = "oui" ]; then
    echo "[entrypoint] application des migrations initiales..."
    drizzle-kit migrate
    echo "[entrypoint] migrations appliquees."
else
    echo "[entrypoint] base existante - migrations non appliquees automatiquement."
fi

echo "[entrypoint] demarrage du serveur..."
exec node dist/boot.js