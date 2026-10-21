// ============================================================
// GBS — Tests du seed (Étape 8, refondu boucle 2)
// Idempotence, structure boutique/terrasse, catalogue multi-pays,
// scission référentiel / fixtures démo (ZÉRO DÉMO en production).
// ============================================================

import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { getDb } from "../queries/connection";
import * as s from "../../db/schema";
import { executerSeedReferentiel } from "../../db/seed";
import { executerSeedCanonique } from "../../db/fixtures-demo";
import { planifierSeed } from "../gbsSeed";
import { CATEGORIES_PAR_TYPE } from "../../contracts/types";

const ETAB_TERR = "etab_terr_001";
const ETAB_BOUT = "etab_bout_001";

// L'idempotence du canonique complet (2 seeds ~1000 articles, ~79 s) est
// isolée dans seed-idempotence.test.ts (découpage boucle 2). Les tests
// ci-dessous supposent le canonique en base : on l'assure une fois ici,
// ils restent ensuite des lectures simples.
describe("seed canonique — structure", () => {
  it("la boutique n'a qu'une seule zone de vente", async () => {
    await executerSeedCanonique(); // no-op si déjà appliqué (idempotent)
    const db = getDb();
    const zones = await db.select().from(s.tablesQr).where(eq(s.tablesQr.terrasseId, ETAB_BOUT));
    expect(zones.filter((z) => z.actif)).toHaveLength(1);
    const [boutique] = await db.select().from(s.terrasses).where(eq(s.terrasses.id, ETAB_BOUT));
    expect(boutique.typeEtablissement).toBe("BOUTIQUE");
    expect(boutique.tokenQrBoutique).toBeTruthy();
  });

  it("la terrasse a 6 tables actives", async () => {
    const db = getDb();
    const tables = await db.select().from(s.tablesQr).where(eq(s.tablesQr.terrasseId, ETAB_TERR));
    expect(tables.filter((t) => t.actif)).toHaveLength(6);
  });

  it("le catalogue contient ~1000 articles actifs", async () => {
    const db = getDb();
    const articles = await db.select().from(s.catalogueProduits).where(eq(s.catalogueProduits.actif, true));
    expect(articles.length).toBeGreaterThanOrEqual(800);
    expect(articles.length).toBeLessThanOrEqual(1200);
  });

  it("les bières des 6 régions sont présentes", async () => {
    const db = getDb();
    const bieres = await db.select().from(s.catalogueProduits)
      .where(eq(s.catalogueProduits.categorie, "Bières"));
    const noms = new Set(bieres.map((b) => b.nom));
    // Katanga, RDC, Angola, Congo-Brazzaville, Zambie, Afrique du Sud
    for (const marque of ["Simba", "Primus", "Cuca", "Ngok", "Mosi", "Soul Barrel Wild African Soul"]) {
      expect(noms.has(marque), `marque manquante : ${marque}`).toBe(true);
    }
  });

  it("la grille divisée par deux est en base (BOUTIQUE 5 USD, ESSENTIEL 10/15/20, PRO 17,50/25/35, BUSINESS 25/37,50/50)", async () => {
    const db = getDb();
    const plans = await db.select().from(s.plansTarifs);
    const boutique = plans.find((p) => p.plan === "BOUTIQUE" && p.tranche === "PETITE");
    expect(boutique).toBeDefined();
    expect(boutique!.prixUsd).toBe(500);
    expect(boutique!.fraisInstallUsd).toBe(500);
    expect(boutique!.typeEtablissementCible).toBe("BOUTIQUE");
    expect(plans).toHaveLength(10);
    // Prix mensuels par plan et par tranche (centimes USD, boucle 1)
    const prix = (plan: string, tranche: string) =>
      plans.find((p) => p.plan === plan && p.tranche === tranche)?.prixUsd;
    expect(prix("ESSENTIEL", "PETITE")).toBe(1000);
    expect(prix("ESSENTIEL", "MOYENNE")).toBe(1500);
    expect(prix("ESSENTIEL", "GRANDE")).toBe(2000);
    expect(prix("PRO", "PETITE")).toBe(1750);
    expect(prix("PRO", "MOYENNE")).toBe(2500);
    expect(prix("PRO", "GRANDE")).toBe(3500);
    expect(prix("BUSINESS", "PETITE")).toBe(2500);
    expect(prix("BUSINESS", "MOYENNE")).toBe(3750);
    expect(prix("BUSINESS", "GRANDE")).toBe(5000);
  });
});

describe("seed référentiel seul (boucle 2 — ZÉRO DÉMO)", () => {
  it("est idempotent : deux exécutions → mêmes volumes de référentiel", async () => {
    const db = getDb();
    const compter = async () => ({
      plans: (await db.select().from(s.plansTarifs)).length,
      catalogue: (await db.select().from(s.catalogueProduits)).length,
      codesBarres: (await db.select().from(s.catalogueCodesBarres)).length,
      categoriesProduit: (await db.select().from(s.categoriesProduit)).length,
    });
    await executerSeedReferentiel();
    const avant = await compter();
    await executerSeedReferentiel();
    const apres = await compter();
    expect(apres).toEqual(avant);
    expect(apres.plans).toBe(10);
    expect(apres.catalogue).toBeGreaterThanOrEqual(800);
    expect(apres.codesBarres).toBeGreaterThanOrEqual(10);
    // Boucle 3 : les 32 catégories du référentiel sont seedées, idempotent
    expect(apres.categoriesProduit).toBe(CATEGORIES_PAR_TYPE.length);
  }, 120_000);
});

describe("planifierSeed (décision pure)", () => {
  it("n'insère JAMAIS la démo quand l'annuaire démo est désactivé (production)", () => {
    // Base vide + ANNUAIRE_DEMO=false : référentiel seul, zéro démo
    expect(planifierSeed({ referentielPresent: false, demoPresente: false, annuaireDemo: false }))
      .toEqual({ referentiel: true, demo: false });
    // Base déjà remplie : rien du tout
    expect(planifierSeed({ referentielPresent: true, demoPresente: true, annuaireDemo: false }))
      .toEqual({ referentiel: false, demo: false });
  });

  it("insère la démo uniquement en mode démo sur une base vide", () => {
    expect(planifierSeed({ referentielPresent: false, demoPresente: false, annuaireDemo: true }))
      .toEqual({ referentiel: true, demo: true });
    // Démo déjà présente : pas de réinsertion (idempotence logique)
    expect(planifierSeed({ referentielPresent: true, demoPresente: true, annuaireDemo: true }))
      .toEqual({ referentiel: false, demo: false });
    // Cas mixte : référentiel absent mais démo présente (base partielle)
    expect(planifierSeed({ referentielPresent: false, demoPresente: true, annuaireDemo: true }))
      .toEqual({ referentiel: true, demo: false });
  });
});
