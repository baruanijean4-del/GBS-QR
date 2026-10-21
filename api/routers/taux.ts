// ============================================================
// GBS — Taux de change USD/FC par établissement (règle figée,
// docs/REGLE-TAUX-CHANGE.md, migration 0016).
//
// Règles serveur :
//  - taux FACULTATIF et propre à chaque établissement
//    (null = mono-devise, aucune conversion implicite) ;
//  - LECTURE : tout membre de l'établissement ;
//  - ÉCRITURE : propriétaire et gérant DE CET ÉTABLISSEMENT
//    uniquement (exigerGerantOuProprio contrôle l'affectation —
//    un gérant d'un autre établissement est refusé) ;
//  - bornes de saisie : entier > 0, ≤ plafond de l'établissement ;
//  - chaque modification est journalisée dans audit_log
//    (TAUX_MODIFIE, avant/après — table non modifiable) ;
//  - alertes propriétaire : variation > seuil %, ou plus de
//    N changements le même jour (seuils par établissement).
// Le taux est FIGÉ sur chaque vente au moment de la vente
// (commande, token, check-in — voir tauxCourantDb).
// ============================================================

import { and, eq, gte, lt } from "drizzle-orm";
import { z } from "zod";
import * as s from "@db/schema";
import {
  doitAlerterFrequence, doitAlerterVariation, erreurSaisieTaux,
} from "@contracts/taux";
import { createRouter, protegee } from "../middleware";
import {
  alerter, db, erreur, exigerGerantOuProprio, journaliser, rolesSurDb,
} from "../gbsRouter";
import { jourComptable, plageUtcDuJourLocal } from "../lib/jourComptable";

/** Plage UTC du jour comptable courant (Africa/Lubumbashi) —
 *  les horodatages restent UTC, seul le « jour » est local. */
const plageDuJour = () => plageUtcDuJourLocal(jourComptable());

export const tauxRouter = createRouter({
  /** Lecture de la configuration taux de l'établissement — tout
   *  membre affecté (les autres rôles sont en lecture seule). */
  voir: protegee
    .input(z.object({ terrasseId: z.string() }))
    .query(async ({ input, ctx }) => {
      const roles = await rolesSurDb(ctx.session.utilisateurId, input.terrasseId);
      if (roles.length === 0) erreur("Vous n'êtes pas membre de cet établissement.");
      const [t] = await db().select({
        tauxUsdCdf: s.terrasses.tauxUsdCdf,
        alerteVariationPct: s.terrasses.tauxAlerteVariationPct,
        alerteMaxParJour: s.terrasses.tauxAlerteMaxParJour,
        plafondCdf: s.terrasses.tauxPlafondCdf,
      }).from(s.terrasses).where(eq(s.terrasses.id, input.terrasseId)).limit(1);
      if (!t) erreur("Établissement introuvable.");
      return t;
    }),

  /** Modification du taux — propriétaire / gérant DE CET
   *  ÉTABLISSEMENT uniquement (contrôle serveur). null = retour en
   *  mono-devise. Journalisée (avant/après) ; alertes variation et
   *  fréquence selon les seuils de l'établissement. */
  modifier: protegee
    .input(z.object({
      terrasseId: z.string(),
      tauxUsdCdf: z.number().int().positive().nullable(),
    }))
    .mutation(async ({ input, ctx }) => {
      const acteurId = ctx.session.utilisateurId;
      // Contrôle d'affectation : le gérant n'agit que sur SON
      // établissement (refus + journal sinon).
      const role = await exigerGerantOuProprio(acteurId, input.terrasseId);
      const [avant] = await db().select().from(s.terrasses)
        .where(eq(s.terrasses.id, input.terrasseId)).limit(1);
      if (!avant) erreur("Établissement introuvable.");

      // Bornes de saisie (contrat pur partagé) : entier > 0, plafond.
      if (input.tauxUsdCdf !== null) {
        const cle = erreurSaisieTaux(input.tauxUsdCdf, avant.tauxPlafondCdf);
        if (cle === "invalide") erreur("Le taux doit être un entier positif (FC pour 1 $).");
        if (cle === "plafond") erreur(`Taux au-delà du plafond de sécurité (${avant.tauxPlafondCdf} FC). Vérifiez la saisie.`);
      }
      if (input.tauxUsdCdf === avant.tauxUsdCdf) {
        return { tauxUsdCdf: avant.tauxUsdCdf, change: false as const };
      }

      await db().update(s.terrasses)
        .set({ tauxUsdCdf: input.tauxUsdCdf })
        .where(eq(s.terrasses.id, input.terrasseId));

      // Historique non modifiable : audit_log (qui, quand, avant/après).
      await journaliser(acteurId, role, "TAUX_MODIFIE",
        `Taux USD/FC : ${avant.tauxUsdCdf ?? "aucun"} → ${input.tauxUsdCdf ?? "aucun (mono-devise)"}`,
        {
          terrasseId: input.terrasseId,
          avant: String(avant.tauxUsdCdf ?? ""),
          apres: String(input.tauxUsdCdf ?? ""),
        });

      // Alerte variation brusque (seuil % de l'établissement).
      if (input.tauxUsdCdf !== null
        && doitAlerterVariation(avant.tauxUsdCdf, input.tauxUsdCdf, avant.tauxAlerteVariationPct)) {
        await alerter(input.terrasseId, "TAUX_VARIATION",
          `Variation de taux > ${avant.tauxAlerteVariationPct} % : ${avant.tauxUsdCdf ?? "—"} → ${input.tauxUsdCdf} FC/$`);
      }

      // Alerte fréquence : plus de N changements le même jour comptable.
      const plage = plageDuJour();
      const duJour = await db().select({ id: s.auditLog.id }).from(s.auditLog)
        .where(and(
          eq(s.auditLog.terrasseId, input.terrasseId),
          eq(s.auditLog.action, "TAUX_MODIFIE"),
          gte(s.auditLog.creeLe, plage.debut),
          lt(s.auditLog.creeLe, plage.fin),
        ));
      if (doitAlerterFrequence(duJour.length, avant.tauxAlerteMaxParJour)) {
        await alerter(input.terrasseId, "TAUX_FREQUENCE",
          `${duJour.length} changements de taux aujourd'hui (seuil : ${avant.tauxAlerteMaxParJour}).`);
      }

      return { tauxUsdCdf: input.tauxUsdCdf, change: true as const };
    }),
});
