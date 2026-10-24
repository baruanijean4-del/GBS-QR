// ============================================================
// GBS — Demandes de photo : le gérant / propriétaire DEMANDE, le
// super-admin colle l'URL et VALIDE, la photo apparaît sur le produit
// ou la chambre. Les photos sont toujours des URL (docs/PHOTOS.md).
// Fixtures préfixées test_pho.
// ============================================================

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, like } from "drizzle-orm";
import { appRouter } from "../router";
import { getDb } from "../queries/connection";
import * as s from "../../db/schema";
import { ajouterJours, maintenant } from "../gbsUtils";
import { env } from "../lib/env";
import { viderLimiteur } from "../lib/limiteur";

const PROP = "usr_test_pho_prop";
const GER = "usr_test_pho_ger";
const SERV = "usr_test_pho_serv";
const AUTRE = "usr_test_pho_autre"; // gérant d'un AUTRE établissement
const ORG = "org_test_pho";
const ORG2 = "org_test_pho2";
const ETAB = "etab_test_pho";
const ETAB2 = "etab_test_pho2";
const PRD = "prd_test_pho_1";
const CHB = "chb_test_pho_1";
const TEL = "+2439900009";
const URL_OK = "https://res.cloudinary.com/demo/image/upload/primus.jpg";

const ip = "127.0.0.1";
const gerant = appRouter.createCaller({ session: { utilisateurId: GER }, ip } as never);
const proprio = appRouter.createCaller({ session: { utilisateurId: PROP }, ip } as never);
const serveuse = appRouter.createCaller({ session: { utilisateurId: SERV }, ip } as never);
const autre = appRouter.createCaller({ session: { utilisateurId: AUTRE }, ip } as never);
const admin = appRouter.createCaller({ ip } as never);

beforeAll(async () => {
  const db = getDb();
  const now = maintenant();
  await db.insert(s.utilisateurs).values([
    { id: PROP, nom: "Proprio TestPho", telephone: `${TEL}1`, pin: "0001", creeLe: now },
    { id: GER, nom: "Gérant TestPho", telephone: `${TEL}2`, pin: "0002", creeLe: now },
    { id: SERV, nom: "Serveuse TestPho", telephone: `${TEL}3`, pin: "0003", creeLe: now },
    { id: AUTRE, nom: "Autre TestPho", telephone: `${TEL}4`, pin: "0004", creeLe: now },
  ]).onConflictDoNothing();
  await db.insert(s.organisations).values([
    { id: ORG, nom: "Org TestPho", proprietaireId: PROP, creeLe: now },
    { id: ORG2, nom: "Org2 TestPho", proprietaireId: AUTRE, creeLe: now },
  ]).onConflictDoNothing();
  await db.insert(s.terrasses).values([
    {
      id: ETAB, organisationId: ORG, nom: "Hôtel TestPho", adresse: "Av. Test",
      typeEtablissement: "GUEST_HOUSE", typesSecondaires: [],
      seuilEcartCdf: 5000, seuilEcartUsd: 200, tauxUsdCdf: 2740, creeLe: now,
    },
    {
      id: ETAB2, organisationId: ORG2, nom: "Bar TestPho", adresse: "Av. Test 2",
      typeEtablissement: "TERRASSE", typesSecondaires: [],
      seuilEcartCdf: 5000, seuilEcartUsd: 200, tauxUsdCdf: 2740, creeLe: now,
    },
  ]).onConflictDoNothing();
  await db.insert(s.abonnements).values({
    id: "abo_test_pho", terrasseId: ETAB, plan: "ESSENTIEL", tranche: "PETITE", statut: "ESSAI",
    essaiFin: ajouterJours(now, 14), periodeDebut: now, periodeFin: ajouterJours(now, 30),
    annuel: false, nbTablesMaxPeriode: 10, prorataDu: 0, fraisInstallPayes: false,
  }).onConflictDoNothing();
  await db.insert(s.affectations).values([
    { id: "aff_test_pho_1", utilisateurId: GER, terrasseId: ETAB, role: "GERANT", actif: true, creeLe: now },
    { id: "aff_test_pho_2", utilisateurId: SERV, terrasseId: ETAB, role: "SERVEUSE", actif: true, creeLe: now },
  ]).onConflictDoNothing();
  await db.insert(s.produits).values({
    id: PRD, terrasseId: ETAB, nom: "Primus TestPho", categorie: "Bières",
    prixCdf: 2500, prixUsd: 100, stock: 50, stockReserve: 0, seuilAlerte: 5, actif: true,
  }).onConflictDoNothing();
  await db.insert(s.chambres).values({
    id: CHB, terrasseId: ETAB, numero: "101", type: "SIMPLE", statut: "LIBRE",
    prixNuitCdf: 40000, prixHeureCdf: null, creeLe: now,
  }).onConflictDoNothing();
  viderLimiteur();
});

afterAll(async () => {
  const db = getDb();
  await db.delete(s.demandesPhoto).where(like(s.demandesPhoto.terrasseId, "etab_test_pho%"));
  await db.delete(s.auditLog).where(like(s.auditLog.terrasseId, "etab_test_pho%"));
  await db.delete(s.chambres).where(eq(s.chambres.terrasseId, ETAB));
  await db.delete(s.produits).where(eq(s.produits.terrasseId, ETAB));
  await db.delete(s.affectations).where(eq(s.affectations.terrasseId, ETAB));
  await db.delete(s.abonnements).where(eq(s.abonnements.terrasseId, ETAB));
  await db.delete(s.terrasses).where(like(s.terrasses.id, "etab_test_pho%"));
  await db.delete(s.organisations).where(like(s.organisations.id, "org_test_pho%"));
  await db.delete(s.utilisateurs).where(like(s.utilisateurs.nom, "%TestPho%"));
});

describe("Demandes de photo — côté établissement", () => {
  it("le gérant demande une photo pour un produit", async () => {
    const r = await gerant.photos.demander({ cible: "PRODUIT", cibleId: PRD, note: "Bouteille de face" });
    expect(r.id).toBeTruthy();
    const liste = await gerant.photos.mesDemandes({ terrasseId: ETAB });
    expect(liste.find((d) => d.id === r.id)).toMatchObject({ cible: "PRODUIT", cibleId: PRD, statut: "EN_ATTENTE", note: "Bouteille de face" });
  });

  it("une seule demande en attente par produit (même en double clic)", async () => {
    await expect(gerant.photos.demander({ cible: "PRODUIT", cibleId: PRD })).rejects.toThrow(/déjà en attente/);
    const doubles = await Promise.allSettled([
      proprio.photos.demander({ cible: "CHAMBRE", cibleId: CHB }),
      proprio.photos.demander({ cible: "CHAMBRE", cibleId: CHB }),
    ]);
    expect(doubles.filter((x) => x.status === "fulfilled")).toHaveLength(1);
  });

  it("une serveuse ne peut pas demander ; un gérant d'un autre établissement non plus", async () => {
    await expect(serveuse.photos.demander({ cible: "PRODUIT", cibleId: PRD })).rejects.toThrow(/Gérant et au Propriétaire/);
    await expect(autre.photos.demander({ cible: "PRODUIT", cibleId: PRD })).rejects.toThrow();
    await expect(autre.photos.mesDemandes({ terrasseId: ETAB })).rejects.toThrow();
  });

  it("produit ou chambre inconnus : refus clair", async () => {
    await expect(gerant.photos.demander({ cible: "PRODUIT", cibleId: "prd_inexistant" })).rejects.toThrow(/introuvable/);
    await expect(gerant.photos.demander({ cible: "CHAMBRE", cibleId: "chb_inexistante" })).rejects.toThrow(/introuvable/);
  });

  it("le demandeur peut annuler sa demande, puis en refaire une", async () => {
    const [enAttente] = (await gerant.photos.mesDemandes({ terrasseId: ETAB })).filter((d) => d.cibleId === CHB && d.statut === "EN_ATTENTE");
    await gerant.photos.annuler({ demandeId: enAttente!.id });
    await expect(gerant.photos.annuler({ demandeId: enAttente!.id })).rejects.toThrow(/déjà traitée/);
    await expect(gerant.photos.demander({ cible: "CHAMBRE", cibleId: CHB })).resolves.toBeDefined();
  });
});

describe("Demandes de photo — côté super-admin", () => {
  it("PIN incorrect : accès refusé", async () => {
    await expect(admin.photos.listerAdmin({ pinAdmin: "mauvais-pin" })).rejects.toThrow(/PIN incorrect/);
    viderLimiteur();
  });

  it("la liste donne de quoi décider : établissement, demandeur, produit, note", async () => {
    const liste = await admin.photos.listerAdmin({ pinAdmin: env.adminPin });
    const d = liste.find((x) => x.libelle === "Primus TestPho");
    expect(d).toMatchObject({ cible: "PRODUIT", etablissement: "Hôtel TestPho", demandeur: "Gérant TestPho", note: "Bouteille de face", photoActuelle: null });
    expect(liste.some((x) => x.libelle === "Chambre 101")).toBe(true);
  });

  it("une adresse non https est refusée : la demande reste en attente", async () => {
    const d = (await admin.photos.listerAdmin({ pinAdmin: env.adminPin })).find((x) => x.libelle === "Primus TestPho")!;
    for (const url of ["http://exemple.com/p.jpg", "photo.jpg", "data:image/png;base64,AAAA", ""]) {
      await expect(admin.photos.traiter({ pinAdmin: env.adminPin, demandeId: d.id, decision: "VALIDEE", url }))
        .rejects.toThrow(/https/);
    }
    const [enBase] = await getDb().select().from(s.demandesPhoto).where(eq(s.demandesPhoto.id, d.id));
    expect(enBase!.statut).toBe("EN_ATTENTE");
  });

  it("validation d'un produit : l'URL devient la photo (et la vignette), visible dans le snapshot", async () => {
    const d = (await admin.photos.listerAdmin({ pinAdmin: env.adminPin })).find((x) => x.libelle === "Primus TestPho")!;
    await admin.photos.traiter({ pinAdmin: env.adminPin, demandeId: d.id, decision: "VALIDEE", url: URL_OK });
    const [p] = await getDb().select().from(s.produits).where(eq(s.produits.id, PRD));
    expect(p).toMatchObject({ photoUrl: URL_OK, photoThumbnailUrl: URL_OK, photoSource: "URL" });
    // Côté établissement : la demande est marquée validée, avec l'adresse
    const liste = await gerant.photos.mesDemandes({ terrasseId: ETAB });
    expect(liste.find((x) => x.id === d.id)).toMatchObject({ statut: "VALIDEE", url: URL_OK });
    // Côté client : le menu lit produits.photo_url
    const snapshot = await gerant.gbs.snapshot({ portee: { kind: "staff" } });
    expect(snapshot.produits.find((x) => x.id === PRD)?.photoUrl).toBe(URL_OK);
  });

  it("une demande déjà traitée ne se retraite pas", async () => {
    const [d] = await getDb().select().from(s.demandesPhoto).where(eq(s.demandesPhoto.cibleId, PRD));
    await expect(admin.photos.traiter({ pinAdmin: env.adminPin, demandeId: d!.id, decision: "VALIDEE", url: URL_OK }))
      .rejects.toThrow(/déjà traitée/);
  });

  it("validation d'une chambre : chambres.photo_url est posée", async () => {
    const d = (await admin.photos.listerAdmin({ pinAdmin: env.adminPin })).find((x) => x.libelle === "Chambre 101")!;
    await admin.photos.traiter({ pinAdmin: env.adminPin, demandeId: d.id, decision: "VALIDEE", url: "https://i.ibb.co/abc123/chambre101.jpg" });
    const [c] = await getDb().select().from(s.chambres).where(eq(s.chambres.id, CHB));
    expect(c!.photoUrl).toBe("https://i.ibb.co/abc123/chambre101.jpg");
  });

  it("refus : motif obligatoire, visible côté établissement, nouvelle demande possible", async () => {
    await gerant.photos.demander({ cible: "PRODUIT", cibleId: PRD, note: "Autre angle" });
    const d = (await admin.photos.listerAdmin({ pinAdmin: env.adminPin })).find((x) => x.libelle === "Primus TestPho")!;
    await expect(admin.photos.traiter({ pinAdmin: env.adminPin, demandeId: d.id, decision: "REFUSEE" })).rejects.toThrow(/Motif obligatoire/);
    await admin.photos.traiter({ pinAdmin: env.adminPin, demandeId: d.id, decision: "REFUSEE", motif: "Image floue" });
    const liste = await gerant.photos.mesDemandes({ terrasseId: ETAB });
    expect(liste.find((x) => x.id === d.id)).toMatchObject({ statut: "REFUSEE", motifRefus: "Image floue" });
    // Un refus ne touche pas la photo en place
    const [p] = await getDb().select().from(s.produits).where(eq(s.produits.id, PRD));
    expect(p!.photoUrl).toBe(URL_OK);
    await expect(gerant.photos.demander({ cible: "PRODUIT", cibleId: PRD })).resolves.toBeDefined();
  });
});

describe("Fin de l'envoi de fichiers", () => {
  it("les anciennes routes d'envoi n'existent plus", () => {
    const routes = Object.keys((appRouter as unknown as { _def: { procedures: Record<string, unknown> } })._def.procedures);
    expect(routes).not.toContain("produits.uploadPhoto");
    expect(routes).not.toContain("hotel.uploadPhotoChambre");
    expect(routes).toContain("photos.demander");
  });

  it("créer un produit avec une image encodée (data:) est refusé", async () => {
    await expect(proprio.gbs.creerProduit({
      terrasseId: ETAB, nom: "Test image TestPho", categorie: "Bières",
      prixCdf: 1000, prixUsdCentimes: 0, stock: 1, seuil: 0,
      photoUrl: "data:image/png;base64,iVBORw0KGgo=",
    } as never)).rejects.toThrow(/Adresse de photo invalide/);
  });
});
