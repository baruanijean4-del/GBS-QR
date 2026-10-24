// ============================================================
// GBS — Billard « Vincaire » (annexe « Expérience par type » §1)
// Types + logique PURE partagée front/back : configuration,
// file d'attente, règle du perdant, durée moyenne des parties,
// estimation d'attente. Aucune entrée/sortie : testable tel quel.
//
// Règles (toutes configurables par établissement, table
// config_billard) :
// - Prix du token : fixé par le gérant (défaut 5 000 FC).
// - Perdant : RACHAT (défaut — doit racheter un token) |
//   FIN_FILE (retour gratuit en fin de file) | SORTIE.
// - Vincaire : illimité par défaut, sinon max N parties gagnées
//   d'affilée (maxPartiesVincaire).
// - Paiement : cash validé par la serveuse ou le billardier.
// - Présence : après appel, le joueur a N minutes (défaut 3),
//   sinon son token passe ABSENT et le suivant est appelé.
// ============================================================

/** Cycle de vie d'un token : ATTENTE_PAIEMENT → (cash validé) →
 *  EN_FILE → APPELE → EN_JEU → SORTI | ABSENT | ANNULE. */
export type StatutTokenBillard =
  | "ATTENTE_PAIEMENT" | "EN_FILE" | "APPELE" | "EN_JEU"
  | "SORTI" | "ABSENT" | "ANNULE";

export type StatutPartieBillard = "EN_COURS" | "TERMINEE" | "ANNULEE";

export type ReglePerdant = "RACHAT" | "FIN_FILE" | "SORTIE";

/** Configuration billard d'un établissement (config_billard). */
export interface ConfigBillard {
  /** Prix du token en francs congolais (défaut 5 000 FC) */
  prixTokenCdf: number;
  /** Sort du perdant (défaut RACHAT : il doit racheter un token) */
  reglePerdant: ReglePerdant;
  /** Victoires consécutives max du vincaire ; null = illimité (défaut) */
  maxPartiesVincaire: number | null;
  /** Minutes laissées au joueur appelé avant d'être déclaré absent */
  delaiPresenceMin: number;
}

/** Défauts de l'annexe : 5 000 FC, RACHAT, vincaire illimité, 3 min. */
export const CONFIG_BILLARD_DEFAUT: ConfigBillard = {
  prixTokenCdf: 5000,
  reglePerdant: "RACHAT",
  maxPartiesVincaire: null,
  delaiPresenceMin: 3,
};

/** Token tel que lu en base (miroir de tokens_billard). */
export interface TokenBillard {
  id: string;
  terrasseId: string;
  tableId: string;
  numero: number;
  clientSessionId: string | null;
  prenom: string;
  prixCdf: number;
  statut: StatutTokenBillard;
  /** Victoires consécutives de ce joueur (série en cours) */
  serie: number;
  creeLe: string;
  payeLe: string | null;
  payePar: string | null;
  /** Horodatage d'entrée (ou de retour) dans la file — ordre FIFO */
  entreeFileLe: string | null;
  appeleLe: string | null;
  annuleLe: string | null;
  annulePar: string | null;
  /** Référence Airtel Money déclarée par le client (flux manuel,
   *  boucle 6) ; NULL = paiement cash. Unique par établissement. */
  referenceMobile: string | null;
}

/** Partie vincaire contre challenger (miroir de parties_billard). */
export interface PartieBillard {
  id: string;
  terrasseId: string;
  tableId: string;
  numero: number;
  vincaireTokenId: string | null;
  challengerTokenId: string;
  gagnantTokenId: string | null;
  statut: StatutPartieBillard;
  debutLe: string;
  finLe: string | null;
  terminePar: string | null;
}

/** Sort du perdant selon la règle configurée :
 *  FIN_FILE → retour gratuit en fin de file ; RACHAT et SORTIE →
 *  le token sort du jeu (avec RACHAT, il doit racheter un token). */
export function statutApresDefaite(regle: ReglePerdant): "SORTI" | "EN_FILE" {
  return regle === "FIN_FILE" ? "EN_FILE" : "SORTI";
}

/** Le vincaire doit-il céder la table après cette victoire ?
 *  (maxPartiesVincaire atteint ; null = illimité) */
export function vincaireDoitSortir(serieApresVictoire: number, maxPartiesVincaire: number | null): boolean {
  return maxPartiesVincaire !== null && serieApresVictoire >= maxPartiesVincaire;
}

/** Durée moyenne RÉELLE des dernières parties terminées, en minutes
 *  (annexe : « calculée sur la durée MOYENNE réelle des dernières
 *  parties, pas une valeur fixe »). Défaut 10 min si aucun historique. */
export function dureeMoyennePartiesMin(
  parties: readonly { debutLe: string; finLe: string | null }[],
  defautMin = 10,
): number {
  const durees = parties
    .filter((p) => p.finLe !== null)
    .slice(-10)
    .map((p) => (new Date(p.finLe as string).getTime() - new Date(p.debutLe).getTime()) / 60_000)
    .filter((d) => d > 0 && d < 240); // borne de sanité : 4 h max
  if (durees.length === 0) return defautMin;
  return Math.round(durees.reduce((a, b) => a + b, 0) / durees.length);
}

/** Attente estimée d'un joueur : position × durée moyenne réelle. */
export function estimerAttenteMin(position: number, dureeMoyenneMin: number): number {
  return Math.max(0, position) * Math.max(1, dureeMoyenneMin);
}

/** Un token appelé est-il absent ? (délai de présence dépassé) */
export function appelExpire(appeleLe: string, delaiPresenceMin: number, maintenantIso: string): boolean {
  const limiteMs = new Date(appeleLe).getTime() + delaiPresenceMin * 60_000;
  return new Date(maintenantIso).getTime() > limiteMs;
}

/** Position d'un token dans la file (1 = prochain à jouer),
 *  la file étant triée par entreeFileLe. -1 si absent de la file. */
export function positionDansFile(file: readonly { id: string }[], tokenId: string): number {
  const i = file.findIndex((t) => t.id === tokenId);
  return i === -1 ? -1 : i + 1;
}
