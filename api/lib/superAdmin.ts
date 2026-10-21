// ============================================================
// GBS — Compte super-admin plateforme
// ============================================================

import { eq } from "drizzle-orm";
import { getDb } from "../queries/connection";
import * as s from "@db/schema";
import { env } from "./env";
import { chiffrerPin, dechiffrerPin } from "./pin";

export const SUPER_ADMIN_ID = "usr_super_admin";

let verifieLe = 0;

/** Petite fonction pour attendre (sleep) */
const attendre = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

export async function assurerSuperAdmin(): Promise<void> {
  if (Date.now() - verifieLe < 60_000) return;
  
  const db = getDb();
  let tentatives = 0;
  const maxTentatives = 3;

  while (tentatives < maxTentatives) {
    try {
      // 1. Chercher si un utilisateur avec ce téléphone existe déjà
      const [existant] = await db.select().from(s.utilisateurs)
        .where(eq(s.utilisateurs.telephone, env.adminTelephone)).limit(1);
        
      const dejaConforme = existant
        && existant.telephone === env.adminTelephone
        && dechiffrerPin(existant.pin) === env.adminPin;
        
      if (!dejaConforme) {
        if (existant) {
          // 2. L'utilisateur existe : on met à jour
          await db.update(s.utilisateurs)
            .set({ nom: "Super Admin", pin: chiffrerPin(env.adminPin) })
            .where(eq(s.utilisateurs.telephone, env.adminTelephone));
          console.log("[superAdmin] Compte Super Admin mis à jour.");
        } else {
          // 3. L'utilisateur n'existe pas : on l'insère
          await db.insert(s.utilisateurs).values({
            id: SUPER_ADMIN_ID,
            nom: "Super Admin",
            telephone: env.adminTelephone,
            pin: chiffrerPin(env.adminPin),
            creeLe: new Date().toISOString(),
          });
          console.log("[superAdmin] Compte Super Admin créé.");
        }
      }
      
      // Si on arrive ici, tout s'est bien passé
      verifieLe = Date.now();
      return; // On sort de la fonction
      
    } catch (erreur) {
      tentatives++;
      console.error(`[superAdmin] Tentative ${tentatives}/${maxTentatives} échouée:`, erreur);
      
      if (tentatives >= maxTentatives) {
        throw erreur; // On relance l'erreur après la dernière tentative
      }
      
      // Attendre 2 secondes avant de réessayer (laisse le temps à Neon de se réveiller)
      console.log("[superAdmin] Attente de 2s avant nouvelle tentative...");
      await attendre(2000);
    }
  }
}