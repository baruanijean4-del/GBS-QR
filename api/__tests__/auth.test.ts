// ============================================================
// GBS — Tests H.1 : authentification par sessions signées
// Jeton HMAC (création/vérification/expiration/falsification),
// extraction du Bearer, garde 401 sur les procédures staff,
// et acteurId d'entrée ignoré par les schémas.
// ============================================================

import { describe, expect, it, afterAll, beforeAll } from "vitest";
import { TRPCError } from "@trpc/server";
import { eq } from "drizzle-orm";
import { appRouter } from "../router";
import { createContext } from "../context";
import { creerJeton, jetonDepuisEntete, verifierJeton } from "../lib/session";
import { SUPER_ADMIN_ID } from "../lib/superAdmin";
import { chiffrerPin, dechiffrerPin, estChiffre } from "../lib/pin";
import { env } from "../lib/env";
import { getDb } from "../queries/connection";
import * as s from "../../db/schema";
import { maintenant } from "../gbsUtils";

// ---------- Jeton HMAC : création / vérification ----------

describe("session — jetons HMAC", () => {
  it("créer puis vérifier un jeton retourne le même utilisateurId", () => {
    const jeton = creerJeton("usr_abc");
    const payload = verifierJeton(jeton);
    expect(payload).not.toBeNull();
    expect(payload!.utilisateurId).toBe("usr_abc");
    expect(payload!.exp).toBeGreaterThan(payload!.iat);
  });

  it("un jeton falsifié (payload modifié) est rejeté", () => {
    const jeton = creerJeton("usr_abc");
    const [h, , sig] = jeton.split(".");
    // L'attaquant réécrit le payload mais ne peut pas recalculer la signature
    const fauxPayload = Buffer.from(
      JSON.stringify({ utilisateurId: "usr_pirate", iat: 1, exp: 9_999_999_999 }),
    ).toString("base64url");
    expect(verifierJeton(`${h}.${fauxPayload}.${sig}`)).toBeNull();
  });

  it("un jeton falsifié (signature modifiée) est rejeté", () => {
    const jeton = creerJeton("usr_abc");
    const falsifie = jeton.slice(0, -2) + (jeton.endsWith("AA") ? "BB" : "AA");
    expect(verifierJeton(falsifie)).toBeNull();
  });

  it("un jeton expiré est rejeté", () => {
    const jeton = creerJeton("usr_abc", -3600); // expiré depuis 1 h
    expect(verifierJeton(jeton)).toBeNull();
  });

  it("des entrées malformées retournent null, jamais d'exception", () => {
    expect(verifierJeton("")).toBeNull();
    expect(verifierJeton(null)).toBeNull();
    expect(verifierJeton(undefined)).toBeNull();
    expect(verifierJeton("pas.un.jeton")).toBeNull();
    expect(verifierJeton("a.b.c.d")).toBeNull();
  });

  it("jetonDepuisEntete extrait le Bearer, refuse le reste", () => {
    const jeton = creerJeton("usr_abc");
    expect(jetonDepuisEntete(`Bearer ${jeton}`)).toBe(jeton);
    expect(jetonDepuisEntete(`Bearer ${jeton} `)).toBe(jeton);
    expect(jetonDepuisEntete(undefined)).toBeNull();
    expect(jetonDepuisEntete("")).toBeNull();
    expect(jetonDepuisEntete("Basic dXNlcjpwYXNz")).toBeNull();
    expect(jetonDepuisEntete("Bearer ")).toBeNull();
  });
});

// ---------- Contexte : le Bearer pilote ctx.session ----------

async function contexteAvec(autorisation?: string) {
  return createContext({
    req: new Request("http://test.local/api/trpc", {
      headers: autorisation ? { authorization: autorisation } : {},
    }),
    resHeaders: new Headers(),
  } as never);
}

describe("session — contexte tRPC", () => {
  it("sans en-tête Authorization → pas de session", async () => {
    const ctx = await contexteAvec();
    expect(ctx.session).toBeNull();
  });

  it("jeton valide → session peuplée du bon utilisateurId", async () => {
    const ctx = await contexteAvec(`Bearer ${creerJeton("usr_marie")}`);
    expect(ctx.session).toEqual({ utilisateurId: "usr_marie" });
  });

  it("jeton expiré → pas de session", async () => {
    const ctx = await contexteAvec(`Bearer ${creerJeton("usr_marie", -3600)}`);
    expect(ctx.session).toBeNull();
  });

  it("jeton falsifié → pas de session", async () => {
    const jeton = creerJeton("usr_marie");
    const ctx = await contexteAvec(`Bearer ${jeton.slice(0, -2)}zz`);
    expect(ctx.session).toBeNull();
  });
});

// ---------- Routeur : garde 401 sur les procédures protégées ----------

const estNonAutorise = (e: unknown) =>
  e instanceof TRPCError && e.code === "UNAUTHORIZED";

describe("session — garde des procédures protégées", () => {
  it("mutation staff SANS jeton → 401", async () => {
    const anonyme = appRouter.createCaller({} as never);
    await expect(anonyme.gbs.marquerPayee({ commandeId: "cmd_x" })).rejects.toSatisfy(estNonAutorise);
    await expect(anonyme.gbs.ouvrirSessionService({ terrasseId: "etab_x" })).rejects.toSatisfy(estNonAutorise);
    await expect(anonyme.etablissements.lister({})).rejects.toSatisfy(estNonAutorise);
  });

  it("snapshot staff SANS jeton → 401", async () => {
    const anonyme = appRouter.createCaller({} as never);
    await expect(anonyme.gbs.snapshot({ portee: { kind: "staff" } })).rejects.toSatisfy(estNonAutorise);
  });

  it("avec un jeton valide, le middleware laisse passer (l'échec suivant est métier, pas 401)", async () => {
    // Session valide d'un utilisateur sans accès : la garde 401 est franchie,
    // le refus vient du contrôle d'accès métier (403 / « accès »), jamais UNAUTHORIZED.
    const inconnu = appRouter.createCaller({ session: { utilisateurId: "usr_inexistant" } } as never);
    await expect(inconnu.gbs.marquerPayee({ commandeId: "cmd_x" })).rejects.toSatisfy(
      (e) => e instanceof TRPCError && e.code !== "UNAUTHORIZED",
    );
  });

  it("un acteurId glissé dans l'entrée est ignoré (le serveur ne s'en sert pas)", async () => {
    // Utilisateur sans aucune affectation → liste vide, sans erreur :
    // l'acteurId « usr_quelconque » de l'entrée n'a PAS été pris en compte
    // (sinon la requête aurait porté sur un autre utilisateur ou planté en validation).
    const appelant = appRouter.createCaller({ session: { utilisateurId: "usr_inexistant" } } as never);
    const r = await appelant.etablissements.lister({ acteurId: "usr_quelconque" } as never);
    expect(r).toEqual([]);
  });

  it("les procédures publiques restent accessibles sans jeton", async () => {
    // Le point d'entrée client (menu QR) ne doit jamais exiger de session staff.
    const anonyme = appRouter.createCaller({} as never);
    // Token inconnu → erreur métier, mais pas 401 (la procédure est publique).
    await expect(anonyme.gbs.contexteTable({ token: "tok_inexistant" })).rejects.toSatisfy(
      (e) => e instanceof TRPCError && e.code !== "UNAUTHORIZED",
    );
  });
});

// ---------- Entrée unique : téléphone + PIN ----------

describe("connexionTelephone — entrée unique de connexion", () => {
  const USR = "usr_test_auth_tel";
  const ORG = "org_test_auth_tel";
  const ETAB = "etab_test_auth_tel";
  const anonyme = appRouter.createCaller({} as never);

  beforeAll(async () => {
    const db = getDb();
    const now = maintenant();
    await db.insert(s.utilisateurs).values({
      id: USR, nom: "Gertrude TestAuth", telephone: "+243990000099", pin: "7777", creeLe: now,
    }).onConflictDoNothing();
    await db.insert(s.organisations).values({
      id: ORG, nom: "Org TestAuth", proprietaireId: USR, creeLe: now,
    }).onConflictDoNothing();
    await db.insert(s.terrasses).values({
      id: ETAB, organisationId: ORG, nom: "Terrasse TestAuth", adresse: "Av. des Tests",
      typeEtablissement: "TERRASSE", seuilEcartCdf: 5000, seuilEcartUsd: 200, tauxUsdCdf: 2740, creeLe: now,
    }).onConflictDoNothing();
    await db.insert(s.affectations).values({
      id: "aff_test_auth_tel", utilisateurId: USR, terrasseId: ETAB, role: "GERANT", actif: true, creeLe: now,
    }).onConflictDoNothing();
  });

  afterAll(async () => {
    const db = getDb();
    await db.delete(s.affectations).where(eq(s.affectations.terrasseId, ETAB));
    await db.delete(s.terrasses).where(eq(s.terrasses.id, ETAB));
    await db.delete(s.organisations).where(eq(s.organisations.id, ORG));
    await db.delete(s.utilisateurs).where(eq(s.utilisateurs.id, USR));
  });

  it("numéro international + PIN → jeton, rôles et terrasses", async () => {
    const r = await anonyme.gbs.connexionTelephone({ telephone: "+243 990 000 099", pin: "7777" });
    expect(r.ok).toBe(true);
    expect(r.utilisateur.id).toBe(USR);
    expect(verifierJeton(r.jeton)?.utilisateurId).toBe(USR);
    // PROPRIETAIRE (organisation) + GERANT (affectation)
    expect(r.roles).toContain("PROPRIETAIRE");
    expect(r.roles).toContain("GERANT");
    expect(r.terrasses.some((t) => t.id === ETAB)).toBe(true);
  });

  it("le format local « 0990 000 099 » mène au même compte", async () => {
    const r = await anonyme.gbs.connexionTelephone({ telephone: "0990 000 099", pin: "7777" });
    expect(r.utilisateur.id).toBe(USR);
  });

  it("mauvais PIN → erreur ambiguë", async () => {
    await expect(
      anonyme.gbs.connexionTelephone({ telephone: "+243990000099", pin: "0000" }),
    ).rejects.toThrow(/incorrect/);
  });

  it("numéro inconnu → MÊME erreur ambiguë (pas d'oracle)", async () => {
    await expect(
      anonyme.gbs.connexionTelephone({ telephone: "+243000000000", pin: "7777" }),
    ).rejects.toThrow(/incorrect/);
  });
});

// ---------- Super-admin : connexion par la porte unique ----------

describe("connexionTelephone — super-admin plateforme", () => {
  // Le compte technique est créé par assurerSuperAdmin() lors de la
  // 1re connexion (n'importe quel environnement, même production).
  const anonyme = appRouter.createCaller({} as never);

  afterAll(async () => {
    const db = getDb();
    await db.delete(s.utilisateurs).where(eq(s.utilisateurs.id, SUPER_ADMIN_ID));
  });

  it("téléphone + PIN admin → rôle SUPER_ADMIN, aucune terrasse", async () => {
    const r = await anonyme.gbs.connexionTelephone({
      telephone: env.adminTelephone,
      pin: env.adminPin,
    });
    expect(r.ok).toBe(true);
    expect(r.utilisateur.id).toBe(SUPER_ADMIN_ID);
    expect(r.roles).toEqual(["SUPER_ADMIN"]);
    expect(r.terrasses).toEqual([]);
    expect(verifierJeton(r.jeton)?.utilisateurId).toBe(SUPER_ADMIN_ID);
  });

  it("le PIN du super-admin est stocké CHIFFRÉ en base (AES-256-GCM, jamais en clair)", async () => {
    // Décision 3.2 : le PIN admin est chiffré (format v1:nonce:tag:corps),
    // déchiffrable vers ADMIN_PIN, et il SURVIT chiffré à une connexion
    // réussie (assurerSuperAdmin ne le réécrit pas s'il est conforme).
    await anonyme.gbs.connexionTelephone({
      telephone: env.adminTelephone,
      pin: env.adminPin,
    });
    const [u] = await getDb().select().from(s.utilisateurs)
      .where(eq(s.utilisateurs.id, SUPER_ADMIN_ID)).limit(1);
    expect(u.pin).not.toBe(env.adminPin); // jamais en clair
    expect(estChiffre(u.pin)).toBe(true); // format v1:nonce:tag:corps
    expect(dechiffrerPin(u.pin)).toBe(env.adminPin); // déchiffrable
  });

  it("mauvais PIN admin → même erreur ambiguë qu'un compte inconnu", async () => {
    await expect(
      anonyme.gbs.connexionTelephone({ telephone: env.adminTelephone, pin: "000000" }),
    ).rejects.toThrow(/incorrect/);
  });

  it("le super-admin n'apparaît JAMAIS dans l'annuaire démo", async () => {
    const a = await anonyme.gbs.annuaire();
    expect(a.some((u) => u.id === SUPER_ADMIN_ID)).toBe(false);
  });

  it("collision de numéro : le PIN départage super-admin et commerçant", async () => {
    // Régression (audit) : un commerçant inscrit avec le numéro technique
    // admin (défaut public) rendait la connexion plateforme aléatoire
    // (LIMIT 1 sans ordre). Désormais le PIN — le secret — départage.
    const db = getDb();
    await db.insert(s.utilisateurs).values({
      id: "usr_test_collision_admin", nom: "Commerçant Collision",
      telephone: env.adminTelephone, pin: chiffrerPin("9999"), creeLe: maintenant(),
    }).onConflictDoNothing();
    try {
      const rAdmin = await anonyme.gbs.connexionTelephone({
        telephone: env.adminTelephone, pin: env.adminPin,
      });
      expect(rAdmin.utilisateur.id).toBe(SUPER_ADMIN_ID);
      const rCommercant = await anonyme.gbs.connexionTelephone({
        telephone: env.adminTelephone, pin: "9999",
      });
      expect(rCommercant.utilisateur.id).toBe("usr_test_collision_admin");
    } finally {
      await db.delete(s.utilisateurs).where(eq(s.utilisateurs.id, "usr_test_collision_admin"));
    }
  });

  it("inscription avec le numéro technique admin : refusée (réservé)", async () => {
    await expect(anonyme.gbs.finaliserInscription({
      nom: "Intrus Collision", telephone: env.adminTelephone, pin: "1234",
      nomTerrasse: "Chez Intrus Collision", adresse: "",
      nombreTables: 2, aussiGerant: false,
      typeEtablissement: "TERRASSE", typesSecondaires: [],
    })).rejects.toThrow(/réservé/);
  });
});
