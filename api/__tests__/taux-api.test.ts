// ============================================================
// GBS — Règle taux de change USD/FC côté API (migration 0016,
// docs/REGLE-TAUX-CHANGE.md) : droits par rôle (gérant limité à
// SON établissement), bornes de saisie, taux FIGÉ sur chaque
// vente (commande, token, nuitée), historique audit_log, alertes
// variation/fréquence, établissement sans taux (mono-devise).
// Fixtures préfixées test_taux.
// ============================================================

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq, inArray, like } from "drizzle-orm";
import { appRouter } from "../router";
import { getDb } from "../queries/connection";
import * as s from "../../db/schema";
import { ajouterJours, maintenant } from "../gbsUtils";

const appelantProp = appRouter.createCaller({ session: { utilisateurId: "usr_test_taux_prop" } } as never);
const appelantGer = appRouter.createCaller({ session: { utilisateurId: "usr_test_taux_ger" } } as never);
const appelantGerB = appRouter.createCaller({ session: { utilisateurId: "usr_test_taux_gerb" } } as never);
const appelantServ = appRouter.createCaller({ session: { utilisateurId: "usr_test_taux_serv" } } as never);
const anonyme = appRouter.createCaller({} as never);

const ORG = "org_test_taux";
const PROP = "usr_test_taux_prop";
const GER = "usr_test_taux_ger";
const GERB = "usr_test_taux_gerb";
const SERV = "usr_test_taux_serv";
const ETAB_A = "etab_test_taux_a"; // terrasse, taux 2800 au départ
const ETAB_B = "etab_test_taux_b"; // autre établissement (gérant GERB)
const ETAB_HOTEL = "etab_test_taux_h"; // nuitées, taux 2800
const ETAB_SANS = "etab_test_taux_s"; // SANS taux (mono-devise)
const TABLE_A = "tbl_test_taux_zone";
const QR_A = "qrtoken_test_taux_zone";
const TABLE_BILL = "tbl_test_taux_bill";
const TABLE_SANS = "tbl_test_taux_sans";
const QR_SANS = "qrtoken_test_taux_sans";
const PRD_A = "prd_test_taux_a";
const PRD_SANS = "prd_test_taux_s";
const CHAMBRE = "chb_test_taux_1";
const TOUS_ETABS = [ETAB_A, ETAB_B, ETAB_HOTEL, ETAB_SANS];
const TEL_BASE = "+2439900008";

async function terrasse(id: string) {
  const [t] = await getDb().select().from(s.terrasses).where(eq(s.terrasses.id, id)).limit(1);
  return t;
}

/** Commande client de 1 Primus sur la table QR donnée. */
async function commander(tokenQr: string, produitId: string, cle: string) {
  const sess = await anonyme.gbs.ouvrirSessionClient({ token: tokenQr, prenom: "Cliente TestTaux" });
  return anonyme.gbs.passerCommande({
    token: tokenQr, clientSessionId: sess.id,
    lignes: [{ produitId, quantite: 1 }], cleIdempotence: cle,
  });
}

beforeAll(async () => {
  const db = getDb();
  const now = maintenant();
  await db.insert(s.utilisateurs).values([
    { id: PROP, nom: "Proprio TestTaux", telephone: `${TEL_BASE}1`, pin: "0001", creeLe: now },
    { id: GER, nom: "Gerant TestTaux", telephone: `${TEL_BASE}2`, pin: "0002", creeLe: now },
    { id: GERB, nom: "GerantB TestTaux", telephone: `${TEL_BASE}3`, pin: "0003", creeLe: now },
    { id: SERV, nom: "Serveuse TestTaux", telephone: `${TEL_BASE}4`, pin: "0004", creeLe: now },
  ]).onConflictDoNothing();
  await db.insert(s.organisations).values({ id: ORG, nom: "Org TestTaux", proprietaireId: PROP, creeLe: now }).onConflictDoNothing();
  await db.insert(s.terrasses).values([
    { id: ETAB_A, organisationId: ORG, nom: "TerrasseA TestTaux", adresse: "Av. des Tests", typeEtablissement: "TERRASSE", typesSecondaires: [], seuilEcartCdf: 5000, seuilEcartUsd: 200, tauxUsdCdf: 2800, creeLe: now },
    { id: ETAB_B, organisationId: ORG, nom: "TerrasseB TestTaux", adresse: "Av. des Tests", typeEtablissement: "TERRASSE", typesSecondaires: [], seuilEcartCdf: 5000, seuilEcartUsd: 200, tauxUsdCdf: 2700, creeLe: now },
    { id: ETAB_HOTEL, organisationId: ORG, nom: "Hotel TestTaux", adresse: "Av. des Tests", typeEtablissement: "GUEST_HOUSE", typesSecondaires: [], seuilEcartCdf: 5000, seuilEcartUsd: 200, tauxUsdCdf: 2800, creeLe: now },
    { id: ETAB_SANS, organisationId: ORG, nom: "MonoDevise TestTaux", adresse: "Av. des Tests", typeEtablissement: "TERRASSE", typesSecondaires: [], seuilEcartCdf: 5000, seuilEcartUsd: 200, tauxUsdCdf: null, creeLe: now },
  ]).onConflictDoNothing();
  for (const etab of TOUS_ETABS) {
    await db.insert(s.abonnements).values({
      id: `abo_test_taux_${etab.slice(-1)}`, terrasseId: etab, plan: "ESSENTIEL", tranche: "PETITE", statut: "ESSAI",
      essaiFin: ajouterJours(now, 14), periodeDebut: now, periodeFin: ajouterJours(now, 30),
      annuel: false, nbTablesMaxPeriode: 2, prorataDu: 0, fraisInstallPayes: false,
    }).onConflictDoNothing();
  }
  await db.insert(s.affectations).values([
    { id: "aff_test_taux_1", utilisateurId: GER, terrasseId: ETAB_A, role: "GERANT", actif: true, creeLe: now },
    { id: "aff_test_taux_2", utilisateurId: GER, terrasseId: ETAB_HOTEL, role: "GERANT", actif: true, creeLe: now },
    { id: "aff_test_taux_3", utilisateurId: GERB, terrasseId: ETAB_B, role: "GERANT", actif: true, creeLe: now },
    { id: "aff_test_taux_4", utilisateurId: SERV, terrasseId: ETAB_A, role: "SERVEUSE", actif: true, creeLe: now },
  ]).onConflictDoNothing();
  await db.insert(s.tablesQr).values([
    { id: TABLE_A, terrasseId: ETAB_A, numero: 1, tokenQr: QR_A, kind: "ZONE", actif: true, creeLe: now },
    { id: TABLE_BILL, terrasseId: ETAB_A, numero: 2, tokenQr: "qrtoken_test_taux_bill", kind: "BILLARD", actif: true, creeLe: now },
    { id: TABLE_SANS, terrasseId: ETAB_SANS, numero: 1, tokenQr: QR_SANS, kind: "ZONE", actif: true, creeLe: now },
  ]).onConflictDoNothing();
  await db.insert(s.produits).values([
    { id: PRD_A, terrasseId: ETAB_A, nom: "Primus TestTaux", categorie: "Bières", prixCdf: 3000, prixUsd: 110, stock: 50, stockReserve: 0, seuilAlerte: 6, actif: true, consignable: false },
    { id: PRD_SANS, terrasseId: ETAB_SANS, nom: "Fanta TestTaux", categorie: "Sodas", prixCdf: 2000, prixUsd: 75, stock: 50, stockReserve: 0, seuilAlerte: 6, actif: true, consignable: false },
  ]).onConflictDoNothing();
  await db.insert(s.chambres).values({
    id: CHAMBRE, terrasseId: ETAB_HOTEL, numero: "T1", type: "SIMPLE", statut: "LIBRE",
    prixNuitCdf: 40000, prixHeureCdf: null, creeLe: now,
  }).onConflictDoNothing();
});

afterAll(async () => {
  const db = getDb();
  await db.delete(s.mouvementsStock).where(inArray(s.mouvementsStock.terrasseId, TOUS_ETABS));
  await db.delete(s.commandes).where(inArray(s.commandes.terrasseId, TOUS_ETABS));
  await db.delete(s.tokensBillard).where(inArray(s.tokensBillard.terrasseId, TOUS_ETABS));
  await db.delete(s.sejours).where(inArray(s.sejours.terrasseId, TOUS_ETABS));
  await db.delete(s.chambres).where(inArray(s.chambres.terrasseId, TOUS_ETABS));
  await db.delete(s.clientsSession).where(inArray(s.clientsSession.tableId, [TABLE_A, TABLE_BILL, TABLE_SANS]));
  await db.delete(s.alertes).where(inArray(s.alertes.terrasseId, TOUS_ETABS));
  await db.delete(s.auditLog).where(inArray(s.auditLog.terrasseId, TOUS_ETABS));
  await db.delete(s.auditLog).where(like(s.auditLog.details, "%TestTaux%"));
  await db.delete(s.configBillard).where(inArray(s.configBillard.terrasseId, TOUS_ETABS));
  await db.delete(s.produits).where(inArray(s.produits.terrasseId, TOUS_ETABS));
  await db.delete(s.affectations).where(inArray(s.affectations.terrasseId, TOUS_ETABS));
  await db.delete(s.tablesQr).where(inArray(s.tablesQr.terrasseId, TOUS_ETABS));
  await db.delete(s.abonnements).where(inArray(s.abonnements.terrasseId, TOUS_ETABS));
  await db.delete(s.terrasses).where(inArray(s.terrasses.id, TOUS_ETABS));
  await db.delete(s.organisations).where(eq(s.organisations.id, ORG));
  await db.delete(s.utilisateurs).where(like(s.utilisateurs.nom, "%TestTaux%"));
});

describe("Taux de change — droits par rôle (contrôle serveur)", () => {
  it("lecture : tout membre de l'établissement (serveuse incluse)", async () => {
    const vue = await appelantServ.taux.voir({ terrasseId: ETAB_A });
    expect(vue.tauxUsdCdf).toBe(2800);
    expect(vue.alerteVariationPct).toBe(5);
    expect(vue.alerteMaxParJour).toBe(3);
    expect(vue.plafondCdf).toBe(10000);
  });

  it("lecture : refusée à un non-membre (gérant d'un autre établissement)", async () => {
    await expect(appelantGerB.taux.voir({ terrasseId: ETAB_A })).rejects.toThrow();
  });

  it("écriture : serveuse REFUSÉE", async () => {
    await expect(appelantServ.taux.modifier({ terrasseId: ETAB_A, tauxUsdCdf: 2850 })).rejects.toThrow();
    expect((await terrasse(ETAB_A)).tauxUsdCdf).toBe(2800);
  });

  it("écriture : gérant de CET établissement accepté", async () => {
    const r = await appelantGer.taux.modifier({ terrasseId: ETAB_A, tauxUsdCdf: 2900 });
    expect(r.change).toBe(true);
    expect((await terrasse(ETAB_A)).tauxUsdCdf).toBe(2900);
  });

  it("écriture : propriétaire accepté", async () => {
    await appelantProp.taux.modifier({ terrasseId: ETAB_A, tauxUsdCdf: 2910 });
    expect((await terrasse(ETAB_A)).tauxUsdCdf).toBe(2910);
  });

  it("un gérant NE PEUT PAS modifier le taux d'un AUTRE établissement", async () => {
    // GERB est gérant d'ETAB_B, pas d'ETAB_A : refus net + valeur inchangée
    await expect(appelantGerB.taux.modifier({ terrasseId: ETAB_A, tauxUsdCdf: 100 })).rejects.toThrow();
    expect((await terrasse(ETAB_A)).tauxUsdCdf).toBe(2910);
    // Son propre établissement : accepté
    await appelantGerB.taux.modifier({ terrasseId: ETAB_B, tauxUsdCdf: 2710 });
    expect((await terrasse(ETAB_B)).tauxUsdCdf).toBe(2710);
  });
});

describe("Taux de change — bornes de saisie", () => {
  it("zéro, négatif, non entier, au-delà du plafond : refusés", async () => {
    await expect(appelantGer.taux.modifier({ terrasseId: ETAB_A, tauxUsdCdf: 0 })).rejects.toThrow();
    await expect(appelantGer.taux.modifier({ terrasseId: ETAB_A, tauxUsdCdf: -100 })).rejects.toThrow();
    await expect(appelantGer.taux.modifier({ terrasseId: ETAB_A, tauxUsdCdf: 2850.5 })).rejects.toThrow();
    await expect(appelantGer.taux.modifier({ terrasseId: ETAB_A, tauxUsdCdf: 15000 })).rejects.toThrow();
    expect((await terrasse(ETAB_A)).tauxUsdCdf).toBe(2910);
  });

  it("valeur identique : aucune écriture, aucun audit supplémentaire", async () => {
    const avant = await getDb().select({ id: s.auditLog.id }).from(s.auditLog)
      .where(and(eq(s.auditLog.terrasseId, ETAB_A), eq(s.auditLog.action, "TAUX_MODIFIE")));
    const r = await appelantGer.taux.modifier({ terrasseId: ETAB_A, tauxUsdCdf: 2910 });
    expect(r.change).toBe(false);
    const apres = await getDb().select({ id: s.auditLog.id }).from(s.auditLog)
      .where(and(eq(s.auditLog.terrasseId, ETAB_A), eq(s.auditLog.action, "TAUX_MODIFIE")));
    expect(apres.length).toBe(avant.length);
  });
});

describe("Taux de change — figé sur chaque ligne de vente", () => {
  it("commande, token et nuitée figent le taux du moment ; les lignes passées ne bougent JAMAIS", async () => {
    // Taux 2915 sur ETAB_A
    await appelantGer.taux.modifier({ terrasseId: ETAB_A, tauxUsdCdf: 2915 });

    // 1. Commande (table ZONE)
    const cmd1 = await commander(QR_A, PRD_A, "cle_test_taux_00000001");
    let [c1] = await getDb().select().from(s.commandes).where(eq(s.commandes.id, cmd1.id)).limit(1);
    expect(c1.tauxUsdCdf).toBe(2915);

    // 2. Token billard (ajout comptoir par le gérant)
    const tok = await appelantGer.billard.ajouterJoueurComptoir({ tableId: TABLE_BILL, prenom: "Joueur TestTaux", dejaPaye: true });
    const [t1] = await getDb().select().from(s.tokensBillard).where(eq(s.tokensBillard.id, tok.id)).limit(1);
    expect(t1.tauxUsdCdf).toBe(2915);

    // 3. Nuitée (check-in réception, hôtel à 2800)
    const sej = await appelantGer.hotel.checkIn({ chambreId: CHAMBRE, clientNom: "Client TestTaux", pieceIdentite: "", mode: "NUIT" });
    const [sj] = await getDb().select().from(s.sejours).where(eq(s.sejours.id, sej.sejourId)).limit(1);
    expect(sj.tauxUsdCdf).toBe(2800);

    // Le taux change : les NOUVELLES ventes figent le nouveau taux,
    // les ANCIENNES gardent le leur (historique intact).
    await appelantGer.taux.modifier({ terrasseId: ETAB_A, tauxUsdCdf: 2950 });
    const cmd2 = await commander(QR_A, PRD_A, "cle_test_taux_00000002");
    const [c2] = await getDb().select().from(s.commandes).where(eq(s.commandes.id, cmd2.id)).limit(1);
    expect(c2.tauxUsdCdf).toBe(2950);
    [c1] = await getDb().select().from(s.commandes).where(eq(s.commandes.id, cmd1.id)).limit(1);
    expect(c1.tauxUsdCdf).toBe(2915); // inchangée
  });
});

describe("Taux de change — historique non modifiable (audit_log)", () => {
  it("chaque modification est journalisée avec avant/après", async () => {
    const lignes = await getDb().select().from(s.auditLog)
      .where(and(eq(s.auditLog.terrasseId, ETAB_A), eq(s.auditLog.action, "TAUX_MODIFIE")));
    expect(lignes.length).toBeGreaterThanOrEqual(4); // 2900, 2910, 2915, 2950
    const premiere = lignes.find((l) => l.apres === "2900");
    expect(premiere).toBeDefined();
    expect(premiere!.avant).toBe("2800");
    expect(premiere!.acteurId).toBe(GER);
  });
});

describe("Taux de change — alertes propriétaire", () => {
  it("variation > seuil (5 %) : alerte TAUX_VARIATION", async () => {
    await appelantGer.taux.modifier({ terrasseId: ETAB_A, tauxUsdCdf: 3300 }); // +11,9 %
    const alertes = await getDb().select().from(s.alertes)
      .where(and(eq(s.alertes.terrasseId, ETAB_A), eq(s.alertes.type, "TAUX_VARIATION")));
    expect(alertes.length).toBeGreaterThanOrEqual(1);
  });

  it("plus de 3 changements le même jour : alerte TAUX_FREQUENCE", async () => {
    // 4 changements DANS ce test (petites variations) : si minuit
    // Lubumbashi passe entre ce test et le changement de ETAB_B plus
    // haut dans le fichier, le compteur du jour repart à zéro — les 4
    // changements doivent donc être faits ici pour rester déterministe.
    await appelantGerB.taux.modifier({ terrasseId: ETAB_B, tauxUsdCdf: 2712 });
    await appelantGerB.taux.modifier({ terrasseId: ETAB_B, tauxUsdCdf: 2714 });
    await appelantGerB.taux.modifier({ terrasseId: ETAB_B, tauxUsdCdf: 2716 });
    await appelantGerB.taux.modifier({ terrasseId: ETAB_B, tauxUsdCdf: 2718 });
    const alertes = await getDb().select().from(s.alertes)
      .where(and(eq(s.alertes.terrasseId, ETAB_B), eq(s.alertes.type, "TAUX_FREQUENCE")));
    expect(alertes.length).toBeGreaterThanOrEqual(1); // déclenchée au 4e changement
  });
});

describe("Taux de change — établissement SANS taux (mono-devise)", () => {
  it("taux null : lecture null, ventes figées null, aucune conversion", async () => {
    const vue = await appelantProp.taux.voir({ terrasseId: ETAB_SANS });
    expect(vue.tauxUsdCdf).toBeNull();
    const cmd = await commander(QR_SANS, PRD_SANS, "cle_test_taux_00000003");
    const [c] = await getDb().select().from(s.commandes).where(eq(s.commandes.id, cmd.id)).limit(1);
    expect(c.tauxUsdCdf).toBeNull();
  });

  it("première fixation : PAS d'alerte variation ; retour à null autorisé et journalisé", async () => {
    await appelantProp.taux.modifier({ terrasseId: ETAB_SANS, tauxUsdCdf: 2850 });
    expect((await terrasse(ETAB_SANS)).tauxUsdCdf).toBe(2850);
    const alertesVar = await getDb().select().from(s.alertes)
      .where(and(eq(s.alertes.terrasseId, ETAB_SANS), eq(s.alertes.type, "TAUX_VARIATION")));
    expect(alertesVar).toHaveLength(0); // pas d'ancien taux → pas de variation
    await appelantProp.taux.modifier({ terrasseId: ETAB_SANS, tauxUsdCdf: null });
    expect((await terrasse(ETAB_SANS)).tauxUsdCdf).toBeNull();
    const audit = await getDb().select().from(s.auditLog)
      .where(and(eq(s.auditLog.terrasseId, ETAB_SANS), eq(s.auditLog.action, "TAUX_MODIFIE")));
    expect(audit.length).toBeGreaterThanOrEqual(2);
  });
});
