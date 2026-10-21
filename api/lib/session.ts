// ============================================================
// GBS — Jetons de session signés (HMAC-SHA256, format JWT HS256)
//
// Principe : le serveur ne fait plus JAMAIS confiance au client
// pour l'identité. Après vérification du PIN, connexionPin
// retourne un jeton signé ; chaque requête staff le présente
// dans l'en-tête « Authorization: Bearer <jeton> ».
//
// Choix d'implémentation :
// - Jeton maison au FORMAT JWT (header.payload.signature, base64url)
//   via node:crypto — aucune dépendance externe.
// - Le payload ne contient que l'identité (utilisateurId) + iat/exp
//   (+ sid en mode glissant) : les rôles sont relus en base à chaque
//   requête (rolesSurDb), donc une affectation révoquée coupe l'accès
//   immédiatement.
//
// SESSION GLISSANTE (docs/SESSION-GLISSANTE.md, appliquée) :
// - expiration après 12 h d'INACTIVITÉ (configurable,
//   SESSION_INACTIVITE_SECONDES) ;
// - durée absolue maximale 7 jours depuis la connexion
//   (SESSION_DUREE_MAX_SECONDES), même en cas d'activité continue ;
// - révocation par appareil : le jeton porte « sid » → ligne
//   sessions_appareils ; révoquée = accès coupé à la requête
//   suivante ;
// - retour arrière : SESSION_GLISSANTE=0 → jeton fixe 12 h comme
//   avant (les jetons glissants émis restent vérifiables : le sid
//   est simplement ignoré).
// ============================================================

import { createHmac, randomBytes, timingSafeEqual } from "crypto";
import { eq } from "drizzle-orm";
import * as s from "@db/schema";
import { getDb } from "../queries/connection";
import { env } from "./env";

const DUREE_SESSION_SECONDES = 12 * 60 * 60; // 12 heures (mode fixe)

export interface PayloadSession {
  utilisateurId: string;
  /** Émis le (secondes Unix) */
  iat: number;
  /** Expire le (secondes Unix) — glisse avec l'activité */
  exp: number;
  /** Identifiant de la ligne sessions_appareils (mode glissant) */
  sid?: string;
}

// ---------- Secret de signature ----------

let secretEffectif: string | null = null;

/**
 * Secret HMAC. En production, SESSION_SECRET (64 caractères aléatoires)
 * doit être défini — sinon un secret aléatoire est généré au démarrage
 * (sécurité intacte, mais les sessions sont invalidées au redémarrage).
 */
function secret(): string {
  if (secretEffectif) return secretEffectif;
  if (env.sessionSecret && env.sessionSecret.length >= 32) {
    secretEffectif = env.sessionSecret;
  } else {
    secretEffectif = randomBytes(48).toString("hex");
    console.warn(
      "⚠ SESSION_SECRET absent ou trop court (< 32) : secret aléatoire généré au démarrage. " +
      "Les sessions seront invalidées à chaque redémarrage — définissez SESSION_SECRET (64 caractères).",
    );
  }
  return secretEffectif;
}

// ---------- base64url ----------

function b64url(tampon: Buffer | string): string {
  return Buffer.from(tampon).toString("base64url");
}

function signer(donnees: string): string {
  return createHmac("sha256", secret()).update(donnees).digest("base64url");
}

/**
 * Signe un jeton de session pour un utilisateur.
 * dureeSecondes : durée de vie (12 h par défaut ; négatif = déjà expiré, utile en tests).
 * sid : identifiant sessions_appareils (mode glissant uniquement).
 * iat : émission (défaut maintenant ; en mode glissant, l'émission
 *       ORIGINALE est conservée au fil des prolongations).
 */
export function creerJeton(
  utilisateurId: string,
  dureeSecondes = DUREE_SESSION_SECONDES,
  sid?: string,
  iat?: number,
): string {
  const maintenantS = Math.floor(Date.now() / 1000);
  const payload: PayloadSession = {
    utilisateurId,
    iat: iat ?? maintenantS,
    exp: maintenantS + dureeSecondes,
    ...(sid ? { sid } : {}),
  };
  const corps = `${b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }))}.${b64url(JSON.stringify(payload))}`;
  return `${corps}.${signer(corps)}`;
}

/**
 * Vérifie signature + expiration. Retourne le payload ou null
 * (jamais d'exception : un jeton invalide n'est pas une erreur serveur).
 */
export function verifierJeton(jeton: string | null | undefined): PayloadSession | null {
  if (!jeton) return null;
  const parties = jeton.split(".");
  if (parties.length !== 3) return null;
  const [h, p, sig] = parties;
  // Comparaison à temps constant contre les attaques par timing
  const attendu = signer(`${h}.${p}`);
  const a = Buffer.from(sig);
  const b = Buffer.from(attendu);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const payload = JSON.parse(Buffer.from(p, "base64url").toString()) as PayloadSession;
    if (typeof payload.utilisateurId !== "string" || typeof payload.exp !== "number") return null;
    if (payload.exp < Math.floor(Date.now() / 1000)) return null; // expiré
    return payload;
  } catch {
    return null;
  }
}

/** Extrait le jeton d'un en-tête « Authorization: Bearer <jeton> » */
export function jetonDepuisEntete(autorisation: string | null | undefined): string | null {
  if (!autorisation?.startsWith("Bearer ")) return null;
  return autorisation.slice(7).trim() || null;
}

// ---------- Session glissante ----------

/** Résultat de la vérification active : payload + jeton prolongé éventuel */
export interface SessionVerifiee {
  payload: PayloadSession;
  /** Nouveau jeton à renvoyer au client (en-tête X-Session-Renouvelee) */
  nouveauJeton: string | null;
}

/** Seuil de réécriture de l'activité : une écriture par minute suffit */
const ACTIVITE_ECRITURE_MIN_MS = 60_000;
/** Prolongation quand l'expiration courante passe sous la moitié de la fenêtre */
const MARGE_PROLONGATION = 0.5;

/**
 * Crée la ligne sessions_appareils d'une connexion et signe le jeton
 * glissant correspondant. Mode fixe (SESSION_GLISSANTE=0) : jeton
 * simple 12 h, aucune ligne créée.
 */
export async function ouvrirSessionAppareil(
  utilisateurId: string,
  appareilId: string,
): Promise<string> {
  if (!env.sessionGlissante) return creerJeton(utilisateurId);
  const maintenantMs = Date.now();
  const maintenantS = Math.floor(maintenantMs / 1000);
  const id = `ses_${randomBytes(8).toString("hex")}`;
  const iso = new Date(maintenantMs).toISOString();
  const absoluIso = new Date(maintenantMs + env.sessionDureeMaxSecondes * 1000).toISOString();
  await getDb().insert(s.sessionsAppareils).values({
    id,
    utilisateurId,
    appareilId: appareilId.slice(0, 60),
    creeLe: iso,
    derniereActiviteLe: iso,
    expireAbsoluLe: absoluIso,
  });
  const duree = Math.min(env.sessionInactiviteSecondes, env.sessionDureeMaxSecondes);
  return creerJeton(utilisateurId, duree, id, maintenantS);
}

/**
 * Vérification active (mode glissant) : signature + expiration du
 * jeton, PUIS ligne sessions_appareils (révoquée ? absolu dépassé ?),
 * mise à jour de l'activité (au plus 1 écriture/minute) et
 * prolongation glissante plafonnée à la durée absolue.
 * Mode fixe : signature + expiration uniquement, aucune lecture base.
 */
export async function verifierSessionActive(
  jeton: string | null | undefined,
): Promise<SessionVerifiee | null> {
  const payload = verifierJeton(jeton);
  if (!payload) return null;
  // Mode fixe, ou jeton ancien format (sans sid) : rien de plus
  if (!env.sessionGlissante || !payload.sid) return { payload, nouveauJeton: null };

  const [ligne] = await getDb().select().from(s.sessionsAppareils)
    .where(eq(s.sessionsAppareils.id, payload.sid)).limit(1);
  if (!ligne || ligne.revoqueLe) return null; // révoquée (ou ligne perdue)
  const maintenantMs = Date.now();
  const maintenantS = Math.floor(maintenantMs / 1000);
  const absoluS = Math.floor(new Date(ligne.expireAbsoluLe).getTime() / 1000);
  if (maintenantS >= absoluS) return null; // durée absolue dépassée

  // Glissement : nouvelle expiration = maintenant + inactivité,
  // plafonnée à l'absolu. Émise seulement quand l'expiration courante
  // a dépassé la moitié de sa fenêtre (évite un jeton neuf par requête).
  const nouvelExp = Math.min(maintenantS + env.sessionInactiviteSecondes, absoluS);
  const seuilProlongation = payload.exp - env.sessionInactiviteSecondes * (1 - MARGE_PROLONGATION);
  const nouveauJeton = maintenantS >= seuilProlongation
    ? creerJeton(payload.utilisateurId, nouvelExp - maintenantS, payload.sid, payload.iat)
    : null;

  // Activité : au plus une écriture par minute
  if (maintenantMs - new Date(ligne.derniereActiviteLe).getTime() > ACTIVITE_ECRITURE_MIN_MS) {
    await getDb().update(s.sessionsAppareils)
      .set({ derniereActiviteLe: new Date(maintenantMs).toISOString() })
      .where(eq(s.sessionsAppareils.id, payload.sid));
  }
  return { payload, nouveauJeton };
}

/** Révoque une session appareil (coupure à la requête suivante) */
export async function revoquerSessionAppareil(sid: string): Promise<void> {
  await getDb().update(s.sessionsAppareils)
    .set({ revoqueLe: new Date().toISOString() })
    .where(eq(s.sessionsAppareils.id, sid));
}
