// ============================================================
// GBS — Tests d'interface, domaine VENTES (découpage boucle 2)
// Extrait d'interfaces.test.ts : session de service, parcours
// commande, étanchéité client (token ↔ session), encaissement
// cash. Scénario séquentiel à état partagé DANS ce fichier ;
// fixtures dédiées (préfixe test_ven), nettoyées en fin de fichier.
// ============================================================

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq, inArray } from "drizzle-orm";
import { appRouter } from "../router";
import { getDb } from "../queries/connection";
import * as s from "../../db/schema";
import { ajouterJours, maintenant } from "../gbsUtils";

// Contexte minimal : les procédures métier n'utilisent pas req/resHeaders.
// Chaque appelant simule une session signée (utilisateurId vérifié côté serveur).
// `anonyme` n'a pas de session : réservé aux procédures publiques (menu, commandes client…).
const anonyme = appRouter.createCaller({} as never);
const appelantServ = appRouter.createCaller({ session: { utilisateurId: "usr_test_ven_serv" } } as never);
// Session valide techniquement mais dont l'utilisateur n'a aucun accès à la terrasse
const appelantIntrus = appRouter.createCaller({ session: { utilisateurId: "usr_intrus_ven" } } as never);

// ---------- Fixtures ----------
const ORG = "org_test_ven";
const PROP = "usr_test_ven_prop";
const GER = "usr_test_ven_ger";
const SERV = "usr_test_ven_serv";
const ETAB = "etab_test_ven";
const TBL1 = "tbl_test_ven_1";
const TBL2 = "tbl_test_ven_2";
const TOK1 = "tok_test_ven_1";
const PRD = "prd_test_ven_1";
const USERS = [PROP, GER, SERV];

let commandeId = "";
let commande2Id = "";
let clientSessionId = "";

beforeAll(async () => {
  const db = getDb();
  const now = maintenant();
  await db.insert(s.utilisateurs).values([
    { id: PROP, nom: "Proprio TestVen", telephone: "+243990000011", pin: "0001", creeLe: now },
    { id: GER, nom: "Gérante TestVen", telephone: "+243990000012", pin: "0002", creeLe: now },
    { id: SERV, nom: "Serveuse TestVen", telephone: "+243990000013", pin: "0003", creeLe: now },
  ]).onConflictDoNothing();
  await db.insert(s.organisations).values({ id: ORG, nom: "Org TestVen", proprietaireId: PROP, creeLe: now }).onConflictDoNothing();
  await db.insert(s.terrasses).values({
    id: ETAB, organisationId: ORG, nom: "Terrasse TestVen", adresse: "Av. des Tests",
    typeEtablissement: "TERRASSE", seuilEcartCdf: 5000, seuilEcartUsd: 200, tauxUsdCdf: 2740, creeLe: now,
  }).onConflictDoNothing();
  await db.insert(s.tablesQr).values([
    { id: TBL1, terrasseId: ETAB, numero: 1, tokenQr: TOK1, actif: true, creeLe: now },
    { id: TBL2, terrasseId: ETAB, numero: 2, tokenQr: "tok_test_ven_2", actif: true, creeLe: now },
  ]).onConflictDoNothing();
  await db.insert(s.produits).values({
    id: PRD, terrasseId: ETAB, nom: "Primus TestVen", categorie: "Bières",
    prixCdf: 3000, prixUsd: 110, stock: 50, stockReserve: 0, seuilAlerte: 6, actif: true, consignable: false,
  }).onConflictDoNothing();
  await db.insert(s.abonnements).values({
    id: "abo_test_ven", terrasseId: ETAB, plan: "ESSENTIEL", tranche: "PETITE", statut: "ESSAI",
    essaiFin: ajouterJours(now, 14), periodeDebut: now, periodeFin: ajouterJours(now, 30),
    annuel: false, nbTablesMaxPeriode: 2, prorataDu: 0, fraisInstallPayes: false,
  }).onConflictDoNothing();
  await db.insert(s.affectations).values([
    { id: "aff_test_ven_ger", utilisateurId: GER, terrasseId: ETAB, role: "GERANT", actif: true, creeLe: now },
    { id: "aff_test_ven_serv", utilisateurId: SERV, terrasseId: ETAB, role: "SERVEUSE", actif: true, creeLe: now },
  ]).onConflictDoNothing();
  await db.insert(s.tableServeuse).values({
    id: "ts_test_ven_1", tableId: TBL1, serveuseId: SERV, actif: true, depuisLe: now,
  }).onConflictDoNothing();
});

afterAll(async () => {
  const db = getDb();
  await db.delete(s.mouvementsStock).where(eq(s.mouvementsStock.terrasseId, ETAB));
  await db.delete(s.depots).where(eq(s.depots.terrasseId, ETAB));
  await db.delete(s.sessionsService).where(eq(s.sessionsService.terrasseId, ETAB));
  await db.delete(s.commandes).where(eq(s.commandes.terrasseId, ETAB));
  await db.delete(s.clientsSession).where(inArray(s.clientsSession.tableId, [TBL1, TBL2]));
  await db.delete(s.avis).where(eq(s.avis.terrasseId, ETAB));
  await db.delete(s.alertes).where(eq(s.alertes.terrasseId, ETAB));
  await db.delete(s.auditLog).where(inArray(s.auditLog.acteurId, USERS));
  await db.delete(s.tableServeuse).where(inArray(s.tableServeuse.tableId, [TBL1, TBL2]));
  await db.delete(s.tablesQr).where(eq(s.tablesQr.terrasseId, ETAB));
  await db.delete(s.produits).where(eq(s.produits.terrasseId, ETAB));
  await db.delete(s.abonnements).where(eq(s.abonnements.terrasseId, ETAB));
  await db.delete(s.affectations).where(eq(s.affectations.terrasseId, ETAB));
  await db.delete(s.terrasses).where(eq(s.terrasses.id, ETAB));
  await db.delete(s.organisations).where(eq(s.organisations.id, ORG));
  await db.delete(s.utilisateurs).where(inArray(s.utilisateurs.id, USERS));
});

// ---------- Serveuse : session et parcours commande ----------

describe("serveuse — session et parcours commande", () => {
  it("ouvre sa session de service (une seule à la fois)", async () => {
    await expect(appelantServ.gbs.ouvrirSessionService({ terrasseId: ETAB })).resolves.toEqual({ ok: true });
    await expect(appelantServ.gbs.ouvrirSessionService({ terrasseId: ETAB })).rejects.toThrow(/déjà ouverte/);
  });

  it("parcours complet : commande → confirmation → servie (stock décrémenté)", async () => {
    const sessionClient = await anonyme.gbs.ouvrirSessionClient({ token: TOK1, prenom: "Cliente Test" });
    clientSessionId = sessionClient.id;
    const cmd = await anonyme.gbs.passerCommande({
      token: TOK1, clientSessionId: sessionClient.id,
      lignes: [{ produitId: PRD, quantite: 3 }], cleIdempotence: "cle_test_ven_00000001",
    });
    commandeId = cmd.id;
    expect(cmd.statut).toBe("EN_ATTENTE");

    const db = getDb();
    let [p] = await db.select().from(s.produits).where(eq(s.produits.id, PRD));
    expect(p!.stockReserve).toBe(3); // réservé à la commande

    await expect(appelantServ.gbs.confirmerCommande({ commandeId })).resolves.toEqual({ ok: true });
    await expect(appelantServ.gbs.marquerServie({ commandeId })).resolves.toEqual({ ok: true });

    [p] = await db.select().from(s.produits).where(eq(s.produits.id, PRD));
    expect(p!.stock).toBe(47); // 50 − 3 vendues
    expect(p!.stockReserve).toBe(0); // réservation consommée
  });

  it("un inconnu ne peut pas confirmer une commande", async () => {
    await expect(
      appelantIntrus.gbs.confirmerCommande({ commandeId }),
    ).rejects.toThrow(/accès/i);
  });
});

// ---------- Étanchéité client : un sessionId ne vaut que pour sa table ----------

describe("étanchéité client (token ↔ session)", () => {
  it("le menu de la table 1 expose la session de la table 1", async () => {
    const snap = await anonyme.gbs.snapshot({ portee: { kind: "client", token: TOK1, sessionId: clientSessionId } });
    expect(snap.clientsSession.some((c) => c.id === clientSessionId)).toBe(true);
    expect(snap.commandes.some((c) => c.id === commandeId)).toBe(true);
  });

  it("le MÊME sessionId sur le token d'une autre table n'expose rien", async () => {
    const snap = await anonyme.gbs.snapshot({ portee: { kind: "client", token: "tok_test_ven_2", sessionId: clientSessionId } });
    expect(snap.clientsSession).toHaveLength(0);
    expect(snap.commandes).toHaveLength(0);
    // … mais le menu de la table 2 reste consultable normalement
    expect(snap.tables.some((t) => t.id === TBL2)).toBe(true);
    expect(snap.produits.length).toBeGreaterThan(0);
  });
});

// ---------- Encaissement cash : pas de nouvelle commande tant que la servie n'est pas payée ----------

describe("encaissement cash (commande payée avant la suivante)", () => {
  // À ce stade du fichier, `commandeId` est SERVIE et non payée
  it("une commande servie non payée bloque la suivante", async () => {
    await expect(
      anonyme.gbs.passerCommande({
        token: TOK1, clientSessionId,
        lignes: [{ produitId: PRD, quantite: 1 }], cleIdempotence: "cle_test_ven_00000002",
      }),
    ).rejects.toThrow(/paiement/);
  });

  it("… mais un retry réseau (même clé d'idempotence) n'est jamais bloqué", async () => {
    await expect(
      anonyme.gbs.passerCommande({
        token: TOK1, clientSessionId,
        lignes: [{ produitId: PRD, quantite: 3 }], cleIdempotence: "cle_test_ven_00000001",
      }),
    ).resolves.toEqual({ id: commandeId, statut: "SERVIE" });
  });

  it("une session d'une autre table reste refusée, même sans impayé", async () => {
    await expect(
      anonyme.gbs.passerCommande({
        token: "tok_test_ven_2", clientSessionId, // session de la table 1, token de la table 2
        lignes: [{ produitId: PRD, quantite: 1 }], cleIdempotence: "cle_test_ven_00000003",
      }),
    ).rejects.toThrow(/Session invalide/);
  });

  it("un inconnu ne peut pas marquer une commande payée", async () => {
    await expect(
      appelantIntrus.gbs.marquerPayee({ commandeId }),
    ).rejects.toThrow(/accès/i);
  });

  it("la serveuse encaisse : la commande est payée et le client peut recommander", async () => {
    await expect(appelantServ.gbs.marquerPayee({ commandeId })).resolves.toEqual({ ok: true });
    const db = getDb();
    const [c] = await db.select().from(s.commandes).where(eq(s.commandes.id, commandeId));
    expect(c!.payeeLe).not.toBeNull();
    expect(c!.payeePar).toBe(SERV);

    const cmd2 = await anonyme.gbs.passerCommande({
      token: TOK1, clientSessionId,
      lignes: [{ produitId: PRD, quantite: 1 }], cleIdempotence: "cle_test_ven_00000004",
    });
    expect(cmd2.statut).toBe("EN_ATTENTE");
    commande2Id = cmd2.id;
  });

  it("double encaissement : idempotent, pas d'erreur", async () => {
    await expect(appelantServ.gbs.marquerPayee({ commandeId })).resolves.toEqual({ ok: true });
    const db = getDb();
    // Un seul événement COMMANDE_PAYEE au journal pour cette commande
    // (portée : acteur = la serveuse de test — le journal est partagé avec d'autres suites)
    const journal = await db.select().from(s.auditLog)
      .where(and(eq(s.auditLog.action, "COMMANDE_PAYEE"), eq(s.auditLog.acteurId, SERV)));
    expect(journal).toHaveLength(1);
  });

  it("une commande payée ne peut plus être annulée par l'application", async () => {
    // Prépaiement comptoir : commande2 est EN_ATTENTE et déjà encaissée
    const appelantGer = appRouter.createCaller({ session: { utilisateurId: GER } } as never);
    await expect(appelantGer.gbs.marquerPayee({ commandeId: commande2Id })).resolves.toEqual({ ok: true });
    await expect(
      appelantGer.gbs.annulerCommandeStaff({ commandeId: commande2Id, motif: "Test" }),
    ).rejects.toThrow(/encaissée/);
  });
});
