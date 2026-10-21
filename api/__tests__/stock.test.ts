// ============================================================
// GBS — Tests de course de stock (TOCTOU) sur passerCommande
// - deux commandes simultanées pour le dernier produit en stock :
//   une seule passe, l'autre est refusée (SELECT … FOR UPDATE)
// - le stock ne devient jamais négatif
// - le message d'erreur contient le produit et le stock disponible
// ============================================================

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq, inArray } from "drizzle-orm";
import { appRouter } from "../router";
import { getDb } from "../queries/connection";
import * as s from "../../db/schema";
import { maintenant } from "../gbsUtils";

const ORG = "org_test_stock";
const ETAB = "etab_test_stock";
const TABLE = "tbl_test_stock";
const TOKEN = "tok_test_stock_race";
const PRODUIT = "prd_test_stock";
const CLI_1 = "cli_test_stock_1";
const CLI_2 = "cli_test_stock_2";

// Endpoint public : pas de session staff (le client commande via QR)
const client = appRouter.createCaller({ session: null, ip: "test-stock" } as never);

beforeAll(async () => {
  const db = getDb();
  const now = maintenant();
  await db.insert(s.organisations).values({
    id: ORG, nom: "Org stock", proprietaireId: "usr_test_stock", creeLe: now,
  }).onConflictDoNothing();
  await db.insert(s.terrasses).values({
    id: ETAB, organisationId: ORG, nom: "Terrasse stock",
    adresse: "Av. des Tests", typeEtablissement: "TERRASSE",
    seuilEcartCdf: 5000, seuilEcartUsd: 200, tauxUsdCdf: 2800, creeLe: now,
  }).onConflictDoNothing();
  // Abonnement ACTIF : sinon la terrasse est en lecture seule
  await db.insert(s.abonnements).values({
    id: "abo_test_stock", terrasseId: ETAB, plan: "ESSENTIEL", tranche: "PETITE",
    statut: "ACTIF", periodeDebut: now, periodeFin: new Date(Date.now() + 86400e3).toISOString(),
    annuel: false, nbTablesMaxPeriode: 8, prorataDu: 0, fraisInstallPayes: true,
  }).onConflictDoNothing();
  await db.insert(s.tablesQr).values({
    id: TABLE, terrasseId: ETAB, numero: 1, tokenQr: TOKEN, actif: true, creeLe: now, archiveLe: null,
  }).onConflictDoNothing();
  // Un seul produit, stock = 1 : c'est lui que les deux clients se disputent
  await db.insert(s.produits).values({
    id: PRODUIT, terrasseId: ETAB, nom: "Primus 33cl Test", categorie: "Bières",
    prixCdf: 2500, prixUsd: 100, stock: 1, stockReserve: 0, seuilAlerte: 0, actif: true,
  }).onConflictDoNothing();
  await db.insert(s.clientsSession).values([
    { id: CLI_1, tableId: TABLE, prenom: "Alain", creeLe: now },
    { id: CLI_2, tableId: TABLE, prenom: "Béatrice", creeLe: now },
  ]).onConflictDoNothing();
});

afterAll(async () => {
  const db = getDb();
  await db.delete(s.commandes).where(eq(s.commandes.terrasseId, ETAB));
  await db.delete(s.clientsSession).where(inArray(s.clientsSession.id, [CLI_1, CLI_2]));
  await db.delete(s.produits).where(eq(s.produits.id, PRODUIT));
  await db.delete(s.tablesQr).where(eq(s.tablesQr.id, TABLE));
  await db.delete(s.abonnements).where(eq(s.abonnements.terrasseId, ETAB));
  await db.delete(s.terrasses).where(eq(s.terrasses.id, ETAB));
  await db.delete(s.organisations).where(eq(s.organisations.id, ORG));
  await db.delete(s.auditLog).where(eq(s.auditLog.action, "COMMANDE_REFUSEE_STOCK"));
});

describe("passerCommande — course de stock", () => {
  it("deux commandes simultanées pour 1 produit en stock → 1 seule passe", async () => {
    const lignes = [{ produitId: PRODUIT, quantite: 1 }];
    // Les deux clients commandent en même temps le dernier produit
    const resultats = await Promise.allSettled([
      client.gbs.passerCommande({
        token: TOKEN, clientSessionId: CLI_1, lignes, cleIdempotence: "cle_test_stock_race_1",
      }),
      client.gbs.passerCommande({
        token: TOKEN, clientSessionId: CLI_2, lignes, cleIdempotence: "cle_test_stock_race_2",
      }),
    ]);

    const reussies = resultats.filter((r) => r.status === "fulfilled");
    const refusees = resultats.filter((r) => r.status === "rejected");
    expect(reussies).toHaveLength(1);
    expect(refusees).toHaveLength(1);

    // Le refus porte un message clair : produit + stock disponible
    const raison = (refusees[0] as PromiseRejectedResult).reason as Error;
    expect(raison.message).toMatch(/Stock insuffisant/);
    expect(raison.message).toContain("Primus 33cl Test");
    expect(raison.message).toMatch(/Disponible : 0/);

    // Une seule commande créée en base
    const commandes = await getDb().select().from(s.commandes)
      .where(eq(s.commandes.terrasseId, ETAB));
    expect(commandes).toHaveLength(1);
  });

  it("le stock ne devient jamais négatif (stock >= réservations >= 0)", async () => {
    const [p] = await getDb().select().from(s.produits)
      .where(eq(s.produits.id, PRODUIT)).limit(1);
    expect(p.stock).toBe(1);
    expect(p.stockReserve).toBe(1); // le gagnant a réservé la seule unité
    expect(p.stock - p.stockReserve).toBeGreaterThanOrEqual(0);

    // Filet global : aucun produit de la base n'est en négatif
    const tous = await getDb().select().from(s.produits);
    for (const prod of tous) {
      expect(prod.stock).toBeGreaterThanOrEqual(0);
      expect(prod.stockReserve).toBeGreaterThanOrEqual(0);
      expect(prod.stock - prod.stockReserve).toBeGreaterThanOrEqual(0);
    }
  });

  it("idempotence : le retry du gagnant renvoie la même commande", async () => {
    const r = await client.gbs.passerCommande({
      token: TOKEN, clientSessionId: CLI_1, lignes: [{ produitId: PRODUIT, quantite: 1 }],
      cleIdempotence: "cle_test_stock_race_1", // même clé que la commande gagnante
    });
    expect(r.statut).toBe("EN_ATTENTE");
    // Toujours une seule commande
    const commandes = await getDb().select().from(s.commandes)
      .where(and(eq(s.commandes.terrasseId, ETAB)));
    expect(commandes).toHaveLength(1);
  });
});
