// ============================================================
// GBS — Amorçage de la base au premier accès (boucle 2)
//
// Deux niveaux, strictement séparés :
//   - RÉFÉRENTIEL (db/seed.ts) : plans tarifaires, catalogue
//     multi-pays, codes-barres connus, compteur de factures.
//     Inséré dans TOUS les environnements si absent.
//   - FIXTURES DÉMO (db/fixtures-demo.ts) : organisation
//     « Nganda Group », 4 personas, 6 établissements, commandes.
//     Insérées UNIQUEMENT si l'annuaire démo est actif
//     (ANNUAIRE_DEMO absent ou ≠ "false"). PRODUCTION DIRECTE
//     ZÉRO DÉMO : avec ANNUAIRE_DEMO=false, aucune donnée de
//     démonstration n'entre jamais en base.
// ============================================================

import { getDb } from "./queries/connection";
import * as s from "@db/schema";
import { env } from "./lib/env";
import { executerSeedReferentiel, viderTables } from "../db/seed";
import { executerFixturesDemo } from "../db/fixtures-demo";

// Le seed ne change qu'au premier démarrage : on mémorise la vérification
// 60 s pour éviter un aller-retour DB à chaque snapshot (latence Neon ~700 ms).
let seedVerifieLe = 0;

/** Décision d'amorçage, pure et testable : le référentiel se réinsère
 *  s'il manque ; la démo n'entre que si l'annuaire démo est actif ET
 *  qu'aucune organisation n'existe encore (jamais d'écrasement). */
export function planifierSeed(o: {
  referentielPresent: boolean;
  demoPresente: boolean;
  annuaireDemo: boolean;
}): { referentiel: boolean; demo: boolean } {
  return {
    referentiel: !o.referentielPresent,
    // ZÉRO DÉMO : annuaireDemo=false (production réelle) → jamais de démo
    demo: o.annuaireDemo && !o.demoPresente,
  };
}

/** Insère le référentiel si absent, et la démo si elle est autorisée.
 *  Appelé au premier accès. Une instance réelle déjà remplie
 *  (inscriptions) n'est jamais écrasée : la démo ne part que sur une
 *  base vide d'organisations, et seulement en mode démo. */
export async function assurerSeed() {
  if (Date.now() - seedVerifieLe < 60_000) return;
  const db = getDb();
  const plans = await db.select().from(s.plansTarifs).limit(1);
  const orgs = await db.select().from(s.organisations).limit(1);
  const plan = planifierSeed({
    referentielPresent: plans.length > 0,
    demoPresente: orgs.length > 0,
    annuaireDemo: env.annuaireDemo,
  });
  if (plan.referentiel) await executerSeedReferentiel();
  if (plan.demo) await executerFixturesDemo();
  seedVerifieLe = Date.now();
}

/** Vide et réinsère référentiel + démo (bouton « Réinitialiser »,
 *  déjà restreint au mode démo par le routeur). */
export async function reinitialiserSeed() {
  await viderTables();
  await executerSeedReferentiel();
  await executerFixturesDemo();
  seedVerifieLe = Date.now();
}
