// ============================================================
// GBS — Tests d'interface, domaine CAISSE (découpage boucle 2)
// Extrait d'interfaces.test.ts : clôture de session, dépôt
// déclaré vs attendu, écart avec/sans motif, validation des
// dépôts (jamais la sienne). Scénario séquentiel à état partagé
// DANS ce fichier ; fixtures dédiées (préfixe test_cai).
// ============================================================

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq, gte, inArray } from "drizzle-orm";
import { appRouter } from "../router";
import { getDb } from "../queries/connection";
import * as s from "../../db/schema";
import { ajouterJours, maintenant } from "../gbsUtils";

// Contexte minimal : chaque appelant simule une session signée.
const anonyme = appRouter.createCaller({} as never);
const appelantProp = appRouter.createCaller({ session: { utilisateurId: "usr_test_cai_prop" } } as never);
const appelantGer = appRouter.createCaller({ session: { utilisateurId: "usr_test_cai_ger" } } as never);
const appelantServ = appRouter.createCaller({ session: { utilisateurId: "usr_test_cai_serv" } } as never);

// ---------- Fixtures ----------
const ORG = "org_test_cai";
const PROP = "usr_test_cai_prop";
const GER = "usr_test_cai_ger";
const SERV = "usr_test_cai_serv";
const ETAB = "etab_test_cai";
const TBL1 = "tbl_test_cai_1";
const TOK1 = "tok_test_cai_1";
const PRD = "prd_test_cai_1";
const USERS = [PROP, GER, SERV];

let sessionServiceId = "";
let depotId = "";

beforeAll(async () => {
  const db = getDb();
  const now = maintenant();
  await db.insert(s.utilisateurs).values([
    { id: PROP, nom: "Proprio TestCai", telephone: "+243990000021", pin: "0001", creeLe: now },
    { id: GER, nom: "Gérante TestCai", telephone: "+243990000022", pin: "0002", creeLe: now },
    { id: SERV, nom: "Serveuse TestCai", telephone: "+243990000023", pin: "0003", creeLe: now },
  ]).onConflictDoNothing();
  await db.insert(s.organisations).values({ id: ORG, nom: "Org TestCai", proprietaireId: PROP, creeLe: now }).onConflictDoNothing();
  await db.insert(s.terrasses).values({
    id: ETAB, organisationId: ORG, nom: "Terrasse TestCai", adresse: "Av. des Tests",
    typeEtablissement: "TERRASSE", seuilEcartCdf: 5000, seuilEcartUsd: 200, tauxUsdCdf: 2740, creeLe: now,
  }).onConflictDoNothing();
  await db.insert(s.tablesQr).values([
    { id: TBL1, terrasseId: ETAB, numero: 1, tokenQr: TOK1, actif: true, creeLe: now },
  ]).onConflictDoNothing();
  await db.insert(s.produits).values({
    id: PRD, terrasseId: ETAB, nom: "Primus TestCai", categorie: "Bières",
    prixCdf: 3000, prixUsd: 110, stock: 50, stockReserve: 0, seuilAlerte: 6, actif: true, consignable: false,
  }).onConflictDoNothing();
  await db.insert(s.abonnements).values({
    id: "abo_test_cai", terrasseId: ETAB, plan: "ESSENTIEL", tranche: "PETITE", statut: "ESSAI",
    essaiFin: ajouterJours(now, 14), periodeDebut: now, periodeFin: ajouterJours(now, 30),
    annuel: false, nbTablesMaxPeriode: 2, prorataDu: 0, fraisInstallPayes: false,
  }).onConflictDoNothing();
  await db.insert(s.affectations).values([
    { id: "aff_test_cai_ger", utilisateurId: GER, terrasseId: ETAB, role: "GERANT", actif: true, creeLe: now },
    { id: "aff_test_cai_serv", utilisateurId: SERV, terrasseId: ETAB, role: "SERVEUSE", actif: true, creeLe: now },
  ]).onConflictDoNothing();
  await db.insert(s.tableServeuse).values({
    id: "ts_test_cai_1", tableId: TBL1, serveuseId: SERV, actif: true, depuisLe: now,
  }).onConflictDoNothing();
});

afterAll(async () => {
  const db = getDb();
  await db.delete(s.mouvementsStock).where(eq(s.mouvementsStock.terrasseId, ETAB));
  await db.delete(s.depots).where(eq(s.depots.terrasseId, ETAB));
  await db.delete(s.sessionsService).where(eq(s.sessionsService.terrasseId, ETAB));
  await db.delete(s.commandes).where(eq(s.commandes.terrasseId, ETAB));
  await db.delete(s.clientsSession).where(eq(s.clientsSession.tableId, TBL1));
  await db.delete(s.alertes).where(eq(s.alertes.terrasseId, ETAB));
  await db.delete(s.auditLog).where(inArray(s.auditLog.acteurId, USERS));
  await db.delete(s.tableServeuse).where(eq(s.tableServeuse.tableId, TBL1));
  await db.delete(s.tablesQr).where(eq(s.tablesQr.terrasseId, ETAB));
  await db.delete(s.produits).where(eq(s.produits.terrasseId, ETAB));
  await db.delete(s.abonnements).where(eq(s.abonnements.terrasseId, ETAB));
  await db.delete(s.affectations).where(eq(s.affectations.terrasseId, ETAB));
  await db.delete(s.terrasses).where(eq(s.terrasses.id, ETAB));
  await db.delete(s.organisations).where(eq(s.organisations.id, ORG));
  await db.delete(s.utilisateurs).where(inArray(s.utilisateurs.id, USERS));
});

// ---------- Serveuse : vente, clôture, dépôt ----------

describe("serveuse — clôture et dépôt", () => {
  it("une vente de 3 Primus est servie (prépare le dépôt)", async () => {
    await expect(appelantServ.gbs.ouvrirSessionService({ terrasseId: ETAB })).resolves.toEqual({ ok: true });
    const db = getDb();
    const [sess] = await db.select().from(s.sessionsService)
      .where(eq(s.sessionsService.terrasseId, ETAB)).limit(1);
    sessionServiceId = sess!.id;

    const sessionClient = await anonyme.gbs.ouvrirSessionClient({ token: TOK1, prenom: "Cliente Caisse" });
    const cmd = await anonyme.gbs.passerCommande({
      token: TOK1, clientSessionId: sessionClient.id,
      lignes: [{ produitId: PRD, quantite: 3 }], cleIdempotence: "cle_test_cai_00000001",
    });
    await expect(appelantServ.gbs.confirmerCommande({ commandeId: cmd.id })).resolves.toEqual({ ok: true });
    await expect(appelantServ.gbs.marquerServie({ commandeId: cmd.id })).resolves.toEqual({ ok: true });
  });

  it("clôture puis dépôt conforme à l'attendu (3 000 FC × 3)", async () => {
    await expect(appelantServ.gbs.cloturerSession({ sessionId: sessionServiceId })).resolves.toEqual({ ok: true });
    await expect(
      appelantServ.gbs.declarerDepot({ sessionId: sessionServiceId, cdf: 9000, usdCentimes: 330 }),
    ).resolves.toEqual({ ok: true });
    // Double dépôt refusé
    await expect(
      appelantServ.gbs.declarerDepot({ sessionId: sessionServiceId, cdf: 9000, usdCentimes: 330 }),
    ).rejects.toThrow(/déjà déclaré/);
    const db = getDb();
    const [d] = await db.select().from(s.depots).where(eq(s.depots.sessionId, sessionServiceId));
    depotId = d!.id;
    expect(d!.statut).toBe("DECLARE");
  });

  it("un écart sans motif est refusé ; avec motif il est signalé (alerte)", async () => {
    // Nouvelle session vide : attendu 0, déclaré 5 000 → écart
    await appelantServ.gbs.ouvrirSessionService({ terrasseId: ETAB });
    const db = getDb();
    const sessions = await db.select().from(s.sessionsService).where(eq(s.sessionsService.terrasseId, ETAB));
    const nouvelle = sessions.find((x) => x.id !== sessionServiceId)!;
    await appelantServ.gbs.cloturerSession({ sessionId: nouvelle.id });

    await expect(
      appelantServ.gbs.declarerDepot({ sessionId: nouvelle.id, cdf: 5000, usdCentimes: 0 }),
    ).rejects.toThrow(/motif/);
    await expect(
      appelantServ.gbs.declarerDepot({ sessionId: nouvelle.id, cdf: 5000, usdCentimes: 0, motifEcart: "Fonds de caisse du matin" }),
    ).resolves.toEqual({ ok: true });
    const alertes = await db.select().from(s.alertes).where(eq(s.alertes.terrasseId, ETAB));
    expect(alertes.some((a) => a.type === "ECART_CAISSE" && a.message.includes("Fonds de caisse"))).toBe(true);
  });
});

// ---------- Gérant : validation des dépôts ----------

describe("gérant — validation des dépôts", () => {
  it("nul ne valide son propre dépôt (gérante qui a aussi servi)", async () => {
    // Cumul de rôles : la gérante ouvre un service, déclare son dépôt…
    await appelantGer.gbs.ouvrirSessionService({ terrasseId: ETAB });
    const db = getDb();
    const sessions = await db.select().from(s.sessionsService).where(eq(s.sessionsService.terrasseId, ETAB));
    const sessGer = sessions.find((x) => x.serveuseId === GER)!;
    await appelantGer.gbs.cloturerSession({ sessionId: sessGer.id });
    await appelantGer.gbs.declarerDepot({ sessionId: sessGer.id, cdf: 0, usdCentimes: 0 });
    const [depGer] = await db.select().from(s.depots).where(eq(s.depots.sessionId, sessGer.id));
    // … mais la règle d'or lui interdit de s'auto-valider
    await expect(
      appelantGer.gbs.validerDepot({ depotId: depGer!.id, decision: "VALIDE" }),
    ).rejects.toThrow(/propre dépôt/);
    // … et une simple serveuse ne valide aucun dépôt
    await expect(
      appelantServ.gbs.validerDepot({ depotId: depGer!.id, decision: "VALIDE" }),
    ).rejects.toThrow(/Gérant et le Propriétaire/);
    // Le propriétaire (tiers) peut valider le dépôt de la gérante
    await expect(
      appelantProp.gbs.validerDepot({ depotId: depGer!.id, decision: "VALIDE" }),
    ).resolves.toEqual({ ok: true });
  });

  it("la contestation exige un motif", async () => {
    await expect(
      appelantGer.gbs.validerDepot({ depotId, decision: "CONTESTE" }),
    ).rejects.toThrow(/[Mm]otif/);
  });

  it("le gérant valide le dépôt de la serveuse", async () => {
    await expect(appelantGer.gbs.validerDepot({ depotId, decision: "VALIDE" })).resolves.toEqual({ ok: true });
    const db = getDb();
    const [d] = await db.select().from(s.depots).where(eq(s.depots.id, depotId));
    expect(d!.statut).toBe("VALIDE");
    expect(d!.validePar).toBe(GER);
  });
});

describe("concurrence — encaissement", () => {
  it("deux encaissements simultanés sur la même note : une seule écriture, un seul audit", async () => {
    // Régression : avant le correctif, marquerPayee vérifiait puis
    // écrivait SANS condition dans le UPDATE — deux appels simultanés
    // (double-tap, deux serveuses) journalisaient deux fois.
    const db = getDb();
    await appelantServ.gbs.ouvrirSessionService({ terrasseId: ETAB });
    const sessionClient = await anonyme.gbs.ouvrirSessionClient({ token: TOK1, prenom: "Cliente Concurrence" });
    const cmd = await anonyme.gbs.passerCommande({
      token: TOK1, clientSessionId: sessionClient.id,
      lignes: [{ produitId: PRD, quantite: 1 }], cleIdempotence: "cle_test_cai_00000002",
    });
    await appelantServ.gbs.confirmerCommande({ commandeId: cmd.id });
    await appelantServ.gbs.marquerServie({ commandeId: cmd.id });

    // Comptage borné aux acteurs de CE fichier et à l'instant du test :
    // la suite complète fait tourner d'autres fichiers en parallèle sur
    // la même base, un delta global serait non déterministe.
    const debut = maintenant();
    const resultats = await Promise.allSettled([
      appelantServ.gbs.marquerPayee({ commandeId: cmd.id }),
      appelantGer.gbs.marquerPayee({ commandeId: cmd.id }),
    ]);
    // Les deux répondent ok (idempotent)…
    for (const r of resultats) expect(r.status).toBe("fulfilled");
    // …mais une SEULE ligne d'audit COMMANDE_PAYEE en tout.
    const audits = await db.select({ id: s.auditLog.id }).from(s.auditLog)
      .where(and(
        eq(s.auditLog.action, "COMMANDE_PAYEE"),
        inArray(s.auditLog.acteurId, USERS),
        gte(s.auditLog.creeLe, debut),
      ));
    expect(audits.length).toBe(1);
    // Et la commande n'est encaissée qu'une fois, par un seul acteur.
    const [c] = await db.select().from(s.commandes).where(eq(s.commandes.id, cmd.id)).limit(1);
    expect(c!.payeeLe).not.toBeNull();
  });
});
