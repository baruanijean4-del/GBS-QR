// ============================================================
// GBS — Module traiteur (MODULE-TRAITEUR.md) côté API :
//  * cas de référence §10 : menu poulet, 200 personnes — huile 30 L
//    UNE ligne (agrégation), sel 200 g EXACTS (aucun arrondi
//    intermédiaire), coût du jour 404,00 $, marge 196,00 $ (32,67 %),
//    contrat sans boisson 344,00 $ ;
//  * RBAC : coûts et marges PROPRIÉTAIRE SEUL, recettes proposées par
//    le chef et validées par le propriétaire, aucun prix pour le
//    gérant / le chef / le magasinier ;
//  * comptage à l'aveugle : théorique jamais renvoyé, écart en
//    quantité seule, alerte propriétaire au-delà du seuil.
// Fixtures préfixées test_tra.
// ============================================================

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq, like } from "drizzle-orm";
import { appRouter } from "../router";
import { getDb } from "../queries/connection";
import * as s from "../../db/schema";
import { maintenant } from "../gbsUtils";

const PROP = "usr_test_tra_prop";
const GER = "usr_test_tra_ger";
const CHEF = "usr_test_tra_chef";
const MAG = "usr_test_tra_mag";
const SERV = "usr_test_tra_serv";
const ORG = "org_test_tra";
const ETAB = "etab_test_tra";
const TEL = "+2439920007";

const proprio = appRouter.createCaller({ session: { utilisateurId: PROP } } as never);
const gerant = appRouter.createCaller({ session: { utilisateurId: GER } } as never);
const chef = appRouter.createCaller({ session: { utilisateurId: CHEF } } as never);
const magasinier = appRouter.createCaller({ session: { utilisateurId: MAG } } as never);
const serveuse = appRouter.createCaller({ session: { utilisateurId: SERV } } as never);

// Produits (unités : stock entier dans l'unité indiquée) — prix §10.
const PRD = {
  poulet: "prd_test_tra_poulet", // kg, 4,30 $/kg
  riz: "prd_test_tra_riz",       // kg, 1,20 $/kg
  huile: "prd_test_tra_huile",   // l,  2,50 $/L
  tomate: "prd_test_tra_tomate", // kg, 1,50 $/kg
  oignon: "prd_test_tra_oignon", // kg, 1,00 $/kg
  eau: "prd_test_tra_eau",       // pièce, 0,30 $/pièce
  sel: "prd_test_tra_sel",       // g,  sans coût renseigné
};

beforeAll(async () => {
  const db = getDb();
  const now = maintenant();
  await db.insert(s.utilisateurs).values([
    { id: PROP, nom: "Proprio TestTra", telephone: `${TEL}1`, pin: "0001", creeLe: now },
    { id: GER, nom: "Gérant TestTra", telephone: `${TEL}2`, pin: "0002", creeLe: now },
    { id: CHEF, nom: "Chef TestTra", telephone: `${TEL}3`, pin: "0003", creeLe: now },
    { id: MAG, nom: "Magasinier TestTra", telephone: `${TEL}4`, pin: "0004", creeLe: now },
    { id: SERV, nom: "Serveuse TestTra", telephone: `${TEL}5`, pin: "0005", creeLe: now },
  ]).onConflictDoNothing();
  await db.insert(s.organisations).values({ id: ORG, nom: "Org TestTra", proprietaireId: PROP, creeLe: now }).onConflictDoNothing();
  await db.insert(s.terrasses).values({
    id: ETAB, organisationId: ORG, nom: "Traiteur TestTra", adresse: "Av. Test",
    typeEtablissement: "TERRASSE", typesSecondaires: [],
    seuilEcartCdf: 5000, seuilEcartUsd: 200, tauxUsdCdf: 2740, creeLe: now,
  }).onConflictDoNothing();
  await db.insert(s.affectations).values([
    { id: "aff_test_tra_1", utilisateurId: GER, terrasseId: ETAB, role: "GERANT", actif: true, creeLe: now },
    { id: "aff_test_tra_2", utilisateurId: CHEF, terrasseId: ETAB, role: "CHEF", actif: true, creeLe: now },
    { id: "aff_test_tra_3", utilisateurId: MAG, terrasseId: ETAB, role: "MAGASINIER", actif: true, creeLe: now },
    { id: "aff_test_tra_4", utilisateurId: SERV, terrasseId: ETAB, role: "SERVEUSE", actif: true, creeLe: now },
  ]).onConflictDoNothing();
  await db.insert(s.produits).values([
    { id: PRD.poulet, terrasseId: ETAB, nom: "Poulet TestTra", categorie: "Denrées", prixCdf: 0, prixUsd: 0, stock: 200, stockReserve: 0, seuilAlerte: 0, actif: true, unite: "kg", coutAchatUsd: 430 },
    { id: PRD.riz, terrasseId: ETAB, nom: "Riz TestTra", categorie: "Denrées", prixCdf: 0, prixUsd: 0, stock: 200, stockReserve: 0, seuilAlerte: 0, actif: true, unite: "kg", coutAchatUsd: 120 },
    { id: PRD.huile, terrasseId: ETAB, nom: "Huile TestTra", categorie: "Denrées", prixCdf: 0, prixUsd: 0, stock: 200, stockReserve: 0, seuilAlerte: 0, actif: true, unite: "l", coutAchatUsd: 250, lot: "LOT-H1" },
    { id: PRD.tomate, terrasseId: ETAB, nom: "Tomate TestTra", categorie: "Denrées", prixCdf: 0, prixUsd: 0, stock: 200, stockReserve: 0, seuilAlerte: 0, actif: true, unite: "kg", coutAchatUsd: 150 },
    { id: PRD.oignon, terrasseId: ETAB, nom: "Oignon TestTra", categorie: "Denrées", prixCdf: 0, prixUsd: 0, stock: 200, stockReserve: 0, seuilAlerte: 0, actif: true, unite: "kg", coutAchatUsd: 100 },
    { id: PRD.eau, terrasseId: ETAB, nom: "Eau TestTra", categorie: "Boissons", prixCdf: 0, prixUsd: 0, stock: 500, stockReserve: 0, seuilAlerte: 0, actif: true, unite: "pièce", coutAchatUsd: 30 },
    { id: PRD.sel, terrasseId: ETAB, nom: "Sel TestTra", categorie: "Denrées", prixCdf: 0, prixUsd: 0, stock: 5000, stockReserve: 0, seuilAlerte: 0, actif: true, unite: "g", coutAchatUsd: null },
  ]).onConflictDoNothing();
});

afterAll(async () => {
  const db = getDb();
  const prefix = (col: unknown) => like(col as never, "%test_tra%");
  // Nettoyage ciblé : uniquement les lignes de CE fichier de test.
  const plans = await db.select({ id: s.traiteurPlans.id }).from(s.traiteurPlans).where(eq(s.traiteurPlans.terrasseId, ETAB));
  for (const p of plans) {
    await db.delete(s.traiteurBonLignes).where(eq(s.traiteurBonLignes.bonId,
      (await db.select({ id: s.traiteurBonsSortie.id }).from(s.traiteurBonsSortie).where(eq(s.traiteurBonsSortie.planId, p.id)))[0]?.id ?? "__"));
    await db.delete(s.traiteurBonsSortie).where(eq(s.traiteurBonsSortie.planId, p.id));
    await db.delete(s.traiteurPlanExclusions).where(eq(s.traiteurPlanExclusions.planId, p.id));
  }
  await db.delete(s.traiteurPlans).where(eq(s.traiteurPlans.terrasseId, ETAB));
  const menus = await db.select({ id: s.traiteurMenus.id }).from(s.traiteurMenus).where(eq(s.traiteurMenus.terrasseId, ETAB));
  for (const m of menus) await db.delete(s.traiteurMenuLignes).where(eq(s.traiteurMenuLignes.menuId, m.id));
  await db.delete(s.traiteurMenus).where(eq(s.traiteurMenus.terrasseId, ETAB));
  const comps = await db.select({ id: s.traiteurComposants.id }).from(s.traiteurComposants).where(eq(s.traiteurComposants.terrasseId, ETAB));
  for (const c of comps) {
    const recs = await db.select({ id: s.traiteurRecettes.id }).from(s.traiteurRecettes).where(eq(s.traiteurRecettes.composantId, c.id));
    for (const r of recs) await db.delete(s.traiteurRecetteLignes).where(eq(s.traiteurRecetteLignes.recetteId, r.id));
    await db.delete(s.traiteurRecettes).where(eq(s.traiteurRecettes.composantId, c.id));
  }
  await db.delete(s.traiteurComposants).where(eq(s.traiteurComposants.terrasseId, ETAB));
  await db.delete(s.traiteurComptages).where(eq(s.traiteurComptages.terrasseId, ETAB));
  await db.delete(s.mouvementsStock).where(prefix(s.mouvementsStock.terrasseId));
  await db.delete(s.alertes).where(eq(s.alertes.terrasseId, ETAB));
  await db.delete(s.auditLog).where(eq(s.auditLog.terrasseId, ETAB));
  await db.delete(s.produits).where(eq(s.produits.terrasseId, ETAB));
  await db.delete(s.affectations).where(eq(s.affectations.terrasseId, ETAB));
  await db.delete(s.terrasses).where(eq(s.terrasses.id, ETAB));
  await db.delete(s.organisations).where(eq(s.organisations.id, ORG));
  await db.delete(s.utilisateurs).where(like(s.utilisateurs.id, "usr_test_tra%"));
});

// ---------------- Montage du cas de référence (partagé) ----------------

let composants: Record<"plat" | "sauce" | "accomp" | "boisson", string>;
let menuId = "";
let planId = "";

async function monterRecette(composantId: string, lignes: { produitId: string; quantiteParPersonneBase: number; tauxPertePct?: number }[]) {
  const { recetteId } = await chef.traiteur.proposerRecette({ composantId, lignes });
  await proprio.traiteur.validerRecette({ recetteId });
  return recetteId;
}

describe("traiteur — cas de référence §10 (menu poulet, 200 personnes)", () => {
  it("monte les 4 composants et leurs recettes validées", async () => {
    composants = {
      plat: (await chef.traiteur.creerComposant({ terrasseId: ETAB, nom: "Poulet grillé TestTra", kind: "PLAT" })).id,
      sauce: (await chef.traiteur.creerComposant({ terrasseId: ETAB, nom: "Sauce tomate TestTra", kind: "SAUCE" })).id,
      accomp: (await chef.traiteur.creerComposant({ terrasseId: ETAB, nom: "Riz TestTra", kind: "ACCOMPAGNEMENT" })).id,
      boisson: (await chef.traiteur.creerComposant({ terrasseId: ETAB, nom: "Eau TestTra", kind: "BOISSON" })).id,
    };
    // Plat : poulet 250 g + huile 100 ml + sel 0,5 g par personne.
    await monterRecette(composants.plat, [
      { produitId: PRD.poulet, quantiteParPersonneBase: 250_000 },
      { produitId: PRD.huile, quantiteParPersonneBase: 100 },
      { produitId: PRD.sel, quantiteParPersonneBase: 500 },
    ]);
    // Sauce : tomate 40 g + oignon 30 g + huile 50 ml + sel 0,5 g.
    await monterRecette(composants.sauce, [
      { produitId: PRD.tomate, quantiteParPersonneBase: 40_000 },
      { produitId: PRD.oignon, quantiteParPersonneBase: 30_000 },
      { produitId: PRD.huile, quantiteParPersonneBase: 50 },
      { produitId: PRD.sel, quantiteParPersonneBase: 500 },
    ]);
    // Accompagnement : riz 150 g. Boisson : 1 pièce, SANS perte (§1).
    await monterRecette(composants.accomp, [{ produitId: PRD.riz, quantiteParPersonneBase: 150_000 }]);
    await monterRecette(composants.boisson, [{ produitId: PRD.eau, quantiteParPersonneBase: 1, tauxPertePct: 0 }]);
    expect(composants.plat).toBeTruthy();
  });

  it("refuse un taux de perte sur une boisson (produit non cuisiné, §1)", async () => {
    await expect(chef.traiteur.proposerRecette({
      composantId: composants.boisson,
      lignes: [{ produitId: PRD.eau, quantiteParPersonneBase: 1, tauxPertePct: 5 }],
    })).rejects.toThrow(/perte/);
  });

  it("refuse la validation d'une recette par un non-propriétaire (§5)", async () => {
    const { recetteId } = await chef.traiteur.proposerRecette({
      composantId: composants.accomp,
      lignes: [{ produitId: PRD.riz, quantiteParPersonneBase: 150_000 }],
    });
    await expect(gerant.traiteur.validerRecette({ recetteId })).rejects.toThrow(/propriétaire/);
  });

  it("une recette validée n'est jamais écrasée : nouvelle version (§6)", async () => {
    const avant = await chef.traiteur.listeRecettes({ composantId: composants.accomp });
    const maxAvant = Math.max(...avant.recettes.map((r) => r.version));
    const { version } = await chef.traiteur.proposerRecette({
      composantId: composants.accomp,
      lignes: [{ produitId: PRD.riz, quantiteParPersonneBase: 160_000 }],
    });
    expect(version).toBe(maxAvant + 1);
  });

  it("crée le menu à 3,00 $/personne et le plan de 200 personnes", async () => {
    menuId = (await proprio.traiteur.creerMenu({
      terrasseId: ETAB, nom: "Menu poulet TestTra", prixPersonneUsd: 300,
      lignes: [
        { composantId: composants.plat },
        { composantId: composants.sauce },
        { composantId: composants.accomp },
        { composantId: composants.boisson },
      ],
    })).menuId;
    planId = (await gerant.traiteur.creerPlan({
      menuId, entreprise: "Entreprise TestTra", nbPersonnes: 200, jour: "2026-10-22", heure: "12:00",
    })).planId;
    await gerant.traiteur.demarrerPlan({ planId });
    const plans = await gerant.traiteur.listePlans({ terrasseId: ETAB });
    expect(plans.find((p) => p.id === planId)?.statut).toBe("EN_COURS");
  });

  it("refuse une répartition d'options dont la somme ≠ nbPersonnes (§2)", async () => {
    await expect(gerant.traiteur.creerPlan({
      menuId, entreprise: "Entreprise TestTra 2", nbPersonnes: 200, jour: "2026-10-23", heure: "12:00",
      repartitionOptions: { quelque_chose: 150 },
    })).rejects.toThrow(/répartition/);
  });

  it("bon de sortie : huile 30 L UNE ligne, sel 200 000 mg EXACTS (§4, §10)", async () => {
    const { bonId } = await magasinier.traiteur.emettreBonSortie({ planId });
    expect(bonId).toBeTruthy();
    const bon = await magasinier.traiteur.voirBonSortie({ planId });
    const parProduit = new Map(bon.lignes.map((l) => [l.produit, l]));
    // Agrégation : UNE seule ligne huile (plat 20 L + sauce 10 L).
    expect(bon.lignes.filter((l) => l.produit === "Huile TestTra")).toHaveLength(1);
    expect(parProduit.get("Huile TestTra")?.quantiteBase).toBe(30_000); // ml
    expect(parProduit.get("Huile TestTra")?.quantite).toBe("30 L");
    expect(parProduit.get("Huile TestTra")?.lot).toBe("LOT-H1"); // lot FEFO
    // Sel : 500 mg × 200 × 2 composants = 200 000 mg — aucun arrondi.
    expect(parProduit.get("Sel TestTra")?.quantiteBase).toBe(200_000);
    expect(parProduit.get("Sel TestTra")?.quantite).toBe("200 g");
    expect(parProduit.get("Poulet TestTra")?.quantiteBase).toBe(50_000_000); // 50 kg
    expect(parProduit.get("Riz TestTra")?.quantiteBase).toBe(30_000_000);
    expect(parProduit.get("Tomate TestTra")?.quantiteBase).toBe(8_000_000);
    expect(parProduit.get("Oignon TestTra")?.quantiteBase).toBe(6_000_000);
    expect(parProduit.get("Eau TestTra")?.quantiteBase).toBe(200);
    // §4 : le bon ne contient AUCUN prix.
    for (const l of bon.lignes) {
      expect(Object.keys(l).join(",")).not.toMatch(/prix|cout|montant/i);
    }
    // Stock décrémenté : huile 200 L − 30 L = 170 ; sel 5000 g − 200 g = 4800.
    const db = getDb();
    const [huile] = await db.select().from(s.produits).where(eq(s.produits.id, PRD.huile));
    const [sel] = await db.select().from(s.produits).where(eq(s.produits.id, PRD.sel));
    expect(huile.stock).toBe(170);
    expect(sel.stock).toBe(4800);
    // Un plan = un bon : toute réémission est refusée.
    await expect(magasinier.traiteur.emettreBonSortie({ planId })).rejects.toThrow(/existe déjà/);
  });

  it("coûts propriétaire : 404,00 $/jour, 2,02 $/pers., marge 196,00 $ (32,67 %)", async () => {
    const couts = await proprio.traiteur.coutsPlan({ planId });
    expect(couts.coutJourCentimes).toBe(40_400);
    expect(couts.coutParPersonneCentimes).toBe(202);
    expect(couts.recetteCentimes).toBe(60_000); // 3,00 $ × 200
    expect(couts.margeCentimes).toBe(19_600);
    expect(couts.margePct).toBeCloseTo(32.67, 2);
    // Coût par composant (§10) : plat 1,325 $/pers., accomp. 0,180,
    // sauce 0,215, boisson 0,300.
    const par = new Map(couts.parComposant.map((c) => [c.kind, c.coutCentimes]));
    expect(par.get("PLAT")).toBe(26_500); // 215 $ poulet + 50 $ huile
    expect(par.get("ACCOMPAGNEMENT")).toBe(3_600);
    expect(par.get("SAUCE")).toBe(4_300); // 12 + 6 + 25
    expect(par.get("BOISSON")).toBe(6_000);
  });

  it("contrat sans boisson : coût 344,00 $ (§3, §10)", async () => {
    const plan2 = (await gerant.traiteur.creerPlan({
      menuId, entreprise: "Entreprise TestTra sans boisson", nbPersonnes: 200,
      jour: "2026-10-24", heure: "12:00",
      exclusions: [{ composantId: composants.boisson, motif: "l'eau est fournie par l'entreprise" }],
    })).planId;
    await gerant.traiteur.demarrerPlan({ planId: plan2 });
    const couts = await proprio.traiteur.coutsPlan({ planId: plan2 });
    expect(couts.coutJourCentimes).toBe(34_400);
    const bon = await magasinier.traiteur.emettreBonSortie({ planId: plan2 });
    expect(bon.bonId).toBeTruthy();
    const vue = await magasinier.traiteur.voirBonSortie({ planId: plan2 });
    expect(vue.lignes.some((l) => l.produit === "Eau TestTra")).toBe(false);
  });
});

describe("traiteur — confidentialité des montants (§5)", () => {
  it("refuse les coûts au gérant, au chef et au magasinier", async () => {
    await expect(gerant.traiteur.coutsPlan({ planId })).rejects.toThrow(/propriétaire/);
    await expect(chef.traiteur.coutsPlan({ planId })).rejects.toThrow(/propriétaire/);
    await expect(magasinier.traiteur.coutsPlan({ planId })).rejects.toThrow(/propriétaire/);
  });

  it("la liste des menus masque le prix au gérant, pas au propriétaire", async () => {
    const vueGerant = await gerant.traiteur.listeMenus({ terrasseId: ETAB });
    expect(vueGerant[0]?.prixPersonneUsd).toBeNull();
    const vueProprio = await proprio.traiteur.listeMenus({ terrasseId: ETAB });
    expect(vueProprio[0]?.prixPersonneUsd).toBe(300);
  });

  it("la fiche de production du chef est groupée par composant, sans prix", async () => {
    const fiche = await chef.traiteur.ficheProduction({ planId });
    const plat = fiche.find((f) => f.kind === "PLAT");
    expect(plat?.personnes).toBe(200);
    expect(plat?.ingredients.find((i) => i.produit === "Poulet TestTra")?.quantite).toBe("50 kg");
    for (const comp of fiche) {
      for (const ing of comp.ingredients) {
        expect(Object.keys(ing).join(",")).not.toMatch(/prix|cout|montant/i);
      }
    }
  });

  it("refuse l'accès traiteur à un rôle hors module (serveuse)", async () => {
    await expect(serveuse.traiteur.listeComposants({ terrasseId: ETAB })).rejects.toThrow(/rôle traiteur/);
  });
});

describe("traiteur — comptage à l'aveugle (§7bis)", () => {
  it("le théorique n'est JAMAIS renvoyé ; écart en quantité seule", async () => {
    // Eau : 500 − 200 (bon) = 300 théoriques ; le magasinier compte 280.
    const r = await magasinier.traiteur.comptageAveugle({ terrasseId: ETAB, produitId: PRD.eau, quantiteComptee: 280 });
    expect(r.ecart).toBe(20);
    expect(Object.keys(r)).not.toContain("theorique");
    // Écart 20 > seuil (max(2, 5 % de 300)) → alerte propriétaire.
    const db = getDb();
    const alertes = await db.select().from(s.alertes)
      .where(and(eq(s.alertes.terrasseId, ETAB), eq(s.alertes.type, "ECART_COMPTAGE")));
    expect(alertes.length).toBeGreaterThan(0);
    expect(alertes[0].message).not.toMatch(/\$|USD|cent/); // quantité seule
  });

  it("la valeur de l'écart n'apparaît que pour le propriétaire", async () => {
    const vueMag = await magasinier.traiteur.listeEcarts({ terrasseId: ETAB });
    expect(vueMag[0]?.ecart).toBe(20);
    expect(vueMag[0]?.valeurEcartCentimes).toBeNull();
    const vueProp = await proprio.traiteur.listeEcarts({ terrasseId: ETAB });
    expect(vueProp[0]?.valeurEcartCentimes).toBe(600); // 20 × 0,30 $
  });
});
