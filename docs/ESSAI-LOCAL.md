# GBS — Essai local complet avant production (Windows)

Règle absolue : **rien ne touche la base de production, jamais.** Le
`.env` de production ne doit figurer dans **aucun** fichier de la copie
locale. Un garde-fou (`api/lib/gardeLocale.ts`) **refuse le démarrage
local si `DATABASE_URL` pointe vers `neon.tech`** — même par mégarde.

---

## 1. Préparation locale pas à pas

### 1.1 Récupérer le code

```bat
:: Là où tu as téléchargé gbs-repo-complet.bundle
git clone gbs-repo-complet.bundle GBS
cd GBS
git log --oneline -3   :: doit afficher cc76673 en tête
```

### 1.2 Node 20 via nvm-windows

```bat
:: Installer nvm-windows : https://github.com/coreybutler/nvm-windows/releases (nvm-setup.exe)
nvm install 20
nvm use 20
node -v    :: v20.x.x
```

### 1.3 PostgreSQL local — deux options au choix

**Option A — Docker (recommandée)** après installation de Docker Desktop :

```bat
docker run --name gbs-pg -e POSTGRES_PASSWORD=faux_mdp_local_pour_essais_32c -e POSTGRES_DB=gbs_local -p 5432:5432 -d postgres:16
```

**Option B — installation directe** : installer PostgreSQL 16
(postgresql.org → installer Windows), puis dans pgAdmin ou psql :
`CREATE DATABASE gbs_local;`

### 1.4 Fichier `.env.local` — FAUX secrets, conformes aux règles

Crée `.env.local` à la racine (jamais le vrai `.env` de production) :

```ini
NODE_ENV=development
DATABASE_URL=postgres://postgres:faux_mdp_local_pour_essais_32c@localhost:5432/gbs_local
ADMIN_PIN=FAUX-pin-local-0000
SESSION_SECRET=faux_secret_local_de_64_caracteres_pour_les_essais_00000000
ANNUAIRE_DEMO=true
```

- `ADMIN_PIN` : 8+ caractères (règle production), ici un FAUX.
- `SESSION_SECRET` : 32+ caractères (règle production), ici un FAUX.
- `ANNUAIRE_DEMO=true` : autorisé en local seulement (page de connexion
  avec les personas démo).

### 1.5 Installation et remise à zéro

```bat
npm ci
npm run db:reset:demo
```

`db:reset:demo` (= `node scripts/reinit-base-locale.mjs --demo`) fait en
**une commande** : destruction du schéma → migrations 0000 → 0017
rejouées → seed référentiel (992 articles, 10 plans) → 6 établissements
de démonstration. Le script **refuse toute URL `neon.tech`**.

### 1.6 Démarrage

```bat
npm run dev
```

Le front ET l'API sont servis par le même serveur de développement
(plugin `devServer` de `vite.config.ts`, entrée `api/boot.ts`).
Ouvre http://localhost:5173 — connexion démo affichée sur la page.

Mode « comme en production » en local :

```bat
npm run build
npm start
```

### 1.7 Pilote de base de données — compatibilité confirmée

L'application utilise **postgres-js** (`api/queries/connection.ts`), un
pilote TCP PostgreSQL **générique** — ce n'est PAS le pilote serverless
spécifique à Neon. **Aucune adaptation de code n'est nécessaire** :
seule l'URL change. Le `?sslmode=require` de Neon est porté par l'URL
elle-même ; en local, l'URL sans `sslmode` suffit. L'option
`prepare: false` (requise par le pooler Neon) est sans effet négatif
sur un PostgreSQL local.

---

## 2. ESSAI A — base vierge

Déjà couvert par `npm run db:reset:demo` (§1.5). Pour rejouer :

```bat
npm run db:reset        :: migrations + référentiel seul
npm run db:reset:demo   :: + établissements de démonstration
```

---

## 3. ESSAI B — copie de production anonymisée

### 3.1 Exporter depuis une SAUVEGARDE (jamais la base vivante)

Dans la console Neon : **Branches → Create branch** depuis `main`
(copie figée instantanée, la production continue sans être touchée).
Puis, depuis cette **branche** (pas depuis main) :

```bat
pg_dump "postgresql://USER:MDP@HOST-BRANCHE.neon.tech/neondb?sslmode=require" --no-owner --no-privileges -f sauvegarde-prod.sql
```

(Ne pas coller cette URL dans le chat — elle contient des identifiants.)

### 3.2 Restaurer en local et anonymiser

```bat
:: PostgreSQL local (Docker) :
docker exec -i gbs-pg psql -U postgres -d gbs_local -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public; DROP SCHEMA IF EXISTS drizzle CASCADE;"
type sauvegarde-prod.sql | docker exec -i gbs-pg psql -U postgres -d gbs_local

:: Anonymisation : noms, téléphones, PIN, pièces d'identité masqués
type scripts\anonymiser-copie.sql | docker exec -i gbs-pg psql -U postgres -d gbs_local
```

### 3.3 Montée de version des migrations sur ces données

```bat
npx drizzle-kit migrate
```

### 3.4 Retour arrière

Avant toute opération risquée sur la copie : `pg_dump` local de
`gbs_local` vers `avant-operation.sql`. Restauration : refaire §3.2
premier bloc avec ce fichier. (Testé : restauration complète après
crash simulé — 2 363 lignes retrouvées à l'identique.)

---

## 4. Batterie de tests locale

```bat
npm test                  :: suite complète, une seule fois, ~20 min
npm run lint              :: 0 erreur attendue
npx tsc --noEmit          :: 0 erreur attendue
```

Démarrage production avec mauvaises valeurs (PowerShell, un cas à la fois) :

```powershell
$env:NODE_ENV="production"; $env:SESSION_SECRET="x"*64; $env:ADMIN_PIN=""; npm start
:: → refus attendu : ADMIN_PIN obligatoire
```

Variantes à jouer : `ADMIN_PIN="2468"` (défaut), `ADMIN_PIN="12345"`
(court), `SESSION_SECRET=""` (absent), `SESSION_SECRET="court"`,
`ANNUAIRE_DEMO="true"` — chaque cas doit REFUSER le démarrage.

---

## 5. Test sur téléphone réel (sans exposer la vraie base)

Le service worker et l'installation PWA exigent un **contexte sécurisé**
(HTTPS ou localhost). Deux options :

**Option A — tunnel HTTPS temporaire** (le plus simple) :

```bat
:: cloudflared (https://github.com/cloudflare/cloudflared/releases)
cloudflared tunnel --url http://localhost:5173
```

→ affiche une URL `https://....trycloudflare.com` valable quelques
heures. Ouvre-la sur le téléphone (même Wi-Fi non requis). Tout reste
sur ta base **locale** ; coupe le tunnel après l'essai.

**Option B — débogage USB** : active le débogage USB sur le téléphone,
branche-le, ouvre `chrome://inspect#devices` sur le PC, ajoute le port
`5173` dans *Port forwarding*. Sur le téléphone, ouvre
`http://localhost:5173` — localhost est un contexte sécurisé, le
service worker fonctionne.

**Ce qui ne peut être testé qu'à la main, sur un vrai téléphone :**

- installation de la PWA (bannière « Ajouter à l'écran d'accueil ») ;
- mode hors-ligne réel (coupure réseau pendant un service, reprise
  sans doublon — l'outbox IndexedDB est testée en automatisé, le
  comportement radio réel non) ;
- la « disparition à minuit » : `chrome://webapks` pour vérifier le
  stockage de l'app, horloge réglée à 23h59, nettoyeur du téléphone ;
- taille des boutons au pouce, lisibilité en plein soleil.
