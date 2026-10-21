// ============================================================
// GBS — Hôtel côté API (prompt maître §4/§7) : création de chambre,
// cycle LIBRE → OCCUPEE → A_NETTOYER → LIBRE, permissions par rôle,
// montant calculé au check-out, concurrence. Fixtures test_hot.
// ============================================================

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq, like } from "drizzle-orm";
import { appRouter } from "../router";
import { getDb } from "../queries/connection";
import * as s from "../../db/schema";
import { ajouterJours, maintenant } from "../gbsUtils";
import { jourComptable } from "../lib/jourComptable";

const appelantProp = appRouter.createCaller({ session: { utilisateurId: "usr_test_hot_prop" } } as never);
const appelantRecep = appRouter.createCaller({ session: { utilisateurId: "usr_test_hot_recep" } } as never);
const appelantGouv = appRouter.createCaller({ session: { utilisateurId: "usr_test_hot_gouv" } } as never);
const appelantServ = appRouter.createCaller({ session: { utilisateurId: "usr_test_hot_serv" } } as never);

const ORG = "org_test_hot";
const ETAB = "etab_test_hot";
const TEL_BASE = "+2439900008";

async function chambreParId(id: string) {
  const [c] = await getDb().select().from(s.chambres).where(eq(s.chambres.id, id)).limit(1);
  return c;
}

beforeAll(async () => {
  const db = getDb();
  const now = maintenant();
  await db.insert(s.utilisateurs).values([
    { id: "usr_test_hot_prop", nom: "Proprio TestHot", telephone: `${TEL_BASE}1`, pin: "0001", creeLe: now },
    { id: "usr_test_hot_recep", nom: "Réception TestHot", telephone: `${TEL_BASE}2`, pin: "0002", creeLe: now },
    { id: "usr_test_hot_gouv", nom: "Gouvernante TestHot", telephone: `${TEL_BASE}3`, pin: "0003", creeLe: now },
    { id: "usr_test_hot_serv", nom: "Serveuse TestHot", telephone: `${TEL_BASE}4`, pin: "0004", creeLe: now },
  ]).onConflictDoNothing();
  await db.insert(s.organisations).values({ id: ORG, nom: "Org TestHot", proprietaireId: "usr_test_hot_prop", creeLe: now }).onConflictDoNothing();
  await db.insert(s.terrasses).values({
    id: ETAB, organisationId: ORG, nom: "Hôtel TestHot", adresse: "Av. des Tests",
    typeEtablissement: "GUEST_HOUSE", typesSecondaires: [],
    seuilEcartCdf: 5000, seuilEcartUsd: 200, tauxUsdCdf: 2740, creeLe: now,
  }).onConflictDoNothing();
  await db.insert(s.abonnements).values({
    id: "abo_test_hot", terrasseId: ETAB, plan: "ESSENTIEL", tranche: "PETITE", statut: "ESSAI",
    essaiFin: ajouterJours(now, 14), periodeDebut: now, periodeFin: ajouterJours(now, 30),
    annuel: false, nbTablesMaxPeriode: 10, prorataDu: 0, fraisInstallPayes: false,
  }).onConflictDoNothing();
  await db.insert(s.affectations).values([
    { id: "aff_test_hot_1", utilisateurId: "usr_test_hot_recep", terrasseId: ETAB, role: "RECEPTIONNISTE", actif: true, creeLe: now },
    { id: "aff_test_hot_2", utilisateurId: "usr_test_hot_gouv", terrasseId: ETAB, role: "GOUVERNANTE", actif: true, creeLe: now },
    { id: "aff_test_hot_3", utilisateurId: "usr_test_hot_serv", terrasseId: ETAB, role: "SERVEUSE", actif: true, creeLe: now },
  ]).onConflictDoNothing();
});

afterAll(async () => {
  const db = getDb();
  await db.delete(s.sejours).where(eq(s.sejours.terrasseId, ETAB));
  await db.delete(s.chambres).where(eq(s.chambres.terrasseId, ETAB));
  await db.delete(s.auditLog).where(eq(s.auditLog.terrasseId, ETAB));
  await db.delete(s.auditLog).where(like(s.auditLog.details, "%TestHot%"));
  await db.delete(s.affectations).where(eq(s.affectations.terrasseId, ETAB));
  await db.delete(s.abonnements).where(eq(s.abonnements.terrasseId, ETAB));
  await db.delete(s.terrasses).where(eq(s.terrasses.id, ETAB));
  await db.delete(s.organisations).where(eq(s.organisations.id, ORG));
  await db.delete(s.utilisateurs).where(like(s.utilisateurs.nom, "%TestHot%"));
});

describe("Hôtel — cycle d'occupation complet", () => {
  let chambre1 = "";
  let sejour1 = "";

  it("création de chambre : la serveuse est refusée, le propriétaire crée", async () => {
    await expect(appelantServ.hotel.creerChambre({
      terrasseId: ETAB, numero: "1", prixNuitCdf: 40_000,
    })).rejects.toThrow();
    const r = await appelantProp.hotel.creerChambre({
      terrasseId: ETAB, numero: "1", type: "DOUBLE", prixNuitCdf: 40_000, prixHeureCdf: 10_000,
    });
    chambre1 = r.id;
    const c = await chambreParId(chambre1);
    expect(c.statut).toBe("LIBRE");
    // Numéro unique par établissement
    await expect(appelantProp.hotel.creerChambre({
      terrasseId: ETAB, numero: "1", prixNuitCdf: 50_000,
    })).rejects.toThrow(/existe déjà/);
  });

  it("check-in par la réceptionniste : séjour EN_COURS, chambre OCCUPEE", async () => {
    const r = await appelantRecep.hotel.checkIn({
      chambreId: chambre1, clientNom: "Mumbere TestHot", pieceIdentite: "PP-12345", mode: "NUIT",
    });
    sejour1 = r.sejourId;
    expect((await chambreParId(chambre1)).statut).toBe("OCCUPEE");
    const [sj] = await getDb().select().from(s.sejours).where(eq(s.sejours.id, sejour1)).limit(1);
    expect(sj.statut).toBe("EN_COURS");
    expect(sj.pieceIdentite).toBe("PP-12345");
    expect(sj.montantTotalCdf).toBeNull(); // calculé au check-out seulement
  });

  it("check-in sur une chambre occupée : refusé (une seule occupation)", async () => {
    await expect(appelantRecep.hotel.checkIn({
      chambreId: chambre1, clientNom: "Intrus TestHot", mode: "NUIT",
    })).rejects.toThrow(/pas libre/);
  });

  it("check-out : montant = 1 nuitée, chambre A_NETTOYER, double clôture refusée", async () => {
    const r = await appelantRecep.hotel.checkOut({ sejourId: sejour1 });
    expect(r.montantTotalCdf).toBe(40_000); // quelques secondes → 1 nuit entamée
    expect((await chambreParId(chambre1)).statut).toBe("A_NETTOYER");
    await expect(appelantRecep.hotel.checkOut({ sejourId: sejour1 }))
      .rejects.toThrow(/déjà clôturé/);
  });

  it("ménage : la réceptionniste ne peut PAS valider, la gouvernante oui", async () => {
    // Contrôle croisé (§4) : qui loge ne déclare pas propre.
    await expect(appelantRecep.hotel.marquerNettoyee({ chambreId: chambre1 }))
      .rejects.toThrow();
    await appelantGouv.hotel.marquerNettoyee({ chambreId: chambre1 });
    expect((await chambreParId(chambre1)).statut).toBe("LIBRE");
    const audits = await getDb().select().from(s.auditLog)
      .where(and(eq(s.auditLog.action, "HOTEL_CHAMBRE_NETTOYEE"), eq(s.auditLog.terrasseId, ETAB)));
    expect(audits.length).toBe(1);
  });

  it("location à l'heure : refusée sur une chambre sans prix horaire", async () => {
    const c2 = await appelantProp.hotel.creerChambre({
      terrasseId: ETAB, numero: "2", prixNuitCdf: 30_000, // pas de prixHeureCdf
    });
    await expect(appelantRecep.hotel.checkIn({
      chambreId: c2.id, clientNom: "Passage TestHot", mode: "HEURE",
    })).rejects.toThrow(/heure/);
    // À la nuitée : acceptée
    const r = await appelantRecep.hotel.checkIn({
      chambreId: c2.id, clientNom: "Passage TestHot", mode: "NUIT",
    });
    expect(r.ok).toBe(true);
  });

  it("voirChambres : état + séjour en cours, refusé hors personnel", async () => {
    const vue = await appelantRecep.hotel.voirChambres({ terrasseId: ETAB });
    expect(vue).toHaveLength(2);
    const c2 = vue.find((c) => c.numero === "2");
    expect(c2?.statut).toBe("OCCUPEE");
    expect(c2?.sejour?.clientNom).toBe("Passage TestHot");
    const inconnu = appRouter.createCaller({ session: { utilisateurId: "usr_test_hot_inconnu" } } as never);
    await expect(inconnu.hotel.voirChambres({ terrasseId: ETAB })).rejects.toThrow();
  });

  it("confidentialité (audit) : la pièce d'identité est masquée hors réception/direction", async () => {
    const c3 = await appelantProp.hotel.creerChambre({ terrasseId: ETAB, numero: "3", prixNuitCdf: 50_000 });
    await appelantRecep.hotel.checkIn({
      chambreId: c3.id, clientNom: "Discret TestHot", pieceIdentite: "CD-99999", mode: "NUIT",
    });
    // La réception voit la pièce d'identité…
    const vueRecep = await appelantRecep.hotel.voirChambres({ terrasseId: ETAB });
    expect(vueRecep.find((c) => c.numero === "3")?.sejour?.pieceIdentite).toBe("CD-99999");
    // …la serveuse voit le séjour (nom utile au service) mais PAS la pièce.
    const vueServ = await appelantServ.hotel.voirChambres({ terrasseId: ETAB });
    const c3serv = vueServ.find((c) => c.numero === "3");
    expect(c3serv?.sejour?.clientNom).toBe("Discret TestHot");
    expect(c3serv?.sejour?.pieceIdentite).toBeNull();
  });

  it("export comptable : le séjour clôturé du jour apparaît en ligne HOTEL", async () => {
    // Le séjour « Mumbere TestHot » a été clôturé plus haut, aujourd'hui.
    // Jour COMPTABLE (Africa/Lubumbashi), pas le jour UTC : entre 22h et
    // minuit UTC, la date UTC est encore « hier » pour Lubumbashi et le
    // séjour clôturé tomberait hors plage — le test deviendrait flaky.
    const jour = jourComptable();
    const r = await appelantProp.comptabilite.exportJournalier({ terrasseId: ETAB, jour });
    expect(r.csv).toContain("HOTEL");
    expect(r.csv).toContain("Mumbere TestHot");
    expect(r.totaux.hotelCdf).toBe(40_000); // 1 nuitée
    expect(r.csv).toContain("NET DU JOUR");
  });
});

describe("concurrence — check-in", () => {
  it("deux check-in simultanés sur la même chambre : un seul séjour créé", async () => {
    // Transaction + FOR UPDATE côté serveur (hotel.ts) : le second
    // check-in doit être refusé même si les deux arrivent ensemble.
    const c = await appelantProp.hotel.creerChambre({ terrasseId: ETAB, numero: "9", prixNuitCdf: 30_000 });
    const resultats = await Promise.allSettled([
      appelantRecep.hotel.checkIn({ chambreId: c.id, clientNom: "ConcA TestHot", pieceIdentite: "CD-A1", mode: "NUIT" }),
      appelantRecep.hotel.checkIn({ chambreId: c.id, clientNom: "ConcB TestHot", pieceIdentite: "CD-B1", mode: "NUIT" }),
    ]);
    const reussis = resultats.filter((r) => r.status === "fulfilled").length;
    expect(reussis).toBe(1);
    const sejours = await getDb().select().from(s.sejours).where(eq(s.sejours.chambreId, c.id));
    expect(sejours.length).toBe(1); // jamais deux occupants
    expect((await chambreParId(c.id)).statut).toBe("OCCUPEE");
  });
});
