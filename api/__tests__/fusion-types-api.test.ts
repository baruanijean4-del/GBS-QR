// ============================================================
// GBS — Fusion multi-métiers côté API : inscription avec 1 à 3
// types (1er = principal), catégories des types fusionnés
// acceptées dans creerProduit. Fixtures préfixées test_fus.
// ============================================================

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, inArray, like } from "drizzle-orm";
import { appRouter } from "../router";
import { getDb } from "../queries/connection";
import * as s from "../../db/schema";
import { ajouterJours, maintenant } from "../gbsUtils";

const anonyme = appRouter.createCaller({} as never);
const appelantProp = appRouter.createCaller({ session: { utilisateurId: "usr_test_fus_prop" } } as never);

const ORG = "org_test_fus";
const PROP = "usr_test_fus_prop";
const ETAB = "etab_test_fus"; // TERRASSE + BILLARD (fusion)
const TEL_BASE = "+2439900005";

beforeAll(async () => {
  const db = getDb();
  const now = maintenant();
  await db.insert(s.utilisateurs).values([
    { id: PROP, nom: "Proprio TestFus", telephone: `${TEL_BASE}1`, pin: "0001", creeLe: now },
  ]).onConflictDoNothing();
  await db.insert(s.organisations).values({ id: ORG, nom: "Org TestFus", proprietaireId: PROP, creeLe: now }).onConflictDoNothing();
  await db.insert(s.terrasses).values({
    id: ETAB, organisationId: ORG, nom: "Terrasse-Billard TestFus", adresse: "Av. des Tests",
    typeEtablissement: "TERRASSE", typesSecondaires: ["BILLARD"],
    seuilEcartCdf: 5000, seuilEcartUsd: 200, tauxUsdCdf: 2740, creeLe: now,
  }).onConflictDoNothing();
  await db.insert(s.abonnements).values({
    id: "abo_test_fus", terrasseId: ETAB, plan: "ESSENTIEL", tranche: "PETITE", statut: "ESSAI",
    essaiFin: ajouterJours(now, 14), periodeDebut: now, periodeFin: ajouterJours(now, 30),
    annuel: false, nbTablesMaxPeriode: 2, prorataDu: 0, fraisInstallPayes: false,
  }).onConflictDoNothing();
});

afterAll(async () => {
  const db = getDb();
  await db.delete(s.auditLog).where(like(s.auditLog.details, "%TestFus%"));
  await db.delete(s.auditLog).where(eq(s.auditLog.acteurId, PROP));
  await db.delete(s.produits).where(eq(s.produits.terrasseId, ETAB));
  // Établissements créés par les tests d'inscription (nom préfixé)
  const crees = await db.select().from(s.terrasses).where(like(s.terrasses.nom, "%TestFus%"));
  const idsCrees = crees.map((t) => t.id);
  if (idsCrees.length > 0) {
    await db.delete(s.abonnements).where(inArray(s.abonnements.terrasseId, idsCrees));
    await db.delete(s.tablesQr).where(inArray(s.tablesQr.terrasseId, idsCrees));
    await db.delete(s.affectations).where(inArray(s.affectations.terrasseId, idsCrees));
    await db.delete(s.terrasses).where(inArray(s.terrasses.id, idsCrees));
  }
  await db.delete(s.abonnements).where(eq(s.abonnements.terrasseId, ETAB));
  await db.delete(s.terrasses).where(eq(s.terrasses.id, ETAB));
  const orgsCreees = await db.select().from(s.organisations).where(like(s.organisations.nom, "%TestFus%"));
  await db.delete(s.organisations).where(inArray(s.organisations.id, orgsCreees.map((o) => o.id)));
  const usrs = await db.select().from(s.utilisateurs).where(like(s.utilisateurs.nom, "%TestFus%"));
  await db.delete(s.utilisateurs).where(inArray(s.utilisateurs.id, usrs.map((u) => u.id)));
});

const base = { prixCdf: 5000, prixUsdCentimes: 200, stock: 10, seuil: 2 };

describe("creerProduit — établissement fusionné TERRASSE+BILLARD", () => {
  it("accepte une catégorie du type SECONDAIRE (Parties de billard)", async () => {
    await expect(
      appelantProp.gbs.creerProduit({ terrasseId: ETAB, nom: "Partie TestFus", categorie: "Parties de billard", ...base }),
    ).resolves.toEqual({ ok: true });
    const db = getDb();
    const [p] = await db.select().from(s.produits).where(eq(s.produits.nom, "Partie TestFus")).limit(1);
    expect(p!.typeProduit).toBe("BILLARD");
  });

  it("refuse toujours une catégorie d'un type NON fusionné (Chambres)", async () => {
    await expect(
      appelantProp.gbs.creerProduit({ terrasseId: ETAB, nom: "Chambre TestFus", categorie: "Chambres", capacite: 2, ...base }),
    ).rejects.toThrow(/type d'établissement/);
  });
});

describe("finaliserInscription — fusion 1 à 3 types", () => {
  it("Terrasse + Billard : principal TERRASSE, secondaire stocké, plan tables", async () => {
    const r = await anonyme.gbs.finaliserInscription({
      nom: "Patron Fusion", telephone: `${TEL_BASE}2`, pin: "5678",
      nomTerrasse: "Chez TestFus Fusion", adresse: "Av. Test",
      nombreTables: 6, aussiGerant: true,
      typeEtablissement: "TERRASSE", typesSecondaires: ["BILLARD"],
    });
    const db = getDb();
    const [ter] = await db.select().from(s.terrasses).where(eq(s.terrasses.id, r.terrasseId));
    expect(ter!.typeEtablissement).toBe("TERRASSE");
    expect(ter!.typesSecondaires).toEqual(["BILLARD"]);
    expect(ter!.tokenQrBoutique).toBeNull(); // ni terrasse ni billard = comptoir
    const tables = await db.select().from(s.tablesQr).where(eq(s.tablesQr.terrasseId, r.terrasseId));
    expect(tables).toHaveLength(6);
    const [abo] = await db.select().from(s.abonnements).where(eq(s.abonnements.terrasseId, r.terrasseId));
    expect(abo!.plan).toBe("ESSENTIEL");
  });

  it("Boutique + Salon (deux comptoirs) : plan BOUTIQUE et QR mural conservés", async () => {
    const r = await anonyme.gbs.finaliserInscription({
      nom: "Patronne Comptoir", telephone: `${TEL_BASE}3`, pin: "5678",
      nomTerrasse: "Comptoir TestFus", adresse: "",
      nombreTables: 8, aussiGerant: false,
      typeEtablissement: "BOUTIQUE", typesSecondaires: ["SALON"],
    });
    const db = getDb();
    const [ter] = await db.select().from(s.terrasses).where(eq(s.terrasses.id, r.terrasseId));
    expect(ter!.tokenQrBoutique).not.toBeNull();
    const tables = await db.select().from(s.tablesQr).where(eq(s.tablesQr.terrasseId, r.terrasseId));
    expect(tables).toHaveLength(1); // zone unique « Comptoir »
    const [abo] = await db.select().from(s.abonnements).where(eq(s.abonnements.terrasseId, r.terrasseId));
    expect(abo!.plan).toBe("BOUTIQUE");
  });

  it("Pharmacie seule : UN seul QR comptoir malgré nombreTables=6 (pas de tables)", async () => {
    // Demande produit : « une pharmacie n'a pas de table » — l'inscription
    // crée une seule zone (kind ZONE, vocabulaire comptoir), quelle que
    // soit la valeur demandée. Le client qui scanne voit tout le catalogue.
    const r = await anonyme.gbs.finaliserInscription({
      nom: "Pharmacien TestFus", telephone: `${TEL_BASE}5`, pin: "5678",
      nomTerrasse: "Pharmacie TestFus", adresse: "",
      nombreTables: 6, aussiGerant: false,
      typeEtablissement: "PHARMACIE", typesSecondaires: [],
    });
    const db = getDb();
    const tables = await db.select().from(s.tablesQr).where(eq(s.tablesQr.terrasseId, r.terrasseId));
    expect(tables).toHaveLength(1);
    expect(tables[0]!.kind).toBe("ZONE");
    const [abo] = await db.select().from(s.abonnements).where(eq(s.abonnements.terrasseId, r.terrasseId));
    expect(abo!.nbTablesMaxPeriode).toBe(1);
    // La pharmacie n'est PAS « zone unique » au sens historique (règle des
    // comptoirs/rayons) : plan ESSENTIEL conservé, tarification inchangée.
    expect(abo!.plan).toBe("ESSENTIEL");
  });

  it("mono-type appelé comme avant (sans typesSecondaires) : comportement inchangé", async () => {
    const r = await anonyme.gbs.finaliserInscription({
      nom: "Patron Solo", telephone: `${TEL_BASE}4`, pin: "5678",
      nomTerrasse: "Solo TestFus", adresse: "",
      nombreTables: 4, aussiGerant: false,
      typeEtablissement: "RESTAURANT", typesSecondaires: [],
    });
    const db = getDb();
    const [ter] = await db.select().from(s.terrasses).where(eq(s.terrasses.id, r.terrasseId));
    expect(ter!.typesSecondaires).toEqual([]);
    const tables = await db.select().from(s.tablesQr).where(eq(s.tablesQr.terrasseId, r.terrasseId));
    expect(tables).toHaveLength(4);
  });
});
