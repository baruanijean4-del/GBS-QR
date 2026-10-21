// ============================================================
// GBS — Hôtel : règles pures (prompt maître §4). Cycle d'occupation
// et facturation à la nuitée ou à l'heure, sans base de données.
// ============================================================

import { describe, expect, it } from "vitest";
import { montantSejourCdf, transitionChambreValide } from "../../contracts/hotel";

describe("transitionChambreValide — cycle LIBRE → OCCUPEE → A_NETTOYER → LIBRE", () => {
  it("accepte les 3 transitions du cycle (et seulement elles)", () => {
    expect(transitionChambreValide("LIBRE", "OCCUPEE")).toBe(true);        // check-in
    expect(transitionChambreValide("OCCUPEE", "A_NETTOYER")).toBe(true);   // check-out
    expect(transitionChambreValide("A_NETTOYER", "LIBRE")).toBe(true);     // ménage validé
  });

  it("refuse les sauts (une chambre occupée ne redevient pas libre sans ménage)", () => {
    expect(transitionChambreValide("OCCUPEE", "LIBRE")).toBe(false);
    expect(transitionChambreValide("LIBRE", "A_NETTOYER")).toBe(false);
    expect(transitionChambreValide("A_NETTOYER", "OCCUPEE")).toBe(false);
    expect(transitionChambreValide("LIBRE", "LIBRE")).toBe(false);
  });
});

describe("montantSejourCdf — unités entamées dues, minimum 1", () => {
  const base = { prixNuitCdf: 40_000, prixHeureCdf: 10_000 };

  it("nuitée : 20 h = 1 nuit, 25 h = 2 nuits, 49 h = 3 nuits", () => {
    const arrivee = "2026-10-19T18:00:00.000Z";
    const apres = (h: number) => new Date(new Date(arrivee).getTime() + h * 3_600_000).toISOString();
    expect(montantSejourCdf({ mode: "NUIT", arriveeLe: arrivee, departLe: apres(20), ...base })).toBe(40_000);
    expect(montantSejourCdf({ mode: "NUIT", arriveeLe: arrivee, departLe: apres(25), ...base })).toBe(80_000);
    expect(montantSejourCdf({ mode: "NUIT", arriveeLe: arrivee, departLe: apres(49), ...base })).toBe(120_000);
  });

  it("heure : 30 min = 1 h, 1 h 05 = 2 h", () => {
    const arrivee = "2026-10-19T14:00:00.000Z";
    const apres = (min: number) => new Date(new Date(arrivee).getTime() + min * 60_000).toISOString();
    expect(montantSejourCdf({ mode: "HEURE", arriveeLe: arrivee, departLe: apres(30), ...base })).toBe(10_000);
    expect(montantSejourCdf({ mode: "HEURE", arriveeLe: arrivee, departLe: apres(65), ...base })).toBe(20_000);
  });

  it("mode HEURE refusé si la chambre n'a pas de prix à l'heure", () => {
    expect(() => montantSejourCdf({
      mode: "HEURE", arriveeLe: "2026-10-19T14:00:00.000Z", departLe: "2026-10-19T15:00:00.000Z",
      prixNuitCdf: 40_000, prixHeureCdf: null,
    })).toThrow(/heure/);
  });

  it("départ avant l'arrivée (donnée corrompue) : minimum 1 unité, jamais négatif", () => {
    expect(montantSejourCdf({
      mode: "NUIT", arriveeLe: "2026-10-19T18:00:00.000Z", departLe: "2026-10-19T10:00:00.000Z",
      prixNuitCdf: 40_000, prixHeureCdf: null,
    })).toBe(40_000);
  });
});
