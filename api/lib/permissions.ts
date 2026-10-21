// ============================================================
// GBS — RBAC par établissement (annexe « Expérience par type » §7)
//
// Principe : peut(utilisateur, action, etablissementId).
// Une personne peut avoir un rôle différent dans chaque
// établissement ; le propriétaire peut TOUT et peut surcharger
// la matrice membre par membre (table permissions_surcharge).
// Chaque refus est journalisé dans audit_log avec l'établissement.
//
// Ce module lit la base DIRECTEMENT (pas d'import de gbsRouter)
// pour éviter tout cycle d'imports.
// ============================================================

import { TRPCError } from "@trpc/server";
import { and, eq } from "drizzle-orm";
import * as s from "@db/schema";
import {
  permissionsParDefaut,
  type ActionSensible,
  type RoleActif,
  type RoleEtablissement,
} from "@contracts/types";
import { getDb } from "../queries/connection";
import { maintenant, uid } from "../gbsUtils";

/** Surcharges de permission d'un membre sur un établissement. */
export async function surchargesPour(
  utilisateurId: string, terrasseId: string,
): Promise<Map<ActionSensible, boolean>> {
  const lignes = await getDb().select().from(s.permissionsSurcharge)
    .where(and(
      eq(s.permissionsSurcharge.utilisateurId, utilisateurId),
      eq(s.permissionsSurcharge.terrasseId, terrasseId),
    ));
  const carte = new Map<ActionSensible, boolean>();
  for (const l of lignes) carte.set(l.action as ActionSensible, l.autorisee);
  return carte;
}

/** Rôles actifs d'un utilisateur sur un établissement (lecture locale,
 *  même logique que rolesSurDb — dupliquée pour éviter un cycle
 *  d'imports avec gbsRouter). */
async function rolesLocaux(utilisateurId: string, terrasseId: string): Promise<RoleActif[]> {
  const db = getDb();
  const roles: RoleActif[] = [];
  const [t] = await db.select().from(s.terrasses).where(eq(s.terrasses.id, terrasseId)).limit(1);
  if (t) {
    const [org] = await db.select().from(s.organisations).where(eq(s.organisations.id, t.organisationId)).limit(1);
    if (org?.proprietaireId === utilisateurId) roles.push("PROPRIETAIRE");
  }
  const affs = await db.select().from(s.affectations)
    .where(and(
      eq(s.affectations.utilisateurId, utilisateurId),
      eq(s.affectations.terrasseId, terrasseId),
      eq(s.affectations.actif, true),
    ));
  for (const a of affs) roles.push(a.role as RoleActif);
  return roles;
}

/** Cœur PUR de la décision : rôles + surcharges → oui/non.
 *  - PROPRIETAIRE : toujours oui (jamais surchargeable à la baisse).
 *  - Une surcharge explicite prime sur la matrice.
 *  - Sinon, un seul rôle d'établissement accordant l'action suffit. */
export function peutAvecRoles(
  roles: readonly RoleActif[],
  action: ActionSensible,
  surcharges: ReadonlyMap<ActionSensible, boolean>,
): boolean {
  if (roles.includes("PROPRIETAIRE")) return true;
  const surcharge = surcharges.get(action);
  if (surcharge !== undefined) return surcharge;
  return roles.some(
    (r) => r !== "CLIENT" && r !== "SUPER_ADMIN"
      && permissionsParDefaut(r as RoleEtablissement).has(action),
  );
}

/** Décision complète (lecture base) : l'utilisateur peut-il faire
 *  l'action sur cet établissement ? */
export async function peut(
  utilisateurId: string, terrasseId: string, action: ActionSensible,
): Promise<boolean> {
  const [roles, surcharges] = await Promise.all([
    rolesLocaux(utilisateurId, terrasseId),
    surchargesPour(utilisateurId, terrasseId),
  ]);
  return peutAvecRoles(roles, action, surcharges);
}

/** Journalise un événement RBAC avec l'établissement (annexe §7 :
 *  « chaque refus et chaque action sensible sont journalisés »). */
export async function journaliserPermission(
  acteurId: string | null, roleActif: RoleActif | null,
  action: string, details: string, terrasseId: string | null,
): Promise<void> {
  await getDb().insert(s.auditLog).values({
    id: uid("aud"), acteurId, roleActif, action,
    details: details.slice(0, 300), terrasseId, creeLe: maintenant(),
  });
}

/** Exige la permission, sinon : refus journalisé + erreur FORBIDDEN.
 *  Retourne le rôle actif retenu (PROPRIETAIRE en priorité). */
export async function exigerPermission(
  acteurId: string, terrasseId: string, action: ActionSensible,
): Promise<RoleActif | null> {
  const [roles, surcharges] = await Promise.all([
    rolesLocaux(acteurId, terrasseId),
    surchargesPour(acteurId, terrasseId),
  ]);
  if (peutAvecRoles(roles, action, surcharges)) {
    return roles.includes("PROPRIETAIRE") ? "PROPRIETAIRE" : (roles[0] ?? null);
  }
  await journaliserPermission(
    acteurId, roles[0] ?? null, "PERMISSION_REFUSEE",
    `${action} refusée (rôles : ${roles.join(", ") || "aucun"})`, terrasseId,
  );
  throw new TRPCError({
    code: "FORBIDDEN",
    message: "Vous n'avez pas la permission pour cette action.",
  });
}
