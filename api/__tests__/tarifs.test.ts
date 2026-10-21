// ============================================================
// GBS — Tests d'intégration de la grille divisée par deux
// (boucle 1) : la première échéance payée inclut l'installation
// selon le TYPE d'établissement (5 $ boutique/salon, 10 $ sinon).
// Fixtures dédiées, nettoyées en fin de fichier.
// ============================================================

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { appRouter } from "../router";
import { getDb } from "../queries/connection";
import * as s from "../../db/schema";
import { ajouterJours, maintenant } from "../gbsUtils";

const appelantProp = appRouter.createCaller({ session: { utilisateurId: "usr_test_tf_prop" } } as never);

const ORG = "org_test_tf";
const PROP = "usr_test_tf_prop";
const TERR = "etab_test_tf_terr"; // terrasse, 2 tables → ESSENTIEL PETITE
const BOUT = "etab_test_tf_bout"; // boutique, zone unique → plan BOUTIQUE

beforeAll(async () => {
  const db = getDb();
  const now = maintenant();
  await db.insert(s.utilisateurs).values(
    { id: PROP, nom: "Proprio TestTF", telephone: "+243990000010", pin: "0009", creeLe: now },
  ).onConflictDoNothing();
  await db.insert(s.organisations).values(
    { id: ORG, nom: "Org TestTF", proprietaireId: PROP, creeLe: now },
  ).onConflictDoNothing();
  await db.insert(s.terrasses).values([
    { id: TERR, organisationId: ORG, nom: "Terrasse TestTF", adresse: "Av. des Tests", typeEtablissement: "TERRASSE", seuilEcartCdf: 5000, seuilEcartUsd: 200, tauxUsdCdf: 2740, creeLe: now },
    { id: BOUT, organisationId: ORG, nom: "Boutique TestTF", adresse: "Av. des Tests", typeEtablissement: "BOUTIQUE", seuilEcartCdf: 5000, seuilEcartUsd: 200, tauxUsdCdf: 2740, creeLe: now },
  ]).onConflictDoNothing();
  await db.insert(s.tablesQr).values([
    { id: "tbl_test_tf_1", terrasseId: TERR, numero: 1, tokenQr: "tok_test_tf_1", actif: true, creeLe: now },
    { id: "tbl_test_tf_2", terrasseId: TERR, numero: 2, tokenQr: "tok_test_tf_2", actif: true, creeLe: now },
  ]).onConflictDoNothing();
  // Abonnements d'essai, installation non encore payée
  await db.insert(s.abonnements).values([
    { id: "abo_test_tf_terr", terrasseId: TERR, plan: "ESSENTIEL", tranche: "PETITE", statut: "ESSAI", typeEtablissement: "TERRASSE", essaiFin: ajouterJours(now, 14), periodeDebut: now, periodeFin: ajouterJours(now, 14), annuel: false, nbTablesMaxPeriode: 2, prorataDu: 0, fraisInstallPayes: false },
    { id: "abo_test_tf_bout", terrasseId: BOUT, plan: "BOUTIQUE", tranche: "PETITE", statut: "ESSAI", typeEtablissement: "BOUTIQUE", essaiFin: ajouterJours(now, 14), periodeDebut: now, periodeFin: ajouterJours(now, 14), annuel: false, nbTablesMaxPeriode: 1, prorataDu: 0, fraisInstallPayes: false },
  ]).onConflictDoNothing();
});

afterAll(async () => {
  const db = getDb();
  await db.delete(s.paiements).where(inArray(s.paiements.terrasseId, [TERR, BOUT]));
  await db.delete(s.abonnements).where(inArray(s.abonnements.terrasseId, [TERR, BOUT]));
  await db.delete(s.tablesQr).where(eq(s.tablesQr.terrasseId, TERR));
  await db.delete(s.terrasses).where(inArray(s.terrasses.id, [TERR, BOUT]));
  await db.delete(s.organisations).where(eq(s.organisations.id, ORG));
  await db.delete(s.utilisateurs).where(eq(s.utilisateurs.id, PROP));
});

describe("première échéance : abonnement ÷ 2 + installation par type", () => {
  it("terrasse ESSENTIEL PETITE : 1000 centimes/mois + 1000 d'installation", async () => {
    const r = await appelantProp.gbs.soumettrePaiement({
      terrasseId: TERR, methode: "M_PESA", reference: "REFTARIFSTERR1", annuel: false,
    });
    // 2 tables, aucune remise multi : mensuel 10 $ + installation 10 $
    expect(r.montant).toBe(2000);
  });

  it("boutique : 500 centimes/mois + 500 d'installation", async () => {
    const r = await appelantProp.gbs.soumettrePaiement({
      terrasseId: BOUT, methode: "M_PESA", reference: "REFTARIFSBOUT1", annuel: false,
    });
    // Plan BOUTIQUE 5 $ + installation 5 $ (type BOUTIQUE)
    expect(r.montant).toBe(1000);
  });

  it("une référence déjà soumise est refusée (pas de double facturation)", async () => {
    await expect(
      appelantProp.gbs.soumettrePaiement({
        terrasseId: TERR, methode: "M_PESA", reference: "REFTARIFSTERR1", annuel: false,
      }),
    ).rejects.toThrow();
  });
});
