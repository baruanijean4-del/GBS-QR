// ============================================================
// GBS — Comptabilité : export quotidien des encaissements (boucle 6).
// Un CSV par établissement et par jour : tokens billard payés
// (cash et Airtel Money), séjours hôtel clôturés, commandes
// encaissées, dépenses de caisse — avec totaux et net du jour.
// Réservé à la direction (propriétaire / gérant) ; chaque export
// est journalisé (qui, quel jour, combien de lignes).
// ============================================================

import { and, eq, gte, lt } from "drizzle-orm";
import { z } from "zod";
import * as s from "@db/schema";
import { createRouter, protegee } from "../middleware";
import { plageUtcDuJourLocal } from "../lib/jourComptable";
import { db, journaliser, exigerGerantOuProprio } from "../gbsRouter";

/** Échappe un champ CSV (séparateur « ; », compatible Excel FR). */
function csvChamp(v: string | number | null | undefined): string {
  const t = String(v ?? "");
  return /[";\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
}

/** Ligne CSV normalisée. */
function csvLigne(champs: (string | number | null | undefined)[]): string {
  return champs.map(csvChamp).join(";");
}

/** Heure HH:MM extraite d'un horodatage ISO (chaîne). */
function heureDe(iso: string | null): string {
  const m = /T(\d{2}:\d{2})/.exec(iso ?? "");
  return m ? m[1] : "";
}

export const comptabiliteRouter = createRouter({
  /** Export comptable d'une journée (direction). Retourne le CSV
   *  complet + les totaux — le client le télécharge tel quel. */
  exportJournalier: protegee
    .input(z.object({
      terrasseId: z.string(),
      jour: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Format AAAA-MM-JJ attendu"),
    }))
    .query(async ({ input, ctx }) => {
      const role = await exigerGerantOuProprio(ctx.session.utilisateurId, input.terrasseId);
      // Jour comptable local : le « jour » demandé est une date
      // Africa/Lubumbashi ; les horodatages stockés restent UTC →
      // on filtre par plage UTC [début, fin[, jamais par préfixe.
      const plage = plageUtcDuJourLocal(input.jour);
      const [tokensPayes, sejoursClotures, commandesPayees, depensesJour] = await Promise.all([
        db().select().from(s.tokensBillard)
          .where(and(eq(s.tokensBillard.terrasseId, input.terrasseId), gte(s.tokensBillard.payeLe, plage.debut), lt(s.tokensBillard.payeLe, plage.fin))),
        db().select().from(s.sejours)
          .where(and(eq(s.sejours.terrasseId, input.terrasseId), gte(s.sejours.departLe, plage.debut), lt(s.sejours.departLe, plage.fin))),
        db().select().from(s.commandes)
          .where(and(eq(s.commandes.terrasseId, input.terrasseId), gte(s.commandes.payeeLe, plage.debut), lt(s.commandes.payeeLe, plage.fin))),
        db().select().from(s.depenses)
          .where(and(eq(s.depenses.terrasseId, input.terrasseId), gte(s.depenses.creeLe, plage.debut), lt(s.depenses.creeLe, plage.fin))),
      ]);

      const lignes: string[] = [
        csvLigne(["heure", "source", "detail", "montant_cdf", "mode", "valide_par"]),
      ];
      const tout: { tri: string; csv: string; montant: number }[] = [];
      for (const t of tokensPayes) {
        tout.push({
          tri: t.payeLe ?? "", montant: t.prixCdf,
          csv: csvLigne([heureDe(t.payeLe), "BILLARD", `Token #${t.numero} (${t.prenom})`,
            t.prixCdf, "CASH", t.payePar]),
        });
      }
      for (const sj of sejoursClotures) {
        tout.push({
          tri: sj.departLe ?? "", montant: sj.montantTotalCdf ?? 0,
          csv: csvLigne([heureDe(sj.departLe), "HOTEL",
            `Séjour ${sj.clientNom} (${sj.mode === "NUIT" ? "nuitée" : "heure"})`,
            sj.montantTotalCdf ?? 0, "CASH", sj.creePar]),
        });
      }
      for (const c of commandesPayees) {
        tout.push({
          tri: c.payeeLe ?? "", montant: c.totalCdf,
          csv: csvLigne([heureDe(c.payeeLe), "COMMANDE", `Commande ${c.id}`,
            c.totalCdf, "CASH", c.serviePar]),
        });
      }
      for (const d of depensesJour) {
        tout.push({
          tri: d.creeLe, montant: -d.montantCdf,
          csv: csvLigne([heureDe(d.creeLe), "DEPENSE", d.motif, -d.montantCdf, "CASH", d.saisiPar]),
        });
      }
      tout.sort((a, b) => a.tri.localeCompare(b.tri));
      for (const l of tout) lignes.push(l.csv);

      const totalBillard = tokensPayes.reduce((n, t) => n + t.prixCdf, 0);
      const totalHotel = sejoursClotures.reduce((n, sj) => n + (sj.montantTotalCdf ?? 0), 0);
      const totalCommandes = commandesPayees.reduce((n, c) => n + c.totalCdf, 0);
      const totalDepenses = depensesJour.reduce((n, d) => n + d.montantCdf, 0);
      const net = totalBillard + totalHotel + totalCommandes - totalDepenses;
      lignes.push("");
      lignes.push(csvLigne(["", "TOTAL BILLARD", "", totalBillard, "", ""]));
      lignes.push(csvLigne(["", "TOTAL HOTEL", "", totalHotel, "", ""]));
      lignes.push(csvLigne(["", "TOTAL COMMANDES", "", totalCommandes, "", ""]));
      lignes.push(csvLigne(["", "TOTAL DEPENSES", "", -totalDepenses, "", ""]));
      lignes.push(csvLigne(["", "NET DU JOUR", "", net, "", ""]));

      await journaliser(ctx.session.utilisateurId, role, "EXPORT_COMPTABLE_JOURNALIER",
        `Export du ${input.jour} : ${tout.length} lignes, net ${net} FC`,
        { terrasseId: input.terrasseId });

      return {
        jour: input.jour,
        // BOM + séparateur « ; » : ouverture directe correcte dans Excel FR
        csv: "\uFEFF" + lignes.join("\n"),
        totaux: { billardCdf: totalBillard, hotelCdf: totalHotel, commandesCdf: totalCommandes, depensesCdf: totalDepenses, netCdf: net },
        nbLignes: tout.length,
      };
    }),
});
