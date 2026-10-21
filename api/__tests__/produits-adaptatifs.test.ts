// ============================================================
// GBS — Boucle 3 : validation API du formulaire produit
// adaptatif. Refus testés : catégorie d'un autre type
// d'établissement, chambre sans capacité, service sans durée.
// Déduction du typeProduit depuis la catégorie du référentiel.
// Fixtures dédiées (préfixe test_pad), nettoyées en fin de fichier.
// ============================================================

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { appRouter } from "../router";
import { getDb } from "../queries/connection";
import * as s from "../../db/schema";
import { ajouterJours, maintenant } from "../gbsUtils";

const appelantProp = appRouter.createCaller({ session: { utilisateurId: "usr_test_pad_prop" } } as never);

const ORG = "org_test_pad";
const PROP = "usr_test_pad_prop";
const ETAB_GH = "etab_test_pad_gh";   // GUEST_HOUSE (chambres, services)
const ETAB_TER = "etab_test_pad_ter"; // TERRASSE (billard, bières)
const ETABS = [ETAB_GH, ETAB_TER];

beforeAll(async () => {
  const db = getDb();
  const now = maintenant();
  await db.insert(s.utilisateurs).values([
    { id: PROP, nom: "Proprio TestPad", telephone: "+243990000041", pin: "0001", creeLe: now },
  ]).onConflictDoNothing();
  await db.insert(s.organisations).values({ id: ORG, nom: "Org TestPad", proprietaireId: PROP, creeLe: now }).onConflictDoNothing();
  await db.insert(s.terrasses).values([
    { id: ETAB_GH, organisationId: ORG, nom: "Hôtel TestPad", adresse: "Av. des Tests", typeEtablissement: "GUEST_HOUSE", seuilEcartCdf: 5000, seuilEcartUsd: 200, tauxUsdCdf: 2740, creeLe: now },
    { id: ETAB_TER, organisationId: ORG, nom: "Terrasse TestPad", adresse: "Av. des Tests", typeEtablissement: "TERRASSE", seuilEcartCdf: 5000, seuilEcartUsd: 200, tauxUsdCdf: 2740, creeLe: now },
  ]).onConflictDoNothing();
  await db.insert(s.abonnements).values(ETABS.map((t, i) => ({
    id: `abo_test_pad_${i}`, terrasseId: t, plan: "ESSENTIEL", tranche: "PETITE", statut: "ESSAI",
    essaiFin: ajouterJours(now, 14), periodeDebut: now, periodeFin: ajouterJours(now, 30),
    annuel: false, nbTablesMaxPeriode: 2, prorataDu: 0, fraisInstallPayes: false,
  }))).onConflictDoNothing();
});

afterAll(async () => {
  const db = getDb();
  await db.delete(s.auditLog).where(eq(s.auditLog.acteurId, PROP));
  await db.delete(s.produits).where(inArray(s.produits.terrasseId, ETABS));
  await db.delete(s.abonnements).where(inArray(s.abonnements.terrasseId, ETABS));
  await db.delete(s.terrasses).where(inArray(s.terrasses.id, ETABS));
  await db.delete(s.organisations).where(eq(s.organisations.id, ORG));
  await db.delete(s.utilisateurs).where(eq(s.utilisateurs.id, PROP));
});

const base = { prixCdf: 5000, prixUsdCentimes: 200, stock: 10, seuil: 2 };

describe("creerProduit — refus adaptatifs (boucle 3)", () => {
  it("chambre sans capacité : refusée", async () => {
    await expect(
      appelantProp.gbs.creerProduit({ terrasseId: ETAB_GH, nom: "Chambre double", categorie: "Chambres", typeProduit: "CHAMBRE", ...base }),
    ).rejects.toThrow(/capacité/);
  });

  it("service sans durée : refusé", async () => {
    await expect(
      appelantProp.gbs.creerProduit({ terrasseId: ETAB_GH, nom: "Blanchisserie", categorie: "Services", typeProduit: "SERVICE", ...base }),
    ).rejects.toThrow(/durée/);
  });

  it("catégorie d'un autre type d'établissement : refusée", async () => {
    // « Chambres » appartient au référentiel GUEST_HOUSE, pas TERRASSE
    await expect(
      appelantProp.gbs.creerProduit({ terrasseId: ETAB_TER, nom: "Chambre importée", categorie: "Chambres", ...base }),
    ).rejects.toThrow(/type d'établissement/);
  });

  it("libellé libre hors référentiel : toléré (compatibilité)", async () => {
    await expect(
      appelantProp.gbs.creerProduit({ terrasseId: ETAB_TER, nom: "Fufu maison", categorie: "Cuisine locale", ...base }),
    ).resolves.toEqual({ ok: true });
  });
});

describe("creerProduit — acceptations et déduction du type", () => {
  it("chambre avec capacité : acceptée, typeProduit déduit CHAMBRE", async () => {
    await expect(
      appelantProp.gbs.creerProduit({ terrasseId: ETAB_GH, nom: "Chambre simple", categorie: "Chambres", capacite: 2, ...base }),
    ).resolves.toEqual({ ok: true });
    const db = getDb();
    const [p] = await db.select().from(s.produits)
      .where(eq(s.produits.nom, "Chambre simple")).limit(1);
    expect(p!.terrasseId).toBe(ETAB_GH);
    expect(p!.typeProduit).toBe("CHAMBRE");
    expect(p!.capacite).toBe(2);
  });

  it("service avec durée : accepté, typeProduit déduit SERVICE", async () => {
    await expect(
      appelantProp.gbs.creerProduit({ terrasseId: ETAB_GH, nom: "Repassage", categorie: "Services", dureeMinutes: 45, ...base }),
    ).resolves.toEqual({ ok: true });
    const db = getDb();
    const [p] = await db.select().from(s.produits).where(eq(s.produits.nom, "Repassage")).limit(1);
    expect(p!.typeProduit).toBe("SERVICE");
    expect(p!.dureeMinutes).toBe(45);
  });

  it("billard sur terrasse : typeProduit déduit BILLARD", async () => {
    await expect(
      appelantProp.gbs.creerProduit({ terrasseId: ETAB_TER, nom: "Partie de billard", categorie: "Billard", ...base }),
    ).resolves.toEqual({ ok: true });
    const db = getDb();
    const [p] = await db.select().from(s.produits).where(eq(s.produits.nom, "Partie de billard")).limit(1);
    expect(p!.typeProduit).toBe("BILLARD");
  });

  it("marchandise classique : typeProduit déduit MARCHANDISE, champs nuls", async () => {
    await expect(
      appelantProp.gbs.creerProduit({ terrasseId: ETAB_TER, nom: "Primus TestPad", categorie: "Bières", ...base }),
    ).resolves.toEqual({ ok: true });
    const db = getDb();
    const [p] = await db.select().from(s.produits).where(eq(s.produits.nom, "Primus TestPad")).limit(1);
    expect(p!.typeProduit).toBe("MARCHANDISE");
    expect(p!.unite).toBeNull();
    expect(p!.lot).toBeNull();
    expect(p!.datePeremption).toBeNull();
  });

  it("pharmacie : lot et date de péremption enregistrés", async () => {
    await expect(
      appelantProp.gbs.creerProduit({
        terrasseId: ETAB_TER, nom: "Lot suivi", categorie: "Boissons",
        lot: "L2026-10", datePeremption: "2027-06-30", ...base,
      }),
    ).resolves.toEqual({ ok: true });
    const db = getDb();
    const [p] = await db.select().from(s.produits).where(eq(s.produits.nom, "Lot suivi")).limit(1);
    expect(p!.lot).toBe("L2026-10");
    expect(p!.datePeremption).toBe("2027-06-30");
  });
});
