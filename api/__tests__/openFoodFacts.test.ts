// ============================================================
// GBS — Tests du service Open Food Facts
// - produit connu (Coca-Cola, appel réel OFF) → nom + photo
// - code inexistant → null
// - format invalide → null (sans appel réseau)
// - la réponse extraite reste < 1 Ko
// ============================================================

import { describe, expect, it } from "vitest";
import { chercherOpenFoodFacts, traduireCategorie } from "../services/openFoodFacts";

describe("chercherOpenFoodFacts", () => {
  it("5449000000996 → Coca-Cola avec photo (appel réel OFF)", async () => {
    const r = await chercherOpenFoodFacts("5449000000996");
    expect(r).not.toBeNull();
    expect(r!.nom.toLowerCase()).toContain("coca-cola");
    expect(r!.code).toBe("5449000000996");
    expect(r!.photoUrl).toMatch(/^https:\/\//);
  }, 15_000);

  it("0000000000000 → null (code inexistant)", async () => {
    const r = await chercherOpenFoodFacts("0000000000000");
    expect(r).toBeNull();
  }, 15_000);

  it("ABC123 → null (format invalide, pas d'appel réseau)", async () => {
    const r = await chercherOpenFoodFacts("ABC123");
    expect(r).toBeNull();
  });

  it("la réponse extraite tient en 8 champs et < 1 Ko", async () => {
    const r = await chercherOpenFoodFacts("5449000000996");
    expect(r).not.toBeNull();
    expect(Object.keys(r!).sort()).toEqual([
      "categorie", "code", "format", "marque", "nom", "nutriscore", "photoThumbnailUrl", "photoUrl",
    ]);
    expect(JSON.stringify(r!).length).toBeLessThan(1024);
  }, 15_000);
});

describe("traduireCategorie", () => {
  it("bière → Bières", () => {
    expect(traduireCategorie(["en:beers", "en:alcoholic-beverages"])).toBe("Bières");
  });
  it("soda / cola → Boissons", () => {
    expect(traduireCategorie(["en:beverages", "en:colas"])).toBe("Boissons");
  });
  it("eau → Boissons", () => {
    expect(traduireCategorie(["en:waters", "en:spring-waters"])).toBe("Boissons");
  });
  it("chocolat → Snacks & conserves", () => {
    expect(traduireCategorie(["en:snacks", "en:chocolates"])).toBe("Snacks & conserves");
  });
  it("savon → Savons & détergents", () => {
    expect(traduireCategorie(["en:soaps"])).toBe("Savons & détergents");
  });
  it("inconnu → Divers", () => {
    expect(traduireCategorie(["en:whatever-else"])).toBe("Divers");
    expect(traduireCategorie([])).toBe("Divers");
  });
});
