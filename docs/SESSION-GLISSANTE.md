# Session « glissante » — variante préparée, NON appliquée

**Statut : proposition écrite en attente du choix du propriétaire du
produit. Aucune ligne de code n'a été modifiée.**

Contexte : aujourd'hui le jeton de session est **fixe** — il expire
12 h après sa création (`api/lib/session.ts`, `DUREE_SESSION_SECONDES
= 12 * 60 * 60`), même si l'utilisateur est actif sans interruption.
Une serveuse qui ouvre sa session à 10 h est déconnectée à 22 h
pile, en plein service si la soirée démarre tard.

## 1. Comportement proposé

| Règle | Valeur proposée | Configurable ? |
|---|---|---|
| Expiration par **inactivité** | 12 h sans aucune requête authentifiée | oui (`SESSION_INACTIVITE_SECONDES`, défaut 43 200) |
| Durée **absolue maximale** | 7 jours depuis la connexion, quelle que soit l'activité | oui (`SESSION_DUREE_MAX_SECONDES`, défaut 604 800) |
| **Révocation par appareil** | chaque session porte un `appareilId` ; le propriétaire peut révoquer un appareil perdu sans toucher les autres | — |

Glissement concret : à chaque requête authentifiée, si le jeton est
valide, le serveur le **prolonge** — la nouvelle expiration est
`maintenant + inactivité`, plafonnée à `iat + durée max absolue`.
Le client remplace silencieusement son jeton quand l'en-tête de
réponse en annonce un nouveau.

## 2. Changements techniques (résumé)

1. **Table `sessions_appareils`** (migration dédiée, à montrer avant
   application) : `id`, `utilisateur_id`, `appareil_id` (empreinte
   locale générée par l'appareil), `cree_le`, `derniere_activite_le`,
   `expire_absolu_le`, `revoque_le` (nullable).
2. **Payload du jeton** : ajout de `sid` (identifiant de la ligne
   `sessions_appareils`) — le jeton reste signé HMAC, les rôles
   restent relus en base à chaque requête.
3. **Vérification** (`verifierJeton`) : signature + expiration comme
   aujourd'hui, **plus** lecture de la ligne `sid` : refus si
   `revoque_le` non nul ou si `maintenant > expire_absolu_le` ;
   sinon mise à jour de `derniere_activite_le` (une écriture par
   requête — voir risque R2).
4. **Prolongation** : si le jeton expire dans moins de la moitié de
   la fenêtre d'inactivité, le serveur en émet un nouveau (même
   `sid`, même `iat`, `exp` glissé, plafonné à l'absolu) et le
   renvoie dans l'en-tête `X-Session-Renouvelee`.
5. **Révocation** : procédure `revoquerAppareil` (propriétaire ou
   l'utilisateur lui-même) → pose `revoque_le` ; la coupure est
   **immédiate** à la requête suivante (comme la révocation de rôle
   actuelle).
6. **Client** : stocke l'`appareilId` (localStorage, généré une
   fois) ; remplace le jeton quand l'en-tête de prolongation est
   présent ; aucune interface nouvelle obligatoire hors écran
   « Appareils connectés » du propriétaire.

## 3. Risques

- **R1 — Vol de jeton prolongeable.** Un jeton volé reste valable
  tant que l'attaquant l'utilise (l'inactivité ne le tue que s'il
  cesse de s'en servir). *Atténuations :* durée absolue maximale de
  7 jours ; révocation par appareil ; les rôles restent relus en
  base (une affectation supprimée coupe tout, comme aujourd'hui).
- **R2 — Une écriture base par requête authentifiée** (mise à jour
  de `derniere_activite_le`). *Atténuation :* n'écrire que si la
  dernière activité date de plus de 60 s (précision suffisante pour
  une fenêtre de 12 h).
- **R3 — Déconnexion en cours de service évitée… mais oubli de
  déconnexion facilité.** Une session glissante sur un téléphone
  partagé reste vivante 12 h après le dernier geste. *Atténuation :*
  bouton « Terminer ma session » mis en avant ; l'écran
  « Appareils connectés » permet au propriétaire de couper à
  distance.
- **R4 — Migration de schéma** (nouvelle table) : rejouable
  (IF NOT EXISTS), montrée avant application, appliquée d'abord sur
  une branche Neon comme la 0016.

## 4. Retour arrière

- Drapeau d'activation `SESSION_GLISSANTE=1` (défaut : **absent =
  comportement actuel, fixe 12 h**). Couper le drapeau suffit à
  revenir au jeton fixe : `verifierJeton` ignore alors `sid` et la
  table n'est plus lue.
- Les jetons émis en mode glissant restent vérifiables en mode fixe
  (le `sid` en plus est ignoré ; seuls `iat`/`exp` comptent) —
  **aucune déconnexion massive au retour arrière**.
- La table `sessions_appareils` peut être supprimée par une
  migration de retour (`DROP TABLE IF EXISTS`), sans toucher aux
  autres tables.

## 5. Décision attendue

1. Appliquer la session glissante telle que décrite (avec migration
   montrée avant application) ?
2. Valeurs retenues : inactivité 12 h / absolu 7 jours, ou d'autres ?
3. Écran « Appareils connectés » du propriétaire dans la même
   livraison, ou plus tard ?
