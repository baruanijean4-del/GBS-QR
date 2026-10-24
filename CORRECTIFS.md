# Correctifs appliqués (audit du 24 octobre 2026)

## À FAIRE PAR TOI (je ne peux pas le faire à ta place)
1. **Rotation des secrets** : l'ancien `.env.example` contenait de vraies valeurs, présentes dans l'historique git.
   Changer : mot de passe Neon, `ADMIN_PIN`, `SESSION_SECRET`. Vérifier l'usage de `PIN_ENC_KEY` avant de la changer.
2. Ne pas repousser l'ancien historique git tel quel si le dépôt GitHub est public.
3. Lancer `npm ci && npm run check && npm test` sur ta machine (base Neon requise pour les tests API).

## Caisse — api/routers/remises.ts
- `declarer` : l'ATTENDU est calculé par le serveur (encaissements CASH `EN_MAIN` non remis de l'employé) ;
  `attenduCdf` / `attenduUsd` envoyés par le client sont ignorés. Les encaissements sont liés à la remise (`remiseId`).
- `declarer` : refuse une 2e déclaration tant qu'une est en attente ; verrou `FOR UPDATE` anti double comptage.
- `valider` : mise à jour conditionnelle (anti double validation), écart recalculé vs attendu serveur,
  motif obligatoire, alerte `ECART_REMISE`, encaissements passés `REMIS` ou `ECART`, journal avant/après.
- `contester` : uniquement une remise `EN_ATTENTE` ; auto-contestation interdite ; encaissements marqués `ECART`.
- Rôle gérant résolu aussi pour les remises créées par `notes.remettreCaisse` (clé organisation OU établissement).
- `listerEnAttente` : lit les deux conventions de clé.

## Hôtel — api/routers/hotel.ts
- `checkOut` : plus d'encaissement automatique en CASH. Paiement optionnel saisi par la réception
  (`paiement: { mode, montantCdf, montantUsd, referenceMobile }`). Sans paiement, la note reste ouverte
  (`HOTEL_CHECKOUT_IMPAYE` au journal). La réponse renvoie `resteCdf`, `resteUsd`, `noteId`.
  Plus de transaction imbriquée.
- `prendreChambreDepuisTerrasse` : chambre et session client doivent appartenir à l'établissement du QR ;
  réservation atomique `LIBRE → OCCUPEE` (plus de double réservation) ; taux figé.
- `prolongerSejour` : le séjour est celui DU CLIENT (via sa note), plus « le premier séjour de l'établissement ».
- Commentaire trompeur sur le ménage corrigé.

## Typage / build (existaient avant mes changements)
- `contracts/types.ts` : le type `DB` ne contenait pas `chambres`, `sejours`, `notes`, `noteLignes` ; ajoutés (optionnels).
  Types d'alerte `ECART_CAISSE_CRITIQUE` et `REMISE_CONTESTEE` ajoutés.
- Imports inutilisés retirés (Gerant, RemisesGerant, Caisse) ; `Pill ton="danger"` invalide → `rouge` ;
  `remisesCaisse.data` possiblement `undefined` géré.
- Tests obsolètes alignés (rôles CAISSIER/GOUVERNANTE supprimés ; ménage validé par la réception ;
  nouveau test « pas d'encaissement automatique »).

## Hygiène
- `.env.example` : placeholders uniquement.
- `.gitattributes` : fins de ligne LF (évite 29 faux fichiers modifiés).
- Retiré du zip : `node_modules`, `dist`, `.git`, `*.bundle`, clés de déploiement.

## NON corrigé (à planifier)
- Garde de module côté API (`CHAMBRES`, `BILLARD_FILE`) : non faite, car il faut tenir compte de `typesSecondaires`
  (types fusionnés) et pouvoir lancer les tests.
- Paiement au check-in + fiche « client connu » créée par le gérant ; rôles serveuse de chambres / ménage ; bi-devise hôtel.
- Snapshot staff (`chargerTout`) lit toute la base : à filtrer par établissement en SQL.
- Réservation de chambre par le client : devrait être une DEMANDE confirmée par la réception.
- Audit de Stock, Abonnements, Invitations et de `filtrerParPortee`.
- Le front envoie encore `attenduCdf/attenduUsd` (ignorés) et le check-out front n'a pas encore de formulaire de paiement :
  le solde restant se règle depuis l'écran Notes.
