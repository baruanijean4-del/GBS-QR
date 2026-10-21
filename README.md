# GBS / Nganda POS

SaaS PWA pour les terrasses et boutiques de quartier (Lubumbashi, RDC).
Une seule application, quatre espaces : Client (sans compte), Serveuse,
Gérant, Propriétaire — plus un super-admin.

## Stack

- **Frontend** : React 19, TypeScript strict, Vite 7, Tailwind CSS 3.4,
  TanStack Query v5 + tRPC v11, routeur par ancres (`#/…`), PWA Android.
- **Backend** : Hono 4 + tRPC 11 sur Node 20, base PostgreSQL (Neon) via
  Drizzle ORM, authentification par sessions signées (jetons HMAC, 12 h).
- **Cycle de vie d'un établissement** : ESSAI (14 j) → ACTIF →
  EN_GRACE (7 j) → LECTURE_SEULE → SUSPENDU.

## Dépendances et runtime

Le serveur de production est un **bundle esbuild autonome** :
`npm run build` produit `dist/boot.js`, qui embarque TOUTES les
dépendances nécessaires (Hono, tRPC, Drizzle, driver postgres, jimp,
Sentry…). Aucun `node_modules` n'est requis à l'exécution — c'est une
contrainte de la plateforme de déploiement (voir « Déploiement »).

### Traitement d'images : jimp (et non sharp)

Les photos produits sont redimensionnées avec **jimp**, une librairie
100 % JavaScript qui se bundle dans `dist/boot.js` :

- photo : 800×800 (cover centré), JPEG qualité 75 ;
- vignette : 200×200 (cover centré), JPEG qualité 70 ;
- repli gracieux : si le fichier est illisible, l'original est conservé
  tel quel (`traitee: false`) — l'upload ne plante jamais.

**Avant / après** : sharp était une dépendance native (binaire
précompilé) absente du runtime de la plateforme — l'upload répondait
« traitement d'images indisponible sur ce serveur ». jimp n'a aucun
binaire : le traitement fonctionne partout. Sortie JPEG (universelle)
au lieu de WebP, que jimp ne sait pas encoder.

## Variables d'environnement

### Obligatoires (production)

| Variable         | Rôle                                                        |
| ---------------- | ----------------------------------------------------------- |
| `DATABASE_URL`   | Chaîne de connexion PostgreSQL (Neon). **Serveur uniquement** — jamais exposée au client. |
| `SESSION_SECRET` | Secret de signature des jetons de session (HMAC-SHA256).    |
| `ADMIN_PIN`      | PIN du compte super-admin créé au premier démarrage. **Ne jamais garder la valeur par défaut `2468` en production** (avertissement au démarrage). |
| `NODE_ENV`       | `production` en déploiement (active le service du front statique et les gardes-fous). |

### Optionnelles

| Variable          | Rôle                                                              |
| ----------------- | ----------------------------------------------------------------- |
| `ADMIN_TELEPHONE` | Numéro de connexion du super-admin (défaut : `+243970000000`). Le compte est créé/maj automatiquement au démarrage, PIN = `ADMIN_PIN`. |
| `SENTRY_DSN`      | Supervision des erreurs backend (Sentry). Absent = supervision désactivée. |
| `VITE_SENTRY_DSN` | Supervision des erreurs frontend (injectée au build Vite).        |

### Interdite en production

| Variable        | Rôle                                                                 |
| --------------- | -------------------------------------------------------------------- |
| `ANNUAIRE_DEMO` | `true` affiche les comptes de démonstration. **Refus de démarrage** si `NODE_ENV=production` et `ANNUAIRE_DEMO=true`. |

## Limites et protections du serveur

| Protection | Valeur | Détail |
|---|---|---|
| Corps de requête | **10 Mo max** | La plus grosse requête légitime est l'upload photo produit (5 Mo de binaire ≈ 7 Mo en base64). Au-delà → **413** « Fichier trop volumineux. Maximum 10 Mo. » |
| Anti-brute-force PIN | 5 échecs → blocage 5 min | Par couple IP + identifiant, sur les connexions et le PIN admin. En mémoire (instance unique) — à mutualiser en base si multi-instances. |
| En-têtes HTTP | `secure-headers` | CSP, `X-Frame-Options`, `X-Content-Type-Options`, `Referrer-Policy`. |
| PIN | scrypt | Jamais en clair en base ; migration transparente à la première connexion. |

### Courses de stock (TOCTOU)

`passerCommande` vérifie la disponibilité **deux fois** : une première fois pour répondre vite aux cas évidents, puis une seconde fois **dans la transaction** avec `SELECT … FOR UPDATE` (verrou de ligne produit). Deux clients qui commandent simultanément le dernier produit sont ainsi sérialisés : le premier réserve, le second est refusé avec « Stock insuffisant pour {produit}. Disponible : {n}. » — le stock ne peut jamais devenir négatif. Couvert par `api/__tests__/stock.test.ts` (test de course réel, deux requêtes concurrentes).

## Déploiement

La plateforme exécute `/code/bootstrap` : elle démarre
`node dist/boot.js` avec son propre `node_modules` incomplet et
**n'utilise pas le Dockerfile**. Conséquences :

1. tout le runtime doit être bundlé dans `dist/boot.js`
   (d'où le build esbuild `--bundle`, sans `--external`) ;
2. aucune dépendance native n'est tolérée (d'où jimp, pas sharp) ;
3. les fichiers statiques du front sont servis par `dist/boot.js`
   lui-même depuis `dist/public` en production.

Le `Dockerfile` du dépôt reste disponible pour un déploiement Docker
autonome (build multi-étapes, migrations appliquées au démarrage via
`scripts/docker-entrypoint.sh`).

### Mise en ligne

```bash
npm ci
npm run check   # TypeScript strict
npm test        # suite vitest (nécessite DATABASE_URL de test)
npm run build   # vite build + bundle esbuild → dist/
```

Puis configurer les variables obligatoires ci-dessus sur la plateforme
et déployer. Au premier démarrage, le schéma est appliqué et le compte
super-admin est créé à partir de `ADMIN_PIN`.

## Développement

```bash
npm run dev     # Vite + API (Hono) avec rechargement à chaud
npm run lint    # ESLint
npm run db:push # pousse le schéma Drizzle vers la base de dev
```

### Règle de dépôt des tests — préfixes de fixtures

Les fichiers de test tournent **en parallèle sur une base partagée**.
Pour éviter toute collision, tout fichier de test DOIT :

1. **préfixer toutes ses fixtures** par un préfixe unique dérivé du
   nom du fichier — ex. `test_cai` (interfaces-caisse), `test_hot`
   (hotel-api), `test_taux` (taux-api), `usr_test_sec_*` (securite) ;
2. **borner ses assertions de comptage** (par acteur et/ou horodatage
   de début de test) plutôt que compter globalement ;
3. **nettoyer uniquement ses propres lignes** dans `afterAll`
   (filtre sur le préfixe ou sur les identifiants créés).

Un test qui ne respecte pas cette règle est refusé en revue, même
s'il passe isolément : c'est en parallèle qu'il casserait les autres.

Comptes de démonstration (uniquement si `ANNUAIRE_DEMO=true`, jamais en
production) : Papa Jean `+243810000001` / `1234` (propriétaire),
Mama Njoki `+243810000002` / `2345` (gérante), Marie `+243810000003` /
`3456` et Chantal `+243810000004` / `4567` (serveuses).
