// ============================================================
// GBS — Routeur tRPC « remises » : déclaration de caisse
// Règle : « Là où l'argent disparaît, GBS le voit. »
// Table existante : remises_caisse (migration 0018)
// ============================================================

import { eq } from "drizzle-orm";
import { z } from "zod";
import * as s from "@db/schema";
import { createRouter, protegee } from "../middleware";
import { alerter, db, erreur, journaliser } from "../gbsRouter";
import { exigerPermission } from "../lib/permissions";
import { maintenant, uid } from "../gbsUtils";

export const remisesRouter = createRouter({
  // ── 1. Le réceptionniste DÉCLARE sa caisse ────────────────
  declarer: protegee
    .input(z.object({
      organisationId: z.string().length(40),
      attenduCdf: z.number().int().min(0),
      attenduUsd: z.number().int().min(0),
      recuCdf: z.number().int().min(0),
      recuUsd: z.number().int().min(0),
      motifEcart: z.string().max(200).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const acteurId = ctx.session.utilisateurId;
      const role = await exigerPermission(acteurId, input.organisationId, "DECLARER_CAISSE");

      const ecartCdf = input.recuCdf - input.attenduCdf;
      const ecartUsd = input.recuUsd - input.attenduUsd;
      const aEcart = ecartCdf !== 0 || ecartUsd !== 0;

      if (aEcart && !input.motifEcart?.trim()) {
        erreur("Motif obligatoire en cas d'écart de caisse.");
      }

      const id = uid("rem");
      const le = maintenant();

      await db().insert(s.remisesCaisse).values({
        id,
        organisationId: input.organisationId,
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
          terrasseId: input.organisationId,
          avant: JSON.stringify({ attenduCdf: input.attenduCdf, attenduUsd: input.attenduUsd }),
          apres: JSON.stringify({ recuCdf: input.recuCdf, recuUsd: input.recuUsd }),
        },
      );

      if (aEcart) {
        await alerter(
          input.organisationId, "ECART_CAISSE",
          `Ecart de ${ecartCdf} CDF / ${ecartUsd} cent. USD. Motif : ${input.motifEcart ?? "-"}`,
        );
      }

      return { id, ecartCdf, ecartUsd, alerte: aEcart };
    }),

  // ── 2. Le gérant VALIDE (jamais sa propre déclaration) ────
  valider: protegee
    .input(z.object({ remiseId: z.string().length(40) }))
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

      const role = await exigerPermission(acteurId, remise.organisationId, "VALIDER_CAISSE");
      const le = maintenant();

      await db().update(s.remisesCaisse)
        .set({ statut: "VALIDE", validePar: acteurId, valideLe: le })
        .where(eq(s.remisesCaisse.id, input.remiseId));

      await journaliser(
        acteurId, role, "REMISE_VALIDEE",
        `Remise ${input.remiseId} validee. Attendu ${remise.attenduCdf} CDF / Recu ${remise.recuCdf} CDF`,
        { terrasseId: remise.organisationId },
      );

      return { ok: true };
    }),

  // ── 3. Le gérant CONTESTE ─────────────────────────────────
  contester: protegee
    .input(z.object({
      remiseId: z.string().length(40),
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

      const role = await exigerPermission(acteurId, remise.organisationId, "VALIDER_CAISSE");
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
});
