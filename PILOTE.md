# PILOTE — Premier établissement réel (boucle 6)

Checklist de mise en production avec UN établissement réel à
Lubumbashi. Aucune donnée de démonstration : l'instance démarre vide
(ZÉRO DÉMO), tout se crée par les écrans de l'application.

## 1. Serveur (avant toute chose)

Variables d'environnement obligatoires — le serveur REFUSE de
démarrer si l'une manque (NODE_ENV=production) :

| Variable | Exigence |
|---|---|
| `DATABASE_URL` | Neon PostgreSQL (jamais exposée côté client) |
| `APP_ID` / `APP_SECRET` | Identifiants d'application |
| `ADMIN_PIN` | 8+ caractères — super-admin plateforme (stocké en clair, jamais haché : choix produit) |
| `SESSION_SECRET` | 32+ caractères aléatoires (`openssl rand -hex 32`) |
| `ANNUAIRE_DEMO` | **NE JAMAIS POSER** — démarrage refusé sinon |

## 2. Compte propriétaire réel

1. Ouvrir l'URL de l'application → **Créer un compte**.
2. Numéro de téléphone réel du propriétaire + PIN personnel.
3. Nommer l'organisation et le premier établissement (type exact :
   terrasse, boutique, pharmacie, guest house, billard…).
4. Le plan tarifaire est calculé automatiquement ; le paiement de
   l'abonnement se déclare avec la référence du transfert (validation
   super-admin).

## 3. Établissement

1. **QR codes** : créer les zones/tables (ou billards, ou chambres)
   depuis l'écran propriétaire → imprimer et plastifier les QR.
2. **Billard** : vérifier la config (prix du token, règle du perdant,
   limite vincaire) — écran gérant, carte « Config billard ».
3. **Hôtel** : créer les chambres (numéro, type, prix nuit/heure).

## 4. Équipe

1. Le propriétaire invite chaque membre (téléphone + PIN personnel).
2. Rôles : gérant, serveuse, cuisine, réceptionniste, gouvernante.
3. Rappel : la réception ne peut PAS valider le ménage (contrôle
   croisé gouvernante) — c'est voulu.

## 5. Caisse — Airtel Money flux manuel

1. Un **numéro Airtel Money dédié** à l'établissement (affiché au
   comptoir).
2. Client : paie au numéro → colle la **référence SMS** dans
   l'application (elle est unique : impossible de la réutiliser).
3. Caissier : compare la référence affichée avec **son propre
   téléphone** avant de valider. Pas de référence = cash.
4. Chaque soir : écran gérant → **Export CSV** (billard, hôtel,
   commandes, dépenses, net du jour) — archivage comptable.

## 6. Jour J

- [ ] Serveur démarré en production (garde-fous verts)
- [ ] Compte propriétaire réel créé et connecté
- [ ] QR imprimés et posés
- [ ] Équipe invitée et connectée (chacun SON téléphone)
- [ ] Numéro Airtel Money affiché au comptoir
- [ ] Premier export CSV du soir réussi

## 7. Support

Bouton WhatsApp intégré (écran de connexion) ; journal d'audit
consultable par le propriétaire (qui, quoi, quand).
