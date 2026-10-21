#!/bin/sh
set -e

echo "[entrypoint] demarrage du serveur..."

exec node dist/boot.js