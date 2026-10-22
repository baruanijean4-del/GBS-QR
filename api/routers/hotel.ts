// ============================================================
// GBS — Hôtel / chambres (prompt maître §4 et §7) : réception.
// Cycle d'occupation : LIBRE →(checkIn) OCCUPEE →(checkOut)
// A_NETTOYER →(marquerNettoyee, gouvernante) LIBRE.
//
// Rôles (matrice annexe §7) : réceptionniste/gérant/propriétaire
// enregistrent et clôturent les séjours ; la gouvernante valide le
// ménage (elle ne touche ni aux prix ni aux séjours). Création et
// tarification des chambres : gérant/propriétaire.
//
// Concurrence : checkIn et checkOut s'exécutent en transaction avec
// verrou FOR UPDATE (chambre / séjour) — deux réceptionnistes ne
// peuvent ni occuper deux fois la même chambre ni clôturer deux
// fois le même séjour. Chaque transition est journalisée
// (audit_log avec établissement + avant/après).
// ============================================================

import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import * as s from "@db/schema";
import { montantSejourCdf, type ModeSejour } from "@contracts/hotel";
import { createRouter, protegee, publicQuery } from "../middleware";
import { ajouterLignesNoteDb, finaliserLigneSejourDb, ouvrirNoteSejourDb } from "./notes";
import {
  db, erreur, exigerGerantOuProprio, journaliser, resoudreTableParToken, rolesSurDb, tauxCourantDb,
} from "../gbsRouter";
import { maintenant, uid } from "../gbsUtils";

/** Rôles habilités à enregistrer et clôturer les séjours (réception). */
const ROLES_RECEPTION = ["PROPRIETAIRE", "GERANT", "RECEPTIONNISTE"] as const;
/** Rôles habilités à valider le ménage d'une chambre. */
const ROLES_MENAGE = ["PROPRIETAIRE", "GERANT", "GOUVERNANTE"] as const;

/** Exige un rôle parmi la liste, sinon refus journalisé. */
async function exigerRole(acteurId: string, terrasseId: string, attendus: readonly string[], action: string) {
  const roles = await rolesSurDb(acteurId, terrasseId);
  if (roles.some((r) => attendus.includes(r))) {
    return roles.includes("PROPRIETAIRE") ? "PROPRIETAIRE" : roles[0];
  }
  await journaliser(acteurId, roles[0] ?? null, "PERMISSION_REFUSEE",
    `${action} tentée sans rôle habilité`, { terrasseId });
  erreur(`Action réservée : ${action.toLowerCase()}.`);
}

export const hotelRouter = createRouter({
  /** Chambres de l'établissement + séjour en cours éventuel
   *  (réception, gouvernante, direction). */
  voirChambres: protegee
    .input(z.object({ terrasseId: z.string() }))
    .query(async ({ input, ctx }) => {
      const roles = await rolesSurDb(ctx.session.utilisateurId, input.terrasseId);
      if (roles.length === 0) erreur("Accès réservé au personnel de l'établissement.");
      // Confidentialité (audit) : le numéro de pièce d'identité n'est
      // visible que de la réception et de la direction — une serveuse
      // ou une gouvernante n'a pas à y accéder.
      const voitIdentite = roles.some((r) => (ROLES_RECEPTION as readonly string[]).includes(r));
      const chambres = await db().select().from(s.chambres)
        .where(eq(s.chambres.terrasseId, input.terrasseId));
      const enCours = await db().select().from(s.sejours)
        .where(and(eq(s.sejours.terrasseId, input.terrasseId), eq(s.sejours.statut, "EN_COURS")));
      const parChambre = new Map(enCours.map((sj) => [sj.chambreId, sj]));
      return chambres
        .map((c) => {
          const sj = parChambre.get(c.id) ?? null;
          return {
            id: c.id, numero: c.numero, type: c.type, statut: c.statut,
            prixNuitCdf: c.prixNuitCdf, prixHeureCdf: c.prixHeureCdf,
            sejour: sj && !voitIdentite ? { ...sj, pieceIdentite: null } : sj,
          };
        })
        .sort((a, b) => a.numero.localeCompare(b.numero, "fr", { numeric: true }));
    }),

  /** Crée une chambre (gérant/propriétaire). Numéro unique par
   *  établissement ; prix à l'heure optionnel (NULL = nuitée seule). */
  creerChambre: protegee
    .input(z.object({
      terrasseId: z.string(),
      numero: z.string().min(1).max(10),
      type: z.enum(["SIMPLE", "DOUBLE", "SUITE"]).default("SIMPLE"),
      prixNuitCdf: z.number().int().positive().max(100_000_000),
      prixHeureCdf: z.number().int().positive().max(100_000_000).nullable().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const acteurId = ctx.session.utilisateurId;
      const role = await exigerGerantOuProprio(acteurId, input.terrasseId);
      const [doublon] = await db().select({ id: s.chambres.id }).from(s.chambres)
        .where(and(eq(s.chambres.terrasseId, input.terrasseId), eq(s.chambres.numero, input.numero.trim())))
        .limit(1);
      if (doublon) erreur(`La chambre ${input.numero.trim()} existe déjà.`);
      const [creee] = await db().insert(s.chambres).values({
        id: uid("cha"), terrasseId: input.terrasseId, numero: input.numero.trim(),
        type: input.type, statut: "LIBRE",
        prixNuitCdf: input.prixNuitCdf, prixHeureCdf: input.prixHeureCdf ?? null,
        creeLe: maintenant(),
      }).returning();

      // Création du QR code pour la chambre (kind = CHAMBRE)
      const tokenQr = uid('qrc');
      await db().insert(s.tablesQr).values({
        id: uid('tab'),
        terrasseId: input.terrasseId,
        numero: parseInt(input.numero.trim()) || 1,
        kind: 'CHAMBRE',
        tokenQr,
        actif: true,
        creeLe: maintenant(),
      });
      await journaliser(acteurId, role, "CHAMBRE_CREEE",
        `Chambre ${creee.numero} (${creee.type}) — ${creee.prixNuitCdf} FC/nuit${creee.prixHeureCdf ? `, ${creee.prixHeureCdf} FC/h` : ""}`,
        { terrasseId: input.terrasseId });
      return { id: creee.id };
    }),

  /** Check-in (prompt maître §7) : enregistre le client (nom + pièce
   *  d'identité), crée le séjour EN_COURS, passe la chambre OCCUPEE.
   *  Transaction + FOR UPDATE : une chambre LIBRE ne peut être prise
   *  que par un seul réceptionniste à la fois. */
  checkIn: protegee
    .input(z.object({
      chambreId: z.string(),
      clientNom: z.string().min(1).max(120),
      pieceIdentite: z.string().max(60).default(""),
      mode: z.enum(["NUIT", "HEURE"]).default("NUIT"),
    }))
    .mutation(async ({ input, ctx }) => {
      const acteurId = ctx.session.utilisateurId;
      const [chambre] = await db().select().from(s.chambres)
        .where(eq(s.chambres.id, input.chambreId)).limit(1);
      if (!chambre) erreur("Chambre introuvable.");
      const role = await exigerRole(acteurId, chambre.terrasseId, ROLES_RECEPTION, "Réception (check-in)");
      if (input.mode === "HEURE" && chambre.prixHeureCdf === null) {
        erreur("Cette chambre ne se loue pas à l'heure.");
      }

      return db().transaction(async (tx) => {
        const [verrou] = await tx.execute(sql`
          SELECT id, statut FROM chambres WHERE id = ${chambre.id} FOR UPDATE
        `) as unknown as [{ id: string; statut: string }];
        if (!verrou || verrou.statut !== "LIBRE") {
          erreur(`La chambre ${chambre.numero} n'est pas libre.`);
        }
        const maintenantIso = maintenant();
        // Règle taux : figé au check-in (début de la prestation).
        const tauxVente = await tauxCourantDb(chambre.terrasseId);
        const [sejour] = await tx.insert(s.sejours).values({
          id: uid("sej"), chambreId: chambre.id, terrasseId: chambre.terrasseId,
          clientNom: input.clientNom.trim(), pieceIdentite: input.pieceIdentite.trim() || null,
          mode: input.mode, arriveeLe: maintenantIso, statut: "EN_COURS",
          tauxUsdCdf: tauxVente,
          creePar: acteurId, creeLe: maintenantIso,
        }).returning();
        await tx.update(s.chambres).set({ statut: "OCCUPEE" })
          .where(eq(s.chambres.id, chambre.id));
        await journaliser(acteurId, role, "HOTEL_CHECK_IN",
          `Chambre ${chambre.numero} : ${input.clientNom.trim()} (${input.mode === "NUIT" ? "nuitée" : "heure"})`,
          { terrasseId: chambre.terrasseId, avant: "LIBRE", apres: "OCCUPEE" });
        // ANNEXE-2 §3 : la note de chambre (folio) s'ouvre au check-in
        // — montant fixé au check-out, règlement jusqu'au départ.
        await ouvrirNoteSejourDb({
          terrasseId: chambre.terrasseId, sejourId: sejour.id,
          clientNom: input.clientNom.trim(), creeParId: acteurId,
        });
        return { ok: true as const, sejourId: sejour.id };
      });
    }),

  /** Check-out (prompt maître §7) : clôture le séjour avec le montant
   *  calculé (unités entamées, min 1), passe la chambre A_NETTOYER.
   *  Transaction + FOR UPDATE : un séjour n'est clôturé qu'une fois. */
  checkOut: protegee
    .input(z.object({ sejourId: z.string() }))
    .mutation(async ({ input, ctx }) => {
      const acteurId = ctx.session.utilisateurId;
      const [sejour] = await db().select().from(s.sejours)
        .where(eq(s.sejours.id, input.sejourId)).limit(1);
      if (!sejour) erreur("Séjour introuvable.");
      const role = await exigerRole(acteurId, sejour.terrasseId, ROLES_RECEPTION, "Réception (check-out)");
      const [chambre] = await db().select().from(s.chambres)
        .where(eq(s.chambres.id, sejour.chambreId)).limit(1);
      if (!chambre) erreur("Chambre du séjour introuvable.");

      return db().transaction(async (tx) => {
        const [verrou] = await tx.execute(sql`
          SELECT id, statut FROM sejours WHERE id = ${sejour.id} FOR UPDATE
        `) as unknown as [{ id: string; statut: string }];
        if (!verrou || verrou.statut !== "EN_COURS") {
          erreur("Ce séjour est déjà clôturé.");
        }
        const departLe = maintenant();
        let montant: number;
        try {
          montant = montantSejourCdf({
            mode: sejour.mode as ModeSejour,
            arriveeLe: sejour.arriveeLe, departLe,
            prixNuitCdf: chambre.prixNuitCdf, prixHeureCdf: chambre.prixHeureCdf,
          });
        } catch (e) {
          erreur(e instanceof Error ? e.message : "Calcul du séjour impossible.");
        }
        await tx.update(s.sejours)
          .set({ statut: "CLOTURE", departLe, montantTotalCdf: montant })
          .where(eq(s.sejours.id, sejour.id));
        await tx.update(s.chambres).set({ statut: "A_NETTOYER" })
          .where(eq(s.chambres.id, chambre.id));
        await journaliser(acteurId, role, "HOTEL_CHECK_OUT",
          `Chambre ${chambre.numero} : ${sejour.clientNom} — ${montant} FC (${sejour.mode === "NUIT" ? "nuitée(s)" : "heure(s)"})`,
          { terrasseId: sejour.terrasseId, avant: "EN_COURS", apres: "CLOTURE" });
        // ANNEXE-2 §3 : la ligne CHAMBRE de la note prend son montant
        // définitif (unités entamées, min 1).
        await finaliserLigneSejourDb(sejour.id, montant,
          `Chambre ${chambre.numero} — ${sejour.mode === "NUIT" ? "nuitée(s)" : "heure(s)"}`);
        return { ok: true as const, montantTotalCdf: montant };
      });
    }),

  /** Ménage validé (prompt maître §7) : la gouvernante repasse la
   *  chambre A_NETTOYER → LIBRE. Elle seule (avec la direction) peut
   *  le faire — jamais la réception, sinon une chambre sale serait
   *  revendue sans contrôle croisé. */
  marquerNettoyee: protegee
    .input(z.object({ chambreId: z.string() }))
    .mutation(async ({ input, ctx }) => {
      const acteurId = ctx.session.utilisateurId;
      const [chambre] = await db().select().from(s.chambres)
        .where(eq(s.chambres.id, input.chambreId)).limit(1);
      if (!chambre) erreur("Chambre introuvable.");
      const role = await exigerRole(acteurId, chambre.terrasseId, ROLES_MENAGE, "Validation du ménage");
      if (chambre.statut !== "A_NETTOYER") {
        erreur(`La chambre ${chambre.numero} n'est pas à nettoyer.`);
      }
      // Mise à jour conditionnelle (audit) : si deux gouvernantes
      // valident en même temps, une seule écrit et journalise —
      // l'autre reçoit un refus au lieu d'un faux « nettoyée ».
      const [miseAJour] = await db().update(s.chambres).set({ statut: "LIBRE" })
        .where(and(eq(s.chambres.id, chambre.id), eq(s.chambres.statut, "A_NETTOYER")))
        .returning({ id: s.chambres.id });
      if (!miseAJour) erreur(`La chambre ${chambre.numero} vient d'être validée par un collègue.`);
      await journaliser(acteurId, role, "HOTEL_CHAMBRE_NETTOYEE",
        `Chambre ${chambre.numero} nettoyée — de nouveau libre`,
        { terrasseId: chambre.terrasseId, avant: "A_NETTOYER", apres: "LIBRE" });
      return { ok: true as const };
    }),

  /** Le client prend une chambre depuis son téléphone (QR terrasse). */
  prendreChambreDepuisTerrasse: publicQuery
    .input(z.object({ token: z.string(), clientSessionId: z.string(), chambreId: z.string(), mode: z.enum(['NUIT', 'HEURE']) }))
    .mutation(async ({ input }) => {
      const table = await resoudreTableParToken(input.token);
      if (!table) erreur('QR code invalide.');
      const [chambre] = await db().select().from(s.chambres).where(eq(s.chambres.id, input.chambreId)).limit(1);
      if (!chambre || chambre.statut !== 'LIBRE') erreur('Cette chambre n est plus disponible.');
      const [sess] = await db().select().from(s.clientsSession).where(eq(s.clientsSession.id, input.clientSessionId)).limit(1);
      if (!sess) erreur('Session client invalide.');
      const sejourId = uid('sej');
      const maintenantIso = maintenant();
      await db().transaction(async (tx) => {
        await tx.update(s.chambres).set({ statut: 'OCCUPEE' }).where(eq(s.chambres.id, chambre.id));
        await tx.insert(s.sejours).values({
          id: sejourId, chambreId: chambre.id, terrasseId: table.terrasseId,
          clientNom: sess.prenom, pieceIdentite: null, mode: input.mode,
          arriveeLe: maintenantIso, departLe: null, montantTotalCdf: null,
          statut: 'EN_COURS', tauxUsdCdf: null, creePar: 'client', creeLe: maintenantIso,
        });
      });
      // Ouvrir la note de séjour (fusionnée avec la note terrasse si elle existe)
      // Ajouter la chambre à la note du client (comme pour le billard)
      const montantChambre = input.mode === 'HEURE'
        ? (chambre.prixHeureCdf ?? 0)
        : (chambre.prixNuitCdf ?? 0);
      
      await ajouterLignesNoteDb({
        clientSessionId: input.clientSessionId,
        terrasseId: table.terrasseId,
        espace: 'HOTEL',
        type: 'CHAMBRE',
        creeParId: 'client',
        lignes: [{
          refId: sejourId,
          libelle: `Chambre ${input.mode === 'HEURE' ? '(heure)' : '(nuit)'}`,
          quantite: 1,
          montantCdf: montantChambre,
          montantUsd: 0,
          tauxUsdCdf: null,
          statut: 'CONFIRMEE',
        }],
      });
      return { ok: true, sejourId, chambre: { id: chambre.id, numero: chambre.numero } };
    }),


  /** Vue PUBLIQUE des chambres libres (client, sans authentification). */
  voirChambresPubliques: publicQuery
    .input(z.object({ terrasseId: z.string() }))
    .query(async ({ input }) => {
      const chambres = await db().select({
        id: s.chambres.id,
        numero: s.chambres.numero,
        type: s.chambres.type,
        prixNuitCdf: s.chambres.prixNuitCdf,
        prixHeureCdf: s.chambres.prixHeureCdf,
      }).from(s.chambres)
        .where(and(eq(s.chambres.terrasseId, input.terrasseId), eq(s.chambres.statut, 'LIBRE')));
      return chambres;
    }),

});
