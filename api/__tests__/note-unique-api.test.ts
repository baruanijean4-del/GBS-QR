// ============================================================
// GBS — Note client unique (ANNEXE-2) côté API : reconnaissance du
// client sur tous les QR, note unique multi-espaces, encaissement
// transactionnel (pas de double encaissement), suivi du cash
// EN_MAIN → remise validée, pourboires hors CA, litige, fusion,
// plafond anti-fraude et token de billard « sur note ».
// Fixtures préfixées test_not.
// ============================================================

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq, like, sql } from "drizzle-orm";
import { appRouter } from "../router";
import { getDb } from "../queries/connection";
import * as s from "../../db/schema";
import { maintenant } from "../gbsUtils";

const PROP = "usr_test_not_prop";
const GER = "usr_test_not_ger";
const SERV = "usr_test_not_serv";
const REC = "usr_test_not_rec";
const CUIS = "usr_test_not_cuis";
const ORG = "org_test_not";
const ETAB = "etab_test_not";
const ETAB_HOTEL = "etab_test_not_h";
const TABLE = "tbl_test_not_1";
const QR = "qrtoken_test_not_1";
const QR_BILLARD = "qrtoken_test_not_b";
const TEL = "+2439910007";

const gerant = appRouter.createCaller({ session: { utilisateurId: GER } } as never);
const serveuse = appRouter.createCaller({ session: { utilisateurId: SERV } } as never);
const reception = appRouter.createCaller({ session: { utilisateurId: REC } } as never);
const cuisine = appRouter.createCaller({ session: { utilisateurId: CUIS } } as never);
const anonyme = appRouter.createCaller({} as never);

async function sessionClient(prenom: string) {
  return anonyme.gbs.ouvrirSessionClient({ token: QR, prenom });
}

async function commander(clientSessionId: string, cle: string) {
  return anonyme.gbs.passerCommande({
    token: QR, clientSessionId,
    lignes: [{ produitId: "prd_test_not_1", quantite: 2 }],
    cleIdempotence: cle,
  });
}

beforeAll(async () => {
  const db = getDb();
  const now = maintenant();
  await db.insert(s.utilisateurs).values([
    { id: PROP, nom: "Proprio TestNot", telephone: `${TEL}1`, pin: "0001", creeLe: now },
    { id: GER, nom: "Gérant TestNot", telephone: `${TEL}2`, pin: "0002", creeLe: now },
    { id: SERV, nom: "Serveuse TestNot", telephone: `${TEL}3`, pin: "0003", creeLe: now },
    { id: REC, nom: "Réception TestNot", telephone: `${TEL}4`, pin: "0004", creeLe: now },
    { id: CUIS, nom: "Cuisine TestNot", telephone: `${TEL}5`, pin: "0005", creeLe: now },
  ]).onConflictDoNothing();
  await db.insert(s.organisations).values({ id: ORG, nom: "Org TestNot", proprietaireId: PROP, creeLe: now }).onConflictDoNothing();
  await db.insert(s.terrasses).values([
    {
      id: ETAB, organisationId: ORG, nom: "Terrasse TestNot", adresse: "Av. Test",
      typeEtablissement: "TERRASSE", typesSecondaires: [],
      seuilEcartCdf: 5000, seuilEcartUsd: 200, tauxUsdCdf: 2740, creeLe: now,
    },
    {
      id: ETAB_HOTEL, organisationId: ORG, nom: "Hôtel TestNot", adresse: "Av. Test",
      typeEtablissement: "GUEST_HOUSE", typesSecondaires: [],
      seuilEcartCdf: 5000, seuilEcartUsd: 200, tauxUsdCdf: 2740, creeLe: now,
    },
  ]).onConflictDoNothing();
  await db.insert(s.affectations).values([
    { id: "aff_test_not_1", utilisateurId: GER, terrasseId: ETAB, role: "GERANT", actif: true, creeLe: now },
    { id: "aff_test_not_2", utilisateurId: SERV, terrasseId: ETAB, role: "SERVEUSE", actif: true, creeLe: now },
    { id: "aff_test_not_3", utilisateurId: REC, terrasseId: ETAB_HOTEL, role: "RECEPTIONNISTE", actif: true, creeLe: now },
    { id: "aff_test_not_4", utilisateurId: CUIS, terrasseId: ETAB, role: "CUISINE_BAR", actif: true, creeLe: now },
  ]).onConflictDoNothing();
  await db.insert(s.tablesQr).values([
    { id: TABLE, terrasseId: ETAB, numero: 1, tokenQr: QR, kind: "ZONE", actif: true, creeLe: now },
    { id: "tbl_test_not_b", terrasseId: ETAB, numero: 9, tokenQr: QR_BILLARD, kind: "BILLARD", actif: true, creeLe: now },
  ]).onConflictDoNothing();
  await db.insert(s.produits).values({
    id: "prd_test_not_1", terrasseId: ETAB, nom: "Primus TestNot", categorie: "Bières",
    prixCdf: 2500, prixUsd: 100, stock: 500, stockReserve: 0, seuilAlerte: 0, actif: true,
  }).onConflictDoNothing();
  await db.insert(s.chambres).values({
    id: "chb_test_not_1", terrasseId: ETAB_HOTEL, numero: "101", type: "SIMPLE",
    statut: "LIBRE", prixNuitCdf: 40000, prixHeureCdf: null, creeLe: now,
  }).onConflictDoNothing();
});

afterAll(async () => {
  const db = getDb();
  await db.delete(s.noteVentilations).where(like(s.noteVentilations.id, "vnt%"));
  await db.delete(s.encaissements).where(eq(s.encaissements.organisationId, ORG));
  await db.delete(s.pourboires).where(like(s.pourboires.id, "ptb%"));
  await db.delete(s.remisesCaisse).where(eq(s.remisesCaisse.organisationId, ORG));
  await db.delete(s.noteLignes).where(eq(s.noteLignes.terrasseId, ETAB));
  await db.delete(s.noteLignes).where(eq(s.noteLignes.terrasseId, ETAB_HOTEL));
  await db.delete(s.notes).where(eq(s.notes.organisationId, ORG));
  await db.delete(s.clientAppareils);
  await db.delete(s.clients).where(eq(s.clients.organisationId, ORG));
  await db.delete(s.commandes).where(eq(s.commandes.terrasseId, ETAB));
  await db.delete(s.tokensBillard).where(eq(s.tokensBillard.terrasseId, ETAB));
  await db.delete(s.sejours).where(eq(s.sejours.terrasseId, ETAB_HOTEL));
  await db.delete(s.chambres).where(eq(s.chambres.terrasseId, ETAB_HOTEL));
  await db.delete(s.mouvementsStock).where(eq(s.mouvementsStock.terrasseId, ETAB));
  await db.delete(s.alertes).where(eq(s.alertes.terrasseId, ETAB));
  await db.delete(s.alertes).where(eq(s.alertes.terrasseId, ETAB_HOTEL));
  await db.delete(s.clientsSession).where(eq(s.clientsSession.tableId, TABLE));
  await db.delete(s.clientsSession).where(eq(s.clientsSession.tableId, "tbl_test_not_b"));
  await db.delete(s.auditLog).where(eq(s.auditLog.terrasseId, ETAB));
  await db.delete(s.auditLog).where(like(s.auditLog.action, "%NOTE%"));
  await db.delete(s.auditLog).where(like(s.auditLog.action, "%REMISE%"));
  await db.delete(s.affectations).where(eq(s.affectations.terrasseId, ETAB));
  await db.delete(s.affectations).where(eq(s.affectations.terrasseId, ETAB_HOTEL));
  await db.delete(s.tablesQr).where(eq(s.tablesQr.terrasseId, ETAB));
  await db.delete(s.produits).where(eq(s.produits.terrasseId, ETAB));
  await db.delete(s.terrasses).where(eq(s.terrasses.id, ETAB));
  await db.delete(s.terrasses).where(eq(s.terrasses.id, ETAB_HOTEL));
  await db.delete(s.organisations).where(eq(s.organisations.id, ORG));
  await db.delete(s.utilisateurs).where(like(s.utilisateurs.nom, "%TestNot%"));
});

describe("Note unique — identité et cycle de la commande", () => {
  it("un second scan reconnaît le client sans redemander le prénom", async () => {
    const s1 = await sessionClient("Aline");
    const s2 = await anonyme.gbs.ouvrirSessionClient({ token: QR, prenom: "", clientSessionId: s1.id });
    expect(s2.id).toBe(s1.id);
  });

  it("la commande s'ajoute à la note unique, statuts synchronisés", async () => {
    const sess = await sessionClient("Bénie");
    const cmd = await commander(sess.id, "cle_test_not_1");
    const maNote = await anonyme.notes.voirMaNote({ clientSessionId: sess.id });
    expect(maNote.note).not.toBeNull();
    expect(maNote.note?.lignes).toHaveLength(1);
    expect(maNote.note?.lignes[0]).toMatchObject({
      espace: "TERRASSE", type: "COMMANDE", quantite: 2, montantCdf: 5000, statut: "EN_ATTENTE",
    });
    expect(maNote.note?.totalCdf).toBe(5000);

    await serveuse.gbs.confirmerCommande({ commandeId: cmd.id });
    let vue = await anonyme.notes.voirMaNote({ clientSessionId: sess.id });
    expect(vue.note?.lignes[0]?.statut).toBe("CONFIRMEE");

    await serveuse.gbs.marquerServie({ commandeId: cmd.id });
    vue = await anonyme.notes.voirMaNote({ clientSessionId: sess.id });
    expect(vue.note?.lignes[0]?.statut).toBe("SERVIE");

    // Idempotence : le même appel ne duplique pas la ligne
    await commander(sess.id, "cle_test_not_1");
    vue = await anonyme.notes.voirMaNote({ clientSessionId: sess.id });
    expect(vue.note?.lignes).toHaveLength(1);
  });

  it("l'annulation client barre la ligne (transparence §4)", async () => {
    const sess = await sessionClient("Cédric");
    const cmd = await commander(sess.id, "cle_test_not_2");
    await anonyme.gbs.annulerMaCommande({ commandeId: cmd.id, clientSessionId: sess.id });
    const vue = await anonyme.notes.voirMaNote({ clientSessionId: sess.id });
    expect(vue.note?.lignes[0]?.statut).toBe("ANNULEE");
    expect(vue.note?.totalCdf).toBe(0);
  });
});

describe("Note unique — paiement et suivi de l'argent physique", () => {
  it("demander l'addition passe la note A_REGLER et alerte l'espace", async () => {
    const sess = await sessionClient("Divine");
    await commander(sess.id, "cle_test_not_3");
    await anonyme.notes.demanderAddition({ clientSessionId: sess.id });
    const vue = await anonyme.notes.voirMaNote({ clientSessionId: sess.id });
    expect(vue.note?.statut).toBe("A_REGLER");
    const alertes = await getDb().select().from(s.alertes)
      .where(and(eq(s.alertes.terrasseId, ETAB), eq(s.alertes.type, "ADDITION_DEMANDEE")));
    expect(alertes.length).toBeGreaterThan(0);
  });

  it("acompte puis solde : REGLEE seulement à solde zéro (§5.5)", async () => {
    const sess = await sessionClient("Émeraude");
    await commander(sess.id, "cle_test_not_4"); // 2 × 2500 = 5000 FC
    const vue = await anonyme.notes.voirMaNote({ clientSessionId: sess.id });
    const noteId = vue.note?.id ?? "";

    // Acompte de 2000 FC — la note reste ouverte
    const r1 = await serveuse.notes.encaisserNote({
      noteId, montantCdf: 2000, montantUsd: 0, mode: "CASH", pourboireCdf: 0, pourboireUsd: 0,
    });
    expect(r1.reglee).toBe(false);
    expect(r1.resteCdf).toBe(3000);

    // Double encaissement impossible au-delà du reste (§5.9)
    await expect(serveuse.notes.encaisserNote({
      noteId, montantCdf: 3001, montantUsd: 0, mode: "CASH", pourboireCdf: 0, pourboireUsd: 0,
    })).rejects.toThrow(/reste dû/);

    // Solde + pourboire À PART (§5.4)
    const r2 = await serveuse.notes.encaisserNote({
      noteId, montantCdf: 3000, montantUsd: 0, mode: "CASH", pourboireCdf: 500, pourboireUsd: 0,
    });
    expect(r2.reglee).toBe(true);

    // La commande liée est marquée payée
    const [cmd] = await getDb().select().from(s.commandes)
      .where(eq(s.commandes.cleIdempotence, "cle_test_not_4")).limit(1);
    expect(cmd?.payeeLe).not.toBeNull();

    // Pourboire enregistré hors CA (hors ventilation)
    const tips = await getDb().select().from(s.pourboires).where(eq(s.pourboires.noteId, noteId));
    expect(tips).toHaveLength(1);
    expect(tips[0]?.montantCdf).toBe(500);
    const ventils = await getDb().select().from(s.noteVentilations)
      .where(eq(s.noteVentilations.terrasseId, ETAB));
    expect(ventils.reduce((x, v) => x + v.montantCdf, 0)).toBe(5000); // pourboire exclu

    // Historique côté client (§4)
    const apres = await anonyme.notes.voirMaNote({ clientSessionId: sess.id });
    expect(apres.note).toBeNull();
    expect(apres.historique).toHaveLength(1);
    expect(apres.historique[0]?.statut).toBe("REGLEE");
  });

  it("le mobile money exige une référence UNIQUE (§5.7)", async () => {
    const sess = await sessionClient("Fifi");
    await commander(sess.id, "cle_test_not_5");
    const noteId = (await anonyme.notes.voirMaNote({ clientSessionId: sess.id })).note?.id ?? "";
    await serveuse.notes.encaisserNote({
      noteId, montantCdf: 5000, montantUsd: 0, mode: "MOBILE_MONEY",
      referenceMobile: "AMTESTNOT001", pourboireCdf: 0, pourboireUsd: 0,
    });
    const sess2 = await sessionClient("Gaby");
    await commander(sess2.id, "cle_test_not_6");
    const note2 = (await anonyme.notes.voirMaNote({ clientSessionId: sess2.id })).note?.id ?? "";
    await expect(serveuse.notes.encaisserNote({
      noteId: note2, montantCdf: 5000, montantUsd: 0, mode: "MOBILE_MONEY",
      referenceMobile: "AMTESTNOT001", pourboireCdf: 0, pourboireUsd: 0,
    })).rejects.toThrow(/déjà été enregistrée/);
    // Le mobile money n'est pas du cash physique : rien EN_MAIN pour cette part
    const caisse = await serveuse.notes.maCaisse();
    expect(caisse.enMainCdf).toBe(5000); // uniquement les cash de Émeraude
  });

  it("remise de caisse : attendu vs reçu, écart = alerte immédiate (§5.6)", async () => {
    const caisse = await serveuse.notes.maCaisse();
    expect(caisse.enMainCdf).toBe(5000);
    expect(caisse.pourboiresCdf).toBe(500);
    const remise = await serveuse.notes.remettreCaisse({ terrasseId: ETAB });
    expect(remise.attenduCdf).toBe(5000);

    // Une seconde remise est refusée tant que la première attend validation
    await expect(serveuse.notes.remettreCaisse({ terrasseId: ETAB })).rejects.toThrow(/en attente/);
    await expect(gerant.notes.validerRemise({
      remiseId: remise.id, recuCdf: 4800, recuUsd: 0, motif: "",
    })).rejects.toThrow(/motif/);
    const r = await gerant.notes.validerRemise({
      remiseId: remise.id, recuCdf: 4800, recuUsd: 0, motif: "200 FC manquants",
    });
    expect(r.ecart).toBe(true);
    const alertes = await getDb().select().from(s.alertes)
      .where(and(eq(s.alertes.terrasseId, ETAB), eq(s.alertes.type, "ECART_REMISE")));
    expect(alertes.length).toBeGreaterThan(0);
    // Plus rien EN_MAIN : tout est passé ECART
    const apres = await serveuse.notes.maCaisse();
    expect(apres.enMainCdf).toBe(0);
  });

  it("rôles : la cuisine ne peut pas encaisser (§5.1)", async () => {
    const sess = await sessionClient("Henri");
    await commander(sess.id, "cle_test_not_7");
    const noteId = (await anonyme.notes.voirMaNote({ clientSessionId: sess.id })).note?.id ?? "";
    await expect(cuisine.notes.encaisserNote({
      noteId, montantCdf: 5000, montantUsd: 0, mode: "CASH", pourboireCdf: 0, pourboireUsd: 0,
    })).rejects.toThrow(/rôle requis/);
  });

  it("litige : la note n'est jamais supprimée, motif tracé (§5.3)", async () => {
    const sess = await sessionClient("Henri-Litige");
    await commander(sess.id, "cle_test_not_litige");
    const noteId = (await anonyme.notes.voirMaNote({ clientSessionId: sess.id })).note?.id ?? "";
    expect(noteId).not.toBe("");
    await gerant.notes.declarerLitige({ noteId, motif: "Parti sans payer" });
    const [note] = await getDb().select().from(s.notes).where(eq(s.notes.id, noteId)).limit(1);
    expect(note?.statut).toBe("LITIGE");
    expect(note?.motifLitige).toBe("Parti sans payer");
  });

  it("fusion : lignes ET encaissements déplacés, source FUSIONNEE (§101)", async () => {
    const s1 = await sessionClient("Irène");
    await commander(s1.id, "cle_test_not_8");
    const n1 = (await anonyme.notes.voirMaNote({ clientSessionId: s1.id })).note?.id ?? "";
    const s2 = await sessionClient("Irène"); // deuxième appareil = autre client
    await commander(s2.id, "cle_test_not_9");
    const n2 = (await anonyme.notes.voirMaNote({ clientSessionId: s2.id })).note?.id ?? "";
    expect(n1).not.toBe(n2);
    await serveuse.notes.fusionnerNotes({ noteSourceId: n2, noteCibleId: n1 });
    const [source] = await getDb().select().from(s.notes).where(eq(s.notes.id, n2)).limit(1);
    expect(source?.statut).toBe("FUSIONNEE");
    const vue = await anonyme.notes.voirMaNote({ clientSessionId: s1.id });
    expect(vue.note?.totalCdf).toBe(10000);
  });
});

describe("Note unique — plafond anti-fraude et billard « sur note »", () => {
  it("plafond : au-delà, la commande exige un règlement (§6)", async () => {
    await gerant.notes.configurerNote({ terrasseId: ETAB, notePlafondCdf: 6000, tokenSurNote: true });
    const sess = await sessionClient("José");
    await commander(sess.id, "cle_test_not_10"); // 5000 ≤ 6000 OK
    await commander(sess.id, "cle_test_not_11"); // reste 5000 ≤ 6000 : encore OK
    await expect(commander(sess.id, "cle_test_not_12")).rejects.toThrow(/plafond/);
    await gerant.notes.configurerNote({ terrasseId: ETAB, notePlafondCdf: null, tokenSurNote: true });
  });

  it("token sur note : en file sans paiement préalable, réglé à la note", async () => {
    const sess = await sessionClient("Ketia");
    const tok = await anonyme.notes.acheterTokenSurNote({ token: QR_BILLARD, clientSessionId: sess.id });
    const [t] = await getDb().select().from(s.tokensBillard).where(eq(s.tokensBillard.id, tok.id)).limit(1);
    expect(t?.statut).toBe("EN_FILE");
    expect(t?.payeLe).toBeNull(); // pas encore payé — il est SUR LA NOTE
    expect(t?.surNote).toBe(true);

    const vue = await anonyme.notes.voirMaNote({ clientSessionId: sess.id });
    expect(vue.note?.lignes.some((l) => l.type === "TOKEN_BILLARD" && l.montantCdf === 5000)).toBe(true);

    // Règlement de la note → le token est soldé automatiquement
    await serveuse.notes.encaisserNote({
      noteId: vue.note?.id ?? "", montantCdf: 5000, montantUsd: 0, mode: "CASH",
      pourboireCdf: 0, pourboireUsd: 0,
    });
    const [t2] = await getDb().select().from(s.tokensBillard).where(eq(s.tokensBillard.id, tok.id)).limit(1);
    expect(t2?.payeLe).not.toBeNull();
  });

  it("token sur note refusé quand le gérant ne l'a pas activé", async () => {
    await gerant.notes.configurerNote({ terrasseId: ETAB, notePlafondCdf: null, tokenSurNote: false });
    const sess = await sessionClient("Léa");
    await expect(anonyme.notes.acheterTokenSurNote({ token: QR_BILLARD, clientSessionId: sess.id }))
      .rejects.toThrow(/pas activé/);
    await gerant.notes.configurerNote({ terrasseId: ETAB, notePlafondCdf: null, tokenSurNote: false });
  });
});

describe("Note unique — chambre d'hôtel (folio)", () => {
  it("check-in ouvre la note du séjour ; check-out fixe le montant", async () => {
    const r = await reception.hotel.checkIn({ chambreId: "chb_test_not_1", clientNom: "M. Ilunga", mode: "NUIT" });
    const [note] = await getDb().select().from(s.notes).where(eq(s.notes.sejourId, r.sejourId)).limit(1);
    expect(note).toBeDefined();
    expect(note?.statut).toBe("OUVERTE");
    const lignes = await getDb().select().from(s.noteLignes)
      .where(and(eq(s.noteLignes.type, "CHAMBRE"), eq(s.noteLignes.refId, r.sejourId)));
    expect(lignes).toHaveLength(1);
    expect(lignes[0]?.montantCdf).toBe(0); // séjour en cours

    const out = await reception.hotel.checkOut({ sejourId: r.sejourId });
    expect(out.montantTotalCdf).toBeGreaterThan(0);
    const [ligne] = await getDb().select().from(s.noteLignes)
      .where(and(eq(s.noteLignes.type, "CHAMBRE"), eq(s.noteLignes.refId, r.sejourId))).limit(1);
    expect(ligne?.montantCdf).toBe(out.montantTotalCdf);
  });

  it("une note de chambre n'est encaissée que par la réception/gérance (§5.1)", async () => {
    const [note] = await getDb().select().from(s.notes)
      .where(and(eq(s.notes.organisationId, ORG), eq(s.notes.statut, "OUVERTE"),
        sql`${s.notes.sejourId} IS NOT NULL`)).limit(1);
    expect(note?.sejourId).not.toBeNull();
    await expect(serveuse.notes.encaisserNote({
      noteId: note?.id ?? "", montantCdf: 1, montantUsd: 0, mode: "CASH", pourboireCdf: 0, pourboireUsd: 0,
    })).rejects.toThrow(/rôle requis/);
    // La serveuse ne voit même pas la note de chambre dans sa liste
    const listeServeuse = await serveuse.notes.notesOuvertes({ terrasseId: ETAB });
    expect(listeServeuse.some((n) => n.id === note?.id)).toBe(false);
    const listeReception = await reception.notes.notesOuvertes({ terrasseId: ETAB_HOTEL });
    expect(listeReception.some((n) => n.id === note?.id)).toBe(true);
  });
});
