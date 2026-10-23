// ============================================================
// GBS — Routeur tRPC « remises » : déclaration de caisse
// Règle : « Là où l'argent disparaît, GBS le voit. »
// Table existante : remises_caisse (migration 0018)
// Convention : la caisse est par TERRASSE (établissement).
// La DB utilise la colonne `organisationId` pour stocker le `terrasseId`.
// ============================================================

import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import * as s from "@db/schema";
import { createRouter, protegee } from "../middleware";
import { alerter, db, erreur, journaliser, rolesSurDb } from "../gbsRouter";
import { maintenant, uid } from "../gbsUtils";

const SEUIL_CDF_DEFAUT = 5000;
const SEUIL_USD_DEFAUT = 200;

/** Exige un rôle parmi la liste, sinon refus journalisé.
 *  Helper local — même logique que hotel.ts (non exporté globalement). */
async function exigerRole(acteurId: string, terrasseId: string, attendus: readonly string[], action: string) {
  const roles = await rolesSurDb(acteurId, terrasseId);
  if (roles.some((r) => attendus.includes(r))) {
    return roles.includes("PROPRIETAIRE") ? "PROPRIETAIRE" : roles[0];
  }
  await journaliser(acteurId, roles[0] ?? null, "PERMISSION_REFUSEE",
    `${action} tentée sans rôle habilité`, { terrasseId });
  erreur(`Action réservée : ${action.toLowerCase()}.`);
}

export const remisesRouter = createRouter({
  // ── 1. Le réceptionniste DÉCLARE sa caisse ────────────────
  declarer: protegee
    .input(z.object({
      terrasseId: z.string().min(1),
      attenduCdf: z.number().int().min(0),
      attenduUsd: z.number().int().min(0),
      recuCdf: z.number().int().min(0),
      recuUsd: z.number().int().min(0),
      motifEcart: z.string().max(200).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const acteurId = ctx.session.utilisateurId;
        const role = await exigerRole(acteurId, input.terrasseId, ["RECEPTIONNISTE", "SERVEUSE", "VENDEUR", "PHARMACIEN"], "Déclaration de caisse");

      const ecartCdf = input.recuCdf - input.attenduCdf;
      const ecartUsd = input.recuUsd - input.attenduUsd;
      const aEcart = ecartCdf !== 0 || ecartUsd !== 0;

      if (aEcart && !input.motifEcart?.trim()) {
        erreur("Motif obligatoire en cas d'écart de caisse.");
      }

      const id = uid("rem");
      const le = maintenant();

      // Insertion : la DB utilise organisationId pour stocker le terrasseId
      await db().insert(s.remisesCaisse).values({
        id,
        organisationId: input.terrasseId,  // mapping terrasse → organisation (colonne legacy)
        employeId: acteurId,
        attenduCdf: input.attenduCdf,
        attenduUsd: input.attenduUsd,
        recuCdf: input.recuCdf,
        recuUsd: input.recuUsd,
        statut: "EN_ATTENTE",
        motifEcart: input.motifEcart ?? null,
        creeLe: le,
      });

      await journaliser(
        acteurId, role, "CAISSE_DECLAREE",
        `Attendu ${input.attenduCdf} CDF / Declare ${input.recuCdf} CDF - Ecart ${ecartCdf} CDF, ${ecartUsd} cent. USD`,
        {
          terrasseId: input.terrasseId,
          avant: JSON.stringify({ attenduCdf: input.attenduCdf, attenduUsd: input.attenduUsd }),
          apres: JSON.stringify({ recuCdf: input.recuCdf, recuUsd: input.recuUsd }),
        },
      );

      if (aEcart) {
        // Seuil personnalisé par l'établissement (ou défaut)
        const [seuils] = await db()
          .select({ cdf: s.terrasses.seuilEcartCdf, usd: s.terrasses.seuilEcartUsd })
          .from(s.terrasses)
          .where(eq(s.terrasses.id, input.terrasseId))
          .limit(1);

        const seuilCdf = seuils?.cdf ?? SEUIL_CDF_DEFAUT;
        const seuilUsd = seuils?.usd ?? SEUIL_USD_DEFAUT;
        const critique = Math.abs(ecartCdf) > seuilCdf || Math.abs(ecartUsd) > seuilUsd;

        await alerter(
          input.terrasseId,
          critique ? "ECART_CAISSE_CRITIQUE" : "ECART_CAISSE",
          `Ecart ${critique ? "CRITIQUE" : ""} de ${ecartCdf} CDF / ${ecartUsd} cent. USD (seuils : ${seuilCdf}/${seuilUsd}). Motif : ${input.motifEcart ?? "-"}`,
        );
      }

      return { id, ecartCdf, ecartUsd, alerte: aEcart };
    }),

  // ── 2. Le gérant VALIDE (jamais sa propre déclaration) ────
  valider: protegee
    .input(z.object({
      remiseId: z.string().min(1),
      recuCdf: z.number().int().min(0),
      recuUsd: z.number().int().min(0),
      motifEcart: z.string().max(200).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const acteurId = ctx.session.utilisateurId;

      const [remise] = await db()
        .select()
        .from(s.remisesCaisse)
        .where(eq(s.remisesCaisse.id, input.remiseId))
        .limit(1);

      if (!remise) erreur("Remise introuvable.");
      if (remise.statut !== "EN_ATTENTE") erreur("Remise deja traitee.");
      if (remise.employeId === acteurId) {
        erreur("Auto-validation interdite : un gerant ne valide pas sa propre declaration.");
      }

      const role = await exigerRole(acteurId, remise.organisationId, ["GERANT", "PROPRIETAIRE"], "Validation de la caisse");
      const le = maintenant();

      await db().update(s.remisesCaisse)
        .set({
        statut: "VALIDE",
        validePar: acteurId,
        valideLe: le,
        recuCdf: input.recuCdf,
        recuUsd: input.recuUsd,
        motifEcart: input.motifEcart ?? remise.motifEcart,
      })
        .where(eq(s.remisesCaisse.id, input.remiseId));

      await journaliser(
        acteurId, role, "REMISE_VALIDEE",
        `Remise ${input.remiseId} validee. Attendu ${remise.attenduCdf} CDF / Recu ${input.recuCdf} CDF. Motif ecart : ${input.motifEcart ?? "-"}`,
        { terrasseId: remise.organisationId },
      );

      return { ok: true };
    }),

  // ── 3. Le gérant CONTESTE ─────────────────────────────────
  contester: protegee
    .input(z.object({
      remiseId: z.string().min(1),
      motifContest: z.string().min(5).max(200),
    }))
    .mutation(async ({ ctx, input }) => {
      const acteurId = ctx.session.utilisateurId;

      const [remise] = await db()
        .select()
        .from(s.remisesCaisse)
        .where(eq(s.remisesCaisse.id, input.remiseId))
        .limit(1);

      if (!remise) erreur("Remise introuvable.");

      const role = await exigerRole(acteurId, remise.organisationId, ["GERANT", "PROPRIETAIRE"], "Validation de la caisse");
      const le = maintenant();

      await db().update(s.remisesCaisse)
        .set({
          statut: "CONTESTE",
          validePar: acteurId,
          valideLe: le,
          motifEcart: input.motifContest,
        })
        .where(eq(s.remisesCaisse.id, input.remiseId));

      await journaliser(
        acteurId, role, "REMISE_CONTESTEE",
        `Remise ${input.remiseId} contestee : ${input.motifContest}`,
        { terrasseId: remise.organisationId },
      );

      await alerter(
        remise.organisationId, "REMISE_CONTESTEE",
        `Remise contestee : ${input.motifContest}`,
      );

      return { ok: true };
    }),

  // ── 4. Le gérant LISTE les déclarations en attente ────────
  listerEnAttente: protegee
    .input(z.object({ terrasseId: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      const acteurId = ctx.session.utilisateurId;
      await exigerRole(acteurId, input.terrasseId, ["GERANT", "PROPRIETAIRE"], "Consultation des remises en attente");

      const lignes = await db()
        .select()
        .from(s.remisesCaisse)
        .where(and(
          eq(s.remisesCaisse.organisationId, input.terrasseId),
          eq(s.remisesCaisse.statut, "EN_ATTENTE"),
        ))
        .orderBy(desc(s.remisesCaisse.creeLe))
        .limit(100);

      return lignes;
    }),

  // ── 5. Le réceptionniste LISTE ses propres déclarations ───
  listerMesDeclarations: protegee
    .input(z.object({ limite: z.number().int().min(1).max(100).default(30) }))
    .query(async ({ ctx, input }) => {
      const acteurId = ctx.session.utilisateurId;

      const lignes = await db()
        .select()
        .from(s.remisesCaisse)
        .where(eq(s.remisesCaisse.employeId, acteurId))
        .orderBy(desc(s.remisesCaisse.creeLe))
        .limit(input.limite);

      return lignes;
    }),
});
