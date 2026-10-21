// ============================================================
// GBS — Chiffrement réversible des PIN (AES-256-GCM, node:crypto)
//
// Décision produit VALIDÉE (boucle 10, point 3.2) : jamais de
// hachage, jamais de clair. Le PIN est chiffré de façon RÉVERSIBLE
// — le super-admin peut le révéler (« Mot de passe oublié »),
// une fuite de la base sans la clé ne révèle rien.
//
// Format stocké : « v1:<nonce hex>:<tag hex>:<corps hex> »
//   - nonce 12 octets aléatoires par chiffrement (GCM l'exige) ;
//   - tag 16 octets : toute altération du corps est détectée
//     (le déchiffrement échoue au lieu de produire un faux PIN) ;
//   - clé : PIN_ENC_KEY (64 caractères hex = 32 octets), DISTINCTE
//     de SESSION_SECRET, obligatoire en production (configProduction).
//
// TRANSITION (anciens comptes) : verifierPin accepte encore les
// formats « scrypt$… » et clair legacy, le temps que chaque compte
// se connecte une fois — migrerPinSiLegacy réécrit alors en v1.
// Les comptes scrypt qui ne se connectent plus ne peuvent être NI
// déchiffrés NI affichés : réinitialisation par le propriétaire
// (plan présenté au propriétaire avant toute application).
// ============================================================

import { createCipheriv, createDecipheriv, randomBytes, scryptSync, timingSafeEqual } from "crypto";
import { env } from "./env";

const VERSION = "v1";
const LONGUEUR_CLE_SCRYPT = 32; // legacy uniquement
const PREFIXE_SCRYPT = "scrypt"; // legacy uniquement

function cleChiffrement(): Buffer {
  return Buffer.from(env.pinEncKey, "hex");
}

/** Chiffre un PIN : « v1:<nonce>:<tag>:<corps> » (hex). */
export function chiffrerPin(pin: string): string {
  const nonce = randomBytes(12);
  const chiffreur = createCipheriv("aes-256-gcm", cleChiffrement(), nonce);
  const corps = Buffer.concat([chiffreur.update(pin, "utf8"), chiffreur.final()]);
  return `${VERSION}:${nonce.toString("hex")}:${chiffreur.getAuthTag().toString("hex")}:${corps.toString("hex")}`;
}

/** true si la valeur stockée est chiffrée au format courant. */
export function estChiffre(valeur: string): boolean {
  return valeur.startsWith(`${VERSION}:`);
}

/** Déchiffre un PIN v1. null si altéré, malformé ou mauvaise clé. */
export function dechiffrerPin(valeur: string): string | null {
  if (!estChiffre(valeur)) return null;
  const [, nonceHex, tagHex, corpsHex] = valeur.split(":");
  if (!nonceHex || !tagHex || !corpsHex) return null;
  try {
    const dechiffreur = createDecipheriv("aes-256-gcm", cleChiffrement(), Buffer.from(nonceHex, "hex"));
    dechiffreur.setAuthTag(Buffer.from(tagHex, "hex"));
    return Buffer.concat([dechiffreur.update(Buffer.from(corpsHex, "hex")), dechiffreur.final()]).toString("utf8");
  } catch {
    return null; // tag GCM invalide : altération détectée
  }
}

/** Legacy : true si la valeur est un hachage scrypt (transition). */
export function estHache(valeur: string): boolean {
  return valeur.startsWith(`${PREFIXE_SCRYPT}$`);
}

/**
 * Vérifie un PIN contre la valeur stockée, quel que soit le format
 * (v1 chiffré, scrypt legacy, clair legacy). Comparaison à temps
 * constant dans tous les cas.
 */
export function verifierPin(pin: string, stocke: string): boolean {
  if (estChiffre(stocke)) {
    const clair = dechiffrerPin(stocke);
    return clair !== null && comparerSecret(pin, clair);
  }
  if (estHache(stocke)) {
    // TRANSITION — les comptes hachés existants restent vérifiables
    // jusqu'à leur migration transparente à la prochaine connexion.
    const [, selHex, empreinteHex] = stocke.split("$");
    if (!selHex || !empreinteHex) return false;
    const attendu = Buffer.from(empreinteHex, "hex");
    const recu = scryptSync(pin, Buffer.from(selHex, "hex"), LONGUEUR_CLE_SCRYPT);
    return attendu.length === recu.length && timingSafeEqual(attendu, recu);
  }
  // Legacy : PIN en clair — comparaison à temps constant quand même
  return comparerSecret(pin, stocke);
}

/**
 * Compare deux secrets à temps constant (ex. PIN admin d'environnement).
 */
export function comparerSecret(recu: string, attendu: string): boolean {
  const a = Buffer.from(recu);
  const b = Buffer.from(attendu);
  return a.length === b.length && timingSafeEqual(a, b);
}
