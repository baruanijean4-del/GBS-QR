// ============================================================
// GBS — Taux de change USD/FC par établissement (règle figée,
// docs/REGLE-TAUX-CHANGE.md). Logique PURE partagée front/back :
// bornes de saisie, alertes de variation/fréquence, affichage de
// l'équivalent. AUCUNE conversion implicite : un établissement
// sans taux (null) reste mono-devise. Aucune entrée/sortie.
// ============================================================

/** Configuration taux d'un établissement (miroir des colonnes
 *  proposées de `terrasses` — migration 0016 en attente). */
export interface ConfigTaux {
  /** FC pour 1 USD ; null = établissement SANS taux (mono-devise) */
  tauxUsdCdf: number | null;
  /** Alerte si variation relative supérieure à ce seuil (défaut 5 %) */
  alerteVariationPct: number;
  /** Alerte si plus de N changements le même jour (défaut 3) */
  alerteMaxParJour: number;
  /** Plafond de saisie anti-faute de frappe (défaut 10 000 FC) */
  plafondCdf: number;
}

export const CONFIG_TAUX_DEFAUT: Omit<ConfigTaux, "tauxUsdCdf"> = {
  alerteVariationPct: 5,
  alerteMaxParJour: 3,
  plafondCdf: 10_000,
};

/** L'établissement a-t-il un taux ? Sinon : mono-devise, bouton
 *  FC/$ masqué, aucune conversion. */
export function aUnTaux(config: Pick<ConfigTaux, "tauxUsdCdf">): boolean {
  return config.tauxUsdCdf !== null;
}

/** Validation de saisie : entier, > 0, ≤ plafond. Retourne la clé
 *  d'erreur ou null si valide. */
export function erreurSaisieTaux(
  taux: number,
  plafondCdf: number = CONFIG_TAUX_DEFAUT.plafondCdf,
): "invalide" | "plafond" | null {
  if (!Number.isInteger(taux) || taux <= 0) return "invalide";
  if (taux > plafondCdf) return "plafond";
  return null;
}

/** Variation relative entre deux taux, en % (ex. 2800 → 3000 = 7,14). */
export function variationTauxPct(ancien: number, nouveau: number): number {
  if (ancien <= 0) return 0;
  return Math.abs(nouveau - ancien) / ancien * 100;
}

/** Alerte si la variation dépasse le seuil configuré. */
export function doitAlerterVariation(
  ancien: number | null,
  nouveau: number,
  seuilPct: number = CONFIG_TAUX_DEFAUT.alerteVariationPct,
): boolean {
  if (ancien === null) return false; // première fixation : pas de variation
  return variationTauxPct(ancien, nouveau) > seuilPct;
}

/** Alerte si le nombre de changements du jour dépasse le plafond. */
export function doitAlerterFrequence(
  changementsDuJour: number,
  maxParJour: number = CONFIG_TAUX_DEFAUT.alerteMaxParJour,
): boolean {
  return changementsDuJour > maxParJour;
}

/** Équivalent FC d'un montant USD (centimes) au taux DE LA VENTE —
 *  affichage seulement, jamais additionné à une caisse FC. null si
 *  la vente n'a pas de taux figé (avant la règle ou sans taux). */
export function equivalentAffichageCdf(
  montantUsdCentimes: number,
  tauxVenteUsdCdf: number | null,
): number | null {
  if (tauxVenteUsdCdf === null) return null;
  return Math.round(montantUsdCentimes / 100 * tauxVenteUsdCdf);
}

/** Libellé client à côté du bouton de devise (« 1 $ = 2 800 FC ») ;
 *  null si l'établissement n'a pas de taux (bouton masqué). */
export function libelleTauxClient(tauxUsdCdf: number | null): string | null {
  if (tauxUsdCdf === null) return null;
  return `1 $ = ${tauxUsdCdf.toLocaleString("fr-CD")} FC`;
}
