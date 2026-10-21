// ============================================================
// GBS — Hôtel / chambres (prompt maître §4) : types et règles
// pures du cycle d'occupation et du calcul de séjour.
// Aucun accès base ici — fonctions testables unitairement.
// ============================================================

export type StatutChambre = "LIBRE" | "OCCUPEE" | "A_NETTOYER";
export type ModeSejour = "NUIT" | "HEURE";
export type StatutSejour = "EN_COURS" | "CLOTURE";

export const TYPES_CHAMBRE = ["SIMPLE", "DOUBLE", "SUITE"] as const;
export type TypeChambre = (typeof TYPES_CHAMBRE)[number];

/** Transitions autorisées du cycle chambre (§4) :
 *  LIBRE →(check-in) OCCUPEE →(check-out) A_NETTOYER
 *  →(ménage validé par la gouvernante) LIBRE. */
export function transitionChambreValide(avant: StatutChambre, apres: StatutChambre): boolean {
  return (avant === "LIBRE" && apres === "OCCUPEE")
    || (avant === "OCCUPEE" && apres === "A_NETTOYER")
    || (avant === "A_NETTOYER" && apres === "LIBRE");
}

const HEURE_MS = 3_600_000;
const JOUR_MS = 24 * HEURE_MS;

/** Montant d'un séjour en CDF (§4 : « facturation à la nuitée ou à
 *  l'heure »). Chaque unité ENTAMÉE est due, minimum 1 : 20 h à la
 *  nuitée = 1 nuit ; 25 h = 2 nuits ; 1 h 05 à l'heure = 2 h.
 *  Une chambre sans prixHeureCdf refuse le mode HEURE. */
export function montantSejourCdf(opts: {
  mode: ModeSejour;
  arriveeLe: string;
  departLe: string;
  prixNuitCdf: number;
  prixHeureCdf: number | null;
}): number {
  const dureeMs = Math.max(
    0,
    new Date(opts.departLe).getTime() - new Date(opts.arriveeLe).getTime(),
  );
  if (opts.mode === "NUIT") {
    const nuits = Math.max(1, Math.ceil(dureeMs / JOUR_MS));
    return nuits * opts.prixNuitCdf;
  }
  if (opts.prixHeureCdf === null) {
    throw new Error("Cette chambre ne se loue pas à l'heure.");
  }
  const heures = Math.max(1, Math.ceil(dureeMs / HEURE_MS));
  return heures * opts.prixHeureCdf;
}
