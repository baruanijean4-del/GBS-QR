// ============================================================
// GBS — Tests des dépenses de caisse (solde de la boutique)
// - enregistrement Gérant/Propriétaire, refus Serveuse
// - montant nul refusé, motif obligatoire
// - la dépense apparaît dans le snapshot staff
// ============================================================

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { appRouter } from "../router";
import { getDb } from "../queries/connection";
import * as s from "../../db/schema";
import { maintenant } from "../gbsUtils";

const ORG = "org_test_depense";
const ETAB = "etab_test_depense";
const PROP = "usr_test_depense_prop";
const SERV = "usr_test_depense_serv";

const appelantProp = appRouter.createCaller({ session: { utilisateurId: PROP } } as never);
const appelantServ = appRouter.createCaller({ session: { utilisateurId: SERV } } as never);

beforeAll(async () => {
  const db = getDb();
  const now = maintenant();
  await db.insert(s.utilisateurs).values([
    { id: PROP, nom: "Prop Dépense", telephone: "+243000000010", pin: "1111", creeLe: now },
    { id: SERV, nom: "Serv Dépense", telephone: "+243000000011", pin: "2222", creeLe: now },
  ]).onConflictDoNothing();
  await db.insert(s.organisations).values({
    id: ORG, nom: "Org dépense", proprietaireId: PROP, creeLe: now,
  }).onConflictDoNothing();
  await db.insert(s.terrasses).values({
    id: ETAB, organisationId: ORG, nom: "Terrasse dépense",
    adresse: "Av. des Tests", typeEtablissement: "TERRASSE",
    seuilEcartCdf: 5000, seuilEcartUsd: 200, tauxUsdCdf: 2800, creeLe: now,
  }).onConflictDoNothing();
  await db.insert(s.affectations).values({
    id: "aff_test_depense", utilisateurId: SERV, terrasseId: ETAB,
    role: "SERVEUSE", actif: true, creeLe: now,
  }).onConflictDoNothing();
  // Abonnement ACTIF : sinon la terrasse est en lecture seule
  await db.insert(s.abonnements).values({
    id: "abo_test_depense", terrasseId: ETAB, plan: "ESSENTIEL", tranche: "PETITE",
    statut: "ACTIF", periodeDebut: now, periodeFin: new Date(Date.now() + 86400e3).toISOString(),
    annuel: false, nbTablesMaxPeriode: 8, prorataDu: 0, fraisInstallPayes: true,
  }).onConflictDoNothing();
});

afterAll(async () => {
  const db = getDb();
  await db.delete(s.depenses).where(eq(s.depenses.terrasseId, ETAB));
  await db.delete(s.auditLog).where(eq(s.auditLog.acteurId, PROP));
  await db.delete(s.auditLog).where(eq(s.auditLog.acteurId, SERV));
  await db.delete(s.abonnements).where(eq(s.abonnements.terrasseId, ETAB));
  await db.delete(s.affectations).where(eq(s.affectations.terrasseId, ETAB));
  await db.delete(s.terrasses).where(eq(s.terrasses.id, ETAB));
  await db.delete(s.organisations).where(eq(s.organisations.id, ORG));
  await db.delete(s.utilisateurs).where(eq(s.utilisateurs.id, PROP));
  await db.delete(s.utilisateurs).where(eq(s.utilisateurs.id, SERV));
});

describe("gbs.enregistrerDepense", () => {
  it("le propriétaire enregistre une dépense → visible dans le snapshot staff", async () => {
    const r = await appelantProp.gbs.enregistrerDepense({
      terrasseId: ETAB, montantCdf: 15000, montantUsdCentimes: 0, motif: "Glace pour les bières",
    });
    expect(r.ok).toBe(true);

    const snap = await appelantProp.gbs.snapshot({ portee: { kind: "staff" } });
    const dep = snap.depenses.find((d) => d.terrasseId === ETAB && d.motif === "Glace pour les bières");
    expect(dep).toBeDefined();
    expect(dep!.montantCdf).toBe(15000);
    expect(dep!.saisiPar).toBe(PROP);
  });

  it("une dépense en dollars est acceptée", async () => {
    const r = await appelantProp.gbs.enregistrerDepense({
      terrasseId: ETAB, montantCdf: 0, montantUsdCentimes: 500, motif: "Transport",
    });
    expect(r.ok).toBe(true);
  });

  it("une serveuse est refusée", async () => {
    await expect(
      appelantServ.gbs.enregistrerDepense({
        terrasseId: ETAB, montantCdf: 1000, montantUsdCentimes: 0, motif: "Tentative",
      }),
    ).rejects.toThrow(/réservée/);
  });

  it("montant nul (0 FC et 0 $) refusé", async () => {
    await expect(
      appelantProp.gbs.enregistrerDepense({ terrasseId: ETAB, montantCdf: 0, montantUsdCentimes: 0, motif: "Rien" }),
    ).rejects.toThrow(/montant/i);
  });

  it("motif trop court refusé par la validation", async () => {
    await expect(
      appelantProp.gbs.enregistrerDepense({ terrasseId: ETAB, montantCdf: 1000, montantUsdCentimes: 0, motif: "x" }),
    ).rejects.toThrow();
  });
});
