// ============================================================
// GBS — Routeur tRPC « billard » : système Vincaire complet
// (annexe « Expérience par type » §1, étape 3).
//
// Cycle : le client achète un token (ATTENTE_PAIEMENT) → la
// serveuse/billardier valide le cash (EN_FILE, permission
// VALIDER_TOKEN_BILLARD — RBAC étape 2) → appel (APPELE, délai de
// présence) → partie (EN_JEU) → le gagnant reste vincaire, le
// perdant suit la règle configurée (RACHAT | FIN_FILE | SORTIE).
//
// Concurrence : lancerPartie / terminerPartie / annulerPartie
// s'exécutent en transaction avec verrou FOR UPDATE sur la ligne
// du billard (tables_qr) — deux serveuses ne peuvent ni lancer
// ni clôturer deux fois la même partie.
//
// Traçabilité (« GBS le voit ») : chaque validation, annulation
// après paiement, absence et clôture est journalisée (audit_log
// avec établissement + avant/après) ; un token payé perdu ou
// annulé déclenche une alerte gérant.
// ============================================================

import { and, asc, desc, eq, gte, lt, sql } from "drizzle-orm";
import { z } from "zod";
import * as s from "@db/schema";
import {
  CONFIG_BILLARD_DEFAUT,
  appelExpire,
  dureeMoyennePartiesMin,
  estimerAttenteMin,
  positionDansFile,
  statutApresDefaite,
  vincaireDoitSortir,
  type ConfigBillard,
  type PartieBillard,
  type ReglePerdant,
  type TokenBillard,
} from "@contracts/billard";
import { createRouter, protegee, publicQuery } from "../middleware";
import { jourComptable, plageUtcDuJourLocal } from "../lib/jourComptable";
import {
  ajouterTableDb, alerter, db, erreur, exigerGerantOuProprio, journaliser, rolesSurDb, tauxCourantDb,
} from "../gbsRouter";
import { exigerPermission } from "../lib/permissions";
import { ajouterLignesNoteDb, encaisserNoteDb, exigerRoleCaisseDb, exigerTelephoneSiGrosseNoteDb, sommesNoteDb } from "./notes";
import { maintenant, uid } from "../gbsUtils";

const zReglePerdant = z.enum(["RACHAT", "FIN_FILE", "SORTIE"]);

/** Rôles habilités à la gestion quotidienne des billards
 *  (annexe §1 : serveuse, gérant ; rôle optionnel BILLARDIER). */
const ROLES_GESTION_BILLARD = ["PROPRIETAIRE", "GERANT", "SERVEUSE", "BILLARDIER"] as const;

// ---------------- Helpers internes ----------------

/** Exige un rôle de gestion billard, sinon refus journalisé. */
async function exigerGestionBillard(acteurId: string, terrasseId: string) {
  const roles = await rolesSurDb(acteurId, terrasseId);
  if (roles.some((r) => (ROLES_GESTION_BILLARD as readonly string[]).includes(r))) {
    return roles.includes("PROPRIETAIRE") ? "PROPRIETAIRE" : roles[0];
  }
  await journaliser(acteurId, roles[0] ?? null, "PERMISSION_REFUSEE",
    "Gestion billard tentée sans rôle habilité", { terrasseId });
  erreur("Action réservée à la serveuse, au billardier, au gérant ou au propriétaire.");
}

/** Résout un billard par son token QR (kind = BILLARD obligatoire). */
async function billardParTokenQr(tokenQr: string) {
  const [t] = await db().select().from(s.tablesQr)
    .where(and(eq(s.tablesQr.tokenQr, tokenQr), eq(s.tablesQr.actif, true))).limit(1);
  if (!t || t.kind !== "BILLARD") erreur("QR code de billard invalide ou révoqué.");
  return t;
}

/** Config billard de l'établissement (défauts de l'annexe si absente). */
async function configPour(terrasseId: string): Promise<ConfigBillard> {
  const [c] = await db().select().from(s.configBillard)
    .where(eq(s.configBillard.terrasseId, terrasseId)).limit(1);
  if (!c) return CONFIG_BILLARD_DEFAUT;
  return {
    prixTokenCdf: c.prixTokenCdf,
    reglePerdant: c.reglePerdant as ReglePerdant,
    maxPartiesVincaire: c.maxPartiesVincaire,
    delaiPresenceMin: c.delaiPresenceMin,
  };
}

/** Tokens actifs d'un billard (hors SORTI / ANNULE) — volumes
 *  faibles (quelques dizaines/jour), le filtrage se fait en JS. */
async function tokensActifs(tableId: string): Promise<TokenBillard[]> {
  const rows = await db().select().from(s.tokensBillard)
    .where(eq(s.tokensBillard.tableId, tableId));
  return (rows as TokenBillard[]).filter((t) => t.statut !== "SORTI" && t.statut !== "ANNULE");
}

/** File d'attente triée (entrée en file croissante). */
function fileTriee(tokens: TokenBillard[]) {
  return tokens
    .filter((t) => t.statut === "EN_FILE")
    .sort((a, b) => String(a.entreeFileLe).localeCompare(String(b.entreeFileLe)));
}

/** Déclare ABSENT les tokens appelés dont le délai de présence est
 *  dépassé, alerte le gérant (token payé perdu) et journalise.
 *  Retourne le nombre de tokens déclarés absents. */
async function balayerAbsents(tableId: string, delaiPresenceMin: number): Promise<number> {
  const appeles = await db().select().from(s.tokensBillard)
    .where(and(eq(s.tokensBillard.tableId, tableId), eq(s.tokensBillard.statut, "APPELE")));
  let absents = 0;
  for (const t of appeles) {
    if (t.appeleLe && appelExpire(t.appeleLe, delaiPresenceMin, maintenant())) {
      await db().update(s.tokensBillard).set({ statut: "ABSENT" })
        .where(and(eq(s.tokensBillard.id, t.id), eq(s.tokensBillard.statut, "APPELE")));
      await alerter(t.terrasseId, "BILLARD_ABSENT",
        `Token #${t.numero} (${t.prenom}) absent après appel — ${t.prixCdf} FC payés à régulariser`);
      await journaliser(null, null, "BILLARD_TOKEN_ABSENT",
        `Token #${t.numero} (${t.prenom}) déclaré absent`, { terrasseId: t.terrasseId });
      absents++;
    }
  }
  return absents;
}

/** Appelle le premier de la file (EN_FILE → APPELE). */
async function appelerPremierDeLaFile(tableId: string): Promise<void> {
  const tokens = await tokensActifs(tableId);
  const [premier] = fileTriee(tokens);
  if (premier) {
    await db().update(s.tokensBillard)
      .set({ statut: "APPELE", appeleLe: maintenant() })
      .where(and(eq(s.tokensBillard.id, premier.id), eq(s.tokensBillard.statut, "EN_FILE")));
  }
}

/** Date du jour COMPTABLE (Africa/Lubumbashi) pour les numéros
 *  quotidiens — les horodatages restent UTC, seul le jour est local. */
const jourCourant = () => jourComptable();

/** Plage UTC du jour comptable courant (pour gte/lt sur l'UTC stocké) */
const plageDuJour = () => plageUtcDuJourLocal(jourComptable());

// ---------------- Routeur ----------------

export const billardRouter = createRouter({
  /** Crée une table de billard (QR kind=BILLARD) — gérant/proprio.
   *  Réutilise ajouterTableDb (numérotation, prorata de tranche). */
  creerTableBillard: protegee
    .input(z.object({ terrasseId: z.string(), numero: z.number().int().positive().optional() }))
    .mutation(async ({ input, ctx }) => {
      const acteurId = ctx.session.utilisateurId;
      await exigerGerantOuProprio(acteurId, input.terrasseId);
      return ajouterTableDb(acteurId, input.terrasseId, input.numero, "BILLARD");
    }),

  /** Vue publique de la file (QR du billard) : vincaire, partie en
   *  cours, file, prix du token, position du client. Balaye au
   *  passage les tokens appelés dont le délai de présence est passé. */
  voirFile: publicQuery
    .input(z.object({ token: z.string(), clientSessionId: z.string().optional() }))
    .query(async ({ input }) => {
      const table = await billardParTokenQr(input.token);
      const config = await configPour(table.terrasseId);
      await balayerAbsents(table.id, config.delaiPresenceMin);
      const tokens = (await tokensActifs(table.id)) as TokenBillard[];
      const file = fileTriee(tokens);
      const [partie] = await db().select().from(s.partiesBillard)
        .where(and(eq(s.partiesBillard.tableId, table.id), eq(s.partiesBillard.statut, "EN_COURS")))
        .limit(1);
      const parId = new Map(tokens.map((t) => [t.id, t]));
      // Vincaire régnant : token EN_JEU hors partie (vainqueur de la
      // dernière partie) ou vincaire de la partie en cours.
      const vincaire = partie?.vincaireTokenId
        ? parId.get(partie.vincaireTokenId) ?? null
        : tokens.find((t) => t.statut === "EN_JEU") ?? null;
      let vincaireDepuis: string | null = null;
      if (vincaire) {
        // « Depuis » = début de la partie en cours, sinon sa victoire
        // la plus récente (approximation du début de règne).
        const [derniereVictoire] = await db().select().from(s.partiesBillard)
          .where(and(
            eq(s.partiesBillard.tableId, table.id),
            eq(s.partiesBillard.gagnantTokenId, vincaire.id),
            eq(s.partiesBillard.statut, "TERMINEE"),
          ))
          .orderBy(desc(s.partiesBillard.finLe)).limit(1);
        vincaireDepuis = partie?.debutLe ?? derniereVictoire?.finLe ?? null;
      }
      // Estimation : durée MOYENNE réelle des dernières parties (annexe §1)
      const recentes = await db().select().from(s.partiesBillard)
        .where(and(eq(s.partiesBillard.tableId, table.id), eq(s.partiesBillard.statut, "TERMINEE")))
        .orderBy(asc(s.partiesBillard.debutLe));
      const dureeMoyenne = dureeMoyennePartiesMin(recentes);
      const challenger = partie ? parId.get(partie.challengerTokenId) ?? null : null;
      // « Mon ticket » (client) : type précis — l'UI s'appuie dessus.
      let monToken: {
        id: string; numero: number; statut: string; position: number;
        personnesDevant: number; attenteEstimeeMin: number | null; appeleLe: string | null;
      } | null = null;
      if (input.clientSessionId) {
        const mien = tokens.find((t) => t.clientSessionId === input.clientSessionId);
        if (mien) {
          const position = positionDansFile(file, mien.id);
          monToken = {
            id: mien.id, numero: mien.numero, statut: mien.statut,
            position,
            personnesDevant: position > 0 ? position - 1 : 0,
            attenteEstimeeMin: position > 0 ? estimerAttenteMin(position, dureeMoyenne) : null,
            appeleLe: mien.appeleLe,
          };
        }
      }
      return {
        billard: { id: table.id, numero: table.numero },
        terrasseId: table.terrasseId,
        prixTokenCdf: config.prixTokenCdf,
        delaiPresenceMin: config.delaiPresenceMin,
        vincaire: vincaire
          ? { numero: vincaire.numero, prenom: vincaire.prenom, serie: vincaire.serie, depuis: vincaireDepuis }
          : null,
        partieEnCours: partie
          ? {
              id: partie.id, numero: partie.numero, debutLe: partie.debutLe,
              challenger: challenger ? { numero: challenger.numero, prenom: challenger.prenom } : null,
            }
          : null,
        file: file.map((t) => ({ numero: t.numero, prenom: t.prenom })),
        nbAttentePaiement: tokens.filter((t) => t.statut === "ATTENTE_PAIEMENT").length,
        monToken,
      };
    }),

  /** Vue GESTION d'un billard (staff habilité) : tout le détail —
   *  tokens actifs avec statuts et ids (validation du cash, absences),
   *  partie en cours, config et durée moyenne. C'est le tableau de
   *  commande du billardier / de la serveuse. */
  voirGestion: protegee
    .input(z.object({ tableId: z.string() }))
    .query(async ({ input, ctx }) => {
      const [table] = await db().select().from(s.tablesQr)
        .where(and(eq(s.tablesQr.id, input.tableId), eq(s.tablesQr.kind, "BILLARD"))).limit(1);
      if (!table) erreur("Billard introuvable.");
      await exigerGestionBillard(ctx.session.utilisateurId, table.terrasseId);
      const config = await configPour(table.terrasseId);
      await balayerAbsents(table.id, config.delaiPresenceMin);
      const tokens = (await tokensActifs(table.id)) as TokenBillard[];
      const file = fileTriee(tokens);
      const [partie] = await db().select().from(s.partiesBillard)
        .where(and(eq(s.partiesBillard.tableId, table.id), eq(s.partiesBillard.statut, "EN_COURS")))
        .limit(1);
      const recentes = await db().select().from(s.partiesBillard)
        .where(and(eq(s.partiesBillard.tableId, table.id), eq(s.partiesBillard.statut, "TERMINEE")))
        .orderBy(asc(s.partiesBillard.debutLe));
      return {
        billard: { id: table.id, numero: table.numero },
        terrasseId: table.terrasseId,
        config,
        dureeMoyenneMin: dureeMoyennePartiesMin(recentes),
        partieEnCours: partie ?? null,
        // Tokens actifs dans l'ordre métier : en jeu/appelés d'abord,
        // puis la file (FIFO), puis les paiements en attente.
        tokens: tokens
          .map((t) => ({
            id: t.id, numero: t.numero, prenom: t.prenom, statut: t.statut,
            serie: t.serie, payeLe: t.payeLe, appeleLe: t.appeleLe,
            entreeFileLe: t.entreeFileLe, creeLe: t.creeLe, prixCdf: t.prixCdf,
            comptoir: t.clientSessionId === null,
          }))
          .sort((a, b) => {
            const rang = (x: typeof a) =>
              x.statut === "EN_JEU" ? 0 : x.statut === "APPELE" ? 1 : x.statut === "EN_FILE" ? 2 : 3;
            const d = rang(a) - rang(b);
            if (d !== 0) return d;
            return String(a.entreeFileLe ?? a.creeLe).localeCompare(String(b.entreeFileLe ?? b.creeLe));
          }),
        positionFile: file.map((t, i) => ({ id: t.id, position: i + 1 })),
      };
    }),

  /** Achat d'un token (client, QR) : le token reste en
   *  ATTENTE_PAIEMENT tant que le paiement n'est pas validé — le
   *  client voit « Paiement en attente de validation » (annexe §1).

   *  Paiement en CASH uniquement (le mobile money ne sert qu'aux abonnements). */
  acheterToken: publicQuery
    .input(z.object({
      token: z.string(),
      clientSessionId: z.string(),
    }))
    .mutation(async ({ input }) => {
      const table = await billardParTokenQr(input.token);
      const [sess] = await db().select().from(s.clientsSession)
        .where(eq(s.clientsSession.id, input.clientSessionId)).limit(1);
      if (!sess || sess.tableId !== table.id) erreur("Session client invalide pour ce billard.");
      const actifs = await tokensActifs(table.id);
      if (actifs.some((t) => t.clientSessionId === sess.id)) {
        erreur("Vous avez déjà un token actif sur ce billard.");
      }
      const config = await configPour(table.terrasseId);
      await exigerTelephoneSiGrosseNoteDb(sess.id, config.prixTokenCdf);
      const plage = plageDuJour();
      const duJour = await db().select({ id: s.tokensBillard.id }).from(s.tokensBillard)
        .where(and(eq(s.tokensBillard.tableId, table.id), gte(s.tokensBillard.creeLe, plage.debut), lt(s.tokensBillard.creeLe, plage.fin)));
      // Règle taux : figé à l'achat du token (annonce client).
      const tauxVente = await tauxCourantDb(table.terrasseId);
      const [cree] = await db().insert(s.tokensBillard).values({
        id: uid("tok"), terrasseId: table.terrasseId, tableId: table.id,
        numero: duJour.length + 1, clientSessionId: sess.id, prenom: sess.prenom,
        prixCdf: config.prixTokenCdf, statut: "ATTENTE_PAIEMENT",
        serie: 0, creeLe: maintenant(),
        tauxUsdCdf: tauxVente,
      }).returning();

      // --- AJOUT DIRECT À LA NOTE (sans validation serveuse) ---
      if (sess.id) {
        await ajouterLignesNoteDb({
          clientSessionId: sess.id,
          terrasseId: table.terrasseId,
          espace: 'BILLARD',
          type: 'TOKEN_BILLARD',
          creeParId: null,
          lignes: [{
            refId: cree.id,
            libelle: 'Token billard n°' + cree.numero,
            quantite: 1,
            montantCdf: cree.prixCdf,
            montantUsd: 0,
            statut: 'EN_ATTENTE',
            tauxUsdCdf: cree.tauxUsdCdf,
          }],
        });
                // Le token reste en ATTENTE_PAIEMENT : le client paie à la fin.
        // L'encaissement sera fait quand la serveuse validera le token.
      }
      // --- FIN AJOUT DIRECT ---

      await journaliser(null, null,
        "BILLARD_TOKEN_CREE",
        `Token #${cree.numero} (${sess.prenom}) — ${config.prixTokenCdf} FC`,
        { terrasseId: table.terrasseId });
      return { id: cree.id, numero: cree.numero, statut: cree.statut, prixCdf: cree.prixCdf };
    }),

  /** Annulation par le client (avant d'entrer en jeu). Un token déjà
   *  payé annulé déclenche l'alerte prévue par l'annexe (qui, quand). */
  annulerToken: publicQuery
    .input(z.object({ tokenId: z.string(), clientSessionId: z.string() }))
    .mutation(async ({ input }) => {
      const [t] = await db().select().from(s.tokensBillard)
        .where(eq(s.tokensBillard.id, input.tokenId)).limit(1);
      if (!t || t.clientSessionId !== input.clientSessionId) erreur("Token introuvable.");
      if (t.statut === "EN_JEU") erreur("Impossible d'annuler : vous êtes à la table.");
      if (t.statut !== "ATTENTE_PAIEMENT" && t.statut !== "EN_FILE" && t.statut !== "APPELE") {
        erreur("Ce token n'est plus annulable.");
      }
      await db().update(s.tokensBillard)
        .set({ statut: "ANNULE", annuleLe: maintenant(), annulePar: "CLIENT" })
        .where(eq(s.tokensBillard.id, t.id));
      if (t.payeLe) {
        await alerter(t.terrasseId, "BILLARD_ANNULATION_PAYEE",
          `Token #${t.numero} (${t.prenom}) annulé APRÈS paiement — ${t.prixCdf} FC à rembourser`);
      }
      await journaliser(null, null, "BILLARD_TOKEN_ANNULE",
        `Token #${t.numero} (${t.prenom}) annulé par le client${t.payeLe ? " (était payé)" : ""}`,
        { terrasseId: t.terrasseId, avant: t.statut, apres: "ANNULE" });
      return { ok: true as const };
    }),

  /** Déclaration de défaite PAR LE PERDANT lui-même (prompt maître §3 :
   *  « c'est le perdant qui déclare lui-même sa défaite sur son
   *  téléphone »). Le joueur EN_JEU identifié par sa session client
   *  déclare sa défaite ; l'autre joueur de la partie est le gagnant.
   *
   *  AUTOMATISATION (règle stricte) : dès la défaite déclarée, le
   *  gagnant est promu roi (ou le reste, série +1), le 1er de la file
   *  devient immédiatement challenger et le match suivant est lancé
   *  SANS appel ni attente — les joueurs sont physiquement autour de
   *  la table. Le perdant suit la règle configurée (RACHAT/SORTIE →
   *  sort et peut racheter ; FIN_FILE → retour gratuit en fin de
   *  file). La déclaration « via l'écran » reste possible côté staff
   *  (terminerPartie, appel + lancement supervisés).
   *
   *  Concurrence : transaction + verrou FOR UPDATE sur la partie —
   *  deux déclarations simultanées → une seule passe. */
  declarerDefaite: publicQuery
    .input(z.object({ token: z.string(), clientSessionId: z.string() }))
    .mutation(async ({ input }) => {
      const table = await billardParTokenQr(input.token);
      const [sess] = await db().select().from(s.clientsSession)
        .where(eq(s.clientsSession.id, input.clientSessionId)).limit(1);
      if (!sess || sess.tableId !== table.id) erreur("Session client invalide pour ce billard.");
      const config = await configPour(table.terrasseId);

      return db().transaction(async (tx) => {
        const [partie] = await tx.select().from(s.partiesBillard)
          .where(and(eq(s.partiesBillard.tableId, table.id), eq(s.partiesBillard.statut, "EN_COURS")))
          .limit(1);
        if (!partie) erreur("Aucune partie en cours sur ce billard.");
        // Relecture APRÈS verrouillage (audit) : si le roi ET le
        // challenger déclarent leur défaite au même instant, les deux
        // transactions lisent la même partie EN_COURS avant le verrou ;
        // la seconde, une fois le verrou obtenu, doit constater que la
        // partie est déjà clôturée — sinon elle ressusciterait le
        // perdant et lancerait une seconde partie EN_COURS.
        const [verrouPartie] = await tx.execute(sql`
          SELECT id, statut FROM parties WHERE id = ${partie.id} FOR UPDATE
        `) as unknown as [{ id: string; statut: string }];
        if (!verrouPartie || verrouPartie.statut !== "EN_COURS") {
          erreur("Cette partie vient d'être clôturée.");
        }

        // Le perdant = le joueur de CETTE session, EN_JEU dans la partie
        const [monToken] = await tx.select().from(s.tokensBillard)
          .where(and(
            eq(s.tokensBillard.clientSessionId, sess.id),
            eq(s.tokensBillard.statut, "EN_JEU"),
          )).limit(1);
        if (!monToken
          || (monToken.id !== partie.vincaireTokenId && monToken.id !== partie.challengerTokenId)) {
          erreur("Vous n'êtes pas en partie sur ce billard.");
        }
        const perdantId = monToken.id;
        const gagnantId = perdantId === partie.vincaireTokenId
          ? partie.challengerTokenId
          : partie.vincaireTokenId;

        const tokens = (await tx.select().from(s.tokensBillard)
          .where(eq(s.tokensBillard.tableId, table.id))) as TokenBillard[];
        const gagnant = tokens.find((t) => t.id === gagnantId);
        if (!gagnant) erreur("Tokens de la partie introuvables.");
        const maintenantIso = maintenant();

        // Perdant : règle configurée (RACHAT/SORTIE → sort, FIN_FILE →
        // retour gratuit en fin de file)
        const sortPerdant = statutApresDefaite(config.reglePerdant);
        await tx.update(s.tokensBillard)
          .set(sortPerdant === "EN_FILE"
            ? { statut: "EN_FILE" as const, entreeFileLe: maintenantIso, serie: 0 }
            : { statut: "SORTI" as const, serie: 0 })
          .where(eq(s.tokensBillard.id, perdantId));

        // Gagnant : série +1 ; un vincaire régnant qui atteint la
        // limite configurée cède la table (comme terminerPartie)
        const serieApres = gagnant.serie + 1;
        const gagnantCede = gagnantId === partie.vincaireTokenId
          && vincaireDoitSortir(serieApres, config.maxPartiesVincaire);
        await tx.update(s.tokensBillard)
          .set({ statut: gagnantCede ? "SORTI" as const : "EN_JEU" as const, serie: serieApres })
          .where(eq(s.tokensBillard.id, gagnant.id));

        await tx.update(s.partiesBillard)
          .set({ statut: "TERMINEE", finLe: maintenantIso, gagnantTokenId: gagnantId })
          .where(eq(s.partiesBillard.id, partie.id));

        // Automatisation : match suivant immédiat. Le roi = le gagnant
        // (sauf s'il cède la table), le challenger = 1er de la file ;
        // si le roi cède, les deux sièges viennent de la file. Vue
        // post-mise-à-jour reconstruite en mémoire (mêmes écritures).
        const etat = new Map<string, TokenBillard["statut"]>([
          [perdantId, sortPerdant],
          [gagnant.id, gagnantCede ? "SORTI" : "EN_JEU"],
        ]);
        const fileApres = fileTriee(tokens.map((t) => ({
          ...t,
          statut: etat.get(t.id) ?? t.statut,
          entreeFileLe: t.id === perdantId && sortPerdant === "EN_FILE" ? maintenantIso : t.entreeFileLe,
        })).filter((t) => t.statut !== "SORTI" && t.statut !== "ANNULE" && t.statut !== "ABSENT"));

        const promus: TokenBillard[] = [];
        let roi: TokenBillard | null = gagnantCede ? null : { ...gagnant, serie: serieApres };
        const restants = [...fileApres];
        if (!roi) roi = restants.shift() ?? null; // 1er de file promu roi
        const suite = restants.shift() ?? null;   // challenger immédiat
        if (roi && roi.id !== gagnant.id) promus.push(roi);
        if (suite) promus.push(suite);
        for (const p of promus) {
          await tx.update(s.tokensBillard).set({ statut: "EN_JEU" })
            .where(eq(s.tokensBillard.id, p.id));
        }
        let nouvellePartie: { id: string; numero: number } | null = null;
        if (roi && suite) {
          const plage = plageDuJour();
          const duJour = await tx.select({ id: s.partiesBillard.id }).from(s.partiesBillard)
            .where(and(eq(s.partiesBillard.tableId, table.id), gte(s.partiesBillard.debutLe, plage.debut), lt(s.partiesBillard.debutLe, plage.fin)));
          const [creee] = await tx.insert(s.partiesBillard).values({
            id: uid("prt"), terrasseId: table.terrasseId, tableId: table.id,
            numero: duJour.length + 1,
            vincaireTokenId: roi.id, challengerTokenId: suite.id,
            statut: "EN_COURS", debutLe: maintenantIso,
          }).returning();
          nouvellePartie = { id: creee.id, numero: creee.numero };
        }

        await journaliser(null, null, "BILLARD_DEFAITE_DECLAREE",
          `#${monToken.numero} ${monToken.prenom} déclare sa défaite — #${gagnant.numero} ${gagnant.prenom} ` +
          `gagne (série ${serieApres})${gagnantCede ? " et cède la table (limite)" : ""}` +
          `${nouvellePartie && roi && suite ? ` — partie #${nouvellePartie.numero} lancée immédiatement : #${roi.numero} ${roi.prenom} vs #${suite.numero} ${suite.prenom}` : ""}`,
          { terrasseId: table.terrasseId, avant: "EN_COURS", apres: "TERMINEE" });
        return {
          ok: true as const,
          gagnant: { id: gagnant.id, numero: gagnant.numero, prenom: gagnant.prenom, serie: serieApres },
          perdantSort: sortPerdant,
          nouvellePartie: nouvellePartie && roi && suite ? {
            id: nouvellePartie.id, numero: nouvellePartie.numero,
            vincaire: { id: roi.id, prenom: roi.prenom },
            challenger: { id: suite.id, prenom: suite.prenom },
          } : null,
        };
      });
    }),

  /** Validation du paiement cash — permission VALIDER_TOKEN_BILLARD
   *  (annexe §7 : propriétaire, gérant, serveuse, billardier ;
   *  surchargeable par le propriétaire). Le token entre en file. */
  validerPaiementToken: protegee
    .input(z.object({ tokenId: z.string() }))
    .mutation(async ({ input, ctx }) => {
      const acteurId = ctx.session.utilisateurId;
      const [t] = await db().select().from(s.tokensBillard)
        .where(eq(s.tokensBillard.id, input.tokenId)).limit(1);
      if (!t) erreur("Token introuvable.");
      const role = await exigerPermission(acteurId, t.terrasseId, "VALIDER_TOKEN_BILLARD");
      // Valider un token = encaisser du cash : réservé au personnel de caisse
      // (vérifié AVANT de changer le statut, sinon token en file sans encaissement).
      const [terrasseToken] = await db().select({ organisationId: s.terrasses.organisationId })
        .from(s.terrasses).where(eq(s.terrasses.id, t.terrasseId)).limit(1);
      if (!terrasseToken) erreur("Établissement introuvable.");
      await exigerRoleCaisseDb(acteurId, terrasseToken.organisationId, false);
      if (t.statut === "EN_FILE" || t.payeLe) erreur("Ce token est déjà payé.");
      if (t.statut !== "ATTENTE_PAIEMENT") erreur("Ce token n'attend plus de paiement.");
      await db().update(s.tokensBillard)
        .set({ statut: "EN_FILE", payeLe: maintenant(), payePar: acteurId, entreeFileLe: maintenant() })
        .where(eq(s.tokensBillard.id, t.id));
      // ANNEXE-2 §3/§5 : le token rejoint la note unique du client et
      // l'encaissement suit l'argent reçu (EN_MAIN + ventilation).
      if (t.clientSessionId) {
        const noteId = await ajouterLignesNoteDb({
          clientSessionId: t.clientSessionId, terrasseId: t.terrasseId, espace: "BILLARD",
          type: "TOKEN_BILLARD", creeParId: acteurId,
          lignes: [{
            refId: t.id, libelle: `Token billard n°${t.numero}`, quantite: 1,
            montantCdf: t.prixCdf, montantUsd: 0, statut: "CONFIRMEE", tauxUsdCdf: t.tauxUsdCdf,
          }],
        });
        if (noteId) {
          const sommes = await sommesNoteDb(noteId);
          const cdf = Math.min(t.prixCdf, sommes.resteCdf);
          if (cdf > 0) {
            await encaisserNoteDb({
              noteId, acteurId, montantCdf: cdf, montantUsd: 0,
            });
          }
        }
      }
      await journaliser(acteurId, role, "BILLARD_PAIEMENT_VALIDE",
        `Token #${t.numero} (${t.prenom}) — ${t.prixCdf} FC encaissés (cash)`,
        { terrasseId: t.terrasseId, avant: "ATTENTE_PAIEMENT", apres: "EN_FILE" });
      return { ok: true as const };
    }),

  /** Ajout au comptoir : client sans téléphone (annexe §1). Le staff
   *  encaisse directement : le token entre en file tout de suite. */
  ajouterJoueurComptoir: protegee
    .input(z.object({
      tableId: z.string(),
      prenom: z.string().min(1).max(60),
      dejaPaye: z.boolean().default(true),
    }))
    .mutation(async ({ input, ctx }) => {
      const acteurId = ctx.session.utilisateurId;
      const [table] = await db().select().from(s.tablesQr)
        .where(and(eq(s.tablesQr.id, input.tableId), eq(s.tablesQr.kind, "BILLARD"))).limit(1);
      if (!table) erreur("Billard introuvable.");
      const role = await exigerGestionBillard(acteurId, table.terrasseId);
      const config = await configPour(table.terrasseId);
      const plage = plageDuJour();
      const duJour = await db().select({ id: s.tokensBillard.id }).from(s.tokensBillard)
        .where(and(eq(s.tokensBillard.tableId, table.id), gte(s.tokensBillard.creeLe, plage.debut), lt(s.tokensBillard.creeLe, plage.fin)));
      const maintenantIso = maintenant();
      // Règle taux : figé à l'ajout au comptoir (même règle qu'au
      // guichet client — le prix annoncé emporte le taux du moment).
      const tauxVente = await tauxCourantDb(table.terrasseId);
      const [cree] = await db().insert(s.tokensBillard).values({
        id: uid("tok"), terrasseId: table.terrasseId, tableId: table.id,
        numero: duJour.length + 1, clientSessionId: null, prenom: input.prenom.trim(),
        prixCdf: config.prixTokenCdf,
        statut: input.dejaPaye ? "EN_FILE" : "ATTENTE_PAIEMENT",
        serie: 0, creeLe: maintenantIso,
        payeLe: input.dejaPaye ? maintenantIso : null,
        payePar: input.dejaPaye ? acteurId : null,
        entreeFileLe: input.dejaPaye ? maintenantIso : null,
        tauxUsdCdf: tauxVente,
      }).returning();
      await journaliser(acteurId, role, "BILLARD_JOUEUR_COMPTOIR",
        `Token #${cree.numero} (${cree.prenom}) ajouté au comptoir${input.dejaPaye ? " — payé cash" : ""}`,
        { terrasseId: table.terrasseId });
      return { id: cree.id, numero: cree.numero, statut: cree.statut };
    }),

  /** Appelle le premier de la file (après une absence ou une
   *  annulation) : EN_FILE → APPELE. */
  appelerSuivant: protegee
    .input(z.object({ tableId: z.string() }))
    .mutation(async ({ input, ctx }) => {
      const acteurId = ctx.session.utilisateurId;
      const [table] = await db().select().from(s.tablesQr)
        .where(eq(s.tablesQr.id, input.tableId)).limit(1);
      if (!table) erreur("Billard introuvable.");
      const role = await exigerGestionBillard(acteurId, table.terrasseId);
      const config = await configPour(table.terrasseId);
      await balayerAbsents(table.id, config.delaiPresenceMin);
      await appelerPremierDeLaFile(table.id);
      await journaliser(acteurId, role, "BILLARD_APPEL_SUIVANT",
        `Appel du joueur suivant (billard n° ${table.numero})`, { terrasseId: table.terrasseId });
      return { ok: true as const };
    }),

  /** Lance une partie. Transaction + verrou FOR UPDATE sur le
   *  billard : impossible de lancer deux parties en parallèle.
   *  Vincaire = tenant EN_JEU ; challenger = joueur APPELE (sinon le
   *  premier de la file est appelé automatiquement). Sans tenant,
   *  il faut deux joueurs : le premier arrivé prend le siège
   *  vincaire, le second est challenger. */
  lancerPartie: protegee
    .input(z.object({ tableId: z.string() }))
    .mutation(async ({ input, ctx }) => {
      const acteurId = ctx.session.utilisateurId;
      const [table] = await db().select().from(s.tablesQr)
        .where(eq(s.tablesQr.id, input.tableId)).limit(1);
      if (!table || table.kind !== "BILLARD") erreur("Billard introuvable.");
      const role = await exigerGestionBillard(acteurId, table.terrasseId);
      const config = await configPour(table.terrasseId);

      return db().transaction(async (tx) => {
        await tx.execute(sql`SELECT id FROM tables_qr WHERE id = ${table.id} FOR UPDATE`);
        await balayerAbsents(table.id, config.delaiPresenceMin);

        const [enCours] = await tx.select({ id: s.partiesBillard.id }).from(s.partiesBillard)
          .where(and(eq(s.partiesBillard.tableId, table.id), eq(s.partiesBillard.statut, "EN_COURS")))
          .limit(1);
        if (enCours) erreur("Une partie est déjà en cours sur ce billard.");

        const tokens = (await tx.select().from(s.tokensBillard)
          .where(eq(s.tokensBillard.tableId, table.id))) as TokenBillard[];
        const actifs = tokens.filter((t) => t.statut !== "SORTI" && t.statut !== "ANNULE" && t.statut !== "ABSENT");
        let vincaire = actifs.find((t) => t.statut === "EN_JEU") ?? null;

        /** Promeut un token EN_FILE en APPELE (appel automatique). */
        const promouvoir = async (t: TokenBillard): Promise<TokenBillard> => {
          await tx.update(s.tokensBillard)
            .set({ statut: "APPELE", appeleLe: maintenant() })
            .where(eq(s.tokensBillard.id, t.id));
          return { ...t, statut: "APPELE" };
        };

        // Sans tenant : le premier arrivé (APPELE ou premier de la
        // file, appelé automatiquement) prend le siège vincaire.
        if (!vincaire) {
          const siege = actifs.find((t) => t.statut === "APPELE")
            ?? null;
          if (siege) {
            vincaire = siege;
          } else {
            const [premier] = fileTriee(actifs);
            if (!premier) erreur("La file est vide : aucun joueur payé en attente.");
            vincaire = await promouvoir(premier);
          }
        }

        // Challenger : joueur APPELE (hors vincaire) sinon premier de
        // la file, appelé automatiquement.
        let challenger = actifs.find((t) => t.statut === "APPELE" && t.id !== vincaire.id) ?? null;
        if (!challenger) {
          const [suivant] = fileTriee(actifs.filter((t) => t.id !== vincaire.id));
          if (!suivant) erreur("Il faut au moins 2 joueurs payés pour lancer une partie.");
          challenger = await promouvoir(suivant);
        }

        const maintenantIso = maintenant();
        for (const t of [vincaire, challenger]) {
          await tx.update(s.tokensBillard).set({ statut: "EN_JEU" })
            .where(eq(s.tokensBillard.id, t.id));
        }
        const plage = plageDuJour();
        const duJour = await tx.select({ id: s.partiesBillard.id }).from(s.partiesBillard)
          .where(and(eq(s.partiesBillard.tableId, table.id), gte(s.partiesBillard.debutLe, plage.debut), lt(s.partiesBillard.debutLe, plage.fin)));
        const [creee] = await tx.insert(s.partiesBillard).values({
          id: uid("prt"), terrasseId: table.terrasseId, tableId: table.id,
          numero: duJour.length + 1,
          vincaireTokenId: vincaire.id, challengerTokenId: challenger.id,
          statut: "EN_COURS", debutLe: maintenantIso,
        }).returning();
        await journaliser(acteurId, role, "BILLARD_PARTIE_LANCEE",
          `Partie #${creee.numero} : #${vincaire.numero} ${vincaire.prenom} vs #${challenger.numero} ${challenger.prenom}`,
          { terrasseId: table.terrasseId });
        return {
          partieId: creee.id, numero: creee.numero,
          vincaire: { id: vincaire.id, numero: vincaire.numero, prenom: vincaire.prenom },
          challenger: { id: challenger.id, numero: challenger.numero, prenom: challenger.prenom },
        };
      });
    }),

  /** Clôture une partie : le gagnant reste (ou devient) vincaire,
   *  le perdant suit la règle configurée, le suivant est appelé.
   *  Transaction + verrou FOR UPDATE sur la partie : deux serveuses
   *  ne peuvent pas clôturer la même partie (annexe §1). */
  terminerPartie: protegee
    .input(z.object({ partieId: z.string(), gagnantTokenId: z.string() }))
    .mutation(async ({ input, ctx }) => {
      const acteurId = ctx.session.utilisateurId;
      const [partie] = await db().select().from(s.partiesBillard)
        .where(eq(s.partiesBillard.id, input.partieId)).limit(1);
      if (!partie) erreur("Partie introuvable.");
      const role = await exigerGestionBillard(acteurId, partie.terrasseId);
      const config = await configPour(partie.terrasseId);

      return db().transaction(async (tx) => {
        const [verrou] = await tx.execute(sql`
          SELECT id, statut FROM parties WHERE id = ${partie.id} FOR UPDATE
        `) as unknown as [{ id: string; statut: string }];
        if (!verrou || verrou.statut !== "EN_COURS") {
          erreur("Cette partie est déjà clôturée ou annulée.");
        }
        if (input.gagnantTokenId !== partie.vincaireTokenId && input.gagnantTokenId !== partie.challengerTokenId) {
          erreur("Le gagnant doit être le vincaire ou le challenger de cette partie.");
        }
        const gagnantId = input.gagnantTokenId;
        const perdantId = gagnantId === partie.vincaireTokenId
          ? partie.challengerTokenId
          : partie.vincaireTokenId;
        const tokens = (await tx.select().from(s.tokensBillard)
          .where(eq(s.tokensBillard.tableId, partie.tableId))) as TokenBillard[];
        const gagnant = tokens.find((t) => t.id === gagnantId);
        const perdant = tokens.find((t) => t.id === perdantId);
        if (!gagnant || !perdant) erreur("Tokens de la partie introuvables.");

        const maintenantIso = maintenant();
        // Perdant : RACHAT/SORTIE → sort du jeu ; FIN_FILE → retour
        // gratuit en fin de file (entreeFileLe = maintenant).
        const sortPerdant = statutApresDefaite(config.reglePerdant);
        await tx.update(s.tokensBillard)
          .set(sortPerdant === "EN_FILE"
            ? { statut: "EN_FILE", entreeFileLe: maintenantIso, serie: 0 }
            : { statut: "SORTI", serie: 0 })
          .where(eq(s.tokensBillard.id, perdant.id));

        // Gagnant : série +1 ; un vincaire qui atteint la limite
        // configurée cède la table en champion (SORTI).
        const serieApres = gagnant.serie + 1;
        const vincaireSort =
          gagnantId === partie.vincaireTokenId && vincaireDoitSortir(serieApres, config.maxPartiesVincaire);
        await tx.update(s.tokensBillard)
          .set({ statut: vincaireSort ? "SORTI" : "EN_JEU", serie: serieApres })
          .where(eq(s.tokensBillard.id, gagnant.id));

        await tx.update(s.partiesBillard)
          .set({ statut: "TERMINEE", finLe: maintenantIso, gagnantTokenId: gagnantId, terminePar: acteurId })
          .where(eq(s.partiesBillard.id, partie.id));

        await journaliser(acteurId, role, "BILLARD_PARTIE_TERMINEE",
          `Partie #${partie.numero} : #${gagnant.numero} ${gagnant.prenom} gagne (série ${serieApres}) — ` +
          `#${perdant.numero} ${perdant.prenom} ${sortPerdant === "EN_FILE" ? "retourne en fin de file" : "sort"}${vincaireSort ? " — le vincaire cède la table (limite atteinte)" : ""}`,
          { terrasseId: partie.terrasseId, avant: "EN_COURS", apres: "TERMINEE" });
        return {
          ok: true as const,
          gagnant: { id: gagnant.id, numero: gagnant.numero, prenom: gagnant.prenom, serie: serieApres },
          perdantSort: sortPerdant,
          vincaireCede: vincaireSort,
        };
      }).then(async (r) => {
        // Hors transaction : le suivant est appelé si la file attend.
        await appelerPremierDeLaFile(partie.tableId);
        return r;
      });
    }),

  /** Déclare absent un joueur appelé (délai dépassé constaté par le
   *  staff). Alerte gérant : token payé perdu (annexe §1). */
  marquerAbsent: protegee
    .input(z.object({ tokenId: z.string() }))
    .mutation(async ({ input, ctx }) => {
      const acteurId = ctx.session.utilisateurId;
      const [t] = await db().select().from(s.tokensBillard)
        .where(eq(s.tokensBillard.id, input.tokenId)).limit(1);
      if (!t) erreur("Token introuvable.");
      const role = await exigerGestionBillard(acteurId, t.terrasseId);
      if (t.statut !== "APPELE") erreur("Seul un joueur appelé peut être déclaré absent.");
      await db().update(s.tokensBillard).set({ statut: "ABSENT" })
        .where(eq(s.tokensBillard.id, t.id));
      await alerter(t.terrasseId, "BILLARD_ABSENT",
        `Token #${t.numero} (${t.prenom}) absent après appel — ${t.prixCdf} FC payés à régulariser`);
      await journaliser(acteurId, role, "BILLARD_TOKEN_ABSENT",
        `Token #${t.numero} (${t.prenom}) déclaré absent`, { terrasseId: t.terrasseId });
      await appelerPremierDeLaFile(t.tableId);
      return { ok: true as const };
    }),

  /** Annule une partie en cours (motif exigé — action sensible).
   *  Le challenger retrouve sa place en tête de file, le vincaire
   *  reste tenant. */
  annulerPartie: protegee
    .input(z.object({ partieId: z.string(), motif: z.string().min(3).max(200) }))
    .mutation(async ({ input, ctx }) => {
      const acteurId = ctx.session.utilisateurId;
      const [partie] = await db().select().from(s.partiesBillard)
        .where(eq(s.partiesBillard.id, input.partieId)).limit(1);
      if (!partie) erreur("Partie introuvable.");
      const role = await exigerGestionBillard(acteurId, partie.terrasseId);
      return db().transaction(async (tx) => {
        const [verrou] = await tx.execute(sql`
          SELECT id, statut FROM parties WHERE id = ${partie.id} FOR UPDATE
        `) as unknown as [{ id: string; statut: string }];
        if (!verrou || verrou.statut !== "EN_COURS") {
          erreur("Cette partie est déjà clôturée ou annulée.");
        }
        await tx.update(s.partiesBillard).set({ statut: "ANNULEE", finLe: maintenant(), terminePar: acteurId })
          .where(eq(s.partiesBillard.id, partie.id));
        // Challenger : retour en file SANS changer entreeFileLe → il
        // reprend sa place d'origine (tête de file).
        await tx.update(s.tokensBillard).set({ statut: "EN_FILE" })
          .where(eq(s.tokensBillard.id, partie.challengerTokenId));
        // Vincaire de la partie sans tenant confirmé (première partie
        // annulée) : il retourne aussi en file.
        const [vinc] = await tx.select().from(s.tokensBillard)
          .where(eq(s.tokensBillard.id, partie.vincaireTokenId ?? "")).limit(1);
        if (vinc && vinc.serie === 0) {
          await tx.update(s.tokensBillard).set({ statut: "EN_FILE" })
            .where(eq(s.tokensBillard.id, vinc.id));
        }
        await journaliser(acteurId, role, "BILLARD_PARTIE_ANNULEE",
          `Partie #${partie.numero} annulée — motif : ${input.motif.trim()}`,
          { terrasseId: partie.terrasseId, avant: "EN_COURS", apres: "ANNULEE" });
        return { ok: true as const };
      });
    }),

  /** Configuration du billard (gérant/propriétaire) : prix du token,
   *  règle du perdant, limite de parties du vincaire, délai de
   *  présence. Avant/après journalisés (annexe §7). */
  configurerBillard: protegee
    .input(z.object({
      terrasseId: z.string(),
      prixTokenCdf: z.number().int().min(0).max(1_000_000).optional(),
      reglePerdant: zReglePerdant.optional(),
      maxPartiesVincaire: z.number().int().min(1).max(50).nullable().optional(),
      delaiPresenceMin: z.number().int().min(1).max(30).optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const acteurId = ctx.session.utilisateurId;
      await exigerGerantOuProprio(acteurId, input.terrasseId);
      const avant = await configPour(input.terrasseId);
      const apres: ConfigBillard = {
        prixTokenCdf: input.prixTokenCdf ?? avant.prixTokenCdf,
        reglePerdant: input.reglePerdant ?? avant.reglePerdant,
        maxPartiesVincaire: input.maxPartiesVincaire === undefined ? avant.maxPartiesVincaire : input.maxPartiesVincaire,
        delaiPresenceMin: input.delaiPresenceMin ?? avant.delaiPresenceMin,
      };
      await db().insert(s.configBillard).values({
        id: uid("cbi"), terrasseId: input.terrasseId,
        prixTokenCdf: apres.prixTokenCdf, reglePerdant: apres.reglePerdant,
        maxPartiesVincaire: apres.maxPartiesVincaire, delaiPresenceMin: apres.delaiPresenceMin,
        modifiePar: acteurId, modifieLe: maintenant(),
      }).onConflictDoUpdate({
        target: s.configBillard.terrasseId,
        set: {
          prixTokenCdf: apres.prixTokenCdf, reglePerdant: apres.reglePerdant,
          maxPartiesVincaire: apres.maxPartiesVincaire, delaiPresenceMin: apres.delaiPresenceMin,
          modifiePar: acteurId, modifieLe: maintenant(),
        },
      });
      await journaliser(acteurId, "GERANT", "BILLARD_CONFIG_MODIFIEE",
        `Token ${apres.prixTokenCdf} FC, perdant ${apres.reglePerdant}, vincaire ${apres.maxPartiesVincaire ?? "illimité"}, présence ${apres.delaiPresenceMin} min`,
        { terrasseId: input.terrasseId, avant: JSON.stringify(avant), apres: JSON.stringify(apres) });
      return apres;
    }),

  /** Statistiques du soir (annexe §1 : recette par billard, nombre
   *  de parties, durée moyenne, heures de pointe, classement).
   *  Permission VOIR_RAPPORTS (propriétaire, gérant — surchargeable). */
  statsBillard: protegee
    .input(z.object({ terrasseId: z.string(), jour: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() }))
    .query(async ({ input, ctx }) => {
      await exigerPermission(ctx.session.utilisateurId, input.terrasseId, "VOIR_RAPPORTS");
      const jour = input.jour ?? jourCourant();
      const plage = plageUtcDuJourLocal(jour);
      const tokens = await db().select().from(s.tokensBillard)
        .where(and(eq(s.tokensBillard.terrasseId, input.terrasseId), gte(s.tokensBillard.creeLe, plage.debut), lt(s.tokensBillard.creeLe, plage.fin)));
      const parties = (await db().select().from(s.partiesBillard)
        .where(and(eq(s.partiesBillard.terrasseId, input.terrasseId), gte(s.partiesBillard.debutLe, plage.debut), lt(s.partiesBillard.debutLe, plage.fin))
        )) as PartieBillard[];
      const payes = tokens.filter((t) => t.payeLe !== null && t.statut !== "ANNULE");
      const terminees = parties.filter((p) => p.statut === "TERMINEE");
      // Classement du jour : victoires par joueur (prénom du token)
      const victoires = new Map<string, number>();
      for (const p of terminees) {
        const g = tokens.find((t) => t.id === p.gagnantTokenId);
        if (g) victoires.set(g.prenom, (victoires.get(g.prenom) ?? 0) + 1);
      }
      // Heures de pointe : parties par tranche horaire
      const parHeure = new Map<number, number>();
      for (const p of terminees) {
        const h = new Date(p.debutLe).getHours();
        parHeure.set(h, (parHeure.get(h) ?? 0) + 1);
      }
      return {
        jour,
        recetteCdf: payes.reduce((a, t) => a + t.prixCdf, 0),
        tokensVendus: payes.length,
        partiesJouees: terminees.length,
        dureeMoyenneMin: dureeMoyennePartiesMin(terminees),
        classement: [...victoires.entries()]
          .map(([prenom, victoiresN]) => ({ prenom, victoires: victoiresN }))
          .sort((a, b) => b.victoires - a.victoires)
          .slice(0, 10),
        heuresDePointe: [...parHeure.entries()]
          .map(([heure, partiesN]) => ({ heure, parties: partiesN }))
          .sort((a, b) => a.heure - b.heure),
      };
    }),

  /** Classement public des 10 meilleurs joueurs (par série de victoires). */
  classementJoueurs: publicQuery
    .input(z.object({ terrasseId: z.string() }))
    .query(async ({ input }) => {
      const joueurs = await db().select({
        id: s.tokensBillard.id,
          prenom: s.tokensBillard.prenom,
          numero: s.tokensBillard.numero,
        serie: s.tokensBillard.serie,
        statut: s.tokensBillard.statut,
      }).from(s.tokensBillard)
        .where(eq(s.tokensBillard.terrasseId, input.terrasseId))
        .orderBy(desc(s.tokensBillard.serie))
        .limit(10);
      
      return joueurs.map((j, index) => ({
        ...j,
        rang: index + 1,
        estChampion: j.statut === 'VINCAIRE' || j.statut === 'ROI',
      }));
    }),
});
