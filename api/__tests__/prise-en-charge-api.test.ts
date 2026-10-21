// ============================================================
// GBS — « Payer pour quelqu'un » (ANNEXE-3) côté API : voie
// serveuse par défaut (décision de la bénéficiaire, de vive voix),
// lignes figées à l'acceptation, expiration 10 min avec remontée
// au gérant, anti-abus (fréquence et paire récurrente), aucune
// identité du payeur exposée. Fixtures préfixées test_pec.
// ============================================================

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq, like } from "drizzle-orm";
import { appRouter } from "../router";
import { getDb } from "../queries/connection";
import * as s from "../../db/schema";
import { maintenant } from "../gbsUtils";

const PROP = "usr_test_pec_prop";
const GER = "usr_test_pec_ger";
const SERV = "usr_test_pec_serv";
const ORG = "org_test_pec";
const ETAB = "etab_test_pec";
const TABLE_A = "tbl_test_pec_a"; // bénéficiaire
const TABLE_B = "tbl_test_pec_b"; // payeur
const QR_A = "qrtoken_test_pec_a";
const QR_B = "qrtoken_test_pec_b";
const TEL = "+2439920007";

const gerant = appRouter.createCaller({ session: { utilisateurId: GER } } as never);
const serveuse = appRouter.createCaller({ session: { utilisateurId: SERV } } as never);
const anonyme = appRouter.createCaller({} as never);

async function clientAvecNote(prenom: string, qr: string, cle: string) {
  const sess = await anonyme.gbs.ouvrirSessionClient({ token: qr, prenom });
  await anonyme.gbs.passerCommande({
    token: qr, clientSessionId: sess.id,
    lignes: [{ produitId: "prd_test_pec_1", quantite: 2 }],
    cleIdempotence: cle,
  });
  const vue = await anonyme.notes.voirMaNote({ clientSessionId: sess.id });
  return { sess, noteId: vue.note?.id ?? "" };
}

beforeAll(async () => {
  const db = getDb();
  const now = maintenant();
  await db.insert(s.utilisateurs).values([
    { id: PROP, nom: "Proprio TestPec", telephone: `${TEL}1`, pin: "0001", creeLe: now },
    { id: GER, nom: "Gérant TestPec", telephone: `${TEL}2`, pin: "0002", creeLe: now },
    { id: SERV, nom: "Serveuse TestPec", telephone: `${TEL}3`, pin: "0003", creeLe: now },
  ]).onConflictDoNothing();
  await db.insert(s.organisations).values({ id: ORG, nom: "Org TestPec", proprietaireId: PROP, creeLe: now }).onConflictDoNothing();
  await db.insert(s.terrasses).values({
    id: ETAB, organisationId: ORG, nom: "Terrasse TestPec", adresse: "Av. Test",
    typeEtablissement: "TERRASSE", typesSecondaires: [],
    seuilEcartCdf: 5000, seuilEcartUsd: 200, tauxUsdCdf: null, creeLe: now,
  }).onConflictDoNothing();
  await db.insert(s.affectations).values([
    { id: "aff_test_pec_1", utilisateurId: GER, terrasseId: ETAB, role: "GERANT", actif: true, creeLe: now },
    { id: "aff_test_pec_2", utilisateurId: SERV, terrasseId: ETAB, role: "SERVEUSE", actif: true, creeLe: now },
  ]).onConflictDoNothing();
  await db.insert(s.tablesQr).values([
    { id: TABLE_A, terrasseId: ETAB, numero: 1, tokenQr: QR_A, kind: "ZONE", actif: true, creeLe: now },
    { id: TABLE_B, terrasseId: ETAB, numero: 2, tokenQr: QR_B, kind: "ZONE", actif: true, creeLe: now },
  ]).onConflictDoNothing();
  await db.insert(s.produits).values({
    id: "prd_test_pec_1", terrasseId: ETAB, nom: "Skol TestPec", categorie: "Bières",
    prixCdf: 2000, prixUsd: 0, stock: 500, stockReserve: 0, seuilAlerte: 0, actif: true,
  }).onConflictDoNothing();
});

afterAll(async () => {
  const db = getDb();
  await db.delete(s.prisesEnCharge).where(eq(s.prisesEnCharge.organisationId, ORG));
  await db.delete(s.noteVentilations).where(eq(s.noteVentilations.terrasseId, ETAB));
  await db.delete(s.encaissements).where(eq(s.encaissements.organisationId, ORG));
  await db.delete(s.noteLignes).where(eq(s.noteLignes.terrasseId, ETAB));
  await db.delete(s.notes).where(eq(s.notes.organisationId, ORG));
  await db.delete(s.clientAppareils);
  await db.delete(s.clients).where(eq(s.clients.organisationId, ORG));
  await db.delete(s.commandes).where(eq(s.commandes.terrasseId, ETAB));
  await db.delete(s.mouvementsStock).where(eq(s.mouvementsStock.terrasseId, ETAB));
  await db.delete(s.alertes).where(eq(s.alertes.terrasseId, ETAB));
  await db.delete(s.clientsSession).where(eq(s.clientsSession.tableId, TABLE_A));
  await db.delete(s.clientsSession).where(eq(s.clientsSession.tableId, TABLE_B));
  await db.delete(s.auditLog).where(eq(s.auditLog.terrasseId, ETAB));
  await db.delete(s.affectations).where(eq(s.affectations.terrasseId, ETAB));
  await db.delete(s.tablesQr).where(eq(s.tablesQr.terrasseId, ETAB));
  await db.delete(s.produits).where(eq(s.produits.terrasseId, ETAB));
  await db.delete(s.terrasses).where(eq(s.terrasses.id, ETAB));
  await db.delete(s.organisations).where(eq(s.organisations.id, ORG));
  await db.delete(s.utilisateurs).where(like(s.utilisateurs.nom, "%TestPec%"));
});

describe("Payer pour quelqu'un — voie serveuse", () => {
  it("le payeur propose depuis son téléphone ; la serveuse voit la demande SANS identité du payeur", async () => {
    const benef = await clientAvecNote("Maman Sifa", QR_A, "cle_test_pec_1");
    const payeur = await anonyme.gbs.ouvrirSessionClient({ token: QR_B, prenom: "Monsieur Paul" });
    await anonyme.notes.proposerPriseEnCharge({
      clientSessionId: payeur.id, numeroTableBeneficiaire: "1",
    });
    const liste = await serveuse.notes.prisesEnChargeEnCours({ terrasseId: ETAB });
    expect(liste).toHaveLength(1);
    expect(liste[0]).toMatchObject({ statut: "EN_ATTENTE", prenomBeneficiaire: "Maman Sifa", nbLignes: 1 });
    // Aucune identité du payeur exposée (§1.2)
    expect(liste[0]).not.toHaveProperty("payeurClientId");
    expect(liste[0]).not.toHaveProperty("payeur");
    expect(benef.noteId).not.toBe("");
  });

  it("on ne paie pas pour sa propre table ni une table inexistante", async () => {
    const payeur = await anonyme.gbs.ouvrirSessionClient({ token: QR_B, prenom: "Monsieur Paul" });
    // Sa propre table (2)
    await expect(anonyme.notes.proposerPriseEnCharge({
      clientSessionId: payeur.id, numeroTableBeneficiaire: "2",
    })).rejects.toThrow(/propre table/);
    // Table inexistante
    await expect(anonyme.notes.proposerPriseEnCharge({
      clientSessionId: payeur.id, numeroTableBeneficiaire: "77",
    })).rejects.toThrow(/Aucune table/);
  });

  it("à l'acceptation, les lignes sont FIGÉES et DÉPLACÉES sur la note du payeur", async () => {
    const liste = await serveuse.notes.prisesEnChargeEnCours({ terrasseId: ETAB });
    const pec = liste.find((p) => p.statut === "EN_ATTENTE");
    expect(pec).toBeDefined();
    await serveuse.notes.deciderPriseEnCharge({ id: pec?.id ?? "", decision: "ACCEPTEE" });

    const [pecDb] = await getDb().select().from(s.prisesEnCharge)
      .where(eq(s.prisesEnCharge.id, pec?.id ?? "")).limit(1);
    expect(pecDb?.statut).toBe("ACCEPTEE");
    expect(Array.isArray(pecDb?.lignes)).toBe(true);
    expect((pecDb?.lignes as unknown[]).length).toBe(1);
    expect(pecDb?.montantCdf).toBe(4000);

    // Lignes déplacées : elles ne sont plus sur la note bénéficiaire…
    const lignesBenef = await getDb().select().from(s.noteLignes)
      .where(eq(s.noteLignes.noteId, pec?.noteId ?? ""));
    expect(lignesBenef.filter((l) => l.statut !== "ANNULEE")).toHaveLength(0);
    // …mais portées par la note du payeur, marquées par la prise en charge
    const lignesPayeur = await getDb().select().from(s.noteLignes)
      .where(eq(s.noteLignes.priseEnChargeId, pec?.id ?? ""));
    expect(lignesPayeur).toHaveLength(1);
    expect(lignesPayeur[0]?.noteId).not.toBe(pec?.noteId);
  });

  it("la consommation ultérieure de la bénéficiaire reste à SA charge (§2)", async () => {
    const sessBenef = await anonyme.gbs.ouvrirSessionClient({ token: QR_A, prenom: "Maman Sifa" });
    await anonyme.gbs.passerCommande({
      token: QR_A, clientSessionId: sessBenef.id,
      lignes: [{ produitId: "prd_test_pec_1", quantite: 1 }],
      cleIdempotence: "cle_test_pec_2",
    });
    const vue = await anonyme.notes.voirMaNote({ clientSessionId: sessBenef.id });
    expect(vue.note?.totalCdf).toBe(2000); // seule la nouvelle consommation
  });

  it("le refus est enregistré par la serveuse (de vive voix)", async () => {
    await clientAvecNote("Maman Olive", QR_A, "cle_test_pec_3");
    const payeur = await anonyme.gbs.ouvrirSessionClient({ token: QR_B, prenom: "Monsieur Paul" });
    await anonyme.notes.proposerPriseEnCharge({ clientSessionId: payeur.id, numeroTableBeneficiaire: "1" });
    const liste = await serveuse.notes.prisesEnChargeEnCours({ terrasseId: ETAB });
    const enAttente = liste.find((p) => p.statut === "EN_ATTENTE");
    await serveuse.notes.deciderPriseEnCharge({ id: enAttente?.id ?? "", decision: "REFUSEE" });
    const [pecDb] = await getDb().select().from(s.prisesEnCharge)
      .where(eq(s.prisesEnCharge.id, enAttente?.id ?? "")).limit(1);
    expect(pecDb?.statut).toBe("REFUSEE");
    expect(pecDb?.decidePar).toBe(SERV);
  });

  it("expiration : la demande remonte au gérant, la serveuse ne peut plus trancher (§2)", async () => {
    await clientAvecNote("Maman Olive", QR_A, "cle_test_pec_4");
    const payeur = await anonyme.gbs.ouvrirSessionClient({ token: QR_B, prenom: "Monsieur Paul" });
    const { id } = await anonyme.notes.proposerPriseEnCharge({
      clientSessionId: payeur.id, numeroTableBeneficiaire: "1",
    });
    // Forcer l'expiration (horloge passée)
    await getDb().update(s.prisesEnCharge)
      .set({ expireLe: "2000-01-01T00:00:00.000Z" })
      .where(eq(s.prisesEnCharge.id, id));
    // La serveuse ne voit plus la demande expirée…
    const listeServeuse = await serveuse.notes.prisesEnChargeEnCours({ terrasseId: ETAB });
    expect(listeServeuse.find((p) => p.id === id)).toBeUndefined();
    // …mais le gérant la voit et peut trancher (§2)
    const listeGerant = await gerant.notes.prisesEnChargeEnCours({ terrasseId: ETAB });
    const expiree = listeGerant.find((p) => p.id === id);
    expect(expiree?.statut).toBe("EXPIREE");
    await expect(serveuse.notes.deciderPriseEnCharge({ id, decision: "ACCEPTEE" }))
      .rejects.toThrow(/gérant/);
    await gerant.notes.deciderPriseEnCharge({ id, decision: "ACCEPTEE" });
    const [pecDb] = await getDb().select().from(s.prisesEnCharge).where(eq(s.prisesEnCharge.id, id)).limit(1);
    expect(pecDb?.statut).toBe("ACCEPTEE");
    const alertes = await getDb().select().from(s.alertes)
      .where(and(eq(s.alertes.terrasseId, ETAB), eq(s.alertes.type, "PRISE_EN_CHARGE_EXPIREE")));
    expect(alertes.length).toBeGreaterThan(0);
  });

  it("voie comptoir : les lignes restent sur la note, marquées pour encaissement direct", async () => {
    const benef = await clientAvecNote("Maman Divine", QR_A, "cle_test_pec_5");
    const { id } = await serveuse.notes.proposerPriseEnChargeComptoir({ noteId: benef.noteId });
    await serveuse.notes.deciderPriseEnCharge({ id, decision: "ACCEPTEE" });
    const lignes = await getDb().select().from(s.noteLignes)
      .where(eq(s.noteLignes.noteId, benef.noteId));
    expect(lignes.length).toBeGreaterThan(0);
    expect(lignes.every((l) => l.priseEnChargeId === id)).toBe(true);
    // La serveuse encaisse le payeur présent (§5 : encaissement cash existant)
    const r = await serveuse.notes.encaisserNote({
      noteId: benef.noteId, montantCdf: 4000, montantUsd: 0, mode: "CASH", pourboireCdf: 0, pourboireUsd: 0,
    });
    expect(r.reglee).toBe(true);
  });

  it("anti-abus : la même paire payeur → bénéficiaire alerte le gérant (§3)", async () => {
    // 3 acceptations de la même paire sur 7 jours (seuil)
    const payeur = await anonyme.gbs.ouvrirSessionClient({ token: QR_B, prenom: "Monsieur Paul" });
    const avant = await getDb().select().from(s.alertes)
      .where(and(eq(s.alertes.terrasseId, ETAB), eq(s.alertes.type, "PRISE_EN_CHARGE_ABUS")));
    for (let i = 0; i < 3; i += 1) {
      const benef = await clientAvecNote("Maman Olive", QR_A, `cle_test_pec_abus_${i}`);
      const { id } = await anonyme.notes.proposerPriseEnCharge({
        clientSessionId: payeur.id, numeroTableBeneficiaire: "1",
      });
      await serveuse.notes.deciderPriseEnCharge({ id, decision: "ACCEPTEE" });
      void benef;
    }
    const apres = await getDb().select().from(s.alertes)
      .where(and(eq(s.alertes.terrasseId, ETAB), eq(s.alertes.type, "PRISE_EN_CHARGE_ABUS")));
    expect(apres.length).toBeGreaterThan(avant.length);
  });

  it("confort (§4) : la bénéficiaire peut accepter elle-même depuis son téléphone", async () => {
    const benef = await clientAvecNote("Maman Grâce", QR_A, "cle_test_pec_6");
    const payeur = await anonyme.gbs.ouvrirSessionClient({ token: QR_B, prenom: "Monsieur Paul" });
    const { id } = await anonyme.notes.proposerPriseEnCharge({
      clientSessionId: payeur.id, numeroTableBeneficiaire: "1",
    });
    // Un autre client ne peut pas décider à sa place
    await expect(anonyme.notes.deciderPriseEnChargeCliente({
      id, clientSessionId: payeur.id, decision: "ACCEPTEE",
    })).rejects.toThrow(/votre note/);
    await anonyme.notes.deciderPriseEnChargeCliente({
      id, clientSessionId: benef.sess.id, decision: "ACCEPTEE",
    });
    const [pecDb] = await getDb().select().from(s.prisesEnCharge).where(eq(s.prisesEnCharge.id, id)).limit(1);
    expect(pecDb?.statut).toBe("ACCEPTEE");
  });
});
