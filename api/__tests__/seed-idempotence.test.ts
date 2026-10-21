// ============================================================
// GBS — Idempotence du seed canonique complet (boucle 2)
// Isolé de seed.test.ts : ce test exécute DEUX seeds complets
// (référentiel ~1000 articles + fixtures démo) et dominait la
// durée du fichier d'origine (~79 s sur 90 s). Les autres tests
// du seed (structure, grille tarifaire, référentiel seul)
// restent dans seed.test.ts.
// ============================================================

import { describe, expect, it } from "vitest";
import { getDb } from "../queries/connection";
import * as s from "../../db/schema";
import { executerSeedCanonique } from "../../db/fixtures-demo";

describe("seed canonique — idempotence", () => {
  it("est idempotent : deux exécutions → mêmes volumes", async () => {
    const db = getDb();
    const compter = async () => ({
      catalogue: (await db.select().from(s.catalogueProduits)).length,
      produits: (await db.select().from(s.produits)).length,
      utilisateurs: (await db.select().from(s.utilisateurs)).length,
      etablissements: (await db.select().from(s.terrasses)).length,
      plans: (await db.select().from(s.plansTarifs)).length,
    });
    await executerSeedCanonique();
    const avant = await compter();
    await executerSeedCanonique();
    const apres = await compter();
    expect(apres).toEqual(avant);
  }, 120_000);
});
