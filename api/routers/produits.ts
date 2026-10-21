// ============================================================
// GBS — Routeur tRPC « produits » (Étape 5)
// Upload de photo produit : redimensionnement via jimp
// (800×800 JPEG q75 + vignette 200×200 q70), stockage local
// uploads/produits/{terrasseId}/{produitId}/ servi par Hono.
// jimp est une librairie 100 % JavaScript : elle se bundle dans
// dist/boot.js et fonctionne sur n'importe quel runtime Node,
// contrairement à sharp (binaire natif absent de la plateforme).
// (Cloudflare R2 prévu plus tard — voir points d'attention.)
// ============================================================

import { Buffer } from "buffer";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { eq } from "drizzle-orm";
import * as s from "@db/schema";
import { createRouter, protegee } from "../middleware";
import { db, erreur, journaliser, rolesSurDb } from "../gbsRouter";
import { enregistrerPhotoProduit } from "../services/storage";

const TAILLE_MAX_OCTETS = 5 * 1024 * 1024; // 5 Mo

const zUploadPhoto = z.object({
  produitId: z.string().min(1),
  /** Image encodée en base64 (max 5 Mo une fois décodée) */
  fichierBase64: z.string().min(64),
  nomFichier: z.string().max(120).default("photo.jpg"),
});

export const produitsRouter = createRouter({
  /** Upload + traitement de la photo d'un produit (PROPRIETAIRE / GERANT) */
  uploadPhoto: protegee
    .input(zUploadPhoto)
    .mutation(async ({ input, ctx }) => {
      const acteurId = ctx.session.utilisateurId;
      const [produit] = await db().select().from(s.produits)
        .where(eq(s.produits.id, input.produitId)).limit(1);
      if (!produit) erreur("Produit introuvable.");

      // Sécurité : le rôle RESPONSABLE n'existant pas, PROPRIETAIRE ou GERANT
      const roles = await rolesSurDb(acteurId, produit.terrasseId);
      if (!roles.includes("PROPRIETAIRE") && !roles.includes("GERANT")) {
        await journaliser(acteurId, null, "ACCES_REFUSE",
          `Upload photo tenté sur ${produit.nom}`);
        throw new TRPCError({ code: "FORBIDDEN", message: "Action réservée au Gérant et au Propriétaire." });
      }

      // Décodage + garde-fou de taille (5 Mo max)
      const tampon = Buffer.from(input.fichierBase64, "base64");
      if (tampon.length > TAILLE_MAX_OCTETS) {
        erreur("Photo trop lourde : 5 Mo maximum.");
      }

      // Traitement + stockage délégués au service (jimp, avec repli
      // gracieux sur l'original si le décodage échoue).
      const photos = await enregistrerPhotoProduit(produit.terrasseId, produit.id, tampon);

      await db().update(s.produits)
        .set({
          photoUrl: photos.photoUrl,
          photoThumbnailUrl: photos.photoThumbnailUrl,
          photoSource: "UPLOAD",
        })
        .where(eq(s.produits.id, produit.id));
      await journaliser(acteurId, roles.includes("PROPRIETAIRE") ? "PROPRIETAIRE" : "GERANT",
        "PHOTO_PRODUIT",
        `${produit.nom} — photo téléversée (${photos.poidsKo} Ko${photos.traitee ? "" : ", non traitée"})`);

      return { photoUrl: photos.photoUrl, photoThumbnailUrl: photos.photoThumbnailUrl };
    }),
});
