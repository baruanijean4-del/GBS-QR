// ============================================================
// GBS — Note client unique (ANNEXE-2) et « payer pour quelqu'un »
// (ANNEXE-3). Types et règles pures partagés client ↔ serveur.
//
// Rappels permanents respectés ici :
// - AUCUNE table « espaces » : l'espace est une ÉTIQUETTE portée par
//   chaque ligne (dérivée du QR et du type d'établissement).
// - Montants en entiers : CDF en francs, USD en centimes.
// - Taux USD→FC figé sur chaque ligne (règle taux) — jamais réécrit.
// ============================================================

/** Statut du folio client. FUSIONNEE = absorbée par une autre note
 *  (fusion validée par la serveuse — la ligne reste pour l'audit). */
export type StatutNote = "OUVERTE" | "A_REGLER" | "REGLEE" | "LITIGE" | "FUSIONNEE";

/** Origine d'une ligne de note. REMISE/ACOMPTE sont prévus au schéma
 *  (ANNEXE-2 §3) ; la v1 n'en émet pas encore. */
export type TypeLigneNote =
  | "COMMANDE" | "TOKEN_BILLARD" | "CHAMBRE" | "SERVICE" | "REMISE" | "ACOMPTE";

/** Étiquette d'espace (ANNEXE-2 §1 adaptée : pas de table espaces).
 *  Sert à grouper « Ma note » et à ventiler la caisse par espace. */
export type EspaceNote = "TERRASSE" | "RESTAURANT" | "BILLARD" | "HOTEL" | "COMPTOIR";

/** EN_ATTENTE (commande pas encore confirmée) est un sur-ensemble
 *  documenté de la spec (CONFIRMEE | SERVIE | ANNULEE) : la ligne
 *  existe dès la validation client, sans prétendre être confirmée. */
export type StatutLigneNote = "EN_ATTENTE" | "CONFIRMEE" | "SERVIE" | "ANNULEE";

export type ModeEncaissement = "CASH" | "MOBILE_MONEY";

/** Suivi de l'argent PHYSIQUE (ANNEXE-2 §5.6) : le cash encaissé
 *  reste EN_MAIN de l'employé jusqu'à sa remise validée à la caisse. */
export type StatutEncaissement = "EN_MAIN" | "REMIS" | "ECART";

export type StatutRemise = "EN_ATTENTE" | "VALIDEE" | "ECART";

export type StatutPriseEnCharge = "EN_ATTENTE" | "ACCEPTEE" | "REFUSEE" | "EXPIREE";

// ---------- Paramètres d'établissement (défauts de la spec) ----------
// ANNEXE-3 §2 : expiration d'une demande de prise en charge.
export const EXPIRATION_PRISE_EN_CHARGE_MIN = 10;
// ANNEXE-3 §3 : anti-abus — acceptations inhabituelles d'une serveuse.
export const SEUIL_PRISES_PAR_SERVEUSE_PAR_JOUR = 5;
// ANNEXE-3 §3 : anti-abus — même paire payeur → bénéficiaire sur 7 j.
export const SEUIL_PAIRE_PRISE_7J = 3;

/** Déduit l'étiquette d'espace du QR scanné et du type d'établissement.
 *  (Un établissement fusionné GUEST_HOUSE+TERRASSE garde des QR de
 *  kind ZONE : l'espace suit le type PRINCIPAL — suffisant pour la
 *  caisse par espace en v1.) */
export function espaceDepuisQr(kindQr: string, typeEtablissement: string): EspaceNote {
  if (kindQr === "BILLARD") return "BILLARD";
  if (typeEtablissement === "GUEST_HOUSE") return "HOTEL";
  if (typeEtablissement === "RESTAURANT") return "RESTAURANT";
  if (typeEtablissement === "BOUTIQUE" || typeEtablissement === "PHARMACIE" || typeEtablissement === "QUINCAILLERIE") {
    return "COMPTOIR";
  }
  return "TERRASSE";
}

export interface LigneNoteVue {
  id: string;
  espace: EspaceNote;
  type: TypeLigneNote;
  libelle: string;
  quantite: number;
  montantCdf: number;
  montantUsd: number; // centimes
  statut: StatutLigneNote;
  creeLe: string;
  /** Statut métier vivant de la source (commande EN_PREPARATION,
   *  token « en file »…) — déduit côté serveur, jamais stocké ici. */
  detailStatut: string | null;
  /** Prise en charge acceptée : la ligne est payée par un tiers. */
  priseEnChargeId: string | null;
}

export interface NoteVue {
  id: string;
  statut: StatutNote;
  prenom: string;
  ouverteLe: string;
  lignes: LigneNoteVue[];
  totalCdf: number;
  totalUsd: number;
  encaisseCdf: number;
  encaisseUsd: number;
  resteCdf: number;
  resteUsd: number;
  /** Taux figé de la note (NULL = établissement mono-devise). */
  tauxUsdCdf: number | null;
}

/** Totaux d'une note = somme des lignes non annulées. */
export function totauxNote(lignes: readonly { montantCdf: number; montantUsd: number; statut: string }[]): {
  totalCdf: number; totalUsd: number;
} {
  let totalCdf = 0;
  let totalUsd = 0;
  for (const l of lignes) {
    if (l.statut === "ANNULEE") continue;
    totalCdf += l.montantCdf;
    totalUsd += l.montantUsd;
  }
  return { totalCdf, totalUsd };
}

/** Reste dû = total − encaissé (jamais négatif : un trop-perçu est
 *  refusé à l'encaissement, donc le reste ne passe pas sous zéro). */
export function resteDu(total: number, encaisse: number): number {
  return Math.max(0, total - encaisse);
}

/** Ventilation COMPTABLE d'un encaissement par espace (ANNEXE-2 §5.8) :
 *  le montant est réparti au prorata du reste dû de chaque espace ;
 *  le dernier espace absorbe l'arrondi pour que la somme soit EXACTE.
 *  Ne change jamais qui détient physiquement l'argent. */
export function ventilerParEspace(
  restes: readonly { espace: EspaceNote; terrasseId: string; resteCdf: number; resteUsd: number }[],
  montantCdf: number,
  montantUsd: number,
): { espace: EspaceNote; terrasseId: string; montantCdf: number; montantUsd: number }[] {
  const concernes = restes.filter((r) => r.resteCdf > 0 || r.resteUsd > 0);
  if (concernes.length === 0) return [];
  const totalCdf = concernes.reduce((x, r) => x + r.resteCdf, 0);
  const totalUsd = concernes.reduce((x, r) => x + r.resteUsd, 0);
  const parts: { espace: EspaceNote; terrasseId: string; montantCdf: number; montantUsd: number }[] = [];
  let accCdf = 0;
  let accUsd = 0;
  concernes.forEach((r, i) => {
    const dernier = i === concernes.length - 1;
    const cdf = dernier ? montantCdf - accCdf : (totalCdf > 0 ? Math.floor((montantCdf * r.resteCdf) / totalCdf) : 0);
    const usd = dernier ? montantUsd - accUsd : (totalUsd > 0 ? Math.floor((montantUsd * r.resteUsd) / totalUsd) : 0);
    accCdf += cdf;
    accUsd += usd;
    if (cdf !== 0 || usd !== 0) parts.push({ espace: r.espace, terrasseId: r.terrasseId, montantCdf: cdf, montantUsd: usd });
  });
  return parts;
}
