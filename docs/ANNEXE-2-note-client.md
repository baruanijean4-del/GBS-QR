# ANNEXE 2 : NOTE CLIENT UNIQUE ET HISTORIQUE COMMUN À TOUS LES QR

> Statut : **VALIDÉ par le propriétaire et IMPLANTÉ** (migration 0018,
> routeur `api/routers/notes.ts`, contrats `contracts/notes.ts`).
>
> **Arbitrage d'implantation (§1)** : la table `espaces` proposée
> ci-dessous n'a PAS été créée (règle permanente : on ne touche pas à
> `espaces`). L'espace est porté par une étiquette sur chaque ligne de
> note (`note_lignes.espace` : TERRASSE | RESTAURANT | BILLARD | HOTEL |
> COMPTOIR, déduite du QR via `espaceDepuisQr`). La ventilation par
> espace (`note_ventilations`) est ainsi préservée sans nouvelle table,
> et la table `paiements` (abonnements SaaS) reste intacte.

## Objectif
Un client peut, dans le même lieu : acheter un token de billard, commander à la terrasse, commander au restaurant, dormir à l'hôtel, puis tout payer. Quel que soit le QR scanné (terrasse, restaurant, billard, chambre) dans la même organisation, il voit LE MÊME historique de consommation et UNE SEULE note.

## 1. Modèle : organisation > établissement > espaces
HYPOTHÈSE : un établissement peut contenir plusieurs ESPACES (TERRASSE, RESTAURANT, BILLARD, HOTEL, COMPTOIR/BOUTIQUE...). Chaque QR appartient à un espace. Les modules et le vocabulaire viennent du registre `TYPES_ETABLISSEMENT` appliqué par espace.
- Nouvelle table `espaces` (id, etablissementId, organisationId, type, nom, actif).
- `tables_qr` reçoit `espaceId`.
- Chaque ligne de vente garde son `espaceId` (pour la caisse et les rapports par espace).
- Tarification : à confirmer avec moi avant de coder (impact sur les tranches et les bouquets). Ne modifie pas le calcul des prix sans validation.

## 2. Identité du client (reconnaître la même personne sur tous les QR)
- Table `clients` (id, organisationId, prenom, telephone nullable, creeLe).
- Table `client_appareils` (clientSessionId, clientId) : plusieurs appareils pour un même client.
- Premier scan : demander le prénom. Le `clientSessionId` est stocké en localStorage. Tous les QR du même domaine partagent ce stockage, donc un second scan reconnaît automatiquement le client.
- Ne JAMAIS fusionner deux clients sur le prénom seul (deux « Jean »). L'identité = `clientSessionId` (ou téléphone vérifié).
- Récupération sur un autre téléphone ou après effacement du navigateur : le client saisit son numéro, reçoit un code (SMS ou WhatsApp ; sinon validation par la serveuse), et l'appareil est rattaché à son compte. Le téléphone est optionnel.
- Client sans téléphone (ou sans smartphone) : la serveuse ouvre la note au comptoir avec son prénom et lui donne un numéro de note.
- Confidentialité : un client ne voit que SA note. La serveuse voit la note des clients de son espace. Les notes de chambre ne sont visibles que par l'occupant, la réception et le gérant.

## 3. La note unique (folio client)
- Table `notes` (id, organisationId, clientId, sejourId nullable, statut OUVERTE | A_REGLER | REGLEE | LITIGE, ouverteLe, reglee_le, taux_change_fige nullable).
- Table `note_lignes` (id, noteId, espaceId, type COMMANDE | TOKEN_BILLARD | CHAMBRE | SERVICE | REMISE | ACOMPTE, refId, libelle, quantite, prixUnitaire, devise, statut CONFIRMEE | SERVIE | ANNULEE, creeParId, creeLe).
- À chaque scan : si le client n'a pas de note OUVERTE dans l'organisation, en créer une ; sinon la réutiliser. Toute commande, tout token et toute nuitée s'ajoute à cette note.
- Un client en chambre : sa note est rattachée au séjour (`sejourId`). Elle reste ouverte jusqu'au check-out.
- Les anciens paniers restent par espace pour la préparation (bar, cuisine, billard), mais la NOTE les regroupe pour l'affichage et le paiement.

## 4. Écran « Ma note / Mon historique » (accessible depuis le header de TOUS les QR)
- Bouton visible partout : « Ma note · 23 500 FC ».
- Contenu groupé par espace avec heure et statut de chaque ligne :
  - 🍺 Terrasse : 3 × Primus 
  - 🍽️ Restaurant : brochettes + frites
  - 🎱 Billard : token n°7 (en file / en cours / joué)
  - 🏨 Chambre 101 : 2 nuits
- Total dans UNE devise (bouton FC / $). Les prix déjà commandés gardent le taux du moment de la commande, pas de mélange de devises dans un même total.
- Lignes annulées visibles et barrées (transparence).
- Mise à jour en direct par WebSocket (canal par note).
- Historique des visites passées (notes réglées) en bas, pour les clients reconnus.

## 5. Paiement unique ET SUIVI DE L'ARGENT PHYSIQUE

### 5.0 Principe directeur (correction importante)
La recette appartient à l'ÉTABLISSEMENT, pas à la serveuse. L'application suit donc l'ARGENT PHYSIQUE : qui le détient, à chaque instant, jusqu'à sa remise à la caisse centrale. La ventilation par espace est comptable uniquement — elle ne change jamais qui détient l'argent.

### 5.1 Qui encaisse (arbitrage A avec limites)
- Tout employé autorisé de l'organisation peut encaisser : serveuse, caissier, réception.
- EXCEPTION : une note rattachée à un séjour de chambre n'est encaissée que par la réception ou le gérant.

### 5.2 Choix de l'encaisseur (arbitrage A)
- Le client paie la personne présente. PAS de liste de choix côté client.
- « Demander l'addition » alerte le personnel de l'espace où se trouve le client.
- Si personne ne répond après N minutes (configurable), l'alerte monte au gérant.

### 5.3 Client parti sans payer (arbitrage A)
- Alerte au gérant ; la note passe en statut `LITIGE` et n'est JAMAIS supprimée.
- Le gérant décide de l'imputation, avec MOTIF obligatoire, tracé dans `journal_audit`.
- AUCUNE responsabilité automatique de la serveuse.

### 5.4 Pourboire (arbitrage A pour la v1)
- Le pourboire va à l'employé qui encaisse.
- Enregistré à part (table `pourboires`), HORS chiffre d'affaires et HORS ventilation par espace.

### 5.5 Paiement en plusieurs fois (arbitrage B)
- Acompte puis reste dû, pour TOUS les espaces.
- Le reste dû s'affiche sur la note ; la note ne passe `REGLEE` qu'à solde zéro.

### 5.6 Suivi du cash : de la main de l'employé à la caisse centrale
- Table `encaissements` (noteId, encaisseParId, montant, devise, mode CASH | MOBILE_MONEY, statut EN_MAIN | REMIS | ECART, creeLe).
- Un cash encaissé reste `EN_MAIN` de l'employé tant qu'il n'est pas remis à la caisse centrale ou au gérant.
- Table `remises_caisse` : la remise est validée par le RECEVEUR, avec montant attendu vs montant reçu.
- Clôture de service : chaque employé voit « Vous devez remettre X FC » ; le gérant valide. Tout écart déclenche une ALERTE IMMÉDIATE au propriétaire.

### 5.7 Mobile money
- Paiement DÉCLARÉ par le client, puis VALIDÉ par le caissier avec la référence de transaction.
- La référence est UNIQUE : aucun doublon accepté (une référence déjà enregistrée est rejetée).
- Intégration automatique (webhooks opérateurs) : plus tard.

### 5.8 Ventilation comptable par espace
- Un paiement unique est ventilé automatiquement par espace selon les lignes (`paiements` + `paiement_ventilations`), pour que la caisse du jour de chaque espace reste juste.
- La ventilation est COMPTABLE UNIQUEMENT : elle alimente les rapports par espace, sans changer qui détient physiquement l'argent.

### 5.9 Intégrité
- `encaisseerNote` s'exécute en TRANSACTION AVEC VERROU : impossible d'encaisser deux fois la même note.
- Un client ne peut pas se déclarer « payé » seul : seul un employé autorisé encaisse (et, pour le mobile money, valide).

### 5.10 API dédiée au paiement
`demanderAddition(noteId)`, `encaisserNote(noteId, montant, mode, reference?)`, `ventilerPaiement(paiementId)`, `remettreCaisse(employeId, montant)`, `validerRemise(remiseId)`, `declarerLitige(noteId, motif)`.

### 5.11 Écrans
- Encaissement côté serveur : détail de la note par espace, boutons Cash / Mobile Money, montant reçu, rendu de monnaie calculé.
- « Ma caisse » (employé) : cash actuellement en main + bouton « Remettre ».
- Validation de remise côté gérant : attendu vs reçu, écart tracé.
- « Demander l'addition » côté client, depuis n'importe quel QR.

## 6. Règles de sécurité et anti-fraude
- Token de billard : entre dans la file seulement une fois PAYÉ. Exception configurable `token_sur_note` : autorisé pour les clients en chambre (garantis par le folio) et, si le gérant l'active, pour les clients dont la note est sous le plafond.
- Plafond de note impayée pour les clients non résidents (configurable, défaut à définir par le gérant). Au-delà, les nouvelles commandes demandent la validation d'une serveuse.
- QR de chambre actif uniquement pendant un séjour (code à 4 chiffres remis à la réception). Un QR de table peut être scanné par n'importe qui sur place, donc une commande reste « EN_ATTENTE » jusqu'à confirmation de la serveuse.
- Alerte au propriétaire : note ouverte depuis plus de N heures sans activité, client parti sans solde (voir 5.3), ligne servie non facturée, annulation après encaissement, écart de remise de caisse (voir 5.6).
- Fusion de notes : si un client a deux notes ouvertes (deux appareils), proposer la fusion avec validation de la serveuse. Journal d'audit pour toute fusion, remise ou annulation.
- Mineur ou conflit : aucune donnée personnelle (téléphone, pièce d'identité) n'est visible depuis l'écran client.

## 7. API (vérifier l'existant)
`ouvrirOuRetrouverNote`, `ajouterLigne`, `voirMaNote`, `historiqueClient`, `rattacherAppareil` (par téléphone), `fusionnerNotes`, `mettreSurNote` (restaurant, bar, billard vers le folio), `clotureNote`.
Paiement : voir 5.10 (`demanderAddition`, `encaisserNote`, `ventilerPaiement`, `remettreCaisse`, `validerRemise`, `declarerLitige` — remplacent et précisent l'ancien `enregistrerPaiement`).
Opérations de paiement et de fusion : transaction + verrou (pas de double encaissement).

## 8. Ordre de travail
1. Table `espaces` et rattachement des QR (migration à me montrer avant application).
2. `clients`, `client_appareils`, `notes`, `note_lignes`.
3. Brancher les commandes existantes, puis les tokens de billard, puis les chambres sur la note.
4. Écran « Ma note » dans le header de tous les QR.
5. Addition, paiement, suivi du cash (`encaissements`, `remises_caisse`, `pourboires`), ventilation par espace, caisse du jour (section 5).
6. Récupération par téléphone et fusion de notes.
7. Alertes et rapports.
Règles de travail inchangées : une étape à la fois, migration montrée avant application, `tsc` et ESLint, résumé en 5 lignes.
