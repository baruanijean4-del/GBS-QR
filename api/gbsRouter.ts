// ============================================================
// GBS — Routeur tRPC métier. Mêmes règles et messages que la
// maquette, mais exécutés côté serveur sur la base partagée.
// ============================================================

import { TRPCError } from "@trpc/server";
import { env } from "./lib/env";
import { ouvrirSessionAppareil, revoquerSessionAppareil } from "./lib/session";
import { chiffrerPin, comparerSecret, dechiffrerPin, estChiffre, estHache, verifierPin } from "./lib/pin";
import { randomInt } from "node:crypto";
import { enregistrerEchec, reinitialiserEchecs, tentativePermise } from "./lib/limiteur";
import { and, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import * as s from "@db/schema";
import type { ActionSensible, Alerte, EntreeAnnuaire, Portee, RoleActif, RoleEtablissement, TypeEtablissement, TypeMouvement, TypeProduit } from "@contracts/types";
import { aTablesDeSalle, CATEGORIES_PAR_TYPE, categorieParLibelle, fraisInstallationPour, tousLesTypes, typeProduitParDefaut, TYPES_ZONE_UNIQUE } from "@contracts/types";
import { createRouter, protegee, publicQuery } from "./middleware";
import {
  ajouterLignesNoteDb, clientDeSessionDb, encaisserNoteDb, noteOuverteDb,
  sommesNoteDb, synchroniserLignesCommandeDb,
} from "./routers/notes";
import { espaceDepuisQr } from "@contracts/notes";
import { getDb } from "./queries/connection";
import { assurerSeed, reinitialiserSeed } from "./gbsSeed";
import { DEMO_PINS } from "../db/fixtures-demo";
import { SUPER_ADMIN_ID, assurerSuperAdmin } from "./lib/superAdmin";
import { peutAvecRoles, surchargesPour } from "./lib/permissions";
import { erreursGroupees } from "./lib/erreursClient";
import { chargerPourClient, chargerPublic, chargerTout, filtrerParPortee, tickAbonnementsSiNecessaire } from "./gbsSnapshot";
import {
  ajouterJours, ajouterMois, codeInvitation, fmtCDF, fmtUSD, joursRestants,
  maintenant, remiseMulti, tarifDe, tokenQR, tranchePourTables, uid,
} from "./gbsUtils";

export function erreur(message: string): never {
  throw new TRPCError({ code: "BAD_REQUEST", message });
}

/** Normalisation téléphone → forme locale (chiffres, sans indicatif) :
 *  « +243 970 000 000 », « 0970000000 », « 243970… » → « 970000000 ». */
function localDe(telephone: string): string {
  return telephone.replace(/\D/g, "").replace(/^243/, "").replace(/^0/, "");
}

/** Garde anti-brute-force : bloque avant même de vérifier le PIN */
function exigerTentativePermise(cle: string): void {
  const attenteMin = tentativePermise(cle);
  if (attenteMin !== null) {
    erreur(`Trop de tentatives — réessayez dans ${attenteMin} min.`);
  }
}

/** Après une connexion réussie sur un PIN legacy (clair ou scrypt) :
 *  réécriture CHIFFRÉE v1 (AES-256-GCM) — migration transparente, à
 *  l'usage, sans script. Aucune exception : le super-admin est chiffré
 *  lui aussi (sa valeur suit ADMIN_PIN via assurerSuperAdmin). */
async function migrerPinSiLegacy(utilisateurId: string, pinSaisi: string, stocke: string): Promise<void> {
  if (utilisateurId === SUPER_ADMIN_ID) return; // géré par assurerSuperAdmin
  if (estChiffre(stocke)) return;
  await db().update(s.utilisateurs).set({ pin: chiffrerPin(pinSaisi) })
    .where(eq(s.utilisateurs.id, utilisateurId));
}

// Quota « Mot de passe oublié » : 20 révélations de PIN par heure,
// toutes instances confondues (compteur en mémoire — un redémarrage
// le remet à zéro, ce qui reste conservateur).
const revelationsPin: number[] = [];
const MAX_REVELATIONS_PIN_PAR_HEURE = 20;
function exigerQuotaRevelationPin(): void {
  const borne = Date.now() - 3_600_000;
  while (revelationsPin.length > 0 && revelationsPin[0]! < borne) revelationsPin.shift();
  if (revelationsPin.length >= MAX_REVELATIONS_PIN_PAR_HEURE) {
    erreur("Limite de consultations de PIN atteinte (20/heure) — réessayez plus tard.");
  }
  revelationsPin.push(Date.now());
}

/** Vérifie le PIN super-admin plateforme (variable d'environnement ADMIN_PIN).
 *  Comparaison à temps constant (timing attack). */
function exigerAdmin(pin: string): void {
  if (!comparerSecret(pin, env.adminPin)) {
    throw new TRPCError({ code: "FORBIDDEN", message: "Accès super-admin refusé : PIN incorrect." });
  }
}

export const db = () => getDb();

// ---------------- Helpers métier (requêtes ciblées) ----------------

export async function estProprietaireDb(utilisateurId: string, terrasseId: string): Promise<boolean> {
  const [t] = await db().select().from(s.terrasses).where(eq(s.terrasses.id, terrasseId)).limit(1);
  if (!t) return false;
  const [org] = await db().select().from(s.organisations).where(eq(s.organisations.id, t.organisationId)).limit(1);
  return org?.proprietaireId === utilisateurId;
}

export async function rolesSurDb(utilisateurId: string, terrasseId: string): Promise<RoleActif[]> {
  const roles: RoleActif[] = [];
  if (await estProprietaireDb(utilisateurId, terrasseId)) roles.push("PROPRIETAIRE");
  const affs = await db().select().from(s.affectations)
    .where(and(eq(s.affectations.utilisateurId, utilisateurId), eq(s.affectations.terrasseId, terrasseId), eq(s.affectations.actif, true)));
  for (const a of affs) roles.push(a.role as RoleActif);
  return roles;
}

async function ecriturePermiseDb(terrasseId: string): Promise<boolean> {
  const [abo] = await db().select().from(s.abonnements).where(eq(s.abonnements.terrasseId, terrasseId)).limit(1);
  if (!abo) return true;
  return abo.statut === "ESSAI" || abo.statut === "ACTIF" || abo.statut === "EN_GRACE";
}

/** Journal d'audit. extras (annexe §7) : établissement + avant/après
 *  pour les actions sensibles — paramètre optionnel, les appels
 *  historiques à 4 arguments restent valides. */
export async function journaliser(
  acteurId: string | null, roleActif: RoleActif | null, action: string, details: string,
  extras?: { terrasseId?: string; avant?: string; apres?: string },
) {
  await db().insert(s.auditLog).values({
    id: uid("aud"), acteurId, roleActif, action, details: details.slice(0, 300),
    terrasseId: extras?.terrasseId ?? null,
    avant: extras?.avant?.slice(0, 2000) ?? null,
    apres: extras?.apres?.slice(0, 2000) ?? null,
    creeLe: maintenant(),
  });
}

export async function alerter(terrasseId: string, type: Alerte["type"], message: string) {
  await db().insert(s.alertes).values({ id: uid("alt"), terrasseId, type, message: message.slice(0, 300), lu: false, creeLe: maintenant() });
}

/** Journalise un mouvement de stock + alerte stock bas si seuil atteint */
async function mouvementDb(
  produitId: string, terrasseId: string, type: TypeMouvement, quantite: number,
  motif: string, acteurId: string | null, roleActif: RoleActif | null,
) {
  await db().insert(s.mouvementsStock).values({
    id: uid("mvt"), produitId, terrasseId, type, quantite, motif: motif.slice(0, 200), acteurId, roleActif, creeLe: maintenant(),
  });
  const [p] = await db().select().from(s.produits).where(eq(s.produits.id, produitId)).limit(1);
  if (p && p.actif && p.stock - p.stockReserve <= p.seuilAlerte && p.stock > 0) {
    const nonLues = await db().select().from(s.alertes)
      .where(and(eq(s.alertes.terrasseId, terrasseId), eq(s.alertes.type, "STOCK_BAS"), eq(s.alertes.lu, false)));
    if (!nonLues.some((a) => a.message.includes(p.nom))) {
      await alerter(terrasseId, "STOCK_BAS", `Stock bas : ${p.nom} (${p.stock - p.stockReserve} disponibles, seuil ${p.seuilAlerte})`);
    }
  }
}

export async function exigerProprietaire(acteurId: string, terrasseId: string) {
  if (!(await estProprietaireDb(acteurId, terrasseId))) {
    const [t] = await db().select().from(s.terrasses).where(eq(s.terrasses.id, terrasseId)).limit(1);
    await journaliser(acteurId, null, "ACCES_REFUSE", `Modification stock/prix tentée sur ${t?.nom ?? terrasseId}`);
    erreur("Seul le Propriétaire modifie le stock et les prix.");
  }
  if (!(await ecriturePermiseDb(terrasseId))) erreur("Terrasse en lecture seule : modification impossible.");
}

export async function exigerGerantOuProprio(acteurId: string, terrasseId: string): Promise<RoleActif> {
  const roles = await rolesSurDb(acteurId, terrasseId);
  if (roles.includes("GERANT")) return "GERANT";
  if (roles.includes("PROPRIETAIRE")) return "PROPRIETAIRE";
  await journaliser(acteurId, null, "ACCES_REFUSE", `Opération QR/assignation tentée sur ${terrasseId}`);
  erreur("Action réservée au Gérant et au Propriétaire.");
}

/** Taux USD→FC courant de l'établissement (règle taux,
 *  docs/REGLE-TAUX-CHANGE.md) : FIGÉ sur chaque ligne de vente au
 *  moment de la vente (commande, token, check-in). null =
 *  établissement mono-devise — la ligne garde NULL, aucune
 *  conversion implicite. */
export async function tauxCourantDb(terrasseId: string): Promise<number | null> {
  const [t] = await db().select({ tauxUsdCdf: s.terrasses.tauxUsdCdf })
    .from(s.terrasses).where(eq(s.terrasses.id, terrasseId)).limit(1);
  return t?.tauxUsdCdf ?? null;
}

export async function nbTablesActivesDb(terrasseId: string): Promise<number> {
  const lignes = await db().select({ id: s.tablesQr.id }).from(s.tablesQr)
    .where(and(eq(s.tablesQr.terrasseId, terrasseId), eq(s.tablesQr.actif, true)));
  return lignes.length;
}

/** Prix mensuel d'une terrasse : tranche × remise multi-terrasses */
async function prixMensuelTerrasseDb(terrasseId: string): Promise<number> {
  const [t] = await db().select().from(s.terrasses).where(eq(s.terrasses.id, terrasseId)).limit(1);
  const [abo] = await db().select().from(s.abonnements).where(eq(s.abonnements.terrasseId, terrasseId)).limit(1);
  if (!t || !abo) return 0;
  const nbTables = await nbTablesActivesDb(terrasseId);
  const soeurs = await db().select({ id: s.terrasses.id }).from(s.terrasses).where(eq(s.terrasses.organisationId, t.organisationId));
  const tarif = await tarifDe(abo.plan as "ESSENTIEL" | "PRO" | "BUSINESS", tranchePourTables(nbTables));
  return Math.round(tarif.prixUsd * (1 - remiseMulti(soeurs.length)));
}

/** Crée une table sur une terrasse (jamais une boutique) et applique le
 *  franchissement de tranche au prorata. Partagé entre `gbs.creerTable`
 *  et `etablissements.ajouterTable`. `kind` : ZONE (défaut) ou BILLARD
 *  (annexe §1 — QR de la file Vincaire). */
export async function ajouterTableDb(
  acteurId: string, terrasseId: string, numeroSouhaite?: number,
  kind: "ZONE" | "BILLARD" = "ZONE",
) {
  await refuserSiBoutique(terrasseId);
  const nbAvant = await nbTablesActivesDb(terrasseId);
  const existantes = await db().select({ numero: s.tablesQr.numero }).from(s.tablesQr)
    .where(eq(s.tablesQr.terrasseId, terrasseId));
  let numero: number;
  if (numeroSouhaite !== undefined) {
    if (existantes.some((t) => t.numero === numeroSouhaite)) erreur(`La table n° ${numeroSouhaite} existe déjà.`);
    numero = numeroSouhaite;
  } else {
    numero = Math.max(0, ...existantes.map((t) => t.numero)) + 1;
  }
  await db().insert(s.tablesQr).values({
    id: uid("tbl"), terrasseId, numero, tokenQr: tokenQR(), kind, actif: true, creeLe: maintenant(),
  });
  const trancheAvant = tranchePourTables(nbAvant);
  const trancheApres = tranchePourTables(nbAvant + 1);
  let prorata = 0;
  const [t] = await db().select().from(s.terrasses).where(eq(s.terrasses.id, terrasseId)).limit(1);
  await journaliser(acteurId, "GERANT", kind === "BILLARD" ? "BILLARD_CREE" : "TABLE_CREEE",
    `${kind === "BILLARD" ? "Billard" : "Table"} ${numero} (${t?.nom ?? ""})`);
  // Franchissement de seuil : application immédiate au prorata
  const [abo] = await db().select().from(s.abonnements).where(eq(s.abonnements.terrasseId, terrasseId)).limit(1);
  if (abo && trancheApres !== trancheAvant) {
    const soeurs = await db().select({ id: s.terrasses.id }).from(s.terrasses)
      .where(eq(s.terrasses.organisationId, t!.organisationId));
    const plan = abo.plan as "ESSENTIEL" | "PRO" | "BUSINESS";
    const diff = Math.round(
      ((await tarifDe(plan, trancheApres)).prixUsd - (await tarifDe(plan, trancheAvant)).prixUsd)
      * (1 - remiseMulti(soeurs.length)),
    );
    const joursPeriode = Math.max(1, Math.round((new Date(abo.periodeFin).getTime() - new Date(abo.periodeDebut).getTime()) / 86_400_000));
    const restants = Math.max(0, joursRestants(abo.periodeFin));
    prorata = Math.round((diff * restants) / joursPeriode);
    await db().update(s.abonnements)
      .set({ prorataDu: abo.prorataDu + prorata, tranche: trancheApres, nbTablesMaxPeriode: Math.max(abo.nbTablesMaxPeriode, nbAvant + 1) })
      .where(eq(s.abonnements.id, abo.id));
    await db().insert(s.historiqueTranches).values({
      id: uid("htr"), abonnementId: abo.id, ancienne: trancheAvant, nouvelle: trancheApres,
      nbTables: nbAvant + 1, prorataUsd: prorata, creePar: acteurId, creeLe: maintenant(),
    });
    await alerter(terrasseId, "ABONNEMENT",
      `« ${t?.nom} » passe en tranche ${trancheApres.toLowerCase()} : +${fmtUSD(diff)}/mois (prorata immédiat ${fmtUSD(prorata)}).`);
  } else if (abo) {
    await db().update(s.abonnements)
      .set({ nbTablesMaxPeriode: Math.max(abo.nbTablesMaxPeriode, nbAvant + 1) })
      .where(eq(s.abonnements.id, abo.id));
  }
  return { trancheAvant, trancheApres, prorata };
}

/** Résout un token QR : table classique, ou QR mural d'une boutique
 *  (redirigé vers sa zone de vente unique « Comptoir »). */
export async function resoudreTableParToken(token: string) {
  const [table] = await db().select().from(s.tablesQr).where(eq(s.tablesQr.tokenQr, token)).limit(1);
  if (table && table.actif) return table;
  const [boutique] = await db().select().from(s.terrasses).where(eq(s.terrasses.tokenQrBoutique, token)).limit(1);
  if (!boutique) return null;
  const [zone] = await db().select().from(s.tablesQr)
    .where(and(eq(s.tablesQr.terrasseId, boutique.id), eq(s.tablesQr.actif, true))).limit(1);
  return zone ?? null;
}

/** Une boutique / quincaillerie / salon n'a qu'une seule zone de vente : refus 403 */
export async function refuserSiBoutique(terrasseId: string) {
  const [t] = await db().select().from(s.terrasses).where(eq(s.terrasses.id, terrasseId)).limit(1);
  if (t && TYPES_ZONE_UNIQUE.includes(t.typeEtablissement as TypeEtablissement)) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Cet établissement n'a qu'une seule zone de vente (« Comptoir ») : impossible d'ajouter une table.",
    });
  }
}

const zRoleEtab = z.enum([
  "GERANT", "SERVEUSE", "CAISSIER", "CUISINE_BAR", "BILLARDIER",
  "RECEPTIONNISTE", "GOUVERNANTE", "PHARMACIEN", "VENDEUR", "PRESTATAIRE",
]);
const zMethode = z.enum(["M_PESA", "AIRTEL_MONEY", "ORANGE_MONEY"]);

const zPortee = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("public") }),
  z.object({ kind: z.literal("admin"), pin: z.string() }),
  // staff : l'identité vient du jeton Bearer (ctx.session) — un éventuel
  // utilisateurId legacy dans l'entrée est ignoré par Zod
  z.object({ kind: z.literal("staff") }),
  // sessionId tolérant : accepte undefined ET null (d'anciens clients en cache
  // peuvent encore envoyer null) ; on normalise null → undefined pour le type Portee
  z.object({
    kind: z.literal("client"),
    token: z.string(),
    sessionId: z
      .string()
      .nullish()
      .transform((v) => v ?? undefined),
  }),
]);

// ============================================================
// ROUTEUR
// ============================================================

export const gbsRouter = createRouter({
  /** Image des données filtrée par portée (+ tick du cycle de vie) */
  snapshot: publicQuery
    .input(z.object({ portee: zPortee }))
    .query(async ({ input, ctx }) => {
      if (input.portee.kind === "admin") exigerAdmin(input.portee.pin);
      // Portée staff : identité = jeton vérifié, jamais un id envoyé par le client
      let portee: Portee;
      if (input.portee.kind === "staff") {
        if (!ctx.session) {
          throw new TRPCError({ code: "UNAUTHORIZED", message: "Session expirée ou invalide — reconnectez-vous." });
        }
        portee = { kind: "staff", utilisateurId: ctx.session.utilisateurId };
      } else {
        portee = input.portee;
      }
      await assurerSeed();
      await tickAbonnementsSiNecessaire();
      // Chargeurs ciblés (peu de tables → réponse rapide malgré la latence Neon) ;
      // les écrans staff/admin gardent l'image complète (chargerTout).
      if (portee.kind === "client") {
        const partiel = await chargerPourClient(portee);
        return filtrerParPortee(partiel, portee);
      }
      if (portee.kind === "public") {
        const partiel = await chargerPublic();
        return filtrerParPortee(partiel, portee);
      }
      const tout = await chargerTout();
      return filtrerParPortee(tout, portee);
    }),

  /** Vérification du PIN super-admin (porte d'entrée de la page /admin).
   *  Comparaison à temps constant + anti-brute-force par IP. */
  verifierPinAdmin: publicQuery
    .input(z.object({ pin: z.string() }))
    .query(({ input, ctx }) => {
      const cle = `admin:${ctx.ip}`;
      exigerTentativePermise(cle);
      const ok = comparerSecret(input.pin, env.adminPin);
      if (!ok) enregistrerEchec(cle);
      else reinitialiserEchecs(cle);
      return { ok };
    }),

  /** Super-admin : journal des erreurs client, groupées par message
   *  (Phase B.6 — « qu'est-ce qui casse en production ? »). */
  erreursClient: publicQuery
    .input(z.object({ pin: z.string() }))
    .query(async ({ input }) => {
      exigerAdmin(input.pin);
      return erreursGroupees();
    }),

  /** Super-admin — « Mot de passe oublié », étape 1 : recherche par
   *  numéro de téléphone. Le PIN est TOUJOURS renvoyé masqué ; sa
   *  révélation est une action séparée (revelerPin), limitée et
   *  journalisée. « lisible » = déchiffrable (v1) ou clair legacy ;
   *  un compte haché scrypt ne peut être ni vérifié ni affiché —
   *  il relève d'une réinitialisation (accord du propriétaire). */
  rechercherCompte: publicQuery
    .input(z.object({ pinAdmin: z.string(), telephone: z.string().min(6).max(30) }))
    .mutation(async ({ input }) => {
      exigerAdmin(input.pinAdmin);
      const chiffres = localDe(input.telephone);
      const tous = await db().select().from(s.utilisateurs);
      return tous
        .filter((u) => u.id !== SUPER_ADMIN_ID && localDe(u.telephone) === chiffres)
        .map((u) => ({
          id: u.id,
          nom: u.nom,
          telephone: u.telephone,
          pinMasque: "••••",
          lisible: estChiffre(u.pin) || !estHache(u.pin),
        }));
    }),

  /** Super-admin — « Mot de passe oublié », étape 2 : révèle le PIN
   *  pour un affichage de 30 s côté client. Exige une méthode de
   *  vérification d'identité (appel, WhatsApp, présentiel), limité à
   *  20 révélations/heure, chaque consultation écrite au journal
   *  d'audit — le PIN lui-même n'y figure JAMAIS, pas plus que dans
   *  les journaux serveur, les exports ou Sentry. */
  revelerPin: publicQuery
    .input(z.object({
      pinAdmin: z.string(),
      utilisateurId: z.string(),
      methodeVerification: z.enum(["APPEL", "WHATSAPP", "PRESENTIEL"]),
    }))
    .mutation(async ({ input }) => {
      exigerAdmin(input.pinAdmin);
      exigerQuotaRevelationPin();
      const [u] = await db().select().from(s.utilisateurs)
        .where(eq(s.utilisateurs.id, input.utilisateurId)).limit(1);
      if (!u || u.id === SUPER_ADMIN_ID) erreur("Compte introuvable.");
      const pin = estChiffre(u.pin) ? dechiffrerPin(u.pin) : (estHache(u.pin) ? null : u.pin);
      if (pin === null) {
        await journaliser("super_admin", "SUPER_ADMIN", "CONSULTATION_PIN_ILISIBLE",
          `Compte ${u.nom} — PIN haché legacy, réinitialisation requise (vérification ${input.methodeVerification}).`);
        erreur("PIN illisible (compte haché) — réinitialisation du compte requise.");
      }
      await journaliser("super_admin", "SUPER_ADMIN", "CONSULTATION_PIN",
        `PIN du compte ${u.nom} révélé au super-admin (vérification ${input.methodeVerification}). Le PIN n'est jamais écrit dans ce journal.`);
      return { pin, dureeAffichageSecondes: 30 };
    }),

  /** Super-admin — « Mot de passe oublié », recours pour un compte
   *  dont le PIN est ILLISIBLE (haché scrypt legacy, irréversible) :
   *  génère un NOUVEAU PIN aléatoire (6 chiffres, crypto), l'écrit
   *  CHIFFRÉ (AES-256-GCM v1) et le renvoie pour un affichage de
   *  30 s côté client — à communiquer au titulaire après vérification
   *  d'identité (appel, WhatsApp, présentiel). Mêmes garde-fous que
   *  la révélation : quota 20/heure, journal d'audit immuable — le
   *  PIN (ancien impossible, nouveau jamais) ne figure NULLE PART. */
  reinitialiserPin: publicQuery
    .input(z.object({
      pinAdmin: z.string(),
      utilisateurId: z.string(),
      methodeVerification: z.enum(["APPEL", "WHATSAPP", "PRESENTIEL"]),
    }))
    .mutation(async ({ input }) => {
      exigerAdmin(input.pinAdmin);
      exigerQuotaRevelationPin();
      const [u] = await db().select().from(s.utilisateurs)
        .where(eq(s.utilisateurs.id, input.utilisateurId)).limit(1);
      if (!u || u.id === SUPER_ADMIN_ID) erreur("Compte introuvable.");
      // 6 chiffres, aléa cryptographique (100000-999999) — compatible
      // avec les champs PIN de l'application (numérique, 6 max).
      const nouveauPin = String(randomInt(100000, 1000000));
      const [maj] = await db().update(s.utilisateurs)
        .set({ pin: chiffrerPin(nouveauPin) })
        .where(eq(s.utilisateurs.id, u.id))
        .returning({ id: s.utilisateurs.id });
      if (!maj) erreur("Compte introuvable.");
      await journaliser("super_admin", "SUPER_ADMIN", "REINITIALISATION_PIN",
        `PIN du compte ${u.nom} réinitialisé par le super-admin (vérification ${input.methodeVerification}). Le PIN n'est jamais écrit dans ce journal.`);
      return { pin: nouveauPin, dureeAffichageSecondes: 30 };
    }),

  /** Annuaire démo pour la page de connexion (personas + PIN affichés) */
  annuaire: publicQuery.query(async (): Promise<EntreeAnnuaire[]> => {
    if (!env.annuaireDemo) return []; // désactivé en production (ANNUAIRE_DEMO=false)
    await assurerSeed();
    const [utilisateurs, affectations, terrasses, organisations] = await Promise.all([
      db().select().from(s.utilisateurs),
      db().select().from(s.affectations),
      db().select().from(s.terrasses),
      db().select().from(s.organisations),
    ]);
    return utilisateurs
      // Le super-admin n'apparaît JAMAIS ici : son PIN est le secret
      // de la plateforme, l'annuaire démo affiche les PIN en clair.
      .filter((u) => u.id !== SUPER_ADMIN_ID)
      .map((u) => {
      const roles = new Set<RoleActif>();
      const ids = new Set<string>();
      for (const o of organisations) {
        if (o.proprietaireId === u.id) {
          roles.add("PROPRIETAIRE");
          terrasses.filter((t) => t.organisationId === o.id).forEach((t) => ids.add(t.id));
        }
      }
      for (const a of affectations) {
        if (a.utilisateurId === u.id && a.actif) {
          roles.add(a.role as RoleActif);
          ids.add(a.terrasseId);
        }
      }
      return {
        // PIN hachés en base : l'annuaire démo lit les PIN connus des
        // comptes de démonstration (DEMO_PINS), jamais la valeur stockée.
        id: u.id, nom: u.nom, telephone: u.telephone,
        pin: estHache(u.pin) ? (DEMO_PINS[u.telephone] ?? "••••") : u.pin,
        roles: Array.from(roles),
        terrasses: terrasses.filter((t) => ids.has(t.id)).map((t) => ({ id: t.id, nom: t.nom })),
      };
    });
  }),

  /** Connexion du personnel : PIN vérifié côté serveur → jeton signé 12 h.
   *  Le jeton est l'unique preuve d'identité acceptée par les mutations staff.
   *  On retourne aussi terrasses + rôles pour router l'utilisateur sans
   *  dépendre de l'annuaire démo (désactivé en production). */
  connexionPin: publicQuery
    .input(z.object({ utilisateurId: z.string(), pin: z.string(), appareilId: z.string().max(60).optional() }))
    .mutation(async ({ input, ctx }) => {
      // Anti-brute-force : 5 échecs (IP + compte) → blocage 5 min
      const cle = `pin:${ctx.ip}:${input.utilisateurId}`;
      exigerTentativePermise(cle);
      const [u] = await db().select().from(s.utilisateurs).where(eq(s.utilisateurs.id, input.utilisateurId)).limit(1);
      if (!u || !verifierPin(input.pin, u.pin)) {
        enregistrerEchec(cle);
        erreur("Code PIN incorrect.");
      }
      reinitialiserEchecs(cle);
      await migrerPinSiLegacy(u.id, input.pin, u.pin);
      return reponseConnexionDb(u, input.appareilId);
    }),

  /** Entrée de connexion unique : numéro de téléphone + PIN.
   *  Le numéro est normalisé (chiffres seuls) : « +243 810 000 001 »,
   *  « 0810000001 »… mènent au même compte. Message d'erreur volontairement
   *  ambigu pour ne pas révéler si le numéro existe. */
  connexionTelephone: publicQuery
    .input(z.object({ telephone: z.string().min(6).max(30), pin: z.string().min(1), appareilId: z.string().max(60).optional() }))
    .mutation(async ({ input, ctx }) => {
      await assurerSeed();
      await assurerSuperAdmin(); // le compte plateforme existe même en production
      const chiffres = input.telephone.replace(/\D/g, "");
      if (!chiffres) erreur("Numéro de téléphone ou code PIN incorrect.");
      // Anti-brute-force : 5 échecs (IP + numéro) → blocage 5 min
      const cle = `tel:${ctx.ip}:${chiffres}`;
      exigerTentativePermise(cle);
      // Comparaison sur les chiffres seuls, tolérante au format :
      // « +243 810 000 001 », « 243810… », « 0810… » → même compte.
      const local = chiffres.replace(/^243/, "").replace(/^0/, "");
      // Collision possible : un commerçant inscrit avec le numéro
      // technique du super-admin (défaut public +243970000000) partage
      // les mêmes chiffres. LIMIT 1 sans ordre pouvait rendre l'autre
      // ligne et VERROUILLER l'accès plateforme (bug réel constaté en
      // audit). On relève tous les candidats (super-admin d'abord) et
      // le PIN — le secret — départage : chacun garde SON compte.
      const candidats = await db().select().from(s.utilisateurs)
        .where(sql`regexp_replace(${s.utilisateurs.telephone}, '[^0-9]', '', 'g') IN (${chiffres}, ${local}, ${`0${local}`}, ${`243${local}`})`)
        .orderBy(sql`CASE WHEN ${s.utilisateurs.id} = ${SUPER_ADMIN_ID} THEN 0 ELSE 1 END`)
        .limit(4); // borne de sécurité : normalement 1, collision admin = 2
      const u = candidats.find((c) => verifierPin(input.pin, c.pin));
      if (!u) {
        enregistrerEchec(cle);
        erreur("Numéro de téléphone ou code PIN incorrect.");
      }
      reinitialiserEchecs(cle);
      await migrerPinSiLegacy(u.id, input.pin, u.pin);
      return reponseConnexionDb(u, input.appareilId);
    }),

  /** Appareils connectés : sessions actives du compte courant
   *  (non révoquées, durée absolue non dépassée). Le champ « courant »
   *  repère CET appareil. Mode fixe (SESSION_GLISSANTE=0) : liste vide. */
  mesAppareils: protegee.query(async ({ ctx }) => {
    const lignes = await db().select().from(s.sessionsAppareils)
      .where(eq(s.sessionsAppareils.utilisateurId, ctx.session.utilisateurId));
    const maintenantIso = new Date().toISOString();
    return lignes
      .filter((l) => !l.revoqueLe && l.expireAbsoluLe > maintenantIso)
      .map((l) => ({
        sessionId: l.id,
        appareilId: l.appareilId,
        creeLe: l.creeLe,
        derniereActiviteLe: l.derniereActiviteLe,
        courant: l.id === (ctx.session.sid ?? null),
      }))
      .sort((a, b) => b.derniereActiviteLe.localeCompare(a.derniereActiviteLe));
  }),

  /** Déconnexion : révoque la session de CET appareil. Les autres
   *  appareils du compte restent connectés. No-op en mode fixe. */
  deconnexion: protegee.mutation(async ({ ctx }) => {
    if (ctx.session.sid) {
      await revoquerSessionAppareil(ctx.session.sid);
      await journaliser(ctx.session.utilisateurId, null, "DECONNEXION", `Session ${ctx.session.sid} révoquée (déconnexion)`);
    }
    return { ok: true as const };
  }),

  /** Révoque l'appareil d'un compte : le sien, ou celui d'un membre de
   *  SES établissements quand on est propriétaire (téléphone perdu,
   *  départ d'un employé…). Effet à la requête suivante de l'appareil. */
  revoquerAppareil: protegee
    .input(z.object({ sessionId: z.string().min(1) }))
    .mutation(async ({ input, ctx }) => {
      const [ligne] = await db().select().from(s.sessionsAppareils)
        .where(eq(s.sessionsAppareils.id, input.sessionId)).limit(1);
      if (!ligne) erreur("Session introuvable.");
      if (ligne.utilisateurId !== ctx.session.utilisateurId
        && !(await estProprioDuMembre(ctx.session.utilisateurId, ligne.utilisateurId))) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Seul le propriétaire révoque les appareils de ses membres." });
      }
      await revoquerSessionAppareil(ligne.id);
      await journaliser(ctx.session.utilisateurId, null, "SESSION_REVOQUEE",
        `Session ${ligne.id} (utilisateur ${ligne.utilisateurId}) révoquée par ${ctx.session.utilisateurId}`);
      return { ok: true as const };
    }),

  /** Infos publiques d'une table scannée (QR) */
  contexteTable: publicQuery
    .input(z.object({ token: z.string() }))
    .query(async ({ input }) => {
      await assurerSeed();
      const table = await resoudreTableParToken(input.token);
      if (!table) erreur("QR code invalide ou révoqué.");
      const [terrasse] = await db().select().from(s.terrasses).where(eq(s.terrasses.id, table.terrasseId)).limit(1);
      if (!terrasse) erreur("Établissement introuvable.");
      return {
        table: { id: table.id, numero: table.numero, terrasseId: table.terrasseId },
        terrasse: { id: terrasse.id, nom: terrasse.nom, adresse: terrasse.adresse },
        typeEtablissement: (terrasse.typeEtablissement ?? "TERRASSE") as TypeEtablissement,
        ecriture: await ecriturePermiseDb(terrasse.id),
      };
    }),

  // ---------------- CLIENT ----------------

  ouvrirSessionClient: publicQuery
    .input(z.object({
      token: z.string(),
      prenom: z.string().max(60).default(""),
      // ANNEXE-2 §2 : le clientSessionId est stocké en localStorage —
      // un second scan (autre QR du même domaine) RECONNAÎT le client
      // sans redemander le prénom.
      clientSessionId: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      const table = await resoudreTableParToken(input.token);
      if (!table) erreur("QR code invalide ou révoqué.");
      if (input.clientSessionId) {
        const [existante] = await db().select().from(s.clientsSession)
          .where(eq(s.clientsSession.id, input.clientSessionId)).limit(1);
        if (existante) return existante;
      }
      if (!input.prenom.trim()) erreur("Indiquez votre prénom pour commander.");
      const session = { id: uid("cli"), tableId: table.id, prenom: input.prenom.trim(), creeLe: maintenant() };
      await db().insert(s.clientsSession).values(session);
      return session;
    }),

  passerCommande: publicQuery
    .input(z.object({
      token: z.string(),
      clientSessionId: z.string(),
      lignes: z.array(z.object({ produitId: z.string(), quantite: z.number().int().positive() })).min(1),
      cleIdempotence: z.string().min(8).max(60),
    }))
    .mutation(async ({ input }) => {
      const table = await resoudreTableParToken(input.token);
      if (!table) erreur("QR code invalide ou révoqué.");
      if (!(await ecriturePermiseDb(table.terrasseId))) erreur("Service momentanément indisponible.");

      // Idempotence : la même clé renvoie la commande existante
      // (doit passer AVANT les gardes ci-dessous : un retry réseau de la
      // commande en cours n'est jamais bloqué)
      const [existante] = await db().select().from(s.commandes).where(eq(s.commandes.cleIdempotence, input.cleIdempotence)).limit(1);
      if (existante) return { id: existante.id, statut: existante.statut };

      // Étanchéité : la session client doit appartenir à la table du token
      // scanné — sinon on pourrait commander « au nom de » la session d'un
      // autre client (sa note gonflerait)
      const [sessClient] = await db().select().from(s.clientsSession).where(eq(s.clientsSession.id, input.clientSessionId)).limit(1);
      if (!sessClient || sessClient.tableId !== table.id) {
        erreur("Session invalide pour cette table — rescannez le QR code posé dessus.");
      }

      // Règle cash : une commande SERVIE non encore encaissée bloque la
      // suivante — la serveuse / le comptoir doit d'abord marquer « payée ».
      // ANNEXE-2 §6 : si l'établissement a configuré un PLAFOND DE NOTE,
      // c'est le reste dû de la note unique qui fait foi (le client peut
      // consommer dans plusieurs espaces tant qu'il reste sous le plafond ;
      // les clients en chambre sont garantis par le folio et exemptés).
      const [terrCommande] = await db().select().from(s.terrasses).where(eq(s.terrasses.id, table.terrasseId)).limit(1);
      if (terrCommande?.notePlafondCdf != null) {
        const client = await clientDeSessionDb(sessClient.id);
        const note = client ? await noteOuverteDb(client.id) : null;
        if (note && !note.sejourId) {
          const sommes = await sommesNoteDb(note.id);
          if (sommes.resteCdf > terrCommande.notePlafondCdf) {
            erreur("Note au-delà du plafond — réglez d'abord auprès de la serveuse ou au comptoir.");
          }
        }
      } else {
        const [impayee] = await db().select({ id: s.commandes.id }).from(s.commandes)
          .where(and(
            eq(s.commandes.clientSessionId, sessClient.id),
            eq(s.commandes.statut, "SERVIE"),
            isNull(s.commandes.payeeLe),
          )).limit(1);
        if (impayee) {
          erreur("Une commande servie attend son paiement — réglez d'abord auprès de la serveuse ou au comptoir.");
        }
      }

      // Vérification du stock + prix recalculés côté serveur
      const lignes: { produitId: string; nom: string; quantite: number; prixCdf: number; prixUsdCentimes: number }[] = [];
      for (const l of input.lignes) {
        const [p] = await db().select().from(s.produits).where(eq(s.produits.id, l.produitId)).limit(1);
        if (!p || !p.actif) erreur("Un produit de votre commande n'est plus à la carte.");
        const dispo = p.stock - p.stockReserve;
        if (dispo < l.quantite) {
          await journaliser(null, "CLIENT", "COMMANDE_REFUSEE_STOCK", `${p.nom} : demandé ${l.quantite}, disponible ${dispo}`);
          erreur(`Stock insuffisant pour ${p.nom}. Disponible : ${dispo}.`);
        }
        lignes.push({ produitId: p.id, nom: p.nom, quantite: l.quantite, prixCdf: p.prixCdf, prixUsdCentimes: p.prixUsd });
      }

      const commandeId = uid("cmd");
      // Règle taux : le taux du jour est FIGÉ sur la commande au
      // moment où le client valide (prix annoncé = taux appliqué).
      const tauxVente = await tauxCourantDb(table.terrasseId);
      await db().transaction(async (tx) => {
        for (const l of lignes) {
          // Verrou pessimiste (FOR UPDATE) + revérification DANS la
          // transaction : deux commandes simultanées ne peuvent plus
          // réserver toutes les deux le même dernier stock (TOCTOU).
          const [p] = await tx.select().from(s.produits)
            .where(eq(s.produits.id, l.produitId)).limit(1).for("update");
          if (!p) erreur("Un produit de votre commande n'est plus à la carte.");
          const dispo = p.stock - p.stockReserve;
          if (dispo < l.quantite) {
            erreur(`Stock insuffisant pour ${l.nom}. Disponible : ${dispo}.`);
          }
          await tx.update(s.produits).set({ stockReserve: p.stockReserve + l.quantite })
            .where(eq(s.produits.id, l.produitId));
        }
        await tx.insert(s.commandes).values({
          id: commandeId, terrasseId: table.terrasseId, tableId: table.id,
          clientSessionId: input.clientSessionId, statut: "EN_ATTENTE", lignes,
          totalCdf: lignes.reduce((x, l) => x + l.prixCdf * l.quantite, 0),
          totalUsd: lignes.reduce((x, l) => x + l.prixUsdCentimes * l.quantite, 0),
          tauxUsdCdf: tauxVente,
          cleIdempotence: input.cleIdempotence, creeLe: maintenant(),
        });
      });
      for (const l of lignes) {
        await mouvementDb(l.produitId, table.terrasseId, "RESERVATION", l.quantite, `Commande table ${table.numero}`, null, null);
      }
      // ANNEXE-2 §3 : la commande s'ajoute à la NOTE UNIQUE du client
      // (idempotent par référence « commandeId:index »).
      await ajouterLignesNoteDb({
        clientSessionId: input.clientSessionId,
        terrasseId: table.terrasseId,
        espace: espaceDepuisQr(table.kind, terrCommande?.typeEtablissement ?? "TERRASSE"),
        type: "COMMANDE",
        lignes: lignes.map((l, i) => ({
          refId: `${commandeId}:${i}`, libelle: l.nom, quantite: l.quantite,
          montantCdf: l.prixCdf * l.quantite, montantUsd: l.prixUsdCentimes * l.quantite,
          statut: "EN_ATTENTE" as const, tauxUsdCdf: tauxVente,
        })),
      });
      return { id: commandeId, statut: "EN_ATTENTE" as const };
    }),

  annulerMaCommande: publicQuery
    .input(z.object({ commandeId: z.string(), clientSessionId: z.string() }))
    .mutation(async ({ input }) => {
      const [c] = await db().select().from(s.commandes).where(eq(s.commandes.id, input.commandeId)).limit(1);
      if (!c || c.clientSessionId !== input.clientSessionId) erreur("Commande introuvable.");
      if (c.statut !== "EN_ATTENTE") erreur("Trop tard : la commande est déjà confirmée.");
      await libererStockDb(c.id);
      await db().update(s.commandes)
        .set({ statut: "ANNULEE", annuleLe: maintenant(), motifAnnulation: "Annulée par le client" })
        .where(eq(s.commandes.id, c.id));
      await synchroniserLignesCommandeDb(c.id, "ANNULEE", null, "Annulée par le client");
      return { ok: true as const };
    }),

  noterServeuse: publicQuery
    .input(z.object({
      commandeId: z.string(), clientSessionId: z.string(),
      note: z.number().int().min(1).max(5), commentaire: z.string().max(300).default(""),
    }))
    .mutation(async ({ input }) => {
      const [c] = await db().select().from(s.commandes).where(eq(s.commandes.id, input.commandeId)).limit(1);
      if (!c || c.clientSessionId !== input.clientSessionId) erreur("Commande introuvable.");
      if (c.statut !== "SERVIE") erreur("Vous pourrez noter le service une fois servi.");
      const [deja] = await db().select().from(s.avis).where(eq(s.avis.commandeId, input.commandeId)).limit(1);
      if (deja) erreur("Vous avez déjà donné votre avis pour cette commande.");
      let serveuseId = c.serviePar;
      if (!serveuseId) {
        const [ts] = await db().select().from(s.tableServeuse)
          .where(and(eq(s.tableServeuse.tableId, c.tableId), eq(s.tableServeuse.actif, true))).limit(1);
        serveuseId = ts?.serveuseId ?? null;
      }
      if (!serveuseId) erreur("Aucune serveuse associée à cette commande.");
      await db().insert(s.avis).values({
        id: uid("avi"), commandeId: c.id, serveuseId, terrasseId: c.terrasseId,
        note: input.note, commentaire: input.commentaire.trim(), masque: false, creeLe: maintenant(),
      });
      // Alerte : 3 avis ≤ 2 étoiles en 7 jours
      const septJours = ajouterJours(maintenant(), -7);
      const avisServeuse = await db().select().from(s.avis)
        .where(and(eq(s.avis.serveuseId, serveuseId), eq(s.avis.masque, false)));
      const mauvais = avisServeuse.filter((a) => a.note <= 2 && a.creeLe >= septJours).length;
      if (mauvais >= 3) {
        const [u] = await db().select().from(s.utilisateurs).where(eq(s.utilisateurs.id, serveuseId)).limit(1);
        await alerter(c.terrasseId, "AVIS_NEGATIFS", `${u?.nom ?? "Une serveuse"} : ${mauvais} avis à 2 étoiles ou moins en 7 jours.`);
      }
      return { ok: true as const };
    }),


  // ---------------- SERVEUSE / STAFF ----------------

  confirmerCommande: protegee
    .input(z.object({ commandeId: z.string() }))
    .mutation(async ({ input, ctx }) => {
      const acteurId = ctx.session.utilisateurId;
      const c = await commandePourRoleDb(input.commandeId, acteurId);
      if (c.statut !== "EN_ATTENTE") erreur("Cette commande a déjà été traitée.");
      await db().update(s.commandes).set({ statut: "CONFIRMEE", confirmeeLe: maintenant() }).where(eq(s.commandes.id, c.id));
      await synchroniserLignesCommandeDb(c.id, "CONFIRMEE", acteurId);
      const [t] = await db().select().from(s.tablesQr).where(eq(s.tablesQr.id, c.tableId)).limit(1);
      const roles = await rolesSurDb(acteurId, c.terrasseId);
      await journaliser(acteurId, roles[0] ?? null, "COMMANDE_CONFIRMEE", `Table ${t?.numero ?? "?"}`);
      return { ok: true as const };
    }),

  marquerServie: protegee
    .input(z.object({ commandeId: z.string() }))
    .mutation(async ({ input, ctx }) => {
      const acteurId = ctx.session.utilisateurId;
      const c = await commandePourRoleDb(input.commandeId, acteurId);
      if (c.statut !== "CONFIRMEE") erreur("La commande doit d'abord être confirmée.");
      await db().update(s.commandes)
        .set({ statut: "SERVIE", servieLe: maintenant(), serviePar: acteurId })
        .where(eq(s.commandes.id, c.id));
      await synchroniserLignesCommandeDb(c.id, "SERVIE", acteurId);
      const [t] = await db().select().from(s.tablesQr).where(eq(s.tablesQr.id, c.tableId)).limit(1);
      for (const l of c.lignes) {
        const [p] = await db().select().from(s.produits).where(eq(s.produits.id, l.produitId)).limit(1);
        if (p) {
          await db().update(s.produits).set({
            stock: p.stock - l.quantite,
            stockReserve: Math.max(0, p.stockReserve - l.quantite),
          }).where(eq(s.produits.id, p.id));
          await mouvementDb(p.id, c.terrasseId, "VENTE", -l.quantite, `Commande table ${t?.numero ?? "?"}`, null, null);
        }
      }
      return { ok: true as const };
    }),

  /**
   * Encaissement cash : la serveuse / le comptoir confirme avoir reçu le
   * montant de la commande. Tant qu'une commande SERVIE n'est pas payée,
   * le client ne peut pas recommander (garde dans passerCommande).
   * Idempotent : un double-tap réseau renvoie ok sans re-journaliser.
   */
  marquerPayee: protegee
    .input(z.object({ commandeId: z.string() }))
    .mutation(async ({ input, ctx }) => {
      const acteurId = ctx.session.utilisateurId;
      const c = await commandePourRoleDb(input.commandeId, acteurId);
      if (c.statut === "ANNULEE") erreur("Cette commande est annulée.");
      if (c.payeeLe) return { ok: true as const };
      // Encaissement atomique : la condition « payee_le IS NULL » est
      // DANS le UPDATE — deux encaissements simultanés (double-tap,
      // deux serveuses) ne peuvent pas passer tous les deux : le second
      // n'affecte aucune ligne et devient un no-op idempotent, sans
      // doublon dans le journal d'audit.
      const [encaissee] = await db().update(s.commandes)
        .set({ payeeLe: maintenant(), payeePar: acteurId })
        .where(and(eq(s.commandes.id, c.id), isNull(s.commandes.payeeLe)))
        .returning({ id: s.commandes.id });
      if (!encaissee) return { ok: true as const };
      const [t] = await db().select().from(s.tablesQr).where(eq(s.tablesQr.id, c.tableId)).limit(1);
      const roles = await rolesSurDb(acteurId, c.terrasseId);
      await journaliser(acteurId, roles[0] ?? null, "COMMANDE_PAYEE",
        `Table ${t?.numero ?? "?"} — ${fmtCDF(c.totalCdf)}${c.totalUsd ? ` + ${fmtUSD(c.totalUsd)}` : ""}`);
      // ANNEXE-2 §5 : si la commande est rattachée à une note, le cash
      // reçu suit la note (EN_MAIN de l'employé + ventilation par
      // espace). Sans note liée (historique), comportement inchangé.
      const [ligneNote] = await db().select({ noteId: s.noteLignes.noteId }).from(s.noteLignes)
        .where(and(eq(s.noteLignes.type, "COMMANDE"), sql`${s.noteLignes.refId} LIKE ${`${c.id}:%`}`)).limit(1);
      if (ligneNote) {
        const sommes = await sommesNoteDb(ligneNote.noteId);
        const cdf = Math.min(c.totalCdf, sommes.resteCdf);
        const usd = Math.min(c.totalUsd, sommes.resteUsd);
        if (cdf > 0 || usd > 0) {
          await encaisserNoteDb({ noteId: ligneNote.noteId, acteurId, montantCdf: cdf, montantUsd: usd, mode: "CASH" });
        }
      }
      return { ok: true as const };
    }),

  annulerCommandeStaff: protegee
    .input(z.object({ commandeId: z.string(), motif: z.string().max(200).default("") }))
    .mutation(async ({ input, ctx }) => {
      const acteurId = ctx.session.utilisateurId;
      const c = await commandePourRoleDb(input.commandeId, acteurId);
      if (c.statut === "SERVIE" || c.statut === "ANNULEE") erreur("Cette commande est déjà clôturée.");
      // Une commande déjà encaissée (prépaiement au comptoir) ne s'annule
      // plus par l'application : le remboursement se fait à la main, en cash
      if (c.payeeLe) erreur("Commande déjà encaissée : remboursez le client à la main, en cash.");
      await libererStockDb(c.id);
      const motif = input.motif.trim() || "Annulée par le staff";
      await db().update(s.commandes)
        .set({ statut: "ANNULEE", annuleLe: maintenant(), motifAnnulation: motif })
        .where(eq(s.commandes.id, c.id));
      await synchroniserLignesCommandeDb(c.id, "ANNULEE", acteurId, motif);
      const roles = await rolesSurDb(acteurId, c.terrasseId);
      await journaliser(acteurId, roles[0] ?? null, "COMMANDE_ANNULEE", motif);
      return { ok: true as const };
    }),

  ouvrirSessionService: protegee
    .input(z.object({ terrasseId: z.string() }))
    .mutation(async ({ input, ctx }) => {
      const serveuseId = ctx.session.utilisateurId;
      if (!(await ecriturePermiseDb(input.terrasseId))) erreur("Terrasse en lecture seule.");
      const [deja] = await db().select().from(s.sessionsService)
        .where(and(
          eq(s.sessionsService.terrasseId, input.terrasseId),
          eq(s.sessionsService.serveuseId, serveuseId),
          eq(s.sessionsService.statut, "OUVERTE"),
        )).limit(1);
      if (deja) erreur("Votre session est déjà ouverte.");
      await db().insert(s.sessionsService).values({
        id: uid("ses"), terrasseId: input.terrasseId, serveuseId,
        statut: "OUVERTE", ouverteLe: maintenant(),
      });
      return { ok: true as const };
    }),

  cloturerSession: protegee
    .input(z.object({ sessionId: z.string() }))
    .mutation(async ({ input, ctx }) => {
      const serveuseId = ctx.session.utilisateurId;
      const [sess] = await db().select().from(s.sessionsService).where(eq(s.sessionsService.id, input.sessionId)).limit(1);
      if (!sess || sess.serveuseId !== serveuseId) erreur("Session introuvable.");
      if (sess.statut === "CLOTUREE") erreur("Session déjà clôturée.");
      await db().update(s.sessionsService).set({ statut: "CLOTUREE", clotureeLe: maintenant() }).where(eq(s.sessionsService.id, sess.id));
      const [u] = await db().select().from(s.utilisateurs).where(eq(s.utilisateurs.id, serveuseId)).limit(1);
      await alerter(sess.terrasseId, "INFO", `${u?.nom ?? "Une serveuse"} a terminé son service — dépôt à déclarer.`);
      return { ok: true as const };
    }),

  declarerDepot: protegee
    .input(z.object({
      sessionId: z.string(),
      cdf: z.number().int().min(0), usdCentimes: z.number().int().min(0),
      // « Signaler un écart » : justification obligatoire si le cash compté
      // diffère de l'attendu (tracée au journal + alerte immédiate)
      motifEcart: z.string().max(200).optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const serveuseId = ctx.session.utilisateurId;
      const [sess] = await db().select().from(s.sessionsService).where(eq(s.sessionsService.id, input.sessionId)).limit(1);
      if (!sess || sess.serveuseId !== serveuseId) erreur("Session introuvable.");
      if (sess.statut !== "CLOTUREE") erreur("Terminez d'abord votre service avant de déclarer le dépôt.");
      const [deja] = await db().select().from(s.depots).where(eq(s.depots.sessionId, input.sessionId)).limit(1);
      if (deja) erreur("Dépôt déjà déclaré pour cette session.");
      const attendu = await attenduSessionDb(sess.id);
      const ecartCdf = input.cdf - attendu.cdf;
      const ecartUsd = input.usdCentimes - attendu.usdCentimes;
      const ecart = ecartCdf !== 0 || ecartUsd !== 0;
      if (ecart && !input.motifEcart?.trim()) {
        erreur("Le montant déclaré diffère de l'attendu : signalez l'écart avec un motif.");
      }
      await db().insert(s.depots).values({
        id: uid("dep"), sessionId: sess.id, terrasseId: sess.terrasseId, serveuseId,
        attenduCdf: attendu.cdf, attenduUsd: attendu.usdCentimes,
        declareCdf: input.cdf, declareUsd: input.usdCentimes,
        statut: "DECLARE", declareLe: maintenant(),
      });
      const [u] = await db().select().from(s.utilisateurs).where(eq(s.utilisateurs.id, serveuseId)).limit(1);
      await journaliser(serveuseId, "SERVEUSE", "DEPOT_DECLARE",
        ecart ? `Écart signalé (${fmtCDF(Math.abs(ecartCdf))}) — ${input.motifEcart!.trim()}` : "Dépôt conforme à l'attendu");
      if (ecart) {
        const parts: string[] = [];
        if (ecartCdf !== 0) parts.push(`${ecartCdf > 0 ? "+" : "−"}${fmtCDF(Math.abs(ecartCdf))}`);
        if (ecartUsd !== 0) parts.push(`${ecartUsd > 0 ? "+" : "−"}${fmtUSD(Math.abs(ecartUsd))}`);
        await alerter(sess.terrasseId, "ECART_CAISSE",
          `${u?.nom ?? "Une serveuse"} signale un écart de caisse : ${parts.join(" et ")} — ${input.motifEcart!.trim()}`);
      }
      return { ok: true as const };
    }),

  // ---------------- GÉRANT / PROPRIÉTAIRE ----------------

  validerDepot: protegee
    .input(z.object({
      depotId: z.string(),
      decision: z.enum(["VALIDE", "CONTESTE"]), motif: z.string().max(200).optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const acteurId = ctx.session.utilisateurId;
      const [d] = await db().select().from(s.depots).where(eq(s.depots.id, input.depotId)).limit(1);
      if (!d) erreur("Dépôt introuvable.");
      if (d.statut !== "DECLARE") erreur("Ce dépôt a déjà été traité.");
      const roles = await rolesSurDb(acteurId, d.terrasseId);
      if (!roles.includes("GERANT") && !roles.includes("PROPRIETAIRE")) {
        erreur("Seuls le Gérant et le Propriétaire valident les dépôts.");
      }
      // Règle d'or : nul ne valide son propre dépôt
      if (d.serveuseId === acteurId) erreur("Vous ne pouvez pas valider votre propre dépôt.");
      if (input.decision === "CONTESTE" && !input.motif?.trim()) erreur("Motif obligatoire pour contester.");
      await db().update(s.depots).set({
        statut: input.decision, valideLe: maintenant(), validePar: acteurId,
        motifContest: input.decision === "CONTESTE" ? (input.motif ?? "").trim() : null,
      }).where(eq(s.depots.id, d.id));
      const roleActif: RoleActif = roles.includes("GERANT") ? "GERANT" : "PROPRIETAIRE";
      const [serveuse] = await db().select().from(s.utilisateurs).where(eq(s.utilisateurs.id, d.serveuseId)).limit(1);
      await journaliser(acteurId, roleActif, `DEPOT_${input.decision}`, `Dépôt de ${serveuse?.nom ?? "serveuse"}`);
      // Alerte écart de caisse
      const [t] = await db().select().from(s.terrasses).where(eq(s.terrasses.id, d.terrasseId)).limit(1);
      const ecartCdf = d.declareCdf - d.attenduCdf;
      const ecartUsd = d.declareUsd - d.attenduUsd;
      if (input.decision === "VALIDE" && t && (Math.abs(ecartCdf) > t.seuilEcartCdf || Math.abs(ecartUsd) > t.seuilEcartUsd)) {
        const parts: string[] = [];
        if (ecartCdf !== 0) parts.push(`${ecartCdf > 0 ? "+" : "−"}${fmtCDF(Math.abs(ecartCdf))}`);
        if (ecartUsd !== 0) parts.push(`${ecartUsd > 0 ? "+" : "−"}${fmtUSD(Math.abs(ecartUsd))}`);
        await alerter(d.terrasseId, "ECART_CAISSE", `Écart de caisse : ${parts.join(" et ")} sur le dépôt de ${serveuse?.nom ?? "serveuse"}.`);
      }
      return { ok: true as const };
    }),


  // ---------------- PROPRIÉTAIRE — stock et prix ----------------

  modifierPrix: protegee
    .input(z.object({
      produitId: z.string(),
      prixCdf: z.number().int().min(0), prixUsdCentimes: z.number().int().min(0),
    }))
    .mutation(async ({ input, ctx }) => {
      const acteurId = ctx.session.utilisateurId;
      const [p] = await db().select().from(s.produits).where(eq(s.produits.id, input.produitId)).limit(1);
      if (!p) erreur("Produit introuvable.");
      await exigerProprietaire(acteurId, p.terrasseId);
      const ancien = `${fmtCDF(p.prixCdf)}${p.prixUsd ? ` / ${fmtUSD(p.prixUsd)}` : ""}`;
      await db().update(s.produits).set({ prixCdf: input.prixCdf, prixUsd: input.prixUsdCentimes }).where(eq(s.produits.id, p.id));
      await journaliser(acteurId, "PROPRIETAIRE", "PRIX_MODIFIE",
        `${p.nom} : ${ancien} → ${fmtCDF(input.prixCdf)}${input.prixUsdCentimes ? ` / ${fmtUSD(input.prixUsdCentimes)}` : ""}`);
      return { ok: true as const };
    }),

  ajusterStock: protegee
    .input(z.object({
      produitId: z.string(),
      type: z.enum(["ENTREE", "PERTE", "INVENTAIRE", "AJUSTEMENT", "TRAITEUR"]),
      quantite: z.number().int(), motif: z.string().max(200),
    }))
    .mutation(async ({ input, ctx }) => {
      const acteurId = ctx.session.utilisateurId;
      const [p] = await db().select().from(s.produits).where(eq(s.produits.id, input.produitId)).limit(1);
      if (!p) erreur("Produit introuvable.");
      await exigerProprietaire(acteurId, p.terrasseId);
      if (!input.motif.trim()) erreur("Motif obligatoire pour toute écriture de stock.");
      let delta = 0;
      if (input.type === "ENTREE") {
        if (input.quantite <= 0) erreur("Quantité invalide.");
        delta = input.quantite;
      } else if (input.type === "PERTE") {
        if (input.quantite <= 0) erreur("Quantité invalide.");
        delta = -input.quantite;
      } else if (input.type === "INVENTAIRE") {
        if (input.quantite < 0) erreur("Quantité invalide.");
        delta = input.quantite - p.stock; // quantité = stock réel compté
      } else {
        delta = input.quantite; // AJUSTEMENT signé
      }
      if (p.stock + delta < 0) erreur("Le stock ne peut pas devenir négatif.");
      await db().update(s.produits).set({ stock: p.stock + delta }).where(eq(s.produits.id, p.id));
      await mouvementDb(p.id, p.terrasseId, input.type, delta, input.motif.trim(), acteurId, "PROPRIETAIRE");
      await journaliser(acteurId, "PROPRIETAIRE", "STOCK_AJUSTE", `${p.nom} : ${input.type} ${delta > 0 ? "+" : ""}${delta} — ${input.motif.trim()}`);
      return { ok: true as const };
    }),

  basculerProduitActif: protegee
    .input(z.object({ produitId: z.string() }))
    .mutation(async ({ input, ctx }) => {
      const acteurId = ctx.session.utilisateurId;
      const [p] = await db().select().from(s.produits).where(eq(s.produits.id, input.produitId)).limit(1);
      if (!p) erreur("Produit introuvable.");
      await exigerProprietaire(acteurId, p.terrasseId);
      await db().update(s.produits).set({ actif: !p.actif }).where(eq(s.produits.id, p.id));
      await journaliser(acteurId, "PROPRIETAIRE", !p.actif ? "PRODUIT_ACTIVE" : "PRODUIT_RETIRE", p.nom);
      return { ok: true as const };
    }),

  creerProduit: protegee
    .input(z.object({
      terrasseId: z.string(),
      nom: z.string().min(1).max(120), categorie: z.string().max(60).default(""),
      prixCdf: z.number().int().min(0), prixUsdCentimes: z.number().int().min(0),
      stock: z.number().int().min(0), seuil: z.number().int().min(0),
      // Scan code-barres (optionnels) : pré-remplissage depuis le référentiel
      codeBarres: z.string().trim().max(50).optional(),
      variante: z.string().trim().max(60).optional(),
      consignable: z.boolean().optional(),
      bouteillesParCasier: z.number().int().min(1).max(48).optional(),
      photoUrl: z.string().trim().max(500).optional(),
      // Boucle 3 — formulaire adaptatif : champs optionnels par type
      typeProduit: z.enum(["MARCHANDISE", "CHAMBRE", "SERVICE", "BILLARD"]).optional(),
      unite: z.string().trim().max(20).optional(),
      dureeMinutes: z.number().int().min(1).max(24 * 60).optional(),
      capacite: z.number().int().min(1).max(50).optional(),
      lot: z.string().trim().max(60).optional(),
      datePeremption: z.string().trim().max(10).optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const acteurId = ctx.session.utilisateurId;
      await exigerProprietaire(acteurId, input.terrasseId);

      // --- Boucle 3 : validation adaptative par type d'établissement ---
      const [ter] = await db().select().from(s.terrasses).where(eq(s.terrasses.id, input.terrasseId)).limit(1);
      if (!ter) erreur("Établissement introuvable.");
      // Fusion multi-métiers : les catégories de TOUS les types de
      // l'établissement (principal + secondaires) sont acceptées.
      const typesEtab = tousLesTypes(
        (ter.typeEtablissement ?? "TERRASSE") as TypeEtablissement,
        (ter.typesSecondaires ?? []) as TypeEtablissement[],
      );
      const libelle = input.categorie.trim();

      // Catégorie présente dans l'un des types fusionnés : OK.
      const catRef = libelle
        ? typesEtab.map((t) => categorieParLibelle(libelle, t)).find((c) => c !== undefined)
        : undefined;

      // Catégorie du référentiel d'un AUTRE type : refusée.
      // (Libellé libre hors référentiel : toléré pour la compatibilité ;
      //  « Divers » est générique — jamais refusé.)
      if (libelle && !catRef) {
        const ailleurs = CATEGORIES_PAR_TYPE.some(
          (c) => c.code !== "DIVERS" && c.nomFr.toLowerCase() === libelle.toLowerCase(),
        );
        if (ailleurs) erreur(`La catégorie « ${libelle} » n'appartient pas à ce type d'établissement.`);
      }

      // Type de produit : explicite, sinon déduit de la catégorie du
      // référentiel (CHAMBRES→CHAMBRE, BILLARD→BILLARD, services→SERVICE).
      const typeProduit: TypeProduit | null = input.typeProduit ?? (catRef ? typeProduitParDefaut(catRef.code) : null);
      if (typeProduit === "CHAMBRE" && !input.capacite) {
        erreur("Une chambre exige une capacité (nombre de personnes).");
      }
      if (typeProduit === "SERVICE" && !input.dureeMinutes) {
        erreur("Un service exige une durée (en minutes).");
      }

      await db().insert(s.produits).values({
        id: uid("prd"), terrasseId: input.terrasseId, nom: input.nom.trim(),
        categorie: libelle || "Divers",
        prixCdf: input.prixCdf, prixUsd: input.prixUsdCentimes,
        stock: input.stock, stockReserve: 0, seuilAlerte: input.seuil, actif: true,
        codeBarres: input.codeBarres || null,
        variante: input.variante || null,
        consignable: input.consignable ?? false,
        bouteillesParCasier: input.bouteillesParCasier ?? null,
        photoUrl: input.photoUrl || null,
        photoSource: input.photoUrl ? "CATALOGUE" : null,
        typeProduit,
        unite: input.unite || null,
        dureeMinutes: input.dureeMinutes ?? null,
        capacite: input.capacite ?? null,
        lot: input.lot || null,
        datePeremption: input.datePeremption || null,
      });
      await journaliser(acteurId, "PROPRIETAIRE", "PRODUIT_CREE", `${input.nom.trim()} (${fmtCDF(input.prixCdf)})`);
      return { ok: true as const };
    }),

  // ---------------- DÉPENSES DE CAISSE ----------------

  /** Enregistre une dépense : elle réduit le solde de la boutique
   *  (ventes encaissées − dépôts validés − dépenses). Gérant ou
   *  Propriétaire uniquement, motif obligatoire, tout est audité. */
  enregistrerDepense: protegee
    .input(z.object({
      terrasseId: z.string(),
      montantCdf: z.number().int().min(0).default(0),
      montantUsdCentimes: z.number().int().min(0).default(0),
      motif: z.string().min(2).max(200),
    }))
    .mutation(async ({ input, ctx }) => {
      const acteurId = ctx.session.utilisateurId;
      if (input.montantCdf <= 0 && input.montantUsdCentimes <= 0) {
        erreur("Indiquez un montant en francs ou en dollars.");
      }
      if (!(await ecriturePermiseDb(input.terrasseId))) erreur("Terrasse en lecture seule : action impossible.");
      const roles = await rolesSurDb(acteurId, input.terrasseId);
      if (!roles.includes("PROPRIETAIRE") && !roles.includes("GERANT")) {
        await journaliser(acteurId, null, "ACCES_REFUSE", `Dépense tentée (${input.motif})`);
        erreur("Action réservée au Gérant et au Propriétaire.");
      }
      const role = roles.includes("PROPRIETAIRE") ? "PROPRIETAIRE" : "GERANT";
      await db().insert(s.depenses).values({
        id: uid("dep"), terrasseId: input.terrasseId,
        montantCdf: input.montantCdf, montantUsd: input.montantUsdCentimes,
        motif: input.motif.trim(), saisiPar: acteurId, roleActif: role,
        creeLe: maintenant(),
      });
      const montant = input.montantCdf > 0 ? fmtCDF(input.montantCdf) : fmtUSD(input.montantUsdCentimes);
      await journaliser(acteurId, role, "DEPENSE_ENREGISTREE", `${montant} — ${input.motif.trim()}`);
      return { ok: true as const };
    }),

  // ---------------- DEMANDES DE STOCK ----------------

  creerDemandeStock: protegee
    .input(z.object({
      terrasseId: z.string(), produitId: z.string(),
      quantite: z.number().int().positive(), type: z.enum(["REAPPRO", "PERTE", "ECART"]),
      motif: z.string().max(200).default(""),
    }))
    .mutation(async ({ input, ctx }) => {
      const acteurId = ctx.session.utilisateurId;
      const roles = await rolesSurDb(acteurId, input.terrasseId);
      if (!roles.includes("GERANT") && !roles.includes("PROPRIETAIRE")) {
        erreur("Action réservée au Gérant et au Propriétaire.");
      }
      await db().insert(s.demandesStock).values({
        id: uid("dem"), terrasseId: input.terrasseId, produitId: input.produitId,
        quantite: input.quantite, type: input.type, motif: input.motif.trim(),
        statut: "EN_ATTENTE", creePar: acteurId, creeLe: maintenant(),
      });
      return { ok: true as const };
    }),

  traiterDemandeStock: protegee
    .input(z.object({ demandeId: z.string(), decision: z.enum(["APPROUVEE", "REFUSEE"]) }))
    .mutation(async ({ input, ctx }) => {
      const acteurId = ctx.session.utilisateurId;
      const [d] = await db().select().from(s.demandesStock).where(eq(s.demandesStock.id, input.demandeId)).limit(1);
      if (!d) erreur("Demande introuvable.");
      await exigerProprietaire(acteurId, d.terrasseId);
      if (d.statut !== "EN_ATTENTE") erreur("Demande déjà traitée.");
      await db().update(s.demandesStock)
        .set({ statut: input.decision, traitePar: acteurId, traiteLe: maintenant() })
        .where(eq(s.demandesStock.id, d.id));
      if (input.decision === "APPROUVEE" && d.type === "REAPPRO") {
        const [p] = await db().select().from(s.produits).where(eq(s.produits.id, d.produitId)).limit(1);
        if (p) {
          await db().update(s.produits).set({ stock: p.stock + d.quantite }).where(eq(s.produits.id, p.id));
          await mouvementDb(p.id, d.terrasseId, "ENTREE", d.quantite, `Demande approuvée — ${d.motif}`, acteurId, "PROPRIETAIRE");
        }
      }
      await journaliser(acteurId, "PROPRIETAIRE", `DEMANDE_${input.decision}`, d.motif);
      return { ok: true as const };
    }),

  // ---------------- QR ET ASSIGNATIONS ----------------

  regenererQr: protegee
    .input(z.object({ tableId: z.string() }))
    .mutation(async ({ input, ctx }) => {
      const acteurId = ctx.session.utilisateurId;
      const [table] = await db().select().from(s.tablesQr).where(eq(s.tablesQr.id, input.tableId)).limit(1);
      if (!table) erreur("Table introuvable.");
      const role = await exigerGerantOuProprio(acteurId, table.terrasseId);
      await db().update(s.tablesQr).set({ tokenQr: tokenQR() }).where(eq(s.tablesQr.id, table.id));
      await journaliser(acteurId, role, "QR_REGENERE", `Table ${table.numero} — ancien code révoqué`);
      return { ok: true as const };
    }),

  assignerServeuse: protegee
    .input(z.object({ tableId: z.string(), serveuseId: z.string().nullable() }))
    .mutation(async ({ input, ctx }) => {
      const acteurId = ctx.session.utilisateurId;
      const [table] = await db().select().from(s.tablesQr).where(eq(s.tablesQr.id, input.tableId)).limit(1);
      if (!table) erreur("Table introuvable.");
      const role = await exigerGerantOuProprio(acteurId, table.terrasseId);
      if (input.serveuseId) {
        const [ok] = await db().select().from(s.affectations)
          .where(and(
            eq(s.affectations.utilisateurId, input.serveuseId),
            eq(s.affectations.terrasseId, table.terrasseId),
            eq(s.affectations.role, "SERVEUSE"),
            eq(s.affectations.actif, true),
          )).limit(1);
        if (!ok) erreur("Cette personne n'est pas serveuse sur cette terrasse.");
      }
      await db().update(s.tableServeuse).set({ actif: false })
        .where(and(eq(s.tableServeuse.tableId, input.tableId), eq(s.tableServeuse.actif, true)));
      if (input.serveuseId) {
        await db().insert(s.tableServeuse).values({
          id: uid("ts"), tableId: input.tableId, serveuseId: input.serveuseId, actif: true, depuisLe: maintenant(),
        });
      }
      let nom = "personne";
      if (input.serveuseId) {
        const [u] = await db().select().from(s.utilisateurs).where(eq(s.utilisateurs.id, input.serveuseId)).limit(1);
        nom = u?.nom ?? "personne";
      }
      await journaliser(acteurId, role, "TABLE_ASSIGNEE", `Table ${table.numero} → ${nom}`);
      return { ok: true as const };
    }),


  // ---------------- TABLES (Propriétaire exclusif) ----------------

  creerTable: protegee
    .input(z.object({ terrasseId: z.string() }))
    .mutation(async ({ input, ctx }) => {
      const acteurId = ctx.session.utilisateurId;
      await exigerProprietaire(acteurId, input.terrasseId);
      return ajouterTableDb(acteurId, input.terrasseId);
    }),
  archiverTable: protegee
    .input(z.object({ tableId: z.string() }))
    .mutation(async ({ input, ctx }) => {
      const acteurId = ctx.session.utilisateurId;
      const [table] = await db().select().from(s.tablesQr).where(eq(s.tablesQr.id, input.tableId)).limit(1);
      if (!table) erreur("Table introuvable.");
      await exigerProprietaire(acteurId, table.terrasseId);
      await db().update(s.tablesQr).set({ actif: false, archiveLe: maintenant() }).where(eq(s.tablesQr.id, table.id));
      await db().update(s.tableServeuse).set({ actif: false })
        .where(and(eq(s.tableServeuse.tableId, table.id), eq(s.tableServeuse.actif, true)));
      await journaliser(acteurId, "PROPRIETAIRE", "TABLE_ARCHIVEE",
        `Table ${table.numero} — tranche revue à l'échéance (max de période conservé)`);
      return { ok: true as const };
    }),

  // ---------------- ÉQUIPE ET INVITATIONS ----------------

  /** Annexe §7 : le propriétaire surcharge la matrice de permissions,
   *  membre par membre. autorisee = null retire la surcharge
   *  (retour à la matrice par défaut). Action journalisée. */
  definirSurchargePermission: protegee
    .input(z.object({
      terrasseId: z.string(),
      utilisateurId: z.string(),
      action: z.enum([
        "VOIR_RAPPORTS", "MODIFIER_PRIX", "REMISE", "REMISE_HORS_SEUIL",
        "ANNULER_VENTE", "AJUSTER_STOCK", "VALIDER_TOKEN_BILLARD",
        "VALIDER_ORDONNANCE", "VOIR_CREDITS", "GERER_EQUIPE",
      ]),
      autorisee: z.boolean().nullable(),
    }))
    .mutation(async ({ input, ctx }) => {
      const acteurId = ctx.session.utilisateurId;
      await exigerProprietaire(acteurId, input.terrasseId);
      // La cible doit être membre actif de l'établissement
      const [aff] = await db().select().from(s.affectations)
        .where(and(
          eq(s.affectations.utilisateurId, input.utilisateurId),
          eq(s.affectations.terrasseId, input.terrasseId),
          eq(s.affectations.actif, true),
        )).limit(1);
      if (!aff) erreur("Ce membre n'est pas actif dans cet établissement.");
      const [existante] = await db().select().from(s.permissionsSurcharge)
        .where(and(
          eq(s.permissionsSurcharge.terrasseId, input.terrasseId),
          eq(s.permissionsSurcharge.utilisateurId, input.utilisateurId),
          eq(s.permissionsSurcharge.action, input.action),
        )).limit(1);
      const avant = existante ? String(existante.autorisee) : "défaut";
      if (input.autorisee === null) {
        if (existante) {
          await db().delete(s.permissionsSurcharge).where(eq(s.permissionsSurcharge.id, existante.id));
        }
      } else if (existante) {
        await db().update(s.permissionsSurcharge)
          .set({ autorisee: input.autorisee, modifieLe: maintenant() })
          .where(eq(s.permissionsSurcharge.id, existante.id));
      } else {
        await db().insert(s.permissionsSurcharge).values({
          id: uid("psc"), terrasseId: input.terrasseId,
          utilisateurId: input.utilisateurId, action: input.action,
          autorisee: input.autorisee, creePar: acteurId,
          creeLe: maintenant(), modifieLe: maintenant(),
        });
      }
      await journaliser(acteurId, "PROPRIETAIRE", "PERMISSION_SURCHARGEE",
        `${input.action} → ${input.autorisee === null ? "défaut" : input.autorisee ? "autorisée" : "refusée"} pour ${aff.role}`,
        { terrasseId: input.terrasseId, avant, apres: input.autorisee === null ? "défaut" : String(input.autorisee) });
      return { ok: true as const };
    }),

  /** Surcharges en vigueur sur un établissement (propriétaire). */
  listerSurcharges: protegee
    .input(z.object({ terrasseId: z.string() }))
    .query(async ({ input, ctx }) => {
      await exigerProprietaire(ctx.session.utilisateurId, input.terrasseId);
      const lignes = await db().select().from(s.permissionsSurcharge)
        .where(eq(s.permissionsSurcharge.terrasseId, input.terrasseId));
      return lignes.map((l) => ({
        utilisateurId: l.utilisateurId,
        action: l.action as ActionSensible,
        autorisee: l.autorisee,
      }));
    }),

  /** Permissions effectives de l'utilisateur courant sur un
   *  établissement (pour que l'UI masque les actions interdites). */
  mesPermissions: protegee
    .input(z.object({ terrasseId: z.string() }))
    .query(async ({ input, ctx }) => {
      const acteurId = ctx.session.utilisateurId;
      const surcharges = await surchargesPour(acteurId, input.terrasseId);
      const roles = await rolesSurDb(acteurId, input.terrasseId);
      const actions = [
        "VOIR_RAPPORTS", "MODIFIER_PRIX", "REMISE", "REMISE_HORS_SEUIL",
        "ANNULER_VENTE", "AJUSTER_STOCK", "VALIDER_TOKEN_BILLARD",
        "VALIDER_ORDONNANCE", "VOIR_CREDITS", "GERER_EQUIPE",
      ] as const;
      const carte = {} as Record<ActionSensible, boolean>;
      for (const a of actions) carte[a] = peutAvecRoles(roles, a, surcharges);
      return carte;
    }),


  creerInvitation: protegee
    .input(z.object({ terrasseId: z.string(), role: zRoleEtab, nomPrevu: z.string().max(120).default("") }))
    .mutation(async ({ input, ctx }) => {
      const acteurId = ctx.session.utilisateurId;
      await exigerProprietaire(acteurId, input.terrasseId);
      const code = codeInvitation();
      await db().insert(s.invitations).values({
        id: uid("inv"), code, terrasseId: input.terrasseId, role: input.role,
        creePar: acteurId, nomPrevu: input.nomPrevu.trim(),
        expireLe: ajouterJours(maintenant(), 2), statut: "ACTIVE", creeLe: maintenant(),
      });
      const [t] = await db().select().from(s.terrasses).where(eq(s.terrasses.id, input.terrasseId)).limit(1);
      await journaliser(acteurId, "PROPRIETAIRE", "INVITATION_CREEE",
        `${input.role} — ${input.nomPrevu || "sans nom"} (${t?.nom ?? ""})`);
      return { code };
    }),

  revoquerInvitation: protegee
    .input(z.object({ invitationId: z.string() }))
    .mutation(async ({ input, ctx }) => {
      const acteurId = ctx.session.utilisateurId;
      const [inv] = await db().select().from(s.invitations).where(eq(s.invitations.id, input.invitationId)).limit(1);
      if (!inv) erreur("Invitation introuvable.");
      await exigerProprietaire(acteurId, inv.terrasseId);
      if (inv.statut !== "ACTIVE") erreur("Invitation déjà utilisée ou révoquée.");
      await db().update(s.invitations).set({ statut: "REVOQUEE" }).where(eq(s.invitations.id, inv.id));
      await journaliser(acteurId, "PROPRIETAIRE", "INVITATION_REVOQUEE", inv.code);
      return { ok: true as const };
    }),

  /** Chemin B : consommer un code d'invitation → compte + affectation */
  consommerInvitation: publicQuery
    .input(z.object({
      code: z.string().min(4).max(8), nom: z.string().min(1).max(120),
      telephone: z.string().max(30).default(""), pin: z.string().min(4).max(12),
    }))
    .mutation(async ({ input }) => {
      const [inv] = await db().select().from(s.invitations)
        .where(eq(s.invitations.code, input.code.trim().toUpperCase())).limit(1);
      if (!inv) {
        await journaliser(null, null, "INVITATION_REFUSEE", `Code inconnu : ${input.code}`);
        erreur("Code invalide.");
      }
      if (inv.statut !== "ACTIVE") erreur("Ce code a déjà été utilisé ou révoqué.");
      // Numéro technique du super-admin réservé (voir finaliserInscription) :
      // sans cette garde, l'invité hériterait du compte plateforme.
      if (input.telephone && localDe(input.telephone) === localDe(env.adminTelephone)) {
        erreur("Ce numéro est réservé à l'administration de la plateforme.");
      }
      if (inv.expireLe < maintenant()) {
        await db().update(s.invitations).set({ statut: "EXPIREE" }).where(eq(s.invitations.id, inv.id));
        erreur("Ce code a expiré (validité 48 h). Demandez un nouveau code au Propriétaire.");
      }
      // Règles de cumul : SERVEUSE + GERANT sur la même terrasse interdit
      const [existant] = await db().select().from(s.utilisateurs)
        .where(eq(s.utilisateurs.telephone, input.telephone.trim())).limit(1);
      const utilisateurId = existant?.id ?? uid("usr");
      if (existant) {
        const [conflit] = await db().select().from(s.affectations)
          .where(and(
            eq(s.affectations.utilisateurId, utilisateurId),
            eq(s.affectations.terrasseId, inv.terrasseId),
            eq(s.affectations.actif, true),
          )).limit(1);
        if (conflit && conflit.role !== inv.role) {
          erreur("Conflit de rôles : Serveuse et Gérant sur la même terrasse est interdit.");
        }
      } else {
        await db().insert(s.utilisateurs).values({
          id: utilisateurId, nom: input.nom.trim(), telephone: input.telephone.trim(), pin: chiffrerPin(input.pin), creeLe: maintenant(),
        });
      }
      await db().insert(s.affectations).values({
        id: uid("aff"), utilisateurId, terrasseId: inv.terrasseId, role: inv.role, actif: true, creeLe: maintenant(),
      });
      await db().update(s.invitations).set({ statut: "UTILISEE" }).where(eq(s.invitations.id, inv.id));
      const [t] = await db().select().from(s.terrasses).where(eq(s.terrasses.id, inv.terrasseId)).limit(1);
      await journaliser(utilisateurId, inv.role as RoleActif, "INVITATION_CONSOMMEE",
        `${input.nom.trim()} rejoint ${t?.nom ?? ""} comme ${inv.role}`);
      return { utilisateurId, terrasseId: inv.terrasseId, role: inv.role as RoleEtablissement };
    }),

  basculerAffectation: protegee
    .input(z.object({ affectationId: z.string() }))
    .mutation(async ({ input, ctx }) => {
      const acteurId = ctx.session.utilisateurId;
      const [a] = await db().select().from(s.affectations).where(eq(s.affectations.id, input.affectationId)).limit(1);
      if (!a) erreur("Affectation introuvable.");
      await exigerProprietaire(acteurId, a.terrasseId);
      await db().update(s.affectations).set({ actif: !a.actif }).where(eq(s.affectations.id, a.id));
      if (a.actif) {
        // Couper les assignations de tables de cette serveuse
        await db().update(s.tableServeuse).set({ actif: false })
          .where(and(eq(s.tableServeuse.serveuseId, a.utilisateurId), eq(s.tableServeuse.actif, true)));
      }
      const [u] = await db().select().from(s.utilisateurs).where(eq(s.utilisateurs.id, a.utilisateurId)).limit(1);
      await journaliser(acteurId, "PROPRIETAIRE", a.actif ? "AFFECTATION_DESACTIVEE" : "AFFECTATION_REACTIVEE",
        `${u?.nom ?? ""} (${a.role})`);
      return { ok: true as const };
    }),


  // ---------------- CHEMIN A — « Je crée mon établissement » ----------------

  finaliserInscription: publicQuery
    .input(z.object({
      nom: z.string().min(1).max(120), telephone: z.string().max(30).default(""),
      pin: z.string().min(4).max(12),
      nomTerrasse: z.string().min(1).max(120), adresse: z.string().max(200).default(""),
      nombreTables: z.number().int().min(1).max(100), aussiGerant: z.boolean(),
      // Étape 6 : une boutique n'a qu'une zone « Comptoir » et un QR mural
      typeEtablissement: z.enum(["TERRASSE", "GUEST_HOUSE", "BOUTIQUE", "RESTAURANT", "PHARMACIE", "SALON", "AUTRE", "QUINCAILLERIE", "BILLARD"]).default("TERRASSE"),
      // Fusion multi-métiers : 0 à 2 types en plus du principal
      // (l'expérience est l'UNION des définitions du registre).
      typesSecondaires: z.array(z.enum(["TERRASSE", "GUEST_HOUSE", "BOUTIQUE", "RESTAURANT", "PHARMACIE", "SALON", "AUTRE", "QUINCAILLERIE", "BILLARD"])).max(2).default([]),
    }))
    .mutation(async ({ input }) => {
      // Le numéro technique du super-admin est réservé : une inscription
      // avec ce numéro crée une collision de connexion (le PIN départage,
      // mais le numéro par défaut est public — autant l'interdire).
      if (input.telephone && localDe(input.telephone) === localDe(env.adminTelephone)) {
        erreur("Ce numéro est réservé à l'administration de la plateforme.");
      }
      const utilisateurId = uid("usr");
      const orgId = uid("org");
      const terrasseId = uid("etab");
      const maintenantIso = maintenant();
      const typesSecondaires = input.typesSecondaires.filter((t) => t !== input.typeEtablissement);
      const types = tousLesTypes(input.typeEtablissement, typesSecondaires);
      // Plan BOUTIQUE (zone unique) seulement si TOUS les types fusionnés
      // sont à comptoir unique (règle inchangée pour les mono-types).
      const boutique = types.every((t) => TYPES_ZONE_UNIQUE.includes(t));
      // QR mural si AU MOINS un type à comptoir (ex. Terrasse+Boutique)
      const qrComptoir = types.some((t) => TYPES_ZONE_UNIQUE.includes(t));
      // Établissement 100 % comptoir (pharmacie, boutique, salon…) :
      // pas de « tables » numérotées — UN seul QR comptoir, quelle que
      // soit la valeur de nombreTables (une pharmacie n'a pas de table).
      const avecTables = types.some((t) => aTablesDeSalle(t));
      const nbZones = boutique || !avecTables ? 1 : input.nombreTables;
      await db().transaction(async (tx) => {
        await tx.insert(s.utilisateurs).values({
          id: utilisateurId, nom: input.nom.trim(), telephone: input.telephone.trim(), pin: chiffrerPin(input.pin), creeLe: maintenantIso,
        });
        await tx.insert(s.organisations).values({
          id: orgId, nom: input.nomTerrasse.trim(), proprietaireId: utilisateurId, creeLe: maintenantIso,
        });
        await tx.insert(s.terrasses).values({
          id: terrasseId, organisationId: orgId, nom: input.nomTerrasse.trim(), adresse: input.adresse.trim(),
          typeEtablissement: input.typeEtablissement,
          typesSecondaires,
          tokenQrBoutique: qrComptoir ? tokenQR() : null,
          seuilEcartCdf: 5000, seuilEcartUsd: 200, tauxUsdCdf: null, creeLe: maintenantIso,
        });
        for (let i = 1; i <= nbZones; i++) {
          await tx.insert(s.tablesQr).values({
            id: uid("tbl"), terrasseId, numero: i, tokenQr: tokenQR(),
            // Un établissement dont le type PRINCIPAL est BILLARD a des
            // billards comme zones ; les établissements fusionnés
            // ajoutent leurs billards ensuite (billard.creerTableBillard).
            kind: input.typeEtablissement === "BILLARD" ? "BILLARD" : "ZONE",
            actif: true, creeLe: maintenantIso,
          });
        }
        if (input.aussiGerant) {
          await tx.insert(s.affectations).values({
            id: uid("aff"), utilisateurId, terrasseId, role: "GERANT", actif: true, creeLe: maintenantIso,
          });
        }
        await tx.insert(s.abonnements).values({
          id: uid("abo"), terrasseId,
          plan: boutique ? "BOUTIQUE" : "ESSENTIEL",
          tranche: boutique ? "PETITE" : tranchePourTables(nbZones),
          statut: "ESSAI", typeEtablissement: input.typeEtablissement,
          essaiFin: ajouterJours(maintenantIso, 14),
          periodeDebut: maintenantIso, periodeFin: ajouterJours(maintenantIso, 14),
          annuel: false, nbTablesMaxPeriode: nbZones, prorataDu: 0, fraisInstallPayes: false,
        });
      });
      await journaliser(utilisateurId, "PROPRIETAIRE", "ETABLISSEMENT_CREE",
        `${input.nomTerrasse.trim()} (${types.join("+")}) — ${nbZones} ${boutique ? "zone" : "tables"}, essai 14 jours`);
      return { utilisateurId, terrasseId };
    }),

  // ---------------- ABONNEMENT — paiement mobile money ----------------

  soumettrePaiement: protegee
    .input(z.object({
      terrasseId: z.string(), methode: zMethode,
      reference: z.string().min(6).max(60), annuel: z.boolean(),
    }))
    .mutation(async ({ input, ctx }) => {
      const acteurId = ctx.session.utilisateurId;
      await exigerProprietaire(acteurId, input.terrasseId);
      const [abo] = await db().select().from(s.abonnements).where(eq(s.abonnements.terrasseId, input.terrasseId)).limit(1);
      if (!abo) erreur("Abonnement introuvable.");
      const [doublon] = await db().select().from(s.paiements)
        .where(eq(s.paiements.reference, input.reference.trim())).limit(1);
      if (doublon && doublon.statut !== "REJETE") erreur("Cette référence a déjà été soumise.");
      const mensuel = await prixMensuelTerrasseDb(input.terrasseId);
      let montant = input.annuel ? mensuel * 10 : mensuel; // annuel = 10 mois payés pour 12
      montant += abo.prorataDu;
      if (!abo.fraisInstallPayes) {
        // Installation unique : 5 $ boutique/salon, 10 $ autres types
        // (règle par type d'établissement, boucle 1 — plus par plan).
        const [etab] = await db().select({ type: s.terrasses.typeEtablissement })
          .from(s.terrasses).where(eq(s.terrasses.id, input.terrasseId)).limit(1);
        montant += fraisInstallationPour(
          (abo.typeEtablissement ?? etab?.type ?? "TERRASSE") as TypeEtablissement,
        );
      }
      await db().update(s.abonnements).set({ annuel: input.annuel }).where(eq(s.abonnements.id, abo.id));
      await db().insert(s.paiements).values({
        id: uid("pay"), abonnementId: abo.id, terrasseId: input.terrasseId, montantUsd: montant,
        methode: input.methode, reference: input.reference.trim(), statut: "EN_ATTENTE",
        soumisPar: acteurId, creeLe: maintenant(),
      });
      await journaliser(acteurId, "PROPRIETAIRE", "PAIEMENT_SOUMIS",
        `${fmtUSD(montant)} via ${input.methode} — réf ${input.reference.trim()}`);
      return { ok: true as const, montant };
    }),

  /** Super-admin : valider / rejeter un paiement (idempotent) */
  validerPaiement: publicQuery
    .input(z.object({ paiementId: z.string(), decision: z.enum(["VALIDE", "REJETE"]), pinAdmin: z.string() }))
    .mutation(async ({ input }) => {
      exigerAdmin(input.pinAdmin);
      const [p] = await db().select().from(s.paiements).where(eq(s.paiements.id, input.paiementId)).limit(1);
      if (!p) erreur("Paiement introuvable.");
      if (p.statut !== "EN_ATTENTE") return { ok: true as const }; // idempotent : un rejeu ne double-crédite pas
      await db().update(s.paiements)
        .set({ statut: input.decision, valideLe: maintenant(), validePar: "super_admin" })
        .where(eq(s.paiements.id, p.id));
      if (input.decision === "VALIDE") {
        const [abo] = await db().select().from(s.abonnements).where(eq(s.abonnements.terrasseId, p.terrasseId)).limit(1);
        if (abo) {
          const maintenantIso = maintenant();
          const base = abo.periodeFin > maintenantIso && (abo.statut === "ACTIF" || abo.statut === "EN_GRACE")
            ? abo.periodeFin
            : maintenantIso;
          const nbActives = await nbTablesActivesDb(p.terrasseId);
          await db().update(s.abonnements).set({
            periodeDebut: maintenantIso,
            periodeFin: ajouterMois(base, abo.annuel ? 12 : 1),
            statut: "ACTIF", essaiFin: null, fraisInstallPayes: true, prorataDu: 0,
            tranche: tranchePourTables(Math.max(abo.nbTablesMaxPeriode, nbActives)),
            nbTablesMaxPeriode: nbActives,
          }).where(eq(s.abonnements.id, abo.id));
          // Facture numérotée GBS-AAAA-NNNNN
          const [metaLigne] = await db().select().from(s.meta).where(eq(s.meta.cle, "compteurFacture")).limit(1);
          const compteur = (metaLigne?.valeur ?? 0) + 1;
          if (metaLigne) {
            await db().update(s.meta).set({ valeur: compteur }).where(eq(s.meta.cle, "compteurFacture"));
          } else {
            await db().insert(s.meta).values({ cle: "compteurFacture", valeur: compteur });
          }
          await db().insert(s.factures).values({
            id: uid("fac"), numero: `GBS-${new Date().getFullYear()}-${String(compteur).padStart(5, "0")}`,
            abonnementId: abo.id, terrasseId: p.terrasseId, plan: abo.plan, tranche: abo.tranche,
            montantUsd: p.montantUsd, creeLe: maintenant(),
          });
          const [t] = await db().select().from(s.terrasses).where(eq(s.terrasses.id, p.terrasseId)).limit(1);
          const fin = ajouterMois(base, abo.annuel ? 12 : 1);
          await alerter(p.terrasseId, "ABONNEMENT",
            `Paiement validé : « ${t?.nom} » est active jusqu'au ${new Date(fin).toLocaleDateString("fr-FR")}.`);
        }
      }
      await journaliser("super_admin", "SUPER_ADMIN", `PAIEMENT_${input.decision}`, `${fmtUSD(p.montantUsd)} — réf ${p.reference}`);
      return { ok: true as const };
    }),

  /** Super-admin : modifier la grille tarifaire sans redéploiement */
  modifierTarif: publicQuery
    .input(z.object({
      plan: z.enum(["ESSENTIEL", "PRO", "BUSINESS", "BOUTIQUE"]),
      tranche: z.enum(["PETITE", "MOYENNE", "GRANDE"]),
      prixCentimes: z.number().int().positive(),
      fraisCentimes: z.number().int().min(0),
      pinAdmin: z.string(),
    }))
    .mutation(async ({ input }) => {
      exigerAdmin(input.pinAdmin);
      await db().update(s.plansTarifs)
        .set({ prixUsd: input.prixCentimes, fraisInstallUsd: input.fraisCentimes })
        .where(and(eq(s.plansTarifs.plan, input.plan), eq(s.plansTarifs.tranche, input.tranche)));
      await journaliser("super_admin", "SUPER_ADMIN", "TARIF_MODIFIE",
        `${input.plan}/${input.tranche} → ${fmtUSD(input.prixCentimes)} + installation ${fmtUSD(input.fraisCentimes)}`);
      return { ok: true as const };
    }),

  // ---------------- DIVERS ----------------

  marquerAlertesLues: protegee
    .input(z.object({ terrasseId: z.string() }))
    .mutation(async ({ input, ctx }) => {
      // Réservé au staff de la terrasse (le jeton prouve l'identité, on vérifie l'appartenance)
      const roles = await rolesSurDb(ctx.session.utilisateurId, input.terrasseId);
      if (roles.length === 0) erreur("Vous n'avez pas accès à cette terrasse.");
      await db().update(s.alertes).set({ lu: true }).where(eq(s.alertes.terrasseId, input.terrasseId));
      return { ok: true as const };
    }),

  definirLangue: protegee
    .input(z.object({ terrasseId: z.string(), langue: z.enum(["fr", "en", "pt", "sw"]) }))
    .mutation(async ({ input, ctx }) => {
      // Mémorise la langue de l'appareil sur l'organisation (boucle 5) :
      // la prochaine connexion, même depuis un autre appareil, la retrouve.
      const roles = await rolesSurDb(ctx.session.utilisateurId, input.terrasseId);
      const [te] = await db().select().from(s.terrasses).where(eq(s.terrasses.id, input.terrasseId)).limit(1);
      if (roles.length === 0 || !te) erreur("Vous n'avez pas accès à cette terrasse.");
      await db().update(s.organisations).set({ langue: input.langue }).where(eq(s.organisations.id, te.organisationId));
      return { ok: true as const };
    }),

  masquerAvis: protegee
    .input(z.object({ avisId: z.string(), motif: z.string().max(200) }))
    .mutation(async ({ input, ctx }) => {
      const acteurId = ctx.session.utilisateurId;
      const [a] = await db().select().from(s.avis).where(eq(s.avis.id, input.avisId)).limit(1);
      if (!a) erreur("Avis introuvable.");
      await exigerProprietaire(acteurId, a.terrasseId);
      if (!input.motif.trim()) erreur("Motif obligatoire pour masquer un avis.");
      await db().update(s.avis).set({ masque: true, motifMasquage: input.motif.trim() }).where(eq(s.avis.id, a.id));
      await journaliser(acteurId, "PROPRIETAIRE", "AVIS_MASQUE", `Avis ${a.note}/5 masqué — ${input.motif.trim()}`);
      return { ok: true as const };
    }),

  reinitialiserDemo: publicQuery.mutation(async () => {
    if (!env.annuaireDemo) erreur("Réinitialisation désactivée hors mode démo.");
    await reinitialiserSeed();
    return { ok: true as const };
  }),
});

// ============================================================
// Helpers internes (hors routeur)
// ============================================================

/**
 * Réponse de connexion (partagée par connexionPin et connexionTelephone) :
 * jeton signé + rôles et terrasses résolus en base — de quoi router
 * l'utilisateur vers son espace sans dépendre de l'annuaire démo.
 * Mode glissant : ouvre une ligne sessions_appareils liée à l'appareil.
 */
async function reponseConnexionDb(u: typeof s.utilisateurs.$inferSelect, appareilId?: string) {
  const jeton = await ouvrirSessionAppareil(u.id, appareilId ?? "inconnu");
  // Super-admin plateforme : aucune terrasse, un seul rôle — le frontend
  // route vers l'espace /admin (le PIN saisi y sert de preuve d'accès).
  if (u.id === SUPER_ADMIN_ID) {
    return {
      ok: true as const,
      jeton,
      utilisateur: { id: u.id, nom: u.nom, telephone: u.telephone, creeLe: u.creeLe },
      roles: ["SUPER_ADMIN"] as RoleActif[],
      terrasses: [] as { id: string; nom: string }[],
    };
  }
  // Terrasses visibles : organisations possédées + affectations actives
  const [organisations, affectations, terrasses] = await Promise.all([
    db().select().from(s.organisations),
    db().select().from(s.affectations)
      .where(and(eq(s.affectations.utilisateurId, u.id), eq(s.affectations.actif, true))),
    db().select().from(s.terrasses),
  ]);
  const orgIds = new Set(organisations.filter((o) => o.proprietaireId === u.id).map((o) => o.id));
  const idsTerrasses = new Set<string>(affectations.map((a) => a.terrasseId));
  for (const t of terrasses) if (orgIds.has(t.organisationId)) idsTerrasses.add(t.id);
  const roles = new Set<RoleActif>(affectations.map((a) => a.role as RoleActif));
  if (orgIds.size > 0) roles.add("PROPRIETAIRE");
  return {
    ok: true as const,
    jeton,
    utilisateur: { id: u.id, nom: u.nom, telephone: u.telephone, creeLe: u.creeLe },
    roles: Array.from(roles),
    terrasses: terrasses.filter((t) => idsTerrasses.has(t.id)).map((t) => ({ id: t.id, nom: t.nom })),
  };
}

/** Vrai si `proprioId` possède au moins un établissement où `membreId`
 *  a une affectation active — condition pour révoquer ses appareils. */
async function estProprioDuMembre(proprioId: string, membreId: string): Promise<boolean> {
  const [organisations, affs, terrasses] = await Promise.all([
    db().select().from(s.organisations),
    db().select().from(s.affectations)
      .where(and(eq(s.affectations.utilisateurId, membreId), eq(s.affectations.actif, true))),
    db().select().from(s.terrasses),
  ]);
  const orgIds = new Set(organisations.filter((o) => o.proprietaireId === proprioId).map((o) => o.id));
  const terrassesDuProprio = new Set(terrasses.filter((t) => orgIds.has(t.organisationId)).map((t) => t.id));
  return affs.some((a) => terrassesDuProprio.has(a.terrasseId));
}

/** Libère les réservations de stock d'une commande annulée */
async function libererStockDb(commandeId: string) {
  const [c] = await db().select().from(s.commandes).where(eq(s.commandes.id, commandeId)).limit(1);
  if (!c) return;
  const [table] = await db().select().from(s.tablesQr).where(eq(s.tablesQr.id, c.tableId)).limit(1);
  for (const l of c.lignes) {
    const [p] = await db().select().from(s.produits).where(eq(s.produits.id, l.produitId)).limit(1);
    if (p) {
      await db().update(s.produits).set({ stockReserve: Math.max(0, p.stockReserve - l.quantite) }).where(eq(s.produits.id, p.id));
      await mouvementDb(p.id, c.terrasseId, "LIBERATION", -l.quantite, `Annulation commande table ${table?.numero ?? "?"}`, null, null);
    }
  }
}

/** Récupère une commande en vérifiant les droits du staff dessus */
async function commandePourRoleDb(commandeId: string, acteurId: string) {
  const [c] = await db().select().from(s.commandes).where(eq(s.commandes.id, commandeId)).limit(1);
  if (!c) erreur("Commande introuvable.");
  if (!(await ecriturePermiseDb(c.terrasseId))) erreur("Terrasse en lecture seule : action impossible.");
  const roles = await rolesSurDb(acteurId, c.terrasseId);
  if (!roles.includes("SERVEUSE") && !roles.includes("GERANT") && !roles.includes("PROPRIETAIRE")) {
    erreur("Vous n'avez pas accès à cette commande.");
  }
  return c;
}

/** Montant attendu en caisse pour une session : commandes SERVIE par la serveuse pendant la session */
async function attenduSessionDb(sessionId: string): Promise<{ cdf: number; usdCentimes: number }> {
  const [sess] = await db().select().from(s.sessionsService).where(eq(s.sessionsService.id, sessionId)).limit(1);
  if (!sess) return { cdf: 0, usdCentimes: 0 };
  const fin = sess.clotureeLe ?? maintenant();
  const commandes = await db().select().from(s.commandes)
    .where(and(
      eq(s.commandes.terrasseId, sess.terrasseId),
      eq(s.commandes.statut, "SERVIE"),
      eq(s.commandes.serviePar, sess.serveuseId),
    ));
  let cdf = 0;
  let usd = 0;
  for (const c of commandes) {
    if (c.servieLe && c.servieLe >= sess.ouverteLe && c.servieLe <= fin) {
      cdf += c.totalCdf;
      usd += c.totalUsd;
    }
  }
  return { cdf, usdCentimes: usd };
}
