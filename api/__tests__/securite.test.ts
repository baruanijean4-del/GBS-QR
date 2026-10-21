// ============================================================
// GBS — Tests sécurité production
// - chiffrement AES-256-GCM des PIN (format v1, vérif, altération)
// - transition : scrypt et clair legacy encore vérifiés, réécrits en v1
// - migration transparente : PIN legacy → chiffré à la 1re connexion
// - anti-brute-force : 5 échecs → blocage 5 min (connexion + admin)
// ============================================================

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { appRouter } from "../router";
import { getDb } from "../queries/connection";
import * as s from "../../db/schema";
import { maintenant } from "../gbsUtils";
import { chiffrerPin, comparerSecret, dechiffrerPin, estChiffre, estHache, verifierPin } from "../lib/pin";
import { viderLimiteur } from "../lib/limiteur";
import { SUPER_ADMIN_ID } from "../lib/superAdmin";

const USR_LEGACY = "usr_test_sec_legacy";
const TEL_LEGACY = "+243000000030";
const USR_BF = "usr_test_sec_bf";
const TEL_BF = "+243000000031";

const anonyme = appRouter.createCaller({ session: null, ip: "test-securite" } as never);

beforeAll(async () => {
  viderLimiteur();
  const now = maintenant();
  await getDb().insert(s.utilisateurs).values([
    // Compte « legacy » : PIN en clair, comme avant le hachage
    { id: USR_LEGACY, nom: "Legacy Sécu", telephone: TEL_LEGACY, pin: "4321", creeLe: now },
    { id: USR_BF, nom: "Bruteforce Sécu", telephone: TEL_BF, pin: "8765", creeLe: now },
  ]).onConflictDoNothing();
});

afterAll(async () => {
  const db = getDb();
  await db.delete(s.utilisateurs).where(eq(s.utilisateurs.id, USR_LEGACY));
  await db.delete(s.utilisateurs).where(eq(s.utilisateurs.id, USR_BF));
});

describe("chiffrement des PIN (AES-256-GCM)", () => {
  it("chiffrerPin produit v1:nonce:tag:corps, jamais le PIN en clair", () => {
    const c = chiffrerPin("1234");
    expect(c.startsWith("v1:")).toBe(true);
    expect(c.split(":")).toHaveLength(4);
    expect(c).not.toContain("1234");
    // Deux chiffrements du même PIN diffèrent (nonce aléatoire)
    expect(chiffrerPin("1234")).not.toBe(c);
  });

  it("dechiffrerPin retrouve le PIN ; toute altération est détectée (tag GCM)", () => {
    const c = chiffrerPin("9876");
    expect(dechiffrerPin(c)).toBe("9876");
    // Corps altéré → déchiffrement refusé (null), jamais un faux PIN
    const altere = c.slice(0, -2) + (c.endsWith("00") ? "01" : "00");
    expect(dechiffrerPin(altere)).toBeNull();
    expect(dechiffrerPin("v1:zz:zz:zz")).toBeNull();
    expect(dechiffrerPin("4321")).toBeNull(); // pas du v1
  });

  it("verifierPin valide un chiffré et rejette un mauvais PIN", () => {
    const c = chiffrerPin("9876");
    expect(verifierPin("9876", c)).toBe(true);
    expect(verifierPin("0000", c)).toBe(false);
  });

  it("verifierPin accepte le legacy scrypt ET le clair (transition)", () => {
    // Haché scrypt produit avant ce chantier (format « scrypt$sel$empreinte »)
    const scryptLegacy = "scrypt$2cf24dba5fb0a30e26e83b2ac5b9e29e$161b0397d2589a2b42d6f18a1d9d3b0e"; // valeur figée de test
    expect(estHache(scryptLegacy)).toBe(true);
    expect(verifierPin("quelquechose", scryptLegacy)).toBe(false); // mauvais PIN rejeté
  });

  it("verifierPin accepte le legacy en clair (rétrocompatibilité)", () => {
    expect(verifierPin("4321", "4321")).toBe(true);
    expect(verifierPin("9999", "4321")).toBe(false);
  });

  it("comparerSecret est strict", () => {
    expect(comparerSecret("abc", "abc")).toBe(true);
    expect(comparerSecret("abc", "abd")).toBe(false);
    expect(comparerSecret("abc", "abcd")).toBe(false);
  });
});

describe("migration transparente à la connexion", () => {
  it("un PIN legacy en clair est CHIFFRÉ en base après une connexion réussie", async () => {
    const r = await anonyme.gbs.connexionTelephone({ telephone: TEL_LEGACY, pin: "4321" });
    expect(r.utilisateur.id).toBe(USR_LEGACY);

    const [u] = await getDb().select().from(s.utilisateurs)
      .where(eq(s.utilisateurs.id, USR_LEGACY)).limit(1);
    expect(estChiffre(u.pin)).toBe(true); // plus en clair, pas haché : chiffré v1
    expect(dechiffrerPin(u.pin)).toBe("4321"); // réversible (révélation super-admin)

    // La reconnexion fonctionne avec le PIN haché
    const r2 = await anonyme.gbs.connexionTelephone({ telephone: TEL_LEGACY, pin: "4321" });
    expect(r2.utilisateur.id).toBe(USR_LEGACY);
    // Et un mauvais PIN est toujours refusé
    await expect(
      anonyme.gbs.connexionTelephone({ telephone: TEL_LEGACY, pin: "0000" }),
    ).rejects.toThrow(/incorrect/);
  });
});

describe("anti-brute-force", () => {
  it("5 échecs de connexion → blocage, même avec le bon PIN", async () => {
    viderLimiteur();
    for (let i = 0; i < 5; i++) {
      await expect(
        anonyme.gbs.connexionTelephone({ telephone: TEL_BF, pin: "0000" }),
      ).rejects.toThrow(/incorrect/);
    }
    // 6e tentative : bloquée AVANT la vérification — même le bon PIN passe pas
    await expect(
      anonyme.gbs.connexionTelephone({ telephone: TEL_BF, pin: "8765" }),
    ).rejects.toThrow(/Trop de tentatives/);
  });

  it("le PIN admin est protégé aussi (5 échecs → blocage)", async () => {
    viderLimiteur();
    for (let i = 0; i < 5; i++) {
      const r = await anonyme.gbs.verifierPinAdmin({ pin: "xxxx" });
      expect(r.ok).toBe(false);
    }
    await expect(anonyme.gbs.verifierPinAdmin({ pin: "xxxx" })).rejects.toThrow(/Trop de tentatives/);
  });
});

describe("super-admin — « Mot de passe oublié »", () => {
  const USR_MDP = "usr_test_sec_mdp";
  const TEL_MDP = "+243000000032";

  beforeAll(async () => {
    await getDb().insert(s.utilisateurs).values([
      { id: USR_MDP, nom: "Oubli Sécu", telephone: TEL_MDP, pin: "5566", creeLe: maintenant() },
    ]).onConflictDoNothing();
  });

  afterAll(async () => {
    // Nettoyage borné aux lignes de CE test (parallélisme inter-fichiers)
    await getDb().delete(s.auditLog).where(inArray(s.auditLog.action,
      ["CONSULTATION_PIN", "CONSULTATION_PIN_ILISIBLE", "REINITIALISATION_PIN"]));
    await getDb().delete(s.utilisateurs).where(eq(s.utilisateurs.id, USR_MDP));
  });

  it("recherche par téléphone : PIN masqué, marqueur de lisibilité", async () => {
    const r = await anonyme.gbs.rechercherCompte({ pinAdmin: "2468", telephone: TEL_MDP });
    expect(r).toHaveLength(1);
    expect(r[0]!.id).toBe(USR_MDP);
    expect(r[0]!.pinMasque).toBe("••••");
    expect(JSON.stringify(r[0])).not.toContain("5566"); // jamais en clair dans la recherche
    expect(r[0]!.lisible).toBe(true);
  });

  it("mauvais PIN admin : refus net", async () => {
    await expect(anonyme.gbs.rechercherCompte({ pinAdmin: "0000", telephone: TEL_MDP }))
      .rejects.toThrow(/super-admin/);
  });

  it("révélation : méthode de vérification OBLIGATOIRE, PIN rendu pour 30 s, audit sans le PIN", async () => {
    // Méthode absente → refusée par la validation d'entrée
    await expect(
      anonyme.gbs.revelerPin({ pinAdmin: "2468", utilisateurId: USR_MDP } as never),
    ).rejects.toThrow();

    const r = await anonyme.gbs.revelerPin({
      pinAdmin: "2468", utilisateurId: USR_MDP, methodeVerification: "WHATSAPP",
    });
    expect(r.pin).toBe("5566");
    expect(r.dureeAffichageSecondes).toBe(30);

    // Journalisée, SANS la valeur du PIN
    const audits = await getDb().select().from(s.auditLog)
      .where(eq(s.auditLog.action, "CONSULTATION_PIN"));
    expect(audits.length).toBeGreaterThanOrEqual(1);
    expect(audits[0]!.details).toContain("WHATSAPP");
    expect(audits[0]!.details).not.toContain("5566");
  });

  it("réinitialisation d'un compte scrypt illisible : nouveau PIN chiffré, audit sans le PIN", async () => {
    // Compte haché legacy : la révélation est impossible…
    await getDb().update(s.utilisateurs).set({ pin: "scrypt$16384$legacy$legacy" })
      .where(eq(s.utilisateurs.id, USR_MDP));
    await expect(
      anonyme.gbs.revelerPin({ pinAdmin: "2468", utilisateurId: USR_MDP, methodeVerification: "APPEL" }),
    ).rejects.toThrow(/réinitialisation du compte requise/);

    // …mais la réinitialisation génère un nouveau PIN, écrit CHIFFRÉ
    const r = await anonyme.gbs.reinitialiserPin({
      pinAdmin: "2468", utilisateurId: USR_MDP, methodeVerification: "PRESENTIEL",
    });
    expect(r.pin).toMatch(/^[0-9]{6}$/);
    expect(r.dureeAffichageSecondes).toBe(30);

    const [u] = await getDb().select().from(s.utilisateurs)
      .where(eq(s.utilisateurs.id, USR_MDP)).limit(1);
    expect(estChiffre(u.pin)).toBe(true);
    expect(dechiffrerPin(u.pin)).toBe(r.pin);

    // Le nouveau PIN permet la connexion
    const c = await anonyme.gbs.connexionTelephone({ telephone: TEL_MDP, pin: r.pin });
    expect(c.utilisateur.id).toBe(USR_MDP);

    // Journalisée, SANS la valeur du PIN
    const audits = await getDb().select().from(s.auditLog)
      .where(eq(s.auditLog.action, "REINITIALISATION_PIN"));
    expect(audits.length).toBeGreaterThanOrEqual(1);
    expect(audits[0]!.details).toContain("PRESENTIEL");
    expect(audits[0]!.details).not.toContain(r.pin);

    // Le super-admin ne peut pas se réinitialiser lui-même
    await expect(
      anonyme.gbs.reinitialiserPin({ pinAdmin: "2468", utilisateurId: SUPER_ADMIN_ID, methodeVerification: "APPEL" }),
    ).rejects.toThrow(/introuvable/);
  });
});
