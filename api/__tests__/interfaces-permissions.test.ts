// ============================================================
// GBS — Tests d'interface, domaine PERMISSIONS (découpage boucle 2)
// Extrait d'interfaces.test.ts : exclusivités du propriétaire
// (prix, ajustement de stock, invitations), assignation
// serveuse ↔ table, visibilité du journal d'audit dans le
// snapshot. Fixtures dédiées (préfixe test_per), nettoyées
// en fin de fichier.
// ============================================================

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { appRouter } from "../router";
import { getDb } from "../queries/connection";
import * as s from "../../db/schema";
import { ajouterJours, maintenant } from "../gbsUtils";

// Contexte minimal : chaque appelant simule une session signée.
const anonyme = appRouter.createCaller({} as never);
const appelantProp = appRouter.createCaller({ session: { utilisateurId: "usr_test_per_prop" } } as never);
const appelantGer = appRouter.createCaller({ session: { utilisateurId: "usr_test_per_ger" } } as never);
const appelantServ = appRouter.createCaller({ session: { utilisateurId: "usr_test_per_serv" } } as never);

// ---------- Fixtures ----------
const ORG = "org_test_per";
const PROP = "usr_test_per_prop";
const GER = "usr_test_per_ger";
const SERV = "usr_test_per_serv";
const ETAB = "etab_test_per";
const TBL1 = "tbl_test_per_1";
const TBL2 = "tbl_test_per_2";
const PRD = "prd_test_per_1";
const USERS = [PROP, GER, SERV];

beforeAll(async () => {
  const db = getDb();
  const now = maintenant();
  await db.insert(s.utilisateurs).values([
    { id: PROP, nom: "Proprio TestPer", telephone: "+243990000031", pin: "0001", creeLe: now },
    { id: GER, nom: "Gérante TestPer", telephone: "+243990000032", pin: "0002", creeLe: now },
    { id: SERV, nom: "Serveuse TestPer", telephone: "+243990000033", pin: "0003", creeLe: now },
  ]).onConflictDoNothing();
  await db.insert(s.organisations).values({ id: ORG, nom: "Org TestPer", proprietaireId: PROP, creeLe: now }).onConflictDoNothing();
  await db.insert(s.terrasses).values({
    id: ETAB, organisationId: ORG, nom: "Terrasse TestPer", adresse: "Av. des Tests",
    typeEtablissement: "TERRASSE", seuilEcartCdf: 5000, seuilEcartUsd: 200, tauxUsdCdf: 2740, creeLe: now,
  }).onConflictDoNothing();
  await db.insert(s.tablesQr).values([
    { id: TBL1, terrasseId: ETAB, numero: 1, tokenQr: "tok_test_per_1", actif: true, creeLe: now },
    { id: TBL2, terrasseId: ETAB, numero: 2, tokenQr: "tok_test_per_2", actif: true, creeLe: now },
  ]).onConflictDoNothing();
  await db.insert(s.produits).values({
    id: PRD, terrasseId: ETAB, nom: "Primus TestPer", categorie: "Bières",
    prixCdf: 3000, prixUsd: 110, stock: 50, stockReserve: 0, seuilAlerte: 6, actif: true, consignable: false,
  }).onConflictDoNothing();
  await db.insert(s.abonnements).values({
    id: "abo_test_per", terrasseId: ETAB, plan: "ESSENTIEL", tranche: "PETITE", statut: "ESSAI",
    essaiFin: ajouterJours(now, 14), periodeDebut: now, periodeFin: ajouterJours(now, 30),
    annuel: false, nbTablesMaxPeriode: 2, prorataDu: 0, fraisInstallPayes: false,
  }).onConflictDoNothing();
  await db.insert(s.affectations).values([
    { id: "aff_test_per_ger", utilisateurId: GER, terrasseId: ETAB, role: "GERANT", actif: true, creeLe: now },
    { id: "aff_test_per_serv", utilisateurId: SERV, terrasseId: ETAB, role: "SERVEUSE", actif: true, creeLe: now },
  ]).onConflictDoNothing();
  await db.insert(s.tableServeuse).values({
    id: "ts_test_per_1", tableId: TBL1, serveuseId: SERV, actif: true, depuisLe: now,
  }).onConflictDoNothing();
});

afterAll(async () => {
  const db = getDb();
  await db.delete(s.mouvementsStock).where(eq(s.mouvementsStock.terrasseId, ETAB));
  await db.delete(s.auditLog).where(inArray(s.auditLog.acteurId, USERS));
  await db.delete(s.invitations).where(eq(s.invitations.terrasseId, ETAB));
  await db.delete(s.tableServeuse).where(inArray(s.tableServeuse.tableId, [TBL1, TBL2]));
  await db.delete(s.tablesQr).where(eq(s.tablesQr.terrasseId, ETAB));
  await db.delete(s.produits).where(eq(s.produits.terrasseId, ETAB));
  await db.delete(s.historiqueTranches).where(eq(s.historiqueTranches.creePar, PROP));
  await db.delete(s.abonnements).where(eq(s.abonnements.terrasseId, ETAB));
  await db.delete(s.affectations).where(eq(s.affectations.terrasseId, ETAB));
  await db.delete(s.terrasses).where(eq(s.terrasses.id, ETAB));
  await db.delete(s.organisations).where(eq(s.organisations.id, ORG));
  await db.delete(s.utilisateurs).where(inArray(s.utilisateurs.id, USERS));
});

// ---------- Assignation serveuse ↔ table ----------

describe("gérant — assignations", () => {
  it("assignation serveuse ↔ table : gérant oui, serveuse non", async () => {
    // serveuseId conservé ici : c'est la CIBLE de l'assignation, pas l'identité de l'appelant
    await expect(appelantGer.gbs.assignerServeuse({ tableId: TBL2, serveuseId: SERV })).resolves.toEqual({ ok: true });
    await expect(
      appelantServ.gbs.assignerServeuse({ tableId: TBL1, serveuseId: null }),
    ).rejects.toThrow();
    const db = getDb();
    const [ts] = await db.select().from(s.tableServeuse)
      .where(eq(s.tableServeuse.tableId, TBL2)).limit(1);
    expect(ts!.serveuseId).toBe(SERV);
  });
});

// ---------- Propriétaire : exclusivités stock/prix/équipe + audit ----------

describe("propriétaire — exclusivités et journal", () => {
  it("modifierPrix : serveuse et gérant refusés, propriétaire accepté", async () => {
    await expect(appelantServ.gbs.modifierPrix({ produitId: PRD, prixCdf: 3500, prixUsdCentimes: 128 })).rejects.toThrow();
    await expect(appelantGer.gbs.modifierPrix({ produitId: PRD, prixCdf: 3500, prixUsdCentimes: 128 })).rejects.toThrow();
    await expect(appelantProp.gbs.modifierPrix({ produitId: PRD, prixCdf: 3500, prixUsdCentimes: 128 })).resolves.toEqual({ ok: true });
    const db = getDb();
    const [p] = await db.select().from(s.produits).where(eq(s.produits.id, PRD));
    expect(p!.prixCdf).toBe(3500);
  });

  it("ajusterStock : motif obligatoire, écriture tracée au journal", async () => {
    await expect(appelantProp.gbs.ajusterStock({ produitId: PRD, type: "ENTREE", quantite: 10, motif: "" })).rejects.toThrow(/[Mm]otif/);
    await expect(appelantGer.gbs.ajusterStock({ produitId: PRD, type: "ENTREE", quantite: 10, motif: "Réappro" })).rejects.toThrow();
    await expect(appelantProp.gbs.ajusterStock({ produitId: PRD, type: "ENTREE", quantite: 10, motif: "Réappro TestPer" })).resolves.toEqual({ ok: true });
    const db = getDb();
    const [p] = await db.select().from(s.produits).where(eq(s.produits.id, PRD));
    // Pas de vente dans ce fichier : 50 + 10 = 60
    expect(p!.stock).toBe(60);
    const audit = await db.select().from(s.auditLog).where(eq(s.auditLog.acteurId, PROP));
    expect(audit.some((a) => a.action === "STOCK_AJUSTE" && a.details.includes("Réappro TestPer"))).toBe(true);
    expect(audit.some((a) => a.action === "PRIX_MODIFIE")).toBe(true);
  });

  it("invitations : le gérant ne peut pas inviter, le propriétaire oui", async () => {
    await expect(appelantGer.gbs.creerInvitation({ terrasseId: ETAB, role: "SERVEUSE", nomPrevu: "" })).rejects.toThrow();
    const r = await appelantProp.gbs.creerInvitation({ terrasseId: ETAB, role: "GERANT", nomPrevu: "Futur Gérant" });
    expect(r.code).toMatch(/^[A-Z0-9]{4,8}$/);
    // Conflit de cumul : la serveuse existante ne peut devenir gérante ici
    await expect(
      anonyme.gbs.consommerInvitation({ code: r.code, nom: "Serveuse TestPer", telephone: "+243990000033", pin: "0003" }),
    ).rejects.toThrow(/[Cc]onflit/);
  });

  it("snapshot : le journal d'audit est visible au propriétaire, pas à la serveuse", async () => {
    // Portée { kind: 'staff' } : l'identité est résolue depuis la session, pas depuis l'entrée
    const vueProprio = await appelantProp.gbs.snapshot({ portee: { kind: "staff" } });
    expect(vueProprio.auditLog.length).toBeGreaterThan(0);
    expect(vueProprio.auditLog.some((a) => a.action === "PRIX_MODIFIE")).toBe(true);
    const vueServeuse = await appelantServ.gbs.snapshot({ portee: { kind: "staff" } });
    expect(vueServeuse.auditLog).toHaveLength(0);
  });
});
