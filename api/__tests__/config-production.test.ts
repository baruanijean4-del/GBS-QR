// ============================================================
// GBS — Garde-fou production (boucles 8 + 10) : ADMIN_PIN,
// SESSION_SECRET et PIN_ENC_KEY obligatoires, annuaire démo interdit.
// Fonction pure testée directement (env.ts l'appelle au démarrage
// quand NODE_ENV=production — non testé ici car fige le processus).
// ============================================================

import { describe, expect, it } from "vitest";
import { verifierConfigProduction } from "../lib/configProduction";

const BASE = {
  adminPin: "MotDePasseFort2026",
  sessionSecret: "s".repeat(64),
  annuaireDemo: "",
  pinEncKey: "a".repeat(64), // 32 octets hexadécimaux
};

describe("verifierConfigProduction — durcissement boucle 8", () => {
  it("configuration complète et forte : acceptée", () => {
    expect(() => verifierConfigProduction(BASE)).not.toThrow();
  });

  it("ADMIN_PIN absent : démarrage refusé", () => {
    expect(() => verifierConfigProduction({ ...BASE, adminPin: "" }))
      .toThrow(/ADMIN_PIN est obligatoire/);
  });

  it("ADMIN_PIN trop court ou défaut « 2468 » : démarrage refusé", () => {
    expect(() => verifierConfigProduction({ ...BASE, adminPin: "1234" }))
      .toThrow(/8\+ caractères/);
    expect(() => verifierConfigProduction({ ...BASE, adminPin: "2468" }))
      .toThrow(/8\+ caractères/);
  });

  it("SESSION_SECRET absent ou faible : démarrage refusé", () => {
    expect(() => verifierConfigProduction({ ...BASE, sessionSecret: "" }))
      .toThrow(/SESSION_SECRET est obligatoire/);
    expect(() => verifierConfigProduction({ ...BASE, sessionSecret: "trop-court" }))
      .toThrow(/SESSION_SECRET est obligatoire/);
  });

  it("PIN_ENC_KEY absente, invalide ou égale à SESSION_SECRET : démarrage refusé", () => {
    expect(() => verifierConfigProduction({ ...BASE, pinEncKey: "" }))
      .toThrow(/PIN_ENC_KEY est obligatoire/);
    expect(() => verifierConfigProduction({ ...BASE, pinEncKey: "trop-courte" }))
      .toThrow(/PIN_ENC_KEY est obligatoire/);
    expect(() => verifierConfigProduction({ ...BASE, pinEncKey: "z".repeat(64) }))
      .toThrow(/PIN_ENC_KEY est obligatoire/); // pas de l'hexadécimal
    // Hexadécimal valide mais identique à SESSION_SECRET : refusé
    expect(() => verifierConfigProduction({ ...BASE, sessionSecret: "a".repeat(64), pinEncKey: "a".repeat(64) }))
      .toThrow(/DISTINCTE de SESSION_SECRET/);
  });

  it("ANNUAIRE_DEMO=true en production : démarrage refusé", () => {
    expect(() => verifierConfigProduction({ ...BASE, annuaireDemo: "true" }))
      .toThrow(/ANNUAIRE_DEMO est interdit/);
  });
});
