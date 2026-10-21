# DÉCISION — CONSULTATION DES PIN PAR LE SUPER-ADMIN

> Statut : DÉCISION FIGÉE. **Correctif appliqué : l'option « alerte au
> titulaire quand son PIN est consulté » (ancien point 4) est SUPPRIMÉE
> — ne pas l'implémenter, ne pas la prévoir.**
> Rappel permanent : un PIN n'est **jamais haché** (choix produit).

## Règles inchangées
1. **Stockage** : PIN chiffré **AES-256-GCM** en base (réversible —
   jamais de hachage). La clé vit dans `PIN_ENC_KEY` (serveur seul).
2. **`PIN_ENC_KEY` obligatoire en production** : démarrage refusé sans
   elle (même garde-fou qu'ADMIN_PIN / SESSION_SECRET).
3. **Recherche par téléphone** dans l'espace super-admin : on cherche
   un compte par son numéro, pas de liste en clair.
4. ~~Alerte au titulaire quand son PIN est consulté~~ **SUPPRIMÉE.**
5. **PIN masqué par défaut** (••••) ; bouton **« Afficher » valable
   30 s**, puis re-masquage automatique.
6. **Méthode de vérification d'identité obligatoire** avant affichage
   (ex. saisie d'un élément connu du titulaire, consignée).
7. **Limite de consultations par heure** par super-admin (anti-énumération).
8. **Journal d'audit non modifiable** : qui consulte, quel compte,
   quand, méthode de vérification utilisée.
9. **Le PIN n'apparaît JAMAIS** dans les journaux, les exports, les
   messages d'erreur ni Sentry (filtre systématique).

## État d'implémentation
- Super-admin : PIN en clair en base (choix produit historique,
  converge avec cette décision — sera repris sous AES-256-GCM).
- Personnel : PIN hachés scrypt aujourd'hui → **à migrer vers
  AES-256-GCM** lors de l'implémentation de cette décision (la
  vérification de connexion comparera après déchiffrement).
- Aucun code de consultation super-admin n'existe encore ; à implémenter
  selon les règles ci-dessus, SANS l'option supprimée.
