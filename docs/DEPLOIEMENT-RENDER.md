# Déploiement Render — guide pas à pas

Application : **GBS / Nganda POS** (PWA React + API Hono/tRPC, bundle
autonome `dist/boot.js`, base Neon PostgreSQL).

## 0. Prérequis

1. Le dépôt GitHub privé à jour : la branche `finalisation` poussée
   depuis votre machine (clé SSH de déploiement que VOUS avez créée —
   la clé générée dans le sandbox a été supprimée).
2. La base Neon de production (projet existant) et son URL de
   connexion du rôle applicatif (`…?sslmode=require`).
3. Un compte Render (render.com) relié à votre GitHub.

## 1. Créer le service

Deux options équivalentes :

- **Blueprint (recommandé)** : Render → *New → Blueprint* → choisir le
  dépôt → Render lit `render.yaml` à la racine et crée le service
  `gbs-nganda` (région Francfort, plan Starter, healthcheck compris).
- **Manuel** : *New → Web Service* → choisir le dépôt, puis saisir les
  paramètres ci-dessous.

| Paramètre | Valeur |
|---|---|
| Runtime | Node |
| Region | **Frankfurt** (la plus proche de Lubumbashi) |
| Branch | `finalisation` |
| Build Command | `npm ci && npm run build` |
| Start Command | `npm start` (= `NODE_ENV=production node dist/boot.js`) |
| Health Check Path | `/api/trpc/ping` |
| Plan | **Starter minimum** — le plan gratuit s'endort au bout de 15 min, inacceptable pour un point de vente |

Le build produit le front statique (`dist/`) **et** le serveur bundlé
(`dist/boot.js`, esbuild autonome — aucune dépendance native, jimp est
inclus dans le bundle). Le Dockerfile du dépôt n'est **pas** utilisé
par Render en mode Node natif ; il reste disponible pour un
déploiement Docker autonome (même commande de build, entrypoint
`scripts/docker-entrypoint.sh`).

## 2. Variables d'environnement

| Variable | Rôle | Comment la produire |
|---|---|---|
| `DATABASE_URL` | Connexion PostgreSQL Neon (jamais côté client) | Console Neon → Connection string |
| `ADMIN_PIN` | PIN du super-admin plateforme (8+ caractères, sinon refus de démarrer) | phrase longue à vous |
| `ADMIN_TELEPHONE` | Numéro technique du compte super-admin | ex. `+243…` |
| `SESSION_SECRET` | Signature des jetons de session (32+ caractères) | `openssl rand -base64 48` |
| `PIN_ENC_KEY` | **Chiffrement AES-256-GCM des PIN** (64 hex exactement, DISTINCTE de SESSION_SECRET, sinon refus de démarrer) | `openssl rand -hex 32` |
| `SENTRY_DSN` | Suivi d'erreurs (optionnel) | console Sentry — laisser vide sinon |
| `SESSION_GLISSANTE` | `1` = session prolongée à chaque activité (défaut) ; `0` = retour à la session fixe 12 h | déjà `1` dans render.yaml |
| `PORT` | Port d'écoute | **fourni automatiquement par Render**, ne pas définir |

⚠️ **Ne définissez JAMAIS `ANNUAIRE_DEMO`** : sa présence en
production fait refuser le démarrage (PRODUCTION DIRECTE ZÉRO DÉMO).

## 3. Migrations de base de données

**Manuelles, jamais automatiques au démarrage** (décision D3 : la
garde `assurerSchema` vérifie le schéma en lecture seule et REFUSE de
démarrer si une migration manque — elle n'écrit jamais en production).

Ordre de déploiement d'une version avec migration :

1. Sauvegarde Neon (branche de sauvegarde ou export).
2. Appliquer la migration depuis votre machine :
   `DATABASE_URL=<url Neon> npm run db:migrate`
3. Vérifier : `npm run db:status` puis le journal
   (`drizzle.__drizzle_migrations`).
4. Déployer le code (Render → *Manual Deploy → Deploy latest commit*).

## 4. Premier démarrage — vérifications

1. Render → *Logs* : vous devez voir
   `[boot] schéma vérifié (production : lecture seule, 0006-0017 présents).`
2. Healthcheck vert : Render appelle `/api/trpc/ping` (réponse 200).
3. Ouvrir l'URL Render : l'écran de connexion s'affiche **sans**
   annuaire démo.
4. Connexion super-admin avec `ADMIN_TELEPHONE` + `ADMIN_PIN`.

## 5. Retour arrière

- **Code** : Render → *Manual Deploy* → choisir le commit précédent
  (chaque déploiement conserve son SHA). Le schéma de la base étant un
  sur-ensemble compatible, le code antérieur redémarre normalement ;
  dans le pire des cas la garde D3 refuserait avec un message explicite
  — jamais de modification silencieuse.
- **Base** : les migrations ont chacune un retour arrière documenté
  (ex. `db/migrations/0016_rollback.sql`) ; l'assainissement du journal
  (D2) a le sien : `scripts/d2-retour-arriere.sql`.
- **Neon** : restaurer la branche de sauvegarde créée avant la
  migration (console Neon → Branches → Restore).

## 6. Après le déploiement

1. Lancer le chiffrement des PIN restés en clair (voir
   `scripts/chiffrer-pins-clairs.ts` — simulation par défaut,
   `--executer` pour appliquer, `--retour-arriere` testé).
2. Assainir le journal de migrations (D2) :
   `scripts/d2-assainissement-journal.sql` — uniquement après
   sauvegarde Neon confirmée.
3. Changer le mot de passe du rôle Neon (console Neon → Roles) puis
   mettre à jour `DATABASE_URL` dans Render → *Environment* → *Save,
   rebuild & deploy*. Procédure détaillée : voir la réponse du
   2026-10-20 (point 2) / LOOPS.md.
