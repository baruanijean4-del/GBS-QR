# ============================================================
# GBS Ã¢â‚¬â€ Image Docker (usage hors plateforme K3)
#
# NOTE : la plateforme de dÃƒÂ©ploiement principale n'utilise PAS ce
# Dockerfile Ã¢â‚¬â€ elle exÃƒÂ©cute /code/bootstrap avec son propre
# node_modules, donc tout le runtime doit ÃƒÂªtre bundlÃƒÂ© dans
# dist/boot.js (voir README Ã¢â€ â€™ Ã‚Â« DÃƒÂ©ploiement Ã‚Â»).
# Ce fichier reste utile pour un dÃƒÂ©ploiement Docker autonome :
# il n'a plus AUCUNE dÃƒÂ©pendance native (le traitement d'images
# utilise jimp, 100 % JavaScript, bundlÃƒÂ© dans dist/boot.js).
# ============================================================

# ---------- Build ----------
FROM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

# ---------- Runtime ----------
# alpine suffit dÃƒÂ©sormais : plus de binaire natif (sharp) ÃƒÂ  rÃƒÂ©soudre,
# jimp est du pur JavaScript inclus dans le bundle dist/boot.js.
FROM node:24-alpine
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
COPY package.json package-lock.json ./
# drizzle-kit sert uniquement ÃƒÂ  appliquer les migrations au dÃƒÂ©marrage
# (voir scripts/docker-entrypoint.sh) ; le serveur, lui, est autonome.
RUN npm ci --omit=dev && npm install --no-save drizzle-kit drizzle-orm postgres drizzle-orm
COPY --from=build /app/dist ./dist
COPY --from=build /app/drizzle.config.ts ./drizzle.config.ts
COPY --from=build /app/db ./db
COPY --from=build /app/contracts ./contracts
COPY --from=build /app/scripts/docker-entrypoint.sh ./scripts/docker-entrypoint.sh
RUN chmod +x ./scripts/docker-entrypoint.sh
EXPOSE 3000
# Initialise le schÃƒÂ©ma si la base est vide (migrations versionnÃƒÂ©es), puis dÃƒÂ©marre
# le serveur (front statique + API tRPC). Voir scripts/docker-entrypoint.sh.
CMD ["sh", "./scripts/docker-entrypoint.sh"]