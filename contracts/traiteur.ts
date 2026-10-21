// ============================================================
// GBS — Traiteur (MODULE-TRAITEUR.md). Règles pures partagées :
// unités de base ENTIÈRES (mg, ml, pièces), AUCUN arrondi
// intermédiaire — un seul arrondi à l'affichage.
//
// Rappel permanent : aucun montant visible du gérant, du chef et
// du magasinier — les coûts ne sortent que pour le propriétaire.
// ============================================================

export type KindComposant = "PLAT" | "SAUCE" | "ACCOMPAGNEMENT" | "BOISSON";
export type StatutRecette = "PROPOSEE" | "VALIDEE";

/** Familles d'unités et conversion vers l'unité de base entière.
 *  MASSE → mg, VOLUME → ml, PIÈCE → pièce. */
export type FamilleUnite = "MASSE" | "VOLUME" | "PIECE";

const UNITES: Record<string, { famille: FamilleUnite; facteurBase: number }> = {
  mg: { famille: "MASSE", facteurBase: 1 },
  g: { famille: "MASSE", facteurBase: 1_000 },
  kg: { famille: "MASSE", facteurBase: 1_000_000 },
  ml: { famille: "VOLUME", facteurBase: 1 },
  cl: { famille: "VOLUME", facteurBase: 10 },
  l: { famille: "VOLUME", facteurBase: 1_000 },
  "pièce": { famille: "PIECE", facteurBase: 1 },
  piece: { famille: "PIECE", facteurBase: 1 },
};

/** Famille d'une unité libre (produits.unite). NULL si inconnue. */
export function familleUnite(unite: string | null | undefined): FamilleUnite | null {
  const u = (unite ?? "").trim().toLowerCase();
  return UNITES[u]?.famille ?? null;
}

/** Unités de base par unité produit (kg → 1 000 000 mg, L → 1 000 ml).
 *  NULL si l'unité est inconnue. */
export function baseParUniteProduit(unite: string | null | undefined): number | null {
  const u = (unite ?? "").trim().toLowerCase();
  return UNITES[u]?.facteurBase ?? null;
}

/** Quantité → unité de base entière. Ex. 0,5 kg → 500 000 mg. */
export function versBase(unite: string, quantite: number): number {
  const u = unite.trim().toLowerCase();
  const def = UNITES[u];
  if (!def) throw new Error(`Unité inconnue : « ${unite} ».`);
  return Math.round(quantite * def.facteurBase);
}

/** Unités acceptées pour un INGRÉDIENT de recette : le stock doit
 *  pouvoir sortir en entiers — on exige une unité « fine » (g, ml,
 *  mg, pièce), jamais kg/L (0,2 kg de sel casserait le stock). */
export function uniteIngredientValide(unite: string | null | undefined): boolean {
  const u = (unite ?? "").trim().toLowerCase();
  return u === "g" || u === "mg" || u === "ml" || u === "pièce" || u === "piece";
}

// ---------- Calcul du bon de sortie (§4) ----------

export interface LigneRecetteBase {
  produitId: string;
  /** Quantité par personne en unité de base (mg, ml, pièces). */
  quantiteParPersonneBase: number;
  /** Taux de perte en % (0 pour les produits achetés non cuisinés). */
  tauxPertePct: number;
}

export interface ComposantPlan {
  composantId: string;
  /** Quantité du composant par personne ×1000 (1000 = 1, 500 = 0,5). */
  qteParPersonneX1000: number;
  lignes: LigneRecetteBase[];
}

export interface LigneBon {
  produitId: string;
  /** Quantité EXACTE en unité de base — entier, sans arrondi
   *  intermédiaire (dénominateur commun 100 000 = 1000 × 100). */
  quantiteBase: number;
}

const DENOMINATEUR = 100_000n; // qteParPersonneX1000 (1000) × (100 + perte) (100)

/** Addition par INGRÉDIENT sur tous les composants du plan (§4).
 *  Arithmétique entière exacte (BigInt), arrondi final à l'entier
 *  supérieur : le magasinier sort des unités physiques entières. */
export function calculerBonSortie(
  composants: readonly ComposantPlan[],
  nbPersonnes: number,
): LigneBon[] {
  const totaux = new Map<string, bigint>(); // produitId → numérateur / DENOMINATEUR
  for (const c of composants) {
    for (const l of c.lignes) {
      const numerateur = BigInt(l.quantiteParPersonneBase)
        * BigInt(nbPersonnes)
        * BigInt(c.qteParPersonneX1000)
        * BigInt(100 + l.tauxPertePct);
      totaux.set(l.produitId, (totaux.get(l.produitId) ?? 0n) + numerateur);
    }
  }
  return [...totaux.entries()].map(([produitId, num]) => ({
    produitId,
    // Arrondi à l'entier supérieur, UNE SEULE FOIS, à la toute fin.
    quantiteBase: Number((num + DENOMINATEUR - 1n) / DENOMINATEUR),
  }));
}

// ---------- Coûts (§5 — propriétaire SEULEMENT) ----------

export interface CoutProduit {
  produitId: string;
  quantiteBase: number;
  /** Coût d'achat en centimes USD par unité produit (kg, L, pièce). */
  coutUniteCentimes: number;
  /** Unités de base par unité produit (kg → 1 000 000 mg…). */
  baseParUnite: number;
}

/** Coût total en centimes USD. Somme exacte en BigInt (millièmes de
 *  centime par produit), UN SEUL arrondi à la fin. Jamais affiché
 *  au gérant, au chef ni au magasinier. */
export function coutTotalCentimes(lignes: readonly CoutProduit[]): number {
  let millièmes = 0n;
  for (const l of lignes) {
    millièmes += (BigInt(l.quantiteBase) * BigInt(l.coutUniteCentimes) * 1000n) / BigInt(l.baseParUnite);
  }
  return Number(millièmes / 1000n);
}

// ---------- Affichage (le seul endroit où l'on arrondit) ----------

/** Formate une quantité de base pour l'affichage : passe à l'unité
 *  supérieure dès que la valeur est ronde (200 000 mg → « 200 g »,
 *  50 000 000 mg → « 50 kg »). */
export function formatBase(famille: FamilleUnite, quantiteBase: number): string {
  if (famille === "PIECE") return `${quantiteBase} pièce${quantiteBase > 1 ? "s" : ""}`;
  if (famille === "VOLUME") {
    if (quantiteBase >= 1000 && quantiteBase % 1000 === 0) return `${quantiteBase / 1000} L`;
    return `${quantiteBase} ml`;
  }
  if (quantiteBase >= 1_000_000 && quantiteBase % 1_000_000 === 0) return `${quantiteBase / 1_000_000} kg`;
  if (quantiteBase >= 1000 && quantiteBase % 1000 === 0) return `${quantiteBase / 1000} g`;
  return `${quantiteBase} mg`;
}
