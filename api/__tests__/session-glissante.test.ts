// ============================================================
// GBS — Tests session glissante (migration 0017) : ouverture
// d'une session par appareil, glissement de l'expiration,
// révocation par appareil (soi-même / propriétaire), plafond
// absolu, endpoints mesAppareils / deconnexion / revoquerAppareil.
// Fixtures préfixées test_sess.
// ============================================================

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { TRPCError } from "@trpc/server";
import { eq, like } from "drizzle-orm";
import { appRouter } from "../router";
import { createContext } from "../context";
import {
  creerJeton,
  ouvrirSessionAppareil,
  revoquerSessionAppareil,
  verifierJeton,
  verifierSessionActive,
} from "../lib/session";
import { env } from "../lib/env";
import { getDb } from "../queries/connection";
import * as s from "../../db/schema";
import { maintenant } from "../gbsUtils";

const USR_PROP = "usr_test_sess_prop";
const USR_MEMBRE = "usr_test_sess_membre";
const ORG = "org_test_sess";
const ETAB = "etab_test_sess";

async function nettoyer() {
  const db = getDb();
  await db.delete(s.sessionsAppareils).where(like(s.sessionsAppareils.utilisateurId, "usr_test_sess%"));
  await db.delete(s.auditLog).where(like(s.auditLog.details, "%test_sess%"));
  await db.delete(s.affectations).where(eq(s.affectations.terrasseId, ETAB));
  await db.delete(s.terrasses).where(eq(s.terrasses.id, ETAB));
  await db.delete(s.organisations).where(eq(s.organisations.id, ORG));
  await db.delete(s.utilisateurs).where(like(s.utilisateurs.id, "usr_test_sess%"));
}

beforeAll(async () => {
  await nettoyer(); // au cas où un run précédent aurait laissé des restes
  const db = getDb();
  const now = maintenant();
  await db.insert(s.utilisateurs).values([
    { id: USR_PROP, nom: "Patrice TestSess", telephone: "+243990000071", pin: "7777", creeLe: now },
    { id: USR_MEMBRE, nom: "Mélanie TestSess", telephone: "+243990000072", pin: "8888", creeLe: now },
  ]);
  await db.insert(s.organisations).values({ id: ORG, nom: "Org TestSess", proprietaireId: USR_PROP, creeLe: now });
  await db.insert(s.terrasses).values({
    id: ETAB, organisationId: ORG, nom: "Terrasse TestSess", adresse: "Av. des Sessions",
    typeEtablissement: "TERRASSE", seuilEcartCdf: 5000, seuilEcartUsd: 200, tauxUsdCdf: 2740, creeLe: now,
  });
  await db.insert(s.affectations).values({
    id: "aff_test_sess_1", utilisateurId: USR_MEMBRE, terrasseId: ETAB, role: "SERVEUSE", actif: true, creeLe: now,
  });
});

afterAll(nettoyer);

// ---------- Brique lib : ouverture, glissement, révocation ----------

describe("session glissante — brique lib/session", () => {
  it("ouvrirSessionAppareil crée la ligne et signe un jeton avec sid", async () => {
    const jeton = await ouvrirSessionAppareil(USR_PROP, "appareil-test-1");
    const payload = verifierJeton(jeton);
    expect(payload).not.toBeNull();
    expect(payload!.utilisateurId).toBe(USR_PROP);
    expect(payload!.sid).toMatch(/^ses_/);
    const [ligne] = await getDb().select().from(s.sessionsAppareils)
      .where(eq(s.sessionsAppareils.id, payload!.sid!)).limit(1);
    expect(ligne).toBeTruthy();
    expect(ligne.appareilId).toBe("appareil-test-1");
    expect(ligne.revoqueLe).toBeNull();
    expect(new Date(ligne.expireAbsoluLe).getTime()).toBeGreaterThan(Date.now());
  });

  it("verifierSessionActive accepte une session fraîche sans la prolonger", async () => {
    const jeton = await ouvrirSessionAppareil(USR_PROP, "appareil-test-2");
    const v = await verifierSessionActive(jeton);
    expect(v).not.toBeNull();
    // Jeton émis à l'instant : loin du seuil de prolongation → pas de nouveau jeton
    expect(v!.nouveauJeton).toBeNull();
  });

  it("un jeton ancien format (sans sid) reste accepté, sans lecture base", async () => {
    const v = await verifierSessionActive(creerJeton(USR_PROP));
    expect(v).not.toBeNull();
    expect(v!.payload.utilisateurId).toBe(USR_PROP);
    expect(v!.nouveauJeton).toBeNull();
  });

  it("glissement : un jeton en fin de fenêtre est prolongé (même sid, même iat)", async () => {
    if (!env.sessionGlissante) return; // mode fixe : pas de glissement
    const jeton = await ouvrirSessionAppareil(USR_PROP, "appareil-test-3");
    const original = verifierJeton(jeton)!;
    // On refabrique un jeton proche de l'expiration (même sid, même iat)
    const presqueExpiré = creerJeton(USR_PROP, 3600, original.sid, original.iat);
    const v = await verifierSessionActive(presqueExpiré);
    expect(v).not.toBeNull();
    expect(v!.nouveauJeton).not.toBeNull();
    const prolonge = verifierJeton(v!.nouveauJeton)!;
    expect(prolonge.sid).toBe(original.sid);
    expect(prolonge.iat).toBe(original.iat); // émission originale conservée
    expect(prolonge.exp).toBeGreaterThan(original.iat + 3600);
  });

  it("révocation : la session révoquée est refusée dès la requête suivante", async () => {
    const jeton = await ouvrirSessionAppareil(USR_PROP, "appareil-test-4");
    const sid = verifierJeton(jeton)!.sid!;
    await revoquerSessionAppareil(sid);
    expect(await verifierSessionActive(jeton)).toBeNull();
  });

  it("plafond absolu dépassé : refus même avec un jeton frais", async () => {
    const jeton = await ouvrirSessionAppareil(USR_PROP, "appareil-test-5");
    const sid = verifierJeton(jeton)!.sid!;
    await getDb().update(s.sessionsAppareils)
      .set({ expireAbsoluLe: new Date(Date.now() - 1000).toISOString() })
      .where(eq(s.sessionsAppareils.id, sid));
    expect(await verifierSessionActive(jeton)).toBeNull();
  });

  it("le contexte pose X-Session-Renouvelee quand le jeton glisse", async () => {
    if (!env.sessionGlissante) return;
    const jeton = await ouvrirSessionAppareil(USR_PROP, "appareil-test-6");
    const original = verifierJeton(jeton)!;
    const presqueExpiré = creerJeton(USR_PROP, 3600, original.sid, original.iat);
    const resHeaders = new Headers();
    const ctx = await createContext({
      req: new Request("http://test.local/api/trpc", {
        headers: { authorization: `Bearer ${presqueExpiré}` },
      }),
      resHeaders,
    } as never);
    expect(ctx.session?.utilisateurId).toBe(USR_PROP);
    expect(ctx.session?.sid).toBe(original.sid);
    const renouvele = resHeaders.get("x-session-renouvelee");
    expect(renouvele).toBeTruthy();
    expect(verifierJeton(renouvele)!.sid).toBe(original.sid);
  });
});

// ---------- Endpoints : connexion, mesAppareils, révocation ----------

describe("session glissante — endpoints", () => {
  const anonyme = appRouter.createCaller({ session: null, ip: "test_sess" } as never);

  it("connexionTelephone avec appareilId ouvre une ligne sessions_appareils", async () => {
    if (!env.sessionGlissante) return;
    const r = await anonyme.gbs.connexionTelephone({
      telephone: "+243 990 000 071", pin: "7777", appareilId: "appareil-endpoint-1",
    });
    expect(r.ok).toBe(true);
    const payload = verifierJeton(r.jeton)!;
    expect(payload.sid).toMatch(/^ses_/);
    const [ligne] = await getDb().select().from(s.sessionsAppareils)
      .where(eq(s.sessionsAppareils.id, payload.sid!)).limit(1);
    expect(ligne.appareilId).toBe("appareil-endpoint-1");
  });

  it("mesAppareils liste les sessions actives et repère l'appareil courant", async () => {
    const jetonA = await ouvrirSessionAppareil(USR_PROP, "appareil-A");
    const jetonB = await ouvrirSessionAppareil(USR_PROP, "appareil-B");
    const sidA = verifierJeton(jetonA)!.sid!;
    const sidB = verifierJeton(jetonB)!.sid!;
    const appelant = appRouter.createCaller({ session: { utilisateurId: USR_PROP, sid: sidB } } as never);
    const liste = await appelant.gbs.mesAppareils();
    const ids = liste.map((a) => a.sessionId);
    expect(ids).toContain(sidA);
    expect(ids).toContain(sidB);
    expect(liste.find((a) => a.sessionId === sidB)?.courant).toBe(true);
    expect(liste.find((a) => a.sessionId === sidA)?.courant).toBe(false);
  });

  it("deconnexion révoque la session courante, pas les autres", async () => {
    const jetonA = await ouvrirSessionAppareil(USR_PROP, "appareil-C");
    const jetonB = await ouvrirSessionAppareil(USR_PROP, "appareil-D");
    const sidA = verifierJeton(jetonA)!.sid!;
    const appelant = appRouter.createCaller({ session: { utilisateurId: USR_PROP, sid: sidA } } as never);
    await appelant.gbs.deconnexion();
    expect(await verifierSessionActive(jetonA)).toBeNull(); // révoquée
    expect(await verifierSessionActive(jetonB)).not.toBeNull(); // intacte
  });

  it("revoquerAppareil : un tiers sans lien est refusé (FORBIDDEN)", async () => {
    const jetonMembre = await ouvrirSessionAppareil(USR_MEMBRE, "appareil-membre-1");
    const sidMembre = verifierJeton(jetonMembre)!.sid!;
    const tiers = appRouter.createCaller({ session: { utilisateurId: "usr_inexistant" } } as never);
    await expect(tiers.gbs.revoquerAppareil({ sessionId: sidMembre })).rejects.toSatisfy(
      (e) => e instanceof TRPCError && e.code === "FORBIDDEN",
    );
  });

  it("revoquerAppareil : le propriétaire déconnecte l'appareil d'un membre", async () => {
    const jetonMembre = await ouvrirSessionAppareil(USR_MEMBRE, "appareil-membre-2");
    const sidMembre = verifierJeton(jetonMembre)!.sid!;
    const proprio = appRouter.createCaller({ session: { utilisateurId: USR_PROP } } as never);
    const r = await proprio.gbs.revoquerAppareil({ sessionId: sidMembre });
    expect(r.ok).toBe(true);
    expect(await verifierSessionActive(jetonMembre)).toBeNull();
  });

  it("revoquerAppareil : session inconnue → erreur métier", async () => {
    const proprio = appRouter.createCaller({ session: { utilisateurId: USR_PROP } } as never);
    await expect(proprio.gbs.revoquerAppareil({ sessionId: "ses_inconnu" })).rejects.toThrow(/introuvable/);
  });

  it("mesAppareils sans session → 401", async () => {
    const sans = appRouter.createCaller({ session: null } as never);
    await expect(sans.gbs.mesAppareils()).rejects.toSatisfy(
      (e) => e instanceof TRPCError && e.code === "UNAUTHORIZED",
    );
  });
});
