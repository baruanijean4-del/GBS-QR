# Migrations — Nganda POS (Drizzle + Neon PostgreSQL)

Ce dossier contient les migrations SQL générées par `drizzle-kit` et le journal
(`meta/_journal.json` + snapshots) qui permet à Drizzle de savoir ce qui a déjà
été appliqué.

## Les deux situations à ne pas confondre

### 1. Base VIDE (nouvel environnement : staging, nouveau développeur…)

Utiliser les fichiers de migration de ce dossier :

```bash
npm run db:generate   # régénère les fichiers si le schéma a changé
npm run db:migrate    # applique les migrations dans l'ordre du journal
```

`0000_premium_thundra.sql` est une **baseline complète** : il crée les 24 tables
(et leurs index/contraintes) d'un coup. Il existe sous cette forme parce que la
toute première mise en route de la base a été faite avec `db:push` (qui ne laisse
pas de journal), avant que les migrations ne soient formalisées.

### 2. Base EXISTANTE (notre Neon de production/démo)

Utiliser la synchronisation directe, qui ne touche **jamais** aux données :

```bash
npm run db:push       # calcule le diff schéma ↔ base et l'applique sans perte
```

C'est la commande utilisée pour faire évoluer la base Neon actuelle.

## ⚠️ Avertissement critique

**NE JAMAIS exécuter `0000_premium_thundra.sql` (ni `npm run db:migrate`) sur la
base Neon existante.** Ce fichier contient des `CREATE TABLE` sans
`IF NOT EXISTS` : sur une base déjà remplie, PostgreSQL refusera chaque table
avec `ERROR: relation "…" already exists`. Aucune donnée ne serait détruite (le
fichier ne contient aucun `DROP`), mais la migration échouerait dès la première
table et laisserait le journal Drizzle incohérent.

Règle simple :

| État de la base | Commande |
| --- | --- |
| Vide (neuve) | `npm run db:migrate` |
| Existante (données) | `npm run db:push` |

## Vérifier l'état de synchronisation

```bash
npm run db:status     # liste les migrations connues et leur état
```

## Conventions du schéma (rappel)

- Identifiants : `varchar(40)` générés par l'application.
- Dates : `varchar(30)` ISO (fuseau Africa/Lubumbashi géré côté application).
- Montants : `integer` (CDF en francs, USD en centimes).
- Index nommés `idx_*`.
- Toute nouvelle colonne sur une table existante doit être **nullable ou avec
  valeur par défaut** (rétrocompatibilité garantie).
