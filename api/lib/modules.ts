// ============================================================
// GBS — Feature flags par établissement (annexe §0, étape 1)
// ------------------------------------------------------------
// Résolution : registre TYPES_ETABLISSEMENT (défaut par type)
// + surcharges de la table modules_etablissement (par établissement).
// Absence de ligne = défaut du registre. Une ligne ne peut que
// activer/désactiver un module CONNU du registre.
// ============================================================

import { eq } from "drizzle-orm";
import { getDb } from "../queries/connection";
import * as s from "@db/schema";
import { modulesParDefaut, type Module, type TypeEtablissement } from "@contracts/types";

/** Modules actifs d'un établissement = défauts du type ± surcharges. */
export async function modulesPourEtablissement(
  terrasseId: string,
  type: TypeEtablissement,
): Promise<Set<Module>> {
  const actifs = new Set<Module>(modulesParDefaut(type));
  const surcharges = await getDb()
    .select()
    .from(s.modulesEtablissement)
    .where(eq(s.modulesEtablissement.terrasseId, terrasseId));
  for (const sc of surcharges) {
    const module = sc.module as Module;
    if (sc.actif) actifs.add(module);
    else actifs.delete(module);
  }
  return actifs;
}

/** Variante synchrone quand les surcharges sont déjà chargées (snapshot). */
export function resoudreModules(
  type: TypeEtablissement,
  surcharges: readonly { module: string; actif: boolean }[],
): Set<Module> {
  const actifs = new Set<Module>(modulesParDefaut(type));
  for (const sc of surcharges) {
    const module = sc.module as Module;
    if (sc.actif) actifs.add(module);
    else actifs.delete(module);
  }
  return actifs;
}
