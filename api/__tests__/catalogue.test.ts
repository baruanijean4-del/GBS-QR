// ============================================================
// GBS — Tests du routeur catalogue codes-barres
// - recherche locale (compteur incrémenté, source LOCAL)
// - recherche Open Food Facts (service moqué, mise en cache)
// - code inconnu partout → null
// - enregistrement manuel + doublon ignoré
// ============================================================

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";

// Le service OFF est moqué : les tests restent hermétiques (pas de réseau).
// Le vrai appel OFF est couvert par openFoodFacts.test.ts.
vi.mock("../services/openFoodFacts", async (importOriginal) => {
  const original = await importOriginal<typeof import("../services/openFoodFacts")>();
  return {
    ...original,
    chercherOpenFoodFacts: vi.fn(async (code: string) => {
      if (code === "3600541234567") {
        return {
          code, nom: "Produit OFF Test", marque: "MarqueTest",
          categorie: "Boissons", format: "50 cl",
          photoUrl: "https://images.openfoodfacts.org/test.jpg",
          photoThumbnailUrl: "https://images.openfoodfacts.org/test_small.jpg",
          nutriscore: "b",
        };
      }
      return null;
    }),
  };
});

import { appRouter } from "../router";
import { getDb } from "../queries/connection";
import * as s from "../../db/schema";
import { maintenant } from "../gbsUtils";

const USR = "usr_test_catalogue_cb";
const CODE_SEED = "5449000000996"; // Coca-Cola 33cl — présent dans le seed
const CODE_OFF = "3600541234567";
const CODE_MANUEL = "4006381333931";

const appelant = appRouter.createCaller({ session: { utilisateurId: USR } } as never);

beforeAll(async () => {
  const db = getDb();
  await db.insert(s.utilisateurs).values({
    id: USR, nom: "Test Catalogue", telephone: "+243000000020", pin: "9999", creeLe: maintenant(),
  }).onConflictDoNothing();
  // S'assure que le code du seed est bien là (idempotent)
  await db.insert(s.catalogueCodesBarres).values({
    id: "cb_test_seed", codeBarres: CODE_SEED, nom: "Coca-Cola", categorie: "Boissons",
    variante: "33 cl", photoUrl: null, consignable: false, bouteillesParCasier: 24,
    prixCdfMoyen: 2000, prixUsdMoyen: 100, nbUtilisations: 0, source: "MANUEL",
    creeLe: maintenant(),
  }).onConflictDoNothing();
  await db.delete(s.catalogueCodesBarres).where(eq(s.catalogueCodesBarres.codeBarres, CODE_OFF));
  await db.delete(s.catalogueCodesBarres).where(eq(s.catalogueCodesBarres.codeBarres, CODE_MANUEL));
});

afterAll(async () => {
  const db = getDb();
  await db.delete(s.catalogueCodesBarres).where(eq(s.catalogueCodesBarres.codeBarres, CODE_OFF));
  await db.delete(s.catalogueCodesBarres).where(eq(s.catalogueCodesBarres.codeBarres, CODE_MANUEL));
  await db.delete(s.auditLog).where(eq(s.auditLog.acteurId, USR));
  await db.delete(s.utilisateurs).where(eq(s.utilisateurs.id, USR));
});

describe("catalogue.rechercherParCodeBarres", () => {
  it("code en base locale → source LOCAL et compteur incrémenté", async () => {
    const avant = await getDb().select().from(s.catalogueCodesBarres)
      .where(eq(s.catalogueCodesBarres.codeBarres, CODE_SEED)).limit(1);

    const r = await appelant.catalogue.rechercherParCodeBarres({ codeBarres: CODE_SEED });
    expect(r).not.toBeNull();
    expect(r!.source).toBe("LOCAL");
    expect(r!.nom).toBe("Coca-Cola");
    expect(r!.categorie).toBe("Boissons");
    expect(r!.variante).toBe("33 cl");
    expect(r!.bouteillesParCasier).toBe(24);

    const apres = await getDb().select().from(s.catalogueCodesBarres)
      .where(eq(s.catalogueCodesBarres.codeBarres, CODE_SEED)).limit(1);
    expect(apres[0].nbUtilisations).toBe(avant[0].nbUtilisations + 1);
  });

  it("code inconnu localement → Open Food Facts, mis en cache (source OPEN_FOOD_FACTS)", async () => {
    const r = await appelant.catalogue.rechercherParCodeBarres({ codeBarres: CODE_OFF });
    expect(r).not.toBeNull();
    expect(r!.source).toBe("OPEN_FOOD_FACTS");
    expect(r!.nom).toBe("Produit OFF Test");
    expect(r!.variante).toBe("50 cl");

    // Mise en cache : le 2e appel passe par le LOCAL (sans rappeler OFF)
    const r2 = await appelant.catalogue.rechercherParCodeBarres({ codeBarres: CODE_OFF });
    expect(r2!.source).toBe("LOCAL");
    const [cache] = await getDb().select().from(s.catalogueCodesBarres)
      .where(eq(s.catalogueCodesBarres.codeBarres, CODE_OFF)).limit(1);
    expect(cache.source).toBe("OPEN_FOOD_FACTS");
  });

  it("code inconnu partout → null", async () => {
    const r = await appelant.catalogue.rechercherParCodeBarres({ codeBarres: "9999999999999" });
    expect(r).toBeNull();
  });

  it("format invalide rejeté par la validation", async () => {
    await expect(
      appelant.catalogue.rechercherParCodeBarres({ codeBarres: "ABC" }),
    ).rejects.toThrow();
  });
});

describe("catalogue.enregistrerCodeBarres", () => {
  it("insertion manuelle → source MANUEL", async () => {
    const r = await appelant.catalogue.enregistrerCodeBarres({
      codeBarres: CODE_MANUEL, nom: "Produit Manuel", categorie: "Divers",
    });
    expect(r.insere).toBe(true);

    const recherche = await appelant.catalogue.rechercherParCodeBarres({ codeBarres: CODE_MANUEL });
    expect(recherche!.source).toBe("LOCAL");
    expect(recherche!.nom).toBe("Produit Manuel");

    const [ligne] = await getDb().select().from(s.catalogueCodesBarres)
      .where(eq(s.catalogueCodesBarres.codeBarres, CODE_MANUEL)).limit(1);
    expect(ligne.source).toBe("MANUEL");
  });

  it("doublon ignoré (onConflictDoNothing)", async () => {
    const r = await appelant.catalogue.enregistrerCodeBarres({
      codeBarres: CODE_MANUEL, nom: "Doublon", categorie: "Divers",
    });
    expect(r.insere).toBe(false);
    // Le nom d'origine est conservé
    const recherche = await appelant.catalogue.rechercherParCodeBarres({ codeBarres: CODE_MANUEL });
    expect(recherche!.nom).toBe("Produit Manuel");
  });
});
