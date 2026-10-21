// ============================================================
// GBS — Tests du routeur etablissements (Étape 8)
// Création terrasse/boutique, règle de la zone unique, essai 14 j.
// Utilise une organisation de test nettoyée en fin de fichier.
// ============================================================

import { TRPCError } from "@trpc/server";
import { afterAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { appRouter } from "../router";
import { getDb } from "../queries/connection";
import * as s from "../../db/schema";
import { maintenant } from "../gbsUtils";

// Contexte minimal : les procédures métier n'utilisent pas req/resHeaders.
// H.1 : identité = session serveur (propriétaire de test, déclaré en fixture) ;
// l'intrus simule un jeton valide d'un utilisateur sans accès.
const appelant = appRouter.createCaller({ session: { utilisateurId: "usr_test_etab" } } as never);
const intrus = appRouter.createCaller({ session: { utilisateurId: "usr_intrus" } } as never);

// Organisation + propriétaire de test (nettoyés après les tests)
const ORG_TEST = "org_test_etab";
const PROP_TEST = "usr_test_etab";
const crees: string[] = []; // établissements à nettoyer

async function preparerOrg() {
  const db = getDb();
  const now = maintenant();
  await db.insert(s.utilisateurs).values({
    id: PROP_TEST, nom: "Test Établissements", telephone: "+243000000000", pin: "9999", creeLe: now,
  }).onConflictDoNothing();
  await db.insert(s.organisations).values({
    id: ORG_TEST, nom: "Org de test", proprietaireId: PROP_TEST, creeLe: now,
  }).onConflictDoNothing();
}

afterAll(async () => {
  const db = getDb();
  for (const id of crees) {
    await db.delete(s.historiqueTranches).where(eq(s.historiqueTranches.creePar, PROP_TEST));
    await db.delete(s.abonnements).where(eq(s.abonnements.terrasseId, id));
    await db.delete(s.affectations).where(eq(s.affectations.terrasseId, id));
    await db.delete(s.tablesQr).where(eq(s.tablesQr.terrasseId, id));
    await db.delete(s.terrasses).where(eq(s.terrasses.id, id));
  }
  await db.delete(s.organisations).where(eq(s.organisations.id, ORG_TEST));
  await db.delete(s.utilisateurs).where(eq(s.utilisateurs.id, PROP_TEST));
});

describe("etablissements", () => {
  it("creer BOUTIQUE → 1 seule zone « Comptoir » + QR mural + essai 14 j", async () => {
    await preparerOrg();
    const r = await appelant.etablissements.creer({
      organisationId: ORG_TEST,
      nom: "Boutique Vitest", adresse: "Av. des Tests", type: "BOUTIQUE",
    });
    crees.push(r.etablissement.id);
    expect(r.tables).toHaveLength(1);
    expect(r.etablissement.typeEtablissement).toBe("BOUTIQUE");
    expect(r.etablissement.tokenQrBoutique).toBeTruthy();
    expect(r.abonnement.plan).toBe("BOUTIQUE");
    expect(r.abonnement.statut).toBe("ESSAI");
    // essaiFin ≈ maintenant + 14 jours (± 1 min de tolérance)
    const delta = new Date(r.abonnement.essaiFin!).getTime() - Date.now();
    expect(delta).toBeGreaterThan(13.9 * 86_400_000);
    expect(delta).toBeLessThan(14.1 * 86_400_000);
  });

  it("creer TERRASSE → N tables avec tokens uniques", async () => {
    await preparerOrg();
    const r = await appelant.etablissements.creer({
      organisationId: ORG_TEST,
      nom: "Terrasse Vitest", adresse: "Av. des Tests", type: "TERRASSE", nombreTables: 5,
    });
    crees.push(r.etablissement.id);
    expect(r.tables).toHaveLength(5);
    expect(new Set(r.tables.map((t) => t.tokenQr)).size).toBe(5);
    expect(r.abonnement.plan).toBe("ESSENTIEL");
  });

  it("ajouterTable sur une boutique est refusé (403)", async () => {
    const boutiqueId = crees[0]!;
    await expect(
      appelant.etablissements.ajouterTable({ etablissementId: boutiqueId }),
    ).rejects.toSatisfy((e) => e instanceof TRPCError && e.code === "FORBIDDEN");
  });

  it("ajouterTable sur une terrasse crée la table et met à jour l'abonnement", async () => {
    const terrasseId = crees[1]!;
    const r = await appelant.etablissements.ajouterTable({ etablissementId: terrasseId });
    expect(r.trancheAvant).toBe("PETITE");
    const db = getDb();
    const tables = await db.select().from(s.tablesQr).where(eq(s.tablesQr.terrasseId, terrasseId));
    expect(tables.filter((t) => t.actif)).toHaveLength(6);
    const [abo] = await db.select().from(s.abonnements).where(eq(s.abonnements.terrasseId, terrasseId));
    expect(abo.nbTablesMaxPeriode).toBe(6);
  });

  it("creer par un non-propriétaire est refusé (403)", async () => {
    await preparerOrg();
    await expect(
      intrus.etablissements.creer({
        organisationId: ORG_TEST, nom: "Interdit", type: "BOUTIQUE",
      }),
    ).rejects.toSatisfy((e) => e instanceof TRPCError && e.code === "FORBIDDEN");
  });
});
