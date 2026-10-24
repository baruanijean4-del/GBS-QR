// ============================================================
// GBS — Billard Vincaire côté API (annexe §1, étape 3) : achat
// de token, validation cash (permission RBAC), file FIFO, parties
// atomiques, règle du perdant, absences, annulations, stats.
// Fixtures préfixées test_bil.
// ============================================================

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, asc, eq, like } from "drizzle-orm";
import { appRouter } from "../router";
import { getDb } from "../queries/connection";
import * as s from "../../db/schema";
import { ajouterJours, maintenant } from "../gbsUtils";

const appelantProp = appRouter.createCaller({ session: { utilisateurId: "usr_test_bil_prop" } } as never);
const appelantServeuse = appRouter.createCaller({ session: { utilisateurId: "usr_test_bil_serv" } } as never);
const appelantCuisine = appRouter.createCaller({ session: { utilisateurId: "usr_test_bil_cuis" } } as never);
const anonyme = appRouter.createCaller({} as never);

const ORG = "org_test_bil";
const PROP = "usr_test_bil_prop";
const SERV = "usr_test_bil_serv";
const CUIS = "usr_test_bil_cuis";
const ETAB = "etab_test_bil";
const TABLE = "tbl_test_bil_1";
const QR = "qrtoken_test_bil_1";
const TEL_BASE = "+2439900007";

/** Ouvre une session client sur le billard et achète un token. */
async function acheter(prenom: string) {
  const sess = await anonyme.gbs.ouvrirSessionClient({ token: QR, prenom });
  return anonyme.billard.acheterToken({ token: QR, clientSessionId: sess.id });
}

async function tokenParId(id: string) {
  const [t] = await getDb().select().from(s.tokensBillard).where(eq(s.tokensBillard.id, id)).limit(1);
  return t;
}

beforeAll(async () => {
  const db = getDb();
  const now = maintenant();
  await db.insert(s.utilisateurs).values([
    { id: PROP, nom: "Proprio TestBil", telephone: `${TEL_BASE}1`, pin: "0001", creeLe: now },
    { id: SERV, nom: "Serveuse TestBil", telephone: `${TEL_BASE}2`, pin: "0002", creeLe: now },
    { id: CUIS, nom: "Cuisine TestBil", telephone: `${TEL_BASE}3`, pin: "0003", creeLe: now },
  ]).onConflictDoNothing();
  await db.insert(s.organisations).values({ id: ORG, nom: "Org TestBil", proprietaireId: PROP, creeLe: now }).onConflictDoNothing();
  await db.insert(s.terrasses).values({
    id: ETAB, organisationId: ORG, nom: "Billard TestBil", adresse: "Av. des Tests",
    typeEtablissement: "BILLARD", typesSecondaires: [],
    seuilEcartCdf: 5000, seuilEcartUsd: 200, tauxUsdCdf: 2740, creeLe: now,
  }).onConflictDoNothing();
  await db.insert(s.abonnements).values({
    id: "abo_test_bil", terrasseId: ETAB, plan: "ESSENTIEL", tranche: "PETITE", statut: "ESSAI",
    essaiFin: ajouterJours(now, 14), periodeDebut: now, periodeFin: ajouterJours(now, 30),
    annuel: false, nbTablesMaxPeriode: 2, prorataDu: 0, fraisInstallPayes: false,
  }).onConflictDoNothing();
  await db.insert(s.affectations).values([
    { id: "aff_test_bil_1", utilisateurId: SERV, terrasseId: ETAB, role: "SERVEUSE", actif: true, creeLe: now },
    { id: "aff_test_bil_2", utilisateurId: CUIS, terrasseId: ETAB, role: "CUISINE_BAR", actif: true, creeLe: now },
  ]).onConflictDoNothing();
  await db.insert(s.tablesQr).values({
    id: TABLE, terrasseId: ETAB, numero: 1, tokenQr: QR, kind: "BILLARD", actif: true, creeLe: now,
  }).onConflictDoNothing();
  // 2e billard : cycle declarerDefaite sur une table vierge
  await db.insert(s.tablesQr).values({
    id: "tbl_test_bil_2", terrasseId: ETAB, numero: 2, tokenQr: "qrtoken_test_bil_2", kind: "BILLARD", actif: true, creeLe: now,
  }).onConflictDoNothing();
});

afterAll(async () => {
  const db = getDb();
  await db.delete(s.tokensBillard).where(eq(s.tokensBillard.terrasseId, ETAB));
  await db.delete(s.partiesBillard).where(eq(s.partiesBillard.terrasseId, ETAB));
  await db.delete(s.configBillard).where(eq(s.configBillard.terrasseId, ETAB));
  await db.delete(s.alertes).where(eq(s.alertes.terrasseId, ETAB));
  // Lignes « note unique » créées par l'encaissement du token (0018) :
  // sans ce nettoyage, la référence mobile unique bloque la relance.
  const notesOrg = await db.select({ id: s.notes.id, clientId: s.notes.clientId }).from(s.notes).where(eq(s.notes.organisationId, ORG));
  for (const n of notesOrg) {
    const encs = await db.select({ id: s.encaissements.id }).from(s.encaissements).where(eq(s.encaissements.noteId, n.id));
    for (const e of encs) await db.delete(s.noteVentilations).where(eq(s.noteVentilations.encaissementId, e.id));
    await db.delete(s.encaissements).where(eq(s.encaissements.noteId, n.id));
    await db.delete(s.noteLignes).where(eq(s.noteLignes.noteId, n.id));
    await db.delete(s.clientAppareils).where(eq(s.clientAppareils.clientId, n.clientId));
  }
  await db.delete(s.notes).where(eq(s.notes.organisationId, ORG));
  await db.delete(s.clients).where(eq(s.clients.organisationId, ORG));
  await db.delete(s.clientsSession).where(eq(s.clientsSession.tableId, TABLE));
  await db.delete(s.clientsSession).where(eq(s.clientsSession.tableId, "tbl_test_bil_2"));
  await db.delete(s.auditLog).where(eq(s.auditLog.terrasseId, ETAB));
  await db.delete(s.auditLog).where(like(s.auditLog.details, "%TestBil%"));
  await db.delete(s.affectations).where(eq(s.affectations.terrasseId, ETAB));
  await db.delete(s.tablesQr).where(eq(s.tablesQr.terrasseId, ETAB));
  await db.delete(s.abonnements).where(eq(s.abonnements.terrasseId, ETAB));
  await db.delete(s.terrasses).where(eq(s.terrasses.id, ETAB));
  await db.delete(s.organisations).where(eq(s.organisations.id, ORG));
  await db.delete(s.utilisateurs).where(like(s.utilisateurs.nom, "%TestBil%"));
});

describe("Billard Vincaire — flux complet", () => {
  let tokA = "", tokB = "", tokC = "";
  let partie1 = "", partie2 = "";

  it("config par défaut exposée : 5 000 FC, présence 3 min", async () => {
    const vue = await anonyme.billard.voirFile({ token: QR });
    expect(vue.prixTokenCdf).toBe(5000);
    expect(vue.delaiPresenceMin).toBe(3);
    expect(vue.vincaire).toBeNull();
    expect(vue.file).toHaveLength(0);
  });

  it("achat de 3 tokens : ATTENTE_PAIEMENT, jamais dans la file", async () => {
    tokA = (await acheter("Alain TestBil")).id;
    tokB = (await acheter("Brice TestBil")).id;
    tokC = (await acheter("Carine TestBil")).id;
    for (const id of [tokA, tokB, tokC]) {
      expect((await tokenParId(id)).statut).toBe("ATTENTE_PAIEMENT");
    }
    const vue = await anonyme.billard.voirFile({ token: QR });
    expect(vue.file).toHaveLength(0);
    expect(vue.nbAttentePaiement).toBe(3);
  });

  it("un client ne peut pas acheter deux tokens actifs", async () => {
    const sess = await anonyme.gbs.ouvrirSessionClient({ token: QR, prenom: "Alain TestBil" });
    // La session est nouvelle mais le prénom existe déjà — le garde-fou
    // porte sur la session, donc une NOUVELLE session peut racheter :
    // c'est le token actif par session qui est bloqué.
    const tok = await anonyme.billard.acheterToken({ token: QR, clientSessionId: sess.id });
    await expect(anonyme.billard.acheterToken({ token: QR, clientSessionId: sess.id }))
      .rejects.toThrow(/déjà un token actif/);
    // Nettoyage du token de contrôle (non payé, annulable)
    await anonyme.billard.annulerToken({ tokenId: tok.id, clientSessionId: sess.id });
  });

  it("validation cash refusée à la cuisine, accordée à la serveuse (RBAC)", async () => {
    await expect(appelantCuisine.billard.validerPaiementToken({ tokenId: tokA }))
      .rejects.toThrow(/permission/);
    // Le refus est journalisé (annexe §7)
    const refus = await getDb().select().from(s.auditLog)
      .where(and(eq(s.auditLog.action, "PERMISSION_REFUSEE"), eq(s.auditLog.acteurId, CUIS)));
    expect(refus.length).toBeGreaterThan(0);

    await appelantServeuse.billard.validerPaiementToken({ tokenId: tokA });
    await appelantServeuse.billard.validerPaiementToken({ tokenId: tokB });
    await appelantServeuse.billard.validerPaiementToken({ tokenId: tokC });
    expect((await tokenParId(tokA)).statut).toBe("EN_FILE");
  });

  it("file FIFO : Alain, Brice, Carine ; position et estimation exposées", async () => {
    const vue = await anonyme.billard.voirFile({ token: QR });
    expect(vue.file.map((f) => f.prenom)).toEqual(["Alain TestBil", "Brice TestBil", "Carine TestBil"]);
  });

  it("lancerPartie : Alain (1er arrivé) au siège vincaire, Brice challenger", async () => {
    const r = await appelantServeuse.billard.lancerPartie({ tableId: TABLE });
    partie1 = r.partieId;
    expect(r.vincaire.prenom).toBe("Alain TestBil");
    expect(r.challenger.prenom).toBe("Brice TestBil");
    expect((await tokenParId(tokA)).statut).toBe("EN_JEU");
    // Deux lancements simultanés : le second échoue (une seule partie)
    await expect(appelantServeuse.billard.lancerPartie({ tableId: TABLE }))
      .rejects.toThrow(/déjà en cours/);
  });

  it("terminerPartie : Alain gagne (série 1), Brice SORTI (RACHAT), Carine appelée", async () => {
    const r = await appelantServeuse.billard.terminerPartie({ partieId: partie1, gagnantTokenId: tokA });
    expect(r.gagnant.serie).toBe(1);
    expect(r.perdantSort).toBe("SORTI");
    expect((await tokenParId(tokB)).statut).toBe("SORTI");
    expect((await tokenParId(tokC)).statut).toBe("APPELE"); // suivant appelé
  });

  it("atomicité : une seconde clôture de la même partie échoue", async () => {
    await expect(appelantProp.billard.terminerPartie({ partieId: partie1, gagnantTokenId: tokB }))
      .rejects.toThrow(/déjà clôturée/);
  });

  it("2e partie : Carine challenger gagne → elle devient vincaire", async () => {
    const lancement = await appelantServeuse.billard.lancerPartie({ tableId: TABLE });
    partie2 = lancement.partieId;
    expect(lancement.vincaire.prenom).toBe("Alain TestBil"); // tenant
    expect(lancement.challenger.prenom).toBe("Carine TestBil");
    const r = await appelantServeuse.billard.terminerPartie({ partieId: partie2, gagnantTokenId: tokC });
    expect(r.gagnant.prenom).toBe("Carine TestBil");
    const vue = await anonyme.billard.voirFile({ token: QR });
    expect(vue.vincaire?.prenom).toBe("Carine TestBil");
    expect(vue.vincaire?.serie).toBe(1);
  });

  it("config : le gérant passe le token à 7 000 FC et FIN_FILE (avant/après journalisés)", async () => {
    const apres = await appelantProp.billard.configurerBillard({
      terrasseId: ETAB, prixTokenCdf: 7000, reglePerdant: "FIN_FILE",
    });
    expect(apres.prixTokenCdf).toBe(7000);
    const [audit] = await getDb().select().from(s.auditLog)
      .where(and(eq(s.auditLog.action, "BILLARD_CONFIG_MODIFIEE"), eq(s.auditLog.terrasseId, ETAB)));
    expect(audit.avant).toContain("5000");
    expect(audit.apres).toContain("7000");
  });

  it("FIN_FILE : le perdant retourne gratuitement en fin de file au nouveau tarif", async () => {
    const tokD = (await acheter("Divine TestBil")).id;
    await appelantServeuse.billard.validerPaiementToken({ tokenId: tokD });
    expect((await tokenParId(tokD)).prixCdf).toBe(7000); // nouveau tarif
    const lancement = await appelantServeuse.billard.lancerPartie({ tableId: TABLE });
    expect(lancement.challenger.prenom).toBe("Divine TestBil");
    const r = await appelantServeuse.billard.terminerPartie({
      partieId: lancement.partieId, gagnantTokenId: lancement.vincaire.id,
    });
    expect(r.perdantSort).toBe("EN_FILE");
    // Retour gratuit : même token, sans nouveau paiement. Seul en file,
    // il est immédiatement rappelé (APPELE) — comportement de l'annexe :
    // « quand la table se libère, le 1er de la file devient challenger ».
    const d = await tokenParId(tokD);
    expect(["EN_FILE", "APPELE"]).toContain(d.statut);
    expect(d.payePar).toBe(SERV); // aucun rachat exigé
  });

  it("marquerAbsent : joueur appelé déclaré absent → alerte + suivant appelé", async () => {
    const tokE = (await acheter("Elie TestBil")).id;
    await appelantServeuse.billard.validerPaiementToken({ tokenId: tokE });
    await appelantServeuse.billard.appelerSuivant({ tableId: TABLE });
    // Divine (rappelée en fin de partie précédente) puis Elie : le
    // premier appelé est Divine — tri par date d'appel, sinon l'ordre
    // physique des lignes rend le choix indéterminé.
    const [appele] = await getDb().select().from(s.tokensBillard)
      .where(and(eq(s.tokensBillard.tableId, TABLE), eq(s.tokensBillard.statut, "APPELE")))
      .orderBy(asc(s.tokensBillard.appeleLe));
    expect(appele).toBeDefined();
    await appelantServeuse.billard.marquerAbsent({ tokenId: appele.id });
    expect((await tokenParId(appele.id)).statut).toBe("ABSENT");
    const alertes = await getDb().select().from(s.alertes)
      .where(and(eq(s.alertes.terrasseId, ETAB), eq(s.alertes.type, "BILLARD_ABSENT")));
    expect(alertes.length).toBeGreaterThan(0);
    // Le suivant (Elie) a été appelé automatiquement
    expect((await tokenParId(tokE)).statut).toBe("APPELE");
  });

  it("annulation d'un token payé par le client → alerte gérant", async () => {
    const sess = await anonyme.gbs.ouvrirSessionClient({ token: QR, prenom: "Fifi TestBil" });
    const tok = await anonyme.billard.acheterToken({ token: QR, clientSessionId: sess.id });
    await appelantServeuse.billard.validerPaiementToken({ tokenId: tok.id });
    await anonyme.billard.annulerToken({ tokenId: tok.id, clientSessionId: sess.id });
    const alertes = await getDb().select().from(s.alertes)
      .where(and(eq(s.alertes.terrasseId, ETAB), eq(s.alertes.type, "BILLARD_ANNULATION_PAYEE")));
    expect(alertes.length).toBeGreaterThan(0);
  });

  it("stats du soir : recette, parties, classement — réservées aux rapports", async () => {
    await expect(appelantServeuse.billard.statsBillard({ terrasseId: ETAB })).rejects.toThrow();
    const stats = await appelantProp.billard.statsBillard({ terrasseId: ETAB });
    expect(stats.partiesJouees).toBe(3);
    expect(stats.tokensVendus).toBeGreaterThanOrEqual(5);
    expect(stats.recetteCdf).toBeGreaterThan(20000);
    expect(stats.classement[0].prenom).toBe("Carine TestBil"); // 2 victoires
    // Les parties de test durent quelques secondes → moyenne arrondie
    // à 0 minute : on vérifie la cohérence (entier ≥ 0), pas le réel.
    expect(Number.isInteger(stats.dureeMoyenneMin)).toBe(true);
    expect(stats.dureeMoyenneMin).toBeGreaterThanOrEqual(0);
  });
});

describe("voirGestion — panneau de gestion (UI staff)", () => {
  it("refusé à la cuisine (PERMISSION_REFUSEE journalisée)", async () => {
    const compte = () => getDb().select().from(s.auditLog)
      .where(and(eq(s.auditLog.action, "PERMISSION_REFUSEE"), eq(s.auditLog.acteurId, CUIS)));
    const avant = await compte();
    await expect(appelantCuisine.billard.voirGestion({ tableId: TABLE }))
      .rejects.toThrow(/réservée/);
    expect((await compte()).length).toBe(avant.length + 1);
  });

  it("refusé sur une zone qui n'est pas un billard", async () => {
    await expect(appelantServeuse.billard.voirGestion({ tableId: "tbl_test_bil_inconnu" }))
      .rejects.toThrow(/introuvable/);
  });

  it("la serveuse voit le détail : statuts, positions FIFO, jetons comptoir", async () => {
    // Un client au scan (non payé) + un joueur ajouté au comptoir (payé cash)
    const tokQr = await acheter("Gael TestBil");
    const tokComptoir = await appelantServeuse.billard.ajouterJoueurComptoir({
      tableId: TABLE, prenom: "Herve TestBil", dejaPaye: true,
    });
    const vue = await appelantServeuse.billard.voirGestion({ tableId: TABLE });
    expect(vue.billard.id).toBe(TABLE);
    expect(vue.terrasseId).toBe(ETAB);
    expect(vue.config.prixTokenCdf).toBe(7000); // tarif modifié plus haut
    expect(Number.isInteger(vue.dureeMoyenneMin)).toBe(true);
    // Aucune partie en cours à ce stade : le bouton « Lancer » s'affiche
    expect(vue.partieEnCours).toBeNull();

    const parId = new Map(vue.tokens.map((t) => [t.id, t]));
    expect(parId.get(tokQr.id)?.statut).toBe("ATTENTE_PAIEMENT");
    expect(parId.get(tokQr.id)?.comptoir).toBe(false);
    expect(parId.get(tokComptoir.id)?.statut).toBe("EN_FILE");
    expect(parId.get(tokComptoir.id)?.comptoir).toBe(true);

    // Positions FIFO : contiguës 1..n, et le joueur comptoir est classé
    const positions = vue.positionFile.map((p) => p.position);
    expect(positions).toEqual(positions.map((_, i) => i + 1));
    expect(vue.positionFile.find((p) => p.id === tokComptoir.id)?.position)
      .toBeGreaterThan(0);

    // Tri métier : EN_JEU (Carine, vincaire) avant EN_FILE avant
    // ATTENTE_PAIEMENT — l'ordre d'affichage du panneau staff.
    const rang = (id: string) => vue.tokens.findIndex((t) => t.id === id);
    const enJeu = vue.tokens.find((t) => t.statut === "EN_JEU");
    expect(enJeu?.prenom).toBe("Carine TestBil");
    expect(rang(enJeu!.id)).toBeLessThan(rang(tokComptoir.id));
    expect(rang(tokComptoir.id)).toBeLessThan(rang(tokQr.id));
  });
});

describe("declarerDefaite — le perdant déclare lui-même (prompt maître §3)", () => {
  const QR2 = "qrtoken_test_bil_2";
  const TABLE2 = "tbl_test_bil_2";
  let sessU = "", sessV = "", sessW = "";

  it("prépare le 2e billard : 3 joueurs payés, partie lancée (Umba roi, Vicky challenger)", async () => {
    // La config est par ÉTABLISSEMENT (modifiée en FIN_FILE plus haut) :
    // on repasse en RACHAT pour un scénario déterministe.
    await appelantProp.billard.configurerBillard({ terrasseId: ETAB, reglePerdant: "RACHAT" });
    sessU = (await anonyme.gbs.ouvrirSessionClient({ token: QR2, prenom: "Umba TestBil" })).id;
    sessV = (await anonyme.gbs.ouvrirSessionClient({ token: QR2, prenom: "Vicky TestBil" })).id;
    sessW = (await anonyme.gbs.ouvrirSessionClient({ token: QR2, prenom: "Willy TestBil" })).id;
    for (const sess of [sessU, sessV, sessW]) {
      const tok = await anonyme.billard.acheterToken({ token: QR2, clientSessionId: sess });
      await appelantServeuse.billard.validerPaiementToken({ tokenId: tok.id });
    }
    const r = await appelantServeuse.billard.lancerPartie({ tableId: TABLE2 });
    expect(r.vincaire.prenom).toBe("Umba TestBil");
    expect(r.challenger.prenom).toBe("Vicky TestBil");
  });

  it("refus : un spectateur qui n'est pas en partie ne peut rien déclarer", async () => {
    const sessX = (await anonyme.gbs.ouvrirSessionClient({ token: QR2, prenom: "Xavier TestBil" })).id;
    await expect(anonyme.billard.declarerDefaite({ token: QR2, clientSessionId: sessX }))
      .rejects.toThrow(/pas en partie/);
  });

  it("le challenger déclare sa défaite → le roi reste (série 1), le suivant est EN_JEU IMMÉDIATEMENT", async () => {
    const r = await anonyme.billard.declarerDefaite({ token: QR2, clientSessionId: sessV });
    expect(r.gagnant.prenom).toBe("Umba TestBil");
    expect(r.gagnant.serie).toBe(1);
    expect(r.perdantSort).toBe("SORTI"); // règle RACHAT par défaut
    // Automatisation du prompt maître : match suivant lancé sans staff
    expect(r.nouvellePartie).not.toBeNull();
    expect(r.nouvellePartie!.vincaire.prenom).toBe("Umba TestBil");
    expect(r.nouvellePartie!.challenger.prenom).toBe("Willy TestBil");
    // Vérifié en base : Willy est EN_JEU (jamais APPELE — pas d'appel ici)
    const willy = await getDb().select().from(s.tokensBillard)
      .where(and(eq(s.tokensBillard.tableId, TABLE2), eq(s.tokensBillard.prenom, "Willy TestBil")))
      .limit(1);
    expect(willy[0]!.statut).toBe("EN_JEU");
    const vue = await anonyme.billard.voirFile({ token: QR2 });
    expect(vue.partieEnCours?.challenger?.prenom).toBe("Willy TestBil");
  });

  it("le ROI déclare sa défaite → destitué, le challenger devient roi, rachat en file promu", async () => {
    // Vicky rachète un token (règle RACHAT : retour en fin de file)
    const tokV2 = await anonyme.billard.acheterToken({ token: QR2, clientSessionId: sessV });
    await appelantServeuse.billard.validerPaiementToken({ tokenId: tokV2.id });
    const r = await anonyme.billard.declarerDefaite({ token: QR2, clientSessionId: sessU });
    expect(r.gagnant.prenom).toBe("Willy TestBil"); // challenger promu roi
    expect(r.nouvellePartie!.vincaire.prenom).toBe("Willy TestBil");
    expect(r.nouvellePartie!.challenger.prenom).toBe("Vicky TestBil"); // rachat = 1re de file
    expect(r.perdantSort).toBe("SORTI"); // le roi destitué sort (peut racheter)
    const vue = await anonyme.billard.voirFile({ token: QR2 });
    expect(vue.vincaire?.prenom).toBe("Willy TestBil");
    expect(vue.vincaire?.serie).toBe(1);
  });

  it("double déclaration du même joueur : la seconde échoue (plus en partie)", async () => {
    await expect(anonyme.billard.declarerDefaite({ token: QR2, clientSessionId: sessU }))
      .rejects.toThrow(/pas en partie/);
  });

  it("déclarations SIMULTANÉES des deux joueurs : une seule passe (verrou FOR UPDATE, audit)", async () => {
    // État : Willy roi vs Vicky challenger, file vide. Les deux
    // déclarent leur défaite au même instant — sans relecture du
    // statut après verrouillage, la seconde transaction ressusciterait
    // le perdant et lancerait une partie fantôme (bug d'audit).
    const [r1, r2] = await Promise.allSettled([
      anonyme.billard.declarerDefaite({ token: QR2, clientSessionId: sessW }),
      anonyme.billard.declarerDefaite({ token: QR2, clientSessionId: sessV }),
    ]);
    expect([r1, r2].filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect([r1, r2].filter((r) => r.status === "rejected")).toHaveLength(1);
    // Invariants : un seul gagnant reste EN_JEU, aucune partie
    // fantôme (file vide → pas de relance automatique possible).
    const enJeu = await getDb().select().from(s.tokensBillard)
      .where(and(eq(s.tokensBillard.tableId, TABLE2), eq(s.tokensBillard.statut, "EN_JEU")));
    expect(enJeu).toHaveLength(1);
    const enCours = await getDb().select().from(s.partiesBillard)
      .where(and(eq(s.partiesBillard.tableId, TABLE2), eq(s.partiesBillard.statut, "EN_COURS")));
    expect(enCours).toHaveLength(0);
  });
});

describe("Cash du comptoir : enregistré en caisse, jamais par le propriétaire", () => {
  it("joueur ajouté payé : un encaissement CASH EN_MAIN de la serveuse existe", async () => {
    const tok = await appelantServeuse.billard.ajouterJoueurComptoir({ tableId: TABLE, prenom: "Cash TestBil", dejaPaye: true });
    const [ligne] = await getDb().select().from(s.noteLignes)
      .where(and(eq(s.noteLignes.type, "TOKEN_BILLARD"), eq(s.noteLignes.refId, tok.id))).limit(1);
    expect(ligne).toBeDefined();
    const encs = await getDb().select().from(s.encaissements).where(eq(s.encaissements.noteId, ligne!.noteId));
    expect(encs).toHaveLength(1);
    expect(encs[0]?.mode).toBe("CASH");
    expect(encs[0]?.statut).toBe("EN_MAIN");
    expect(encs[0]?.encaisseParId).toBe(SERV);
    expect(encs[0]?.montantCdf).toBe(ligne!.montantCdf);
  });

  it("le propriétaire ne peut pas encaisser un joueur comptoir (aucun token créé)", async () => {
    const avant = await getDb().select({ id: s.tokensBillard.id }).from(s.tokensBillard).where(eq(s.tokensBillard.terrasseId, ETAB));
    await expect(appelantProp.billard.ajouterJoueurComptoir({ tableId: TABLE, prenom: "Refus TestBil", dejaPaye: true }))
      .rejects.toThrow(/rôle requis/);
    const apres = await getDb().select({ id: s.tokensBillard.id }).from(s.tokensBillard).where(eq(s.tokensBillard.terrasseId, ETAB));
    expect(apres).toHaveLength(avant.length);
  });

  it("joueur ajouté À PAYER puis validé par la serveuse : le cash entre aussi en caisse", async () => {
    const tok = await appelantServeuse.billard.ajouterJoueurComptoir({ tableId: TABLE, prenom: "Apres TestBil", dejaPaye: false });
    await appelantServeuse.billard.validerPaiementToken({ tokenId: tok.id });
    const [ligne] = await getDb().select().from(s.noteLignes)
      .where(and(eq(s.noteLignes.type, "TOKEN_BILLARD"), eq(s.noteLignes.refId, tok.id))).limit(1);
    expect(ligne).toBeDefined();
    const encs = await getDb().select().from(s.encaissements).where(eq(s.encaissements.noteId, ligne!.noteId));
    expect(encs.map((e) => e.statut)).toEqual(["EN_MAIN"]);
  });
});
