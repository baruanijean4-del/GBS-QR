# ============================================================
# GBS â€” Image Docker (usage hors plateforme K3)
#
# NOTE : la plateforme de dÃ©ploiement principale n'utilise PAS ce
# Dockerfile â€” elle exÃ©cute /code/bootstrap avec son propre
# node_modules, donc tout le runtime doit Ãªtre bundlÃ© dans
# dist/boot.js (voir README â†’ Â« DÃ©ploiement Â»).
# Ce fichier reste utile pour un dÃ©ploiement Docker autonome :
# il n'a plus AUCUNE dÃ©pendance native (le traitement d'images
# utilise jimp, 100 % JavaScript, bundlÃ© dans dist/boot.js).
# ============================================================

# ---------- Build ----------
FROM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

# ---------- Runtime ----------
# alpine suffit dÃ©sormais : plus de binaire natif (sharp) Ã  rÃ©soudre,
# jimp est du pur JavaScript inclus dans le bundle dist/boot.js.
FROM node:24-alpine
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
COPY package.json package-lock.json ./
# drizzle-kit sert uniquement Ã  appliquer les migrations au dÃ©marrage
# (voir scripts/docker-entrypoint.sh) ; le serveur, lui, est autonome.
RUN npm ci --omit=dev && npm install --no-save drizzle-kit
COPY --from=build /app/dist ./dist
COPY --from=build /app/drizzle.config.ts ./drizzle.config.ts
COPY --from=build /app/db ./db
COPY --from=build /app/contracts ./contracts
COPY --from=build /app/scripts/docker-entrypoint.sh ./scripts/docker-entrypoint.sh
RUN chmod +x ./scripts/docker-entrypoint.sh
EXPOSE 3000
# Initialise le schÃ©ma si la base est vide (migrations versionnÃ©es), puis dÃ©marre
# le serveur (front statique + API tRPC). Voir scripts/docker-entrypoint.sh.
CMD ["sh", "./scripts/docker-entrypoint.sh"]