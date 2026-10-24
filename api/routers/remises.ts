// ============================================================
// GBS — Routeur tRPC « remises » : déclaration de caisse
// Règle : « Là où l'argent disparaît, GBS le voit. »
// Table existante : remises_caisse (migration 0018)
// Convention : la caisse est par TERRASSE (établissement).
// La DB utilise la colonne `organisationId` pour stocker le `terrasseId`.
// ============================================================

import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import * as s from "@db/schema";
import { createRouter, protegee } from "../middleware";
import { alerter, db, erreur, journaliser, rolesSurDb } from "../gbsRouter";
import { maintenant, uid } from "../gbsUtils";
import { exigerProprietaireSiRemiseDeGerantDb } from "./notes";
import type { RoleActif } from "@contracts/types";

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


/** Une remise stocke dans `organisation_id` soit un id d'ÉTABLISSEMENT (ancien
 *  flux de ce routeur, relu tel quel par le snapshot front), soit un id
 *  d'ORGANISATION (flux notes.remettreCaisse). Cette fonction résout les deux. */
async function terrassesDeRemise(cle: string): Promise<{ id: string; organisationId: string }[]> {
  const parId = await db().select({ id: s.terrasses.id, organisationId: s.terrasses.organisationId })
    .from(s.terrasses).where(eq(s.terrasses.id, cle));
  if (parId.length > 0) return parId;
  return db().select({ id: s.terrasses.id, organisationId: s.terrasses.organisationId })
    .from(s.terrasses).where(eq(s.terrasses.organisationId, cle));
}

/** Exige un rôle de gérance sur AU MOINS un établissement de la remise. */
async function exigerGeranceRemise(acteurId: string, cle: string, action: string) {
  const terrasses = await terrassesDeRemise(cle);
  if (terrasses.length === 0) erreur("Établissement de la remise introuvable.");
  for (const t of terrasses) {
    const roles = await rolesSurDb(acteurId, t.id);
    if (roles.some((r) => r === "GERANT" || r === "PROPRIETAIRE")) {
      return { role: (roles.includes("PROPRIETAIRE") ? "PROPRIETAIRE" : "GERANT") as RoleActif, terrasseId: t.id };
    }
  }
  await journaliser(acteurId, null, "PERMISSION_REFUSEE", `${action} tentée sans rôle habilité`,
    { terrasseId: terrasses[0].id });
  erreur(`Action réservée : ${action.toLowerCase()}.`);
}

export const remisesRouter = createRouter({
  // ── 1. L'employé DÉCLARE sa caisse ────────────────────────
  // SÉCURITÉ : le montant ATTENDU est calculé ICI, côté serveur, à partir
  // des encaissements CASH « en main » de l'employé. Les champs
  // attenduCdf / attenduUsd envoyés par d'anciens clients sont IGNORÉS.
  declarer: protegee
    .input(z.object({
      terrasseId: z.string().min(1),
      /** @deprecated ignoré : calculé par le serveur. */
      attenduCdf: z.number().int().min(0).optional(),
      /** @deprecated ignoré : calculé par le serveur. */
      attenduUsd: z.number().int().min(0).optional(),
      recuCdf: z.number().int().min(0),
      recuUsd: z.number().int().min(0),
      motifEcart: z.string().max(200).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const acteurId = ctx.session.utilisateurId;
      const role = await exigerRole(acteurId, input.terrasseId, ["RECEPTIONNISTE", "SERVEUSE", "VENDEUR", "PHARMACIEN"], "Déclaration de caisse");

      const [terrasse] = await db().select().from(s.terrasses)
        .where(eq(s.terrasses.id, input.terrasseId)).limit(1);
      if (!terrasse) erreur("Établissement introuvable.");

      // Une déclaration en attente couvre déjà le cash en main.
      const [enAttente] = await db().select({ id: s.remisesCaisse.id }).from(s.remisesCaisse)
        .where(and(
          eq(s.remisesCaisse.employeId, acteurId),
          inArray(s.remisesCaisse.organisationId, [input.terrasseId, terrasse.organisationId]),
          eq(s.remisesCaisse.statut, "EN_ATTENTE"),
        )).limit(1);
      if (enAttente) erreur("Une déclaration est déjà en attente de validation par le gérant.");

      const id = uid("rem");
      const le = maintenant();

      // Transaction : calcul de l'attendu + liaison des encaissements, sous
      // verrou (deux déclarations simultanées ne peuvent pas compter deux
      // fois le même cash).
      const { attenduCdf, attenduUsd } = await db().transaction(async (tx) => {
        const enMain = await tx.select().from(s.encaissements)
          .where(and(
            eq(s.encaissements.encaisseParId, acteurId),
            eq(s.encaissements.organisationId, terrasse.organisationId),
            eq(s.encaissements.statut, "EN_MAIN"),
            eq(s.encaissements.mode, "CASH"),
            sql`${s.encaissements.remiseId} IS NULL`,
          )).for("update");
        const attCdf = enMain.reduce((x, e) => x + e.montantCdf, 0);
        const attUsd = enMain.reduce((x, e) => x + e.montantUsd, 0);
        if (enMain.length === 0 && input.recuCdf === 0 && input.recuUsd === 0) {
          erreur("Aucun cash en main à déclarer.");
        }
        const ecC = input.recuCdf - attCdf;
        const ecU = input.recuUsd - attUsd;
        if ((ecC !== 0 || ecU !== 0) && !input.motifEcart?.trim()) {
          erreur("Motif obligatoire en cas d'écart de caisse.");
        }
        // Convention conservée : `organisation_id` = id de l'établissement
        // (relu ainsi par le snapshot front).
        await tx.insert(s.remisesCaisse).values({
          id, organisationId: input.terrasseId, employeId: acteurId,
          attenduCdf: attCdf, attenduUsd: attUsd,
          recuCdf: input.recuCdf, recuUsd: input.recuUsd,
          statut: "EN_ATTENTE", motifEcart: input.motifEcart?.trim() || null, creeLe: le,
        });
        if (enMain.length > 0) {
          await tx.update(s.encaissements).set({ remiseId: id })
            .where(inArray(s.encaissements.id, enMain.map((e) => e.id)));
        }
        return { attenduCdf: attCdf, attenduUsd: attUsd };
      });

      const ecartCdf = input.recuCdf - attenduCdf;
      const ecartUsd = input.recuUsd - attenduUsd;
      const aEcart = ecartCdf !== 0 || ecartUsd !== 0;

      await journaliser(
        acteurId, role, "CAISSE_DECLAREE",
        `Attendu ${attenduCdf} CDF / ${attenduUsd} cent. USD — déclaré ${input.recuCdf} CDF / ${input.recuUsd} cent. USD — écart ${ecartCdf} CDF, ${ecartUsd} cent. USD`,
        {
          terrasseId: input.terrasseId,
          avant: JSON.stringify({ attenduCdf, attenduUsd }),
          apres: JSON.stringify({ recuCdf: input.recuCdf, recuUsd: input.recuUsd }),
        },
      );

      if (aEcart) {
        const seuilCdf = terrasse.seuilEcartCdf ?? SEUIL_CDF_DEFAUT;
        const seuilUsd = terrasse.seuilEcartUsd ?? SEUIL_USD_DEFAUT;
        const critique = Math.abs(ecartCdf) > seuilCdf || Math.abs(ecartUsd) > seuilUsd;
        await alerter(
          input.terrasseId,
          critique ? "ECART_CAISSE_CRITIQUE" : "ECART_CAISSE",
          `Ecart ${critique ? "CRITIQUE " : ""}de ${ecartCdf} CDF / ${ecartUsd} cent. USD (seuils : ${seuilCdf}/${seuilUsd}). Motif : ${input.motifEcart ?? "-"}`,
        );
      }

      return { id, ecartCdf, ecartUsd, alerte: aEcart, attenduCdf, attenduUsd };
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

      const [remise] = await db().select().from(s.remisesCaisse)
        .where(eq(s.remisesCaisse.id, input.remiseId)).limit(1);
      if (!remise) erreur("Remise introuvable.");
      if (remise.statut !== "EN_ATTENTE") erreur("Remise deja traitee.");
      if (remise.employeId === acteurId) {
        erreur("Auto-validation interdite : on ne valide pas sa propre declaration.");
      }

      const { role, terrasseId } = await exigerGeranceRemise(acteurId, remise.organisationId, "Validation de la caisse");
      await exigerProprietaireSiRemiseDeGerantDb(acteurId, remise.employeId, remise.organisationId);

      // Écart = comptage du gérant vs attendu calculé par le serveur.
      const ecartCdf = input.recuCdf - remise.attenduCdf;
      const ecartUsd = input.recuUsd - remise.attenduUsd;
      const aEcart = ecartCdf !== 0 || ecartUsd !== 0;
      const motif = (input.motifEcart ?? remise.motifEcart ?? "").trim();
      if (aEcart && !motif) erreur("Un écart exige un motif.");
      const le = maintenant();

      await db().transaction(async (tx) => {
        // Mise à jour CONDITIONNELLE : une seule validation peut réussir.
        const [maj] = await tx.update(s.remisesCaisse)
          .set({
            statut: "VALIDE", validePar: acteurId, valideLe: le,
            recuCdf: input.recuCdf, recuUsd: input.recuUsd,
            motifEcart: aEcart ? motif : null,
          })
          .where(and(eq(s.remisesCaisse.id, remise.id), eq(s.remisesCaisse.statut, "EN_ATTENTE")))
          .returning({ id: s.remisesCaisse.id });
        if (!maj) erreur("Remise deja traitee.");
        // Le cash quitte la poche de l'employé (REMIS) ou est marqué ECART.
        await tx.update(s.encaissements)
          .set({ statut: aEcart ? "ECART" : "REMIS", remisLe: le })
          .where(eq(s.encaissements.remiseId, remise.id));
        // Versement du gérant : le cash arrive chez le propriétaire (VERSE).
        await tx.update(s.encaissements)
          .set({ statut: aEcart ? "ECART" : "VERSE", remisLe: le })
          .where(eq(s.encaissements.versementId, remise.id));
      });

      if (aEcart) {
        await alerter(terrasseId, "ECART_REMISE",
          `Écart à la validation : attendu ${remise.attenduCdf} FC / ${remise.attenduUsd} ¢, compté ${input.recuCdf} FC / ${input.recuUsd} ¢ — ${motif}`);
      }
      await journaliser(
        acteurId, role, aEcart ? "REMISE_ECART" : "REMISE_VALIDEE",
        `Remise ${remise.id} : attendu ${remise.attenduCdf}/${remise.attenduUsd}, compté ${input.recuCdf}/${input.recuUsd}${aEcart ? ` — motif : ${motif}` : ""}`,
        {
          terrasseId,
          avant: JSON.stringify({ declareCdf: remise.recuCdf, declareUsd: remise.recuUsd }),
          apres: JSON.stringify({ recuCdf: input.recuCdf, recuUsd: input.recuUsd }),
        },
      );
      return { ok: true, ecart: aEcart };
    }),

  // ── 3. Le gérant CONTESTE (uniquement une remise EN_ATTENTE) ─
  contester: protegee
    .input(z.object({
      remiseId: z.string().min(1),
      motifContest: z.string().min(5).max(200),
    }))
    .mutation(async ({ ctx, input }) => {
      const acteurId = ctx.session.utilisateurId;

      const [remise] = await db().select().from(s.remisesCaisse)
        .where(eq(s.remisesCaisse.id, input.remiseId)).limit(1);
      if (!remise) erreur("Remise introuvable.");
      if (remise.statut !== "EN_ATTENTE") erreur("Remise deja traitee : elle ne peut plus etre contestee.");
      if (remise.employeId === acteurId) erreur("Auto-contestation interdite.");

      const { role, terrasseId } = await exigerGeranceRemise(acteurId, remise.organisationId, "Validation de la caisse");
      await exigerProprietaireSiRemiseDeGerantDb(acteurId, remise.employeId, remise.organisationId);
      const le = maintenant();

      const [maj] = await db().update(s.remisesCaisse)
        .set({ statut: "CONTESTE", validePar: acteurId, valideLe: le, motifEcart: input.motifContest })
        .where(and(eq(s.remisesCaisse.id, input.remiseId), eq(s.remisesCaisse.statut, "EN_ATTENTE")))
        .returning({ id: s.remisesCaisse.id });
      if (!maj) erreur("Remise deja traitee : elle ne peut plus etre contestee.");
      // Le cash reste suivi : marqué ECART (jamais libéré sans décision).
      await db().update(s.encaissements).set({ statut: "ECART" })
        .where(eq(s.encaissements.remiseId, remise.id));
      await db().update(s.encaissements).set({ statut: "ECART" })
        .where(eq(s.encaissements.versementId, remise.id));

      await journaliser(acteurId, role, "REMISE_CONTESTEE",
        `Remise ${input.remiseId} contestee : ${input.motifContest}`, { terrasseId });
      await alerter(terrasseId, "REMISE_CONTESTEE", `Remise contestee : ${input.motifContest}`);
      return { ok: true };
    }),

  // ── 4. Le gérant LISTE les déclarations en attente ────────
  listerEnAttente: protegee
    .input(z.object({ terrasseId: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      const acteurId = ctx.session.utilisateurId;
      await exigerRole(acteurId, input.terrasseId, ["GERANT", "PROPRIETAIRE"], "Consultation des remises en attente");
      const [terrasse] = await db().select({ organisationId: s.terrasses.organisationId })
        .from(s.terrasses).where(eq(s.terrasses.id, input.terrasseId)).limit(1);
      const cles = terrasse ? [input.terrasseId, terrasse.organisationId] : [input.terrasseId];

      return db().select().from(s.remisesCaisse)
        .where(and(
          inArray(s.remisesCaisse.organisationId, cles),
          eq(s.remisesCaisse.statut, "EN_ATTENTE"),
        ))
        .orderBy(desc(s.remisesCaisse.creeLe))
        .limit(100);
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
