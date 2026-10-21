# ============================================================
# GBS — Image Docker (usage hors plateforme K3)
#
# NOTE : la plateforme de déploiement principale n'utilise PAS ce
# Dockerfile — elle exécute /code/bootstrap avec son propre
# node_modules, donc tout le runtime doit être bundlé dans
# dist/boot.js (voir README → « Déploiement »).
# Ce fichier reste utile pour un déploiement Docker autonome :
# il n'a plus AUCUNE dépendance native (le traitement d'images
# utilise jimp, 100 % JavaScript, bundlé dans dist/boot.js).
# ============================================================

# ---------- Build ----------
FROM node:20-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

# ---------- Runtime ----------
# alpine suffit désormais : plus de binaire natif (sharp) à résoudre,
# jimp est du pur JavaScript inclus dans le bundle dist/boot.js.
FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
COPY package.json package-lock.json ./
# drizzle-kit sert uniquement à appliquer les migrations au démarrage
# (voir scripts/docker-entrypoint.sh) ; le serveur, lui, est autonome.
RUN npm ci --omit=dev && npm install --no-save drizzle-kit
COPY --from=build /app/dist ./dist
COPY --from=build /app/drizzle.config.ts ./drizzle.config.ts
COPY --from=build /app/db ./db
COPY --from=build /app/contracts ./contracts
COPY --from=build /app/scripts/docker-entrypoint.sh ./scripts/docker-entrypoint.sh
RUN chmod +x ./scripts/docker-entrypoint.sh
EXPOSE 3000
# Initialise le schéma si la base est vide (migrations versionnées), puis démarre
# le serveur (front statique + API tRPC). Voir scripts/docker-entrypoint.sh.
CMD ["sh", "./scripts/docker-entrypoint.sh"]
