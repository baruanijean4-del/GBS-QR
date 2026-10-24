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

import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import * as s from "@db/schema";
import { montantSejourCdf, type ModeSejour } from "@contracts/hotel";
import { createRouter, protegee, publicQuery } from "../middleware";
import { ajouterLignesNoteDb, assurerClientDb, encaisserNoteDb, exigerTelephoneSiGrosseNoteDb, finaliserLigneSejourDb, noteOuverteDb, ouvrirNoteSejourDb, sommesNoteDb } from "./notes";
import {
  db, erreur, exigerGerantOuProprio, journaliser, resoudreTableParToken, rolesSurDb, tauxCourantDb,
} from "../gbsRouter";
import { maintenant, uid } from "../gbsUtils";

/** Rôles habilités à enregistrer et clôturer les séjours (réception). */
const ROLES_RECEPTION = ["PROPRIETAIRE", "GERANT", "RECEPTIONNISTE"] as const;
/** Rôles habilités à valider le ménage d'une chambre. */

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
            photoUrl: c.photoUrl,
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
    .input(z.object({
      sejourId: z.string(),
      /** Règlement saisi PAR LA RÉCEPTION au départ (jamais automatique).
       *  Sans paiement, la note reste OUVERTE (impayé visible) et se règle
       *  ensuite depuis l'écran Notes avec le bon mode de paiement. */
      paiement: z.object({
        mode: z.literal("CASH"),
        montantCdf: z.number().int().min(0),
        montantUsd: z.number().int().min(0),
      }).optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const acteurId = ctx.session.utilisateurId;
      const [sejour] = await db().select().from(s.sejours)
        .where(eq(s.sejours.id, input.sejourId)).limit(1);
      if (!sejour) erreur("Séjour introuvable.");
      const role = await exigerRole(acteurId, sejour.terrasseId, ROLES_RECEPTION, "Réception (check-out)");
      const [chambre] = await db().select().from(s.chambres)
        .where(eq(s.chambres.id, sejour.chambreId)).limit(1);
      if (!chambre) erreur("Chambre du séjour introuvable.");

      const cloture = await db().transaction(async (tx) => {
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
        // PAS d'encaissement automatique : l'argent n'entre en caisse que
        // si la réception saisit le mode ET le montant réellement reçus.
        return { ok: true as const, montantTotalCdf: montant };
      });

      // Hors transaction (pas de transaction imbriquée) : règlement saisi
      // par la réception, puis calcul du reste dû restant.
      // Séjour ouvert par la réception : note liée par sejour_id. Chambre
      // prise depuis le téléphone du client : la note n'a pas de sejour_id,
      // on la retrouve par sa ligne CHAMBRE (sinon le départ affichait
      // « reste 0 » alors que le client n'avait rien payé).
      const [parSejour] = await db().select({ id: s.notes.id }).from(s.notes)
        .where(eq(s.notes.sejourId, sejour.id)).limit(1);
      const [parLigne] = parSejour ? [] : await db().select({ id: s.noteLignes.noteId }).from(s.noteLignes)
        .where(and(eq(s.noteLignes.type, "CHAMBRE"), eq(s.noteLignes.refId, sejour.id))).limit(1);
      const noteSejour = parSejour ?? parLigne;
      // Le séjour est déjà clôturé : un paiement refusé (montant > reste dû,
      // référence mobile invalide) ne doit pas faire échouer le check-out.
      let paiementRefuse: string | null = null;
      if (noteSejour && input.paiement && (input.paiement.montantCdf > 0 || input.paiement.montantUsd > 0)) {
        try {
          await encaisserNoteDb({
            noteId: noteSejour.id, acteurId,
            montantCdf: input.paiement.montantCdf, montantUsd: input.paiement.montantUsd,
          });
          await journaliser(acteurId, role, "HOTEL_REGLEMENT_CHECKOUT",
            `Chambre ${chambre.numero} : ${input.paiement.montantCdf} FC / ${input.paiement.montantUsd} ¢ (cash)`,
            { terrasseId: sejour.terrasseId });
        } catch (e) {
          paiementRefuse = e instanceof Error ? e.message : "Paiement refusé.";
        }
      }
      let resteCdf = 0, resteUsd = 0;
      if (noteSejour) {
        const sommes = await sommesNoteDb(noteSejour.id);
        resteCdf = sommes.resteCdf; resteUsd = sommes.resteUsd;
        if (resteCdf > 0 || resteUsd > 0) {
          await journaliser(acteurId, role, "HOTEL_CHECKOUT_IMPAYE",
            `Chambre ${chambre.numero} : reste dû ${resteCdf} FC / ${resteUsd} ¢ — note laissée ouverte`,
            { terrasseId: sejour.terrasseId });
        }
      }
      return { ...cloture, resteCdf, resteUsd, noteId: noteSejour?.id ?? null, paiementRefuse };
    }),

  /** Ménage validé : réception ou direction repasse la chambre
   *  A_NETTOYER → LIBRE (rôle GOUVERNANTE supprimé, cf. refonte RBAC). */
  marquerNettoyee: protegee
    .input(z.object({ chambreId: z.string() }))
    .mutation(async ({ input, ctx }) => {
      const acteurId = ctx.session.utilisateurId;
      const [chambre] = await db().select().from(s.chambres)
        .where(eq(s.chambres.id, input.chambreId)).limit(1);
      if (!chambre) erreur("Chambre introuvable.");
      const role = await exigerRole(acteurId, chambre.terrasseId, ["RECEPTIONNISTE", "GERANT", "PROPRIETAIRE"], "Validation du ménage");
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
      if (!chambre) erreur('Chambre introuvable.');
      // Étanchéité entre établissements : la chambre doit appartenir
      // à l'établissement du QR scanné.
      if (chambre.terrasseId !== table.terrasseId) erreur("Cette chambre n'appartient pas à cet établissement.");
      const [sess] = await db().select().from(s.clientsSession).where(eq(s.clientsSession.id, input.clientSessionId)).limit(1);
      if (!sess) erreur('Session client invalide.');
      // La session client doit provenir d'une table du MÊME établissement.
      const [tableSess] = await db().select().from(s.tablesQr).where(eq(s.tablesQr.id, sess.tableId)).limit(1);
      if (!tableSess || tableSess.terrasseId !== table.terrasseId) erreur('Session client invalide.');
      // Une chambre prise depuis le téléphone est un gros achat : numéro exigé AVANT de bloquer la chambre
      await exigerTelephoneSiGrosseNoteDb(input.clientSessionId,
        input.mode === 'HEURE' ? (chambre.prixHeureCdf ?? 0) : (chambre.prixNuitCdf ?? 0));
      const sejourId = uid('sej');
      const maintenantIso = maintenant();
      const tauxVente = await tauxCourantDb(table.terrasseId);
      await db().transaction(async (tx) => {
        // Réservation ATOMIQUE : un seul client peut passer LIBRE → OCCUPEE.
        const [prise] = await tx.update(s.chambres).set({ statut: 'OCCUPEE' })
          .where(and(eq(s.chambres.id, chambre.id), eq(s.chambres.statut, 'LIBRE')))
          .returning({ id: s.chambres.id });
        if (!prise) erreur("Cette chambre n'est plus disponible.");
        await tx.insert(s.sejours).values({
          id: sejourId, chambreId: chambre.id, terrasseId: table.terrasseId,
          clientNom: sess.prenom, pieceIdentite: null, mode: input.mode,
          arriveeLe: maintenantIso, departLe: null, montantTotalCdf: null,
          statut: 'EN_COURS', tauxUsdCdf: tauxVente, creePar: 'client', creeLe: maintenantIso,
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
        photoUrl: s.chambres.photoUrl,
      }).from(s.chambres)
        .where(and(eq(s.chambres.terrasseId, input.terrasseId), eq(s.chambres.statut, 'LIBRE')));
      return chambres;
    }),

  /** Direction : modifie une chambre (prix, type). La photo passe par une demande (routeur photos). */
  modifierChambre: protegee
    .input(z.object({
      chambreId: z.string(),
      prixNuitCdf: z.number().int().positive().max(100_000_000).optional(),
      prixHeureCdf: z.number().int().positive().max(100_000_000).nullable().optional(),
      type: z.enum(["SIMPLE", "DOUBLE", "SUITE"]).optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const acteurId = ctx.session.utilisateurId;
      const [chambre] = await db().select().from(s.chambres)
        .where(eq(s.chambres.id, input.chambreId)).limit(1);
      if (!chambre) erreur("Chambre introuvable.");
      const role = await exigerGerantOuProprio(acteurId, chambre.terrasseId);
      
      const maj: Record<string, unknown> = {};
      if (input.prixNuitCdf !== undefined) maj.prixNuitCdf = input.prixNuitCdf;
      if (input.prixHeureCdf !== undefined) maj.prixHeureCdf = input.prixHeureCdf;
      if (input.type !== undefined) maj.type = input.type;
      
      if (Object.keys(maj).length === 0) return { ok: true };
      
      await db().update(s.chambres).set(maj).where(eq(s.chambres.id, input.chambreId));
      await journaliser(acteurId, role, "CHAMBRE_MODIFIEE",
        `Chambre ${chambre.numero} modifiée`,
        { terrasseId: chambre.terrasseId, avant: JSON.stringify(chambre), apres: JSON.stringify(maj) });
      return { ok: true };
    }),

  /** Client : prolonge son séjour (ajoute une nuit ou une heure à la note). */
  prolongerSejour: publicQuery
    .input(z.object({
      token: z.string(),
      clientSessionId: z.string(),
      mode: z.enum(["NUIT", "HEURE"]),
    }))
    .mutation(async ({ input }) => {
      const table = await resoudreTableParToken(input.token);
      if (!table) erreur("QR code invalide.");
      
      // Le séjour est celui DU CLIENT (via les lignes CHAMBRE de sa note),
      // jamais « le premier séjour en cours de l'établissement ».
      const [sess] = await db().select().from(s.clientsSession)
        .where(eq(s.clientsSession.id, input.clientSessionId)).limit(1);
      if (!sess) erreur("Session client invalide.");
      const [tableSess] = await db().select().from(s.tablesQr).where(eq(s.tablesQr.id, sess.tableId)).limit(1);
      if (!tableSess || tableSess.terrasseId !== table.terrasseId) erreur("Session client invalide.");
      const client = await assurerClientDb(input.clientSessionId);
      const note = client ? await noteOuverteDb(client.id) : null;
      if (!note) erreur("Aucun séjour en cours.");
      const lignesChambre = await db().select({ refId: s.noteLignes.refId }).from(s.noteLignes)
        .where(and(eq(s.noteLignes.noteId, note.id), eq(s.noteLignes.type, "CHAMBRE"),
          eq(s.noteLignes.terrasseId, table.terrasseId)));
      const sejourIds = [...new Set(lignesChambre
        .map((l) => (l.refId ?? "").split("_prolong_")[0]).filter(Boolean))];
      const [sejour] = sejourIds.length === 0 ? [] : await db().select().from(s.sejours)
        .where(and(inArray(s.sejours.id, sejourIds), eq(s.sejours.statut, "EN_COURS"),
          eq(s.sejours.terrasseId, table.terrasseId))).limit(1);
      if (!sejour) erreur("Aucun séjour en cours.");

      const [chambre] = await db().select().from(s.chambres)
        .where(eq(s.chambres.id, sejour.chambreId)).limit(1);
      if (!chambre) erreur("Chambre introuvable.");
      
      const montant = input.mode === "HEURE"
        ? (chambre.prixHeureCdf ?? 0)
        : chambre.prixNuitCdf;
      
      await exigerTelephoneSiGrosseNoteDb(input.clientSessionId, montant);
      // On ajoute la ligne à la note
      await ajouterLignesNoteDb({
        clientSessionId: input.clientSessionId,
        terrasseId: table.terrasseId,
        espace: "HOTEL",
        type: "CHAMBRE",
        creeParId: "client",
        lignes: [{
          refId: sejour.id + "_prolong_" + Date.now(),
          libelle: `Prolongation ${input.mode === "HEURE" ? "(heure)" : "(nuit)"}` ,
          quantite: 1,
          montantCdf: montant,
          montantUsd: 0,
          tauxUsdCdf: null,
          statut: "CONFIRMEE",
        }],
      });
      
      await journaliser("client", "CLIENT", "SEJOUR_PROLONGE",
        `Prolongation ${input.mode === "HEURE" ? "1 heure" : "1 nuit"} — ${montant} FC`,
        { terrasseId: table.terrasseId });
      
      return { ok: true, montant };
    }),

  /** Serveuse : liste les commandes EN_ATTENTE pour sa terrasse. */
  voirNouvellesCommandes: protegee
    .input(z.object({ terrasseId: z.string() }))
    .query(async ({ input, ctx }) => {
      const acteurId = ctx.session.utilisateurId;
      const roles = await rolesSurDb(acteurId, input.terrasseId);
      if (roles.length === 0) erreur("Accès réservé au personnel de l'établissement.");
      
      const commandes = await db().select({
        id: s.commandes.id,
        tableId: s.commandes.tableId,
        clientSessionId: s.commandes.clientSessionId,
        statut: s.commandes.statut,
        lignes: s.commandes.lignes,
        totalCdf: s.commandes.totalCdf,
        totalUsd: s.commandes.totalUsd,
        creeLe: s.commandes.creeLe,
      }).from(s.commandes)
        .where(and(
          eq(s.commandes.terrasseId, input.terrasseId),
          eq(s.commandes.statut, "EN_ATTENTE"),
        ))
        .orderBy(desc(s.commandes.creeLe))
        .limit(20);
      
      return commandes;
    }),
});
