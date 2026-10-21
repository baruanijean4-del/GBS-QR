# ANNEXE 3 : PAYER POUR QUELQU'UN — VOIE SERVEUSE (VOIE PAR DÉFAUT)

> Statut : **VALIDÉ par le propriétaire et IMPLANTÉ** (migration 0018,
> routeur `api/routers/notes.ts` — prises en charge, expiration 10 min,
> anti-abus, aucune identité du payeur exposée).

## Principe
Un client (le **payeur**) veut régler la note d'une autre table ou d'un
autre client (la **bénéficiaire**). La voie par défaut est la
**voie serveuse** : la décision est toujours prise par la bénéficiaire
elle-même, de vive voix, et enregistrée par la serveuse — jamais par
le payeur.

## 1. Flux par défaut (voie serveuse)
1. Le payeur déclare « je paie pour la table X / pour Mme Y » depuis
   son téléphone (ou à la serveuse directement).
2. La demande apparaît sur **l'écran de la serveuse de la zone** :
   lignes concernées + total, **sans identité ni téléphone** du payeur
   (la bénéficiaire n'a pas à savoir qui paie si le payeur veut rester
   discret ; la serveuse n'a pas besoin de ses coordonnées).
3. La serveuse **demande l'accord à la bénéficiaire elle-même**, puis
   appuie sur **[Acceptée par la cliente]** ou **[Refusée]**.
4. **Seuls la serveuse de la zone et le gérant** peuvent enregistrer
   cette décision. Le payeur ne peut jamais la forcer ni la modifier.
   Contrôle côté serveur (rôle + zone d'affectation).

## 2. Règles métier
- **Note bénéficiaire** : si la table bénéficiaire n'a pas de note
  ouverte, la serveuse l'ouvre au moment de la demande. Une note
  **sans lignes refuse la demande** (rien à payer = rien à accepter).
- **Lignes figées à l'acceptation** : la liste et les montants
  acceptés ne bougent plus ; toute consommation ultérieure de la
  bénéficiaire reste à sa charge.
- **Expiration** : la demande expire après **N minutes** (paramètre
  d'établissement, défaut proposé : 10 min). Si la serveuse ne répond
  pas dans le délai, la demande **remonte au gérant** (badge + alerte)
  qui peut trancher à la place.

## 3. Anti-abus
- **Alerte au gérant** si une serveuse accepte un nombre **inhabituel**
  de prises en charge (seuil par établissement, défaut proposé :
  5/jour), ou **toujours pour les mêmes clients** (même bénéficiaire
  récurrente, défaut proposé : 3 fois la même paire payeur→bénéficiaire
  sur 7 jours).
- Journal d'audit **obligatoire et non modifiable** : proposeur
  (payeur), serveuse confirmante, bénéficiaire, lignes figées, heure.

## 4. Confort (jamais une obligation)
Si la bénéficiaire **a scanné le QR**, la demande peut AUSSI apparaître
sur son téléphone pour qu'elle accepte elle-même — c'est un confort.
La voie serveuse reste la voie par défaut et suffit toujours (la
bénéficiaire sans téléphone, sans scan ou hors ligne est couverte).

## 5. Non-objectifs
- Aucun paiement en ligne : la prise en charge déplace des lignes de
  note, l'encaissement reste cash / Airtel Money manuel existant.
- Aucune identité du payeur affichée à la bénéficiaire par défaut.
