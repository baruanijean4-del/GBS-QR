// ============================================================
// GBS — Routeur tRPC « photos » : les photos sont TOUJOURS des URL
//
// 1. Le gérant ou le propriétaire de l'établissement DEMANDE une photo
//    pour un produit ou une chambre (demander).
// 2. Le super-admin voit les demandes (listerAdmin), colle l'adresse de
//    l'image et valide — ou refuse avec un motif (traiter).
// 3. Validée, la photo apparaît côté client et côté établissement
//    (produits.photo_url / chambres.photo_url, déjà lus par le snapshot).
//
// Aucune image n'est stockée par l'application : les photos sont
// préparées à l'installation avec un outil extérieur (voir docs/PHOTOS.md).
// ============================================================

import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { and, desc, eq, inArray } from "drizzle-orm";
import * as s from "@db/schema";
import { urlPhotoValide } from "@contracts/photos";
import { createRouter, protegee, publicQuery } from "../middleware";
import { db, erreur, exigerGerantOuProprio, journaliser } from "../gbsRouter";
import { env } from "../lib/env";
import { comparerSecret } from "../lib/pin";
import { enregistrerEchec, reinitialiserEchecs, tentativePermise } from "../lib/limiteur";
import { maintenant, uid } from "../gbsUtils";

/** PIN super-admin vérifié à temps constant, avec blocage après 5 échecs (par IP). */
function exigerSuperAdmin(pin: string, ip: string): void {
  const cle = `admin:${ip}`;
  const attenteMin = tentativePermise(cle);
  if (attenteMin !== null) erreur(`Trop de tentatives — réessayez dans ${attenteMin} min.`);
  if (!comparerSecret(pin, env.adminPin)) {
    enregistrerEchec(cle);
    throw new TRPCError({ code: "FORBIDDEN", message: "Accès super-admin refusé : PIN incorrect." });
  }
  reinitialiserEchecs(cle);
}

/** Cible d'une demande : établissement propriétaire + libellé lisible. */
async function resoudreCible(cible: "PRODUIT" | "CHAMBRE", cibleId: string): Promise<{ terrasseId: string; libelle: string }> {
  if (cible === "PRODUIT") {
    const [p] = await db().select({ terrasseId: s.produits.terrasseId, nom: s.produits.nom })
      .from(s.produits).where(eq(s.produits.id, cibleId)).limit(1);
    if (!p) erreur("Produit introuvable.");
    return { terrasseId: p.terrasseId, libelle: p.nom };
  }
  const [c] = await db().select({ terrasseId: s.chambres.terrasseId, numero: s.chambres.numero })
    .from(s.chambres).where(eq(s.chambres.id, cibleId)).limit(1);
  if (!c) erreur("Chambre introuvable.");
  return { terrasseId: c.terrasseId, libelle: `Chambre ${c.numero}` };
}

export const photosRouter = createRouter({
  /** Gérant / propriétaire : demande une photo pour un produit ou une chambre. */
  demander: protegee
    .input(z.object({
      cible: z.enum(["PRODUIT", "CHAMBRE"]),
      cibleId: z.string().min(1),
      note: z.string().trim().max(300).optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const acteurId = ctx.session.utilisateurId;
      const { terrasseId, libelle } = await resoudreCible(input.cible, input.cibleId);
      const role = await exigerGerantOuProprio(acteurId, terrasseId);
      // L'index unique partiel (une seule demande EN_ATTENTE par cible) tranche
      // aussi les doubles clics simultanés : le second insert ne renvoie rien.
      const id = uid("dph");
      const [cree] = await db().insert(s.demandesPhoto).values({
        id, terrasseId, cible: input.cible, cibleId: input.cibleId, demandeurId: acteurId,
        note: input.note || null, statut: "EN_ATTENTE", creeLe: maintenant(),
      }).onConflictDoNothing().returning({ id: s.demandesPhoto.id });
      if (!cree) erreur("Une demande de photo est déjà en attente pour cet élément.");
      await journaliser(acteurId, role, "PHOTO_DEMANDEE", `${libelle} — demande de photo`, { terrasseId });
      return { id };
    }),

  /** Gérant / propriétaire : ses demandes (en attente, validées, refusées). */
  mesDemandes: protegee
    .input(z.object({ terrasseId: z.string().min(1) }))
    .query(async ({ input, ctx }) => {
      await exigerGerantOuProprio(ctx.session.utilisateurId, input.terrasseId);
      return db().select({
        id: s.demandesPhoto.id, cible: s.demandesPhoto.cible, cibleId: s.demandesPhoto.cibleId,
        note: s.demandesPhoto.note, statut: s.demandesPhoto.statut, url: s.demandesPhoto.url,
        motifRefus: s.demandesPhoto.motifRefus, creeLe: s.demandesPhoto.creeLe, traiteLe: s.demandesPhoto.traiteLe,
      }).from(s.demandesPhoto)
        .where(eq(s.demandesPhoto.terrasseId, input.terrasseId))
        .orderBy(desc(s.demandesPhoto.creeLe)).limit(200);
    }),

  /** Gérant / propriétaire : retire une demande encore en attente. */
  annuler: protegee
    .input(z.object({ demandeId: z.string().min(1) }))
    .mutation(async ({ input, ctx }) => {
      const acteurId = ctx.session.utilisateurId;
      const [d] = await db().select().from(s.demandesPhoto).where(eq(s.demandesPhoto.id, input.demandeId)).limit(1);
      if (!d) erreur("Demande introuvable.");
      const role = await exigerGerantOuProprio(acteurId, d.terrasseId);
      const [maj] = await db().update(s.demandesPhoto)
        .set({ statut: "ANNULEE", traiteLe: maintenant(), traitePar: acteurId })
        .where(and(eq(s.demandesPhoto.id, d.id), eq(s.demandesPhoto.statut, "EN_ATTENTE")))
        .returning({ id: s.demandesPhoto.id });
      if (!maj) erreur("Demande déjà traitée.");
      await journaliser(acteurId, role, "PHOTO_DEMANDE_ANNULEE", `Demande ${d.id} annulée`, { terrasseId: d.terrasseId });
      return { ok: true as const };
    }),

  /** Super-admin : les demandes en attente, avec de quoi décider (qui, quoi, photo actuelle). */
  listerAdmin: publicQuery
    .input(z.object({ pinAdmin: z.string() }))
    .query(async ({ input, ctx }) => {
      exigerSuperAdmin(input.pinAdmin, ctx.ip);
      const demandes = await db().select().from(s.demandesPhoto)
        .where(eq(s.demandesPhoto.statut, "EN_ATTENTE"))
        .orderBy(s.demandesPhoto.creeLe).limit(200);
      if (demandes.length === 0) return [];

      const idsProduits = demandes.filter((d) => d.cible === "PRODUIT").map((d) => d.cibleId);
      const idsChambres = demandes.filter((d) => d.cible === "CHAMBRE").map((d) => d.cibleId);
      const [produits, chambres, terrasses, demandeurs] = await Promise.all([
        idsProduits.length ? db().select({ id: s.produits.id, nom: s.produits.nom, photoUrl: s.produits.photoUrl })
          .from(s.produits).where(inArray(s.produits.id, idsProduits)) : Promise.resolve([]),
        idsChambres.length ? db().select({ id: s.chambres.id, numero: s.chambres.numero, photoUrl: s.chambres.photoUrl })
          .from(s.chambres).where(inArray(s.chambres.id, idsChambres)) : Promise.resolve([]),
        db().select({ id: s.terrasses.id, nom: s.terrasses.nom })
          .from(s.terrasses).where(inArray(s.terrasses.id, [...new Set(demandes.map((d) => d.terrasseId))])),
        db().select({ id: s.utilisateurs.id, nom: s.utilisateurs.nom })
          .from(s.utilisateurs).where(inArray(s.utilisateurs.id, [...new Set(demandes.map((d) => d.demandeurId))])),
      ]);
      const parId = <T extends { id: string }>(l: T[]) => new Map(l.map((x) => [x.id, x]));
      const mP = parId(produits);
      const mC = parId(chambres);
      const mT = parId(terrasses);
      const mU = parId(demandeurs);
      return demandes.map((d) => {
        const p = d.cible === "PRODUIT" ? mP.get(d.cibleId) : undefined;
        const c = d.cible === "CHAMBRE" ? mC.get(d.cibleId) : undefined;
        return {
          id: d.id, cible: d.cible as "PRODUIT" | "CHAMBRE", note: d.note, creeLe: d.creeLe,
          libelle: p ? p.nom : c ? `Chambre ${c.numero}` : "—",
          photoActuelle: (p?.photoUrl ?? c?.photoUrl) ?? null,
          etablissement: mT.get(d.terrasseId)?.nom ?? "—",
          demandeur: mU.get(d.demandeurId)?.nom ?? "—",
        };
      });
    }),

  /** Super-admin : valide (avec l'URL collée) ou refuse (avec un motif). */
  traiter: publicQuery
    .input(z.object({
      pinAdmin: z.string(),
      demandeId: z.string().min(1),
      decision: z.enum(["VALIDEE", "REFUSEE"]),
      url: z.string().trim().optional(),
      motif: z.string().trim().max(200).optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      exigerSuperAdmin(input.pinAdmin, ctx.ip);
      const [d] = await db().select().from(s.demandesPhoto).where(eq(s.demandesPhoto.id, input.demandeId)).limit(1);
      if (!d) erreur("Demande introuvable.");
      if (d.statut !== "EN_ATTENTE") erreur("Demande déjà traitée.");

      if (input.decision === "REFUSEE") {
        if (!input.motif) erreur("Motif obligatoire pour refuser une demande de photo.");
        const [maj] = await db().update(s.demandesPhoto)
          .set({ statut: "REFUSEE", motifRefus: input.motif, traiteLe: maintenant(), traitePar: "super_admin" })
          .where(and(eq(s.demandesPhoto.id, d.id), eq(s.demandesPhoto.statut, "EN_ATTENTE")))
          .returning({ id: s.demandesPhoto.id });
        if (!maj) erreur("Demande déjà traitée.");
        await journaliser("super_admin", "SUPER_ADMIN", "PHOTO_REFUSEE", `Demande ${d.id} refusée — ${input.motif}`, { terrasseId: d.terrasseId });
        return { ok: true as const };
      }

      const url = input.url ?? "";
      if (!urlPhotoValide(url)) erreur("L'adresse de la photo doit être un lien https:// valide (500 caractères maximum).");
      await db().transaction(async (tx) => {
        // Mise à jour conditionnelle : une seule validation peut réussir
        const [maj] = await tx.update(s.demandesPhoto)
          .set({ statut: "VALIDEE", url, traiteLe: maintenant(), traitePar: "super_admin" })
          .where(and(eq(s.demandesPhoto.id, d.id), eq(s.demandesPhoto.statut, "EN_ATTENTE")))
          .returning({ id: s.demandesPhoto.id });
        if (!maj) erreur("Demande déjà traitée.");
        if (d.cible === "PRODUIT") {
          // Une seule adresse : la même image sert de vignette (l'hébergeur la redimensionne si besoin)
          await tx.update(s.produits).set({ photoUrl: url, photoThumbnailUrl: url, photoSource: "URL" })
            .where(eq(s.produits.id, d.cibleId));
        } else {
          await tx.update(s.chambres).set({ photoUrl: url }).where(eq(s.chambres.id, d.cibleId));
        }
      });
      await journaliser("super_admin", "SUPER_ADMIN", "PHOTO_VALIDEE", `Demande ${d.id} validée`, { terrasseId: d.terrasseId });
      return { ok: true as const };
    }),
});
