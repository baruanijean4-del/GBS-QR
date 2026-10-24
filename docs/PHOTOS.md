# Photos : toujours une adresse (URL)

L'application **ne stocke aucune image**. Une photo de produit ou de chambre est
toujours l'adresse (`https://…`) d'une image hébergée ailleurs. Il n'y a plus
d'envoi de fichier : le disque du serveur est effacé à chaque redéploiement, une
photo envoyée disparaissait.

## Le circuit

1. **Demande.** Le gérant ou le propriétaire ouvre un produit (onglet Carte) ou une
   chambre (onglet Hôtel) et touche **« Demander une photo »** (avec, si besoin, une
   précision : « bouteille de face, fond blanc »). Une seule demande en attente par
   produit ou chambre ; il peut l'annuler tant qu'elle n'est pas traitée.
2. **Validation.** Le super-admin ouvre l'onglet **Photos** : pour chaque demande il voit
   l'établissement, le demandeur, le produit ou la chambre, la note et la photo actuelle.
   Il **colle l'adresse** de l'image, contrôle l'aperçu, puis **Valide** — ou **Refuse**
   avec un motif (affiché au demandeur, qui peut redemander).
3. **Affichage.** À la validation, l'adresse est écrite sur le produit
   (`produits.photo_url`, aussi utilisée comme vignette) ou la chambre
   (`chambres.photo_url`). Le menu du client et les écrans de l'établissement la
   lisent au prochain rafraîchissement (quelques secondes).

## Préparer les photos (à l'installation)

Prendre les photos, les envoyer vers un **hébergeur d'images de votre choix** (gratuit
ou non) et copier l'adresse directe de l'image. L'application n'impose aucun
hébergeur. Conseils :

- une image de **800 × 800 px au plus**, en JPEG ou WebP : légère pour les réseaux
  mobiles ;
- un lien **stable** (si l'hébergeur supprime l'image, la photo disparaît) ;
- un lien **https://** direct vers l'image (qui se termine par `.jpg`, `.png`, `.webp`…),
  pas vers une page web.

## Règles vérifiées par le serveur

- Adresse en **https://**, 500 caractères au plus, sans identifiant dans le lien
  (`contracts/photos.ts` → `urlPhotoValide`, aussi utilisé par l'écran du super-admin).
- Seuls le **gérant** et le **propriétaire** de l'établissement demandent ; seul le
  **super-admin** (PIN) valide.
- Une photo en base ne change **que** par une demande validée (ni le gérant ni le
  propriétaire ne posent plus d'adresse eux-mêmes). Les photos du catalogue
  (code-barres) à la création d'un produit restent possibles.
- Journal d'audit : `PHOTO_DEMANDEE`, `PHOTO_VALIDEE`, `PHOTO_REFUSEE`.

## Mise en production

La table `demandes_photo` vient avec la migration **0021**
(`db/migrations/0021_demandes-photo.sql`). En production le serveur refuse de
démarrer si une migration manque : lancer `npm run db:migrate` **avant** de déployer.

Les photos déjà téléversées avant ce changement (`/uploads/…`, `photo_source = UPLOAD`)
continuent de s'afficher tant que le fichier existe ; pour les remplacer, faire une
demande de photo.
