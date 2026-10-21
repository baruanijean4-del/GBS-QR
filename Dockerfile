# Étape 1 : Build
FROM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

# Étape 2 : Runtime
FROM node:24-alpine
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=10000

# Dépendances de production (drizzle-kit y est maintenant)
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# Copie du build et des fichiers nécessaires
COPY --from=build /app/dist ./dist
COPY --from=build /app/drizzle.config.ts ./drizzle.config.ts
COPY --from=build /app/db ./db
COPY --from=build /app/contracts ./contracts

# Démarrage direct (le code gère les migrations)
CMD ["node", "dist/boot.js"]