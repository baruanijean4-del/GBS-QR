// ============================================================
// GBS — Compte super-admin plateforme
//
// Le super-admin se connecte comme tout le monde : téléphone + PIN
// sur la page de connexion unique. Cet utilisateur technique est
// créé (ou mis à jour) au démarrage et à la première connexion :
// son PIN suit TOUJOURS la variable d'environnement ADMIN_PIN, et
// son téléphone ADMIN_TELEPHONE — changer l'env change l'accès,
// sans migration ni intervention en base.
//
// Sécurité : ce compte n'apparaît JAMAIS dans l'annuaire démo
// (son PIN est le secret de la plateforme) et ne possède aucune
// terrasse — reponseConnexionDb lui répond le rôle SUPER_ADMIN.
//
// Décision produit (boucle 10, point 3.2) : le PIN du super-admin
// est CHIFFRÉ en base (AES-256-GCM, voir api/lib/pin.ts) comme tous
// les autres — jamais de hachage, jamais de clair. La valeur stockée
// suit TOUJOURS ADMIN_PIN : changer l'env change l'accès au plus une
// minute après un redéploiement.
// ============================================================

import { eq } from "drizzle-orm";
import { getDb } from "../queries/connection";
import * as s from "@db/schema";
import { env } from "./env";
import { chiffrerPin, dechiffrerPin } from "./pin";

/** Identifiant technique du compte super-admin (hors organisations) */
export const SUPER_ADMIN_ID = "usr_super_admin";

// Mémorisation 60 s : évite un aller-retour DB à chaque connexion
// (latence Neon ~700 ms), tout en propageant un changement d'env
// au plus une minute après un redéploiement.
let verifieLe = 0;

/** Crée ou met à jour le compte super-admin (idempotent, mémoïsé 60 s).
 *  Le PIN stocké = ADMIN_PIN CHIFFRÉ (v1) ; réécrit seulement si la
 *  valeur stockée ne déchiffre plus vers ADMIN_PIN (changement d'env
 *  ou de clé) — sinon aucune écriture. */
export async function assurerSuperAdmin(): Promise<void> {
  if (Date.now() - verifieLe < 60_000) return;
  const db = getDb();
  
  // 1. Chercher si un utilisateur avec ce téléphone existe déjà (peu importe son ID)
  const [existant] = await db.select().from(s.utilisateurs)
    .where(eq(s.utilisateurs.telephone, env.adminTelephone)).limit(1);
    
  const dejaConforme = existant
    && existant.telephone === env.adminTelephone
    && dechiffrerPin(existant.pin) === env.adminPin;
    
  if (!dejaConforme) {
    if (existant) {
      // 2. L'utilisateur existe (peut-être avec un autre ID) : on met à jour
      await db.update(s.utilisateurs)
        .set({ 
          nom: "Super Admin", 
          pin: chiffrerPin(env.adminPin) 
        })
        .where(eq(s.utilisateurs.telephone, env.adminTelephone));
    } else {
      // 3. L'utilisateur n'existe pas : on l'insère
      await db.insert(s.utilisateurs).values({
        id: SUPER_ADMIN_ID,
        nom: "Super Admin",
        telephone: env.adminTelephone,
        pin: chiffrerPin(env.adminPin),
        creeLe: new Date().toISOString(),
      });
    }
  }
  verifieLe = Date.now();
}