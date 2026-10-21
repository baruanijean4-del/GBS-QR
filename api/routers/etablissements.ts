// ============================================================
// GBS — Routeur tRPC « etablissements » (Étape 6)
// Création d'établissements (terrasse ou boutique), liste,
// ajout / suppression de tables (boutique : 1 seule zone).
// ============================================================

import { TRPCError } from "@trpc/server";
import { and, eq } from "drizzle-orm";
import * as s from "@db/schema";
import { createRouter, protegee } from "../middleware";
import {
  zAjouterTable, zCreerEtablissement, zListerEtablissements, zSupprimerTable,
} from "../schemas/etablissements";
import {
  ajouterTableDb, db, erreur, exigerGerantOuProprio, journaliser,
} from "../gbsRouter";
import { ajouterJours, maintenant, tokenQR, tranchePourTables, uid } from "../gbsUtils";
import { TYPES_ZONE_UNIQUE, type TypeEtablissement } from "@contracts/types";

export const etablissementsRouter = createRouter({
  /** Crée un établissement + ses tables/zone + l'abonnement ESSAI 14 j */
  creer: protegee
    .input(zCreerEtablissement)
    .mutation(async ({ input, ctx }) => {
      const acteurId = ctx.session.utilisateurId;
      // Sécurité : seul le propriétaire de l'organisation peut créer
      const [org] = await db().select().from(s.organisations)
        .where(eq(s.organisations.id, input.organisationId)).limit(1);
      if (!org) erreur("Organisation introuvable.");
      if (org.proprietaireId !== acteurId) {
        await journaliser(acteurId, null, "ACCES_REFUSE",
          `Création d'établissement tentée sur ${input.organisationId}`);
        throw new TRPCError({ code: "FORBIDDEN", message: "Seul le Propriétaire crée un établissement." });
      }

      const now = maintenant();
      const etablissementId = uid("etab");
      // Plan BOUTIQUE (5 USD/mois, zone unique « Comptoir » + QR mural) :
      // boutique, salon, autre et quincaillerie — pas seulement BOUTIQUE.
      const boutique = TYPES_ZONE_UNIQUE.includes(input.type as TypeEtablissement);
      const nbZones = boutique ? 1 : input.nombreTables;

      // Établissement
      const etablissement: typeof s.terrasses.$inferInsert = {
        id: etablissementId, organisationId: input.organisationId,
        nom: input.nom.trim(), adresse: input.adresse.trim(),
        typeEtablissement: input.type,
        tokenQrBoutique: boutique ? tokenQR() : null,
        seuilEcartCdf: 5000, seuilEcartUsd: 200, tauxUsdCdf: null, creeLe: now,
      };

      // Tables / zone unique
      const tables: (typeof s.tablesQr.$inferInsert)[] = [];
      for (let i = 1; i <= nbZones; i++) {
        tables.push({
          id: uid("tbl"), terrasseId: etablissementId, numero: i,
          tokenQr: tokenQR(), actif: true, creeLe: now, archiveLe: null,
        });
      }

      // Abonnement en ESSAI (14 jours) : ESSENTIEL terrasse / BOUTIQUE boutique
      const abonnement: typeof s.abonnements.$inferInsert = {
        id: uid("abo"), terrasseId: etablissementId,
        plan: boutique ? "BOUTIQUE" : "ESSENTIEL",
        tranche: boutique ? "PETITE" : tranchePourTables(nbZones),
        statut: "ESSAI", typeEtablissement: input.type,
        essaiFin: ajouterJours(now, 14), periodeDebut: now, periodeFin: ajouterJours(now, 14),
        annuel: false, nbTablesMaxPeriode: nbZones, prorataDu: 0, fraisInstallPayes: false,
      };

      // Le créateur est propriétaire (via l'organisation) + gérant de fait
      const affectation: typeof s.affectations.$inferInsert = {
        id: uid("aff"), utilisateurId: acteurId, terrasseId: etablissementId,
        role: "GERANT", actif: true, creeLe: now,
      };

      await db().transaction(async (tx) => {
        await tx.insert(s.terrasses).values(etablissement);
        await tx.insert(s.tablesQr).values(tables);
        await tx.insert(s.abonnements).values(abonnement);
        await tx.insert(s.affectations).values(affectation);
      });
      await journaliser(acteurId, "PROPRIETAIRE", "ETABLISSEMENT_CREE",
        `${input.nom.trim()} (${input.type}) — ${nbZones} ${boutique ? "zone" : "tables"}, essai 14 jours`);

      return { etablissement, tables, abonnement };
    }),

  /** Établissements accessibles à l'utilisateur connecté (proprio ou affecté) */
  lister: protegee
    .input(zListerEtablissements)
    .query(async ({ ctx }) => {
      const acteurId = ctx.session.utilisateurId;
      const orgs = await db().select().from(s.organisations)
        .where(eq(s.organisations.proprietaireId, acteurId));
      const affs = await db().select().from(s.affectations)
        .where(and(eq(s.affectations.utilisateurId, acteurId), eq(s.affectations.actif, true)));
      const ids = new Set([
        ...orgs.map((o) => o.id),
      ]);
      const parOrgs = orgs.length
        ? await db().select().from(s.terrasses)
        : [];
      const directes = affs.length
        ? await db().select().from(s.terrasses)
        : [];
      const visibles = new Map<string, typeof s.terrasses.$inferSelect>();
      for (const t of parOrgs) if (ids.has(t.organisationId)) visibles.set(t.id, t);
      for (const t of directes) if (affs.some((a) => a.terrasseId === t.id)) visibles.set(t.id, t);
      return [...visibles.values()];
    }),

  /** Ajoute une table (GERANT+) — refusé (403) pour une boutique */
  ajouterTable: protegee
    .input(zAjouterTable)
    .mutation(async ({ input, ctx }) => {
      const acteurId = ctx.session.utilisateurId;
      await exigerGerantOuProprio(acteurId, input.etablissementId);
      // La garde boutique (403) est dans ajouterTableDb
      return ajouterTableDb(acteurId, input.etablissementId, input.numero);
    }),

  /** Archive une table (soft delete) — GERANT+ */
  supprimerTable: protegee
    .input(zSupprimerTable)
    .mutation(async ({ input, ctx }) => {
      const acteurId = ctx.session.utilisateurId;
      const [table] = await db().select().from(s.tablesQr)
        .where(eq(s.tablesQr.id, input.tableId)).limit(1);
      if (!table) erreur("Table introuvable.");
      await exigerGerantOuProprio(acteurId, table.terrasseId);
      await db().update(s.tablesQr)
        .set({ actif: false, archiveLe: maintenant() }).where(eq(s.tablesQr.id, table.id));
      await db().update(s.tableServeuse).set({ actif: false })
        .where(and(eq(s.tableServeuse.tableId, table.id), eq(s.tableServeuse.actif, true)));
      await journaliser(acteurId, "GERANT", "TABLE_ARCHIVEE",
        `Table ${table.numero} — tranche revue à l'échéance (max de période conservé)`);
      return { ok: true as const };
    }),
});
