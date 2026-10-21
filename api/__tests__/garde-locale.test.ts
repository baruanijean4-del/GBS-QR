// ============================================================
// GBS — Garde-fou copie locale (essai local avant production) :
// hors production et hors tests, une DATABASE_URL vers neon.tech
// doit REFUSER le démarrage. Fonction pure, sans base.
// ============================================================

import { describe, expect, it } from "vitest";
import { verifierBaseLocale } from "../lib/gardeLocale";

const URL_NEON = "postgres://u:***@ep-quelconque-pooler.eu-west-1.aws.neon.tech/neondb?sslmode=require";
const URL_LOCALE = "postgres://postgres:faux@localhost:5432/gbs_local";

describe("garde-fou copie locale — jamais de base Neon hors production", () => {
  it("local + neon.tech → démarrage refusé", () => {
    expect(() =>
      verifierBaseLocale(URL_NEON, { production: false, test: false, autoriseNeonHorsProd: false }),
    ).toThrow(/LOCAL.*neon\.tech/);
  });

  it("production + neon.tech → autorisé (hébergement prévu)", () => {
    expect(() =>
      verifierBaseLocale(URL_NEON, { production: true, test: false, autoriseNeonHorsProd: false }),
    ).not.toThrow();
  });

  it("tests automatisés + neon.tech → autorisé (branche dédiée)", () => {
    expect(() =>
      verifierBaseLocale(URL_NEON, { production: false, test: true, autoriseNeonHorsProd: false }),
    ).not.toThrow();
  });

  it("hatch sandbox documenté (GBS_NEON_HORS_PROD=1) → autorisé", () => {
    expect(() =>
      verifierBaseLocale(URL_NEON, { production: false, test: false, autoriseNeonHorsProd: true }),
    ).not.toThrow();
  });

  it("local + PostgreSQL localhost → autorisé", () => {
    expect(() =>
      verifierBaseLocale(URL_LOCALE, { production: false, test: false, autoriseNeonHorsProd: false }),
    ).not.toThrow();
  });

  it("local + URL vide → autorisé (l'exigence DATABASE_URL relève d'env.ts)", () => {
    expect(() =>
      verifierBaseLocale("", { production: false, test: false, autoriseNeonHorsProd: false }),
    ).not.toThrow();
  });
});
