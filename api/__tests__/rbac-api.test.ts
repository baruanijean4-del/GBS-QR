// ============================================================
// GBS — RBAC côté API (annexe §7, étape 2) : invitation avec un
// rôle long (RECEPTIONNISTE, 14 caractères), surcharges de
// permission du propriétaire, refus journalisé. Fixtures test_rbac.
// ============================================================

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq, like } from "drizzle-orm";
import { appRouter } from "../router";
import { getDb } from "../queries/connection";
import * as s from "../../db/schema";
import { ajouterJours, maintenant } from "../gbsUtils";

const appelantProp = appRouter.createCaller({ session: { utilisateurId: "usr_test_rbac_prop" } } as never);

const ORG = "org_test_rbac";
const PROP = "usr_test_rbac_prop";
const ETAB = "etab_test_rbac";
const TEL_BASE = "+2439900006";
let membreId = "";

beforeAll(async () => {
  const db = getDb();
  const now = maintenant();
  await db.insert(s.utilisateurs).values([
    { id: PROP, nom: "Proprio TestRbac", telephone: `${TEL_BASE}1`, pin: "0001", creeLe: now },
  ]).onConflictDoNothing();
  await db.insert(s.organisations).values({ id: ORG, nom: "Org TestRbac", proprietaireId: PROP, creeLe: now }).onConflictDoNothing();
  await db.insert(s.terrasses).values({
    id: ETAB, organisationId: ORG, nom: "Terrasse TestRbac", adresse: "Av. des Tests",
    typeEtablissement: "TERRASSE", typesSecondaires: [],
    seuilEcartCdf: 5000, seuilEcartUsd: 200, tauxUsdCdf: 2740, creeLe: now,
  }).onConflictDoNothing();
  await db.insert(s.abonnements).values({
    id: "abo_test_rbac", terrasseId: ETAB, plan: "ESSENTIEL", tranche: "PETITE", statut: "ESSAI",
    essaiFin: ajouterJours(now, 14), periodeDebut: now, periodeFin: ajouterJours(now, 30),
    annuel: false, nbTablesMaxPeriode: 2, prorataDu: 0, fraisInstallPayes: false,
  }).onConflictDoNothing();
});

afterAll(async () => {
  const db = getDb();
  await db.delete(s.permissionsSurcharge).where(eq(s.permissionsSurcharge.terrasseId, ETAB));
  await db.delete(s.invitations).where(eq(s.invitations.terrasseId, ETAB));
  await db.delete(s.affectations).where(eq(s.affectations.terrasseId, ETAB));
  await db.delete(s.auditLog).where(like(s.auditLog.details, "%TestRbac%"));
  await db.delete(s.auditLog).where(eq(s.auditLog.terrasseId, ETAB));
  await db.delete(s.auditLog).where(eq(s.auditLog.acteurId, PROP));
  await db.delete(s.abonnements).where(eq(s.abonnements.terrasseId, ETAB));
  await db.delete(s.terrasses).where(eq(s.terrasses.id, ETAB));
  await db.delete(s.organisations).where(eq(s.organisations.id, ORG));
  await db.delete(s.utilisateurs).where(like(s.utilisateurs.nom, "%TestRbac%"));
});

describe("RBAC API — rôles étendus et surcharges", () => {
  it("invitation RECEPTIONNISTE (14 caractères) → affectation complète en base", async () => {
    const { code } = await appelantProp.gbs.creerInvitation({
      terrasseId: ETAB, role: "RECEPTIONNISTE", nomPrevu: "Reception TestRbac",
    });
    expect(code).toHaveLength(8);
    const anonyme = appRouter.createCaller({} as never);
    const res = await anonyme.gbs.consommerInvitation({
      code, nom: "Reception TestRbac", telephone: `${TEL_BASE}2`, pin: "3344",
    });
    expect(res.role).toBe("RECEPTIONNISTE");
    membreId = res.utilisateurId;
    const [aff] = await getDb().select().from(s.affectations)
      .where(and(eq(s.affectations.utilisateurId, membreId), eq(s.affectations.terrasseId, ETAB))).limit(1);
    expect(aff.role).toBe("RECEPTIONNISTE");
    expect(aff.role.length).toBeGreaterThan(10); // prouve le varchar(16)
  });

  it("mesPermissions reflète la matrice : réceptionniste = remise oui, ordonnance non", async () => {
    const appelantMembre = appRouter.createCaller({ session: { utilisateurId: membreId } } as never);
    const p = await appelantMembre.gbs.mesPermissions({ terrasseId: ETAB });
    expect(p.REMISE).toBe(true);
    expect(p.VALIDER_ORDONNANCE).toBe(false);
    expect(p.GERER_EQUIPE).toBe(false);
    const pProp = await appelantProp.gbs.mesPermissions({ terrasseId: ETAB });
    expect(pProp.GERER_EQUIPE).toBe(true); // le propriétaire peut tout
  });

  it("surcharge propriétaire : accorde puis retire VALIDER_ORDONNANCE", async () => {
    await appelantProp.gbs.definirSurchargePermission({
      terrasseId: ETAB, utilisateurId: membreId, action: "VALIDER_ORDONNANCE", autorisee: true,
    });
    const appelantMembre = appRouter.createCaller({ session: { utilisateurId: membreId } } as never);
    expect((await appelantMembre.gbs.mesPermissions({ terrasseId: ETAB })).VALIDER_ORDONNANCE).toBe(true);

    await appelantProp.gbs.definirSurchargePermission({
      terrasseId: ETAB, utilisateurId: membreId, action: "VALIDER_ORDONNANCE", autorisee: null,
    });
    expect((await appelantMembre.gbs.mesPermissions({ terrasseId: ETAB })).VALIDER_ORDONNANCE).toBe(false);

    const liste = await appelantProp.gbs.listerSurcharges({ terrasseId: ETAB });
    expect(liste).toHaveLength(0); // la ligne est supprimée au retrait
  });

  it("un membre ne peut pas surcharger les permissions (propriétaire seul)", async () => {
    const appelantMembre = appRouter.createCaller({ session: { utilisateurId: membreId } } as never);
    await expect(appelantMembre.gbs.definirSurchargePermission({
      terrasseId: ETAB, utilisateurId: membreId, action: "GERER_EQUIPE", autorisee: true,
    })).rejects.toThrow();
  });

  it("surcharge refusée sur un non-membre", async () => {
    await expect(appelantProp.gbs.definirSurchargePermission({
      terrasseId: ETAB, utilisateurId: "usr_test_rbac_inconnu", action: "REMISE", autorisee: true,
    })).rejects.toThrow(/pas actif/);
  });
});
