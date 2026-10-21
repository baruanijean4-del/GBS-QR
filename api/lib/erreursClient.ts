// ============================================================
// GBS — Journal des erreurs client côté serveur (Phase B.6)
//
// - Table erreurs_client créée de façon idempotente au démarrage
//   (les migrations versionnées ne s'appliquent qu'aux bases
//   neuves — voir scripts/docker-entrypoint.sh ; ici on couvre
//   aussi les bases existantes, sans toucher à aucune donnée).
// - Route POST /api/erreurs (voir api/boot.ts) : schéma STRICT —
//   toute clé surprise (pin, mot de passe, jeton, formulaire…)
//   est refusée. On n'enregistre que des champs techniques.
// - Limite de débit : 10 enregistrements par minute et par
//   appareil (fenêtre glissante en mémoire, instance unique).
// - Lecture super-admin : erreurs groupées par message + code.
// ============================================================

import { sql } from "drizzle-orm";
import { z } from "zod";
import * as s from "@db/schema";
import { getDb } from "../queries/connection";
import { maintenant, uid } from "../gbsUtils";

// ---------- Schéma strict de la charge (jamais de données sensibles) ----------

/**
 * Contrat d'enregistrement : UNIQUEMENT des champs techniques.
 * strictObject → toute clé supplémentaire (pin, motDePasse,
 * password, jeton, token, formulaire…) provoque un refus 400.
 */
export const schemaErreurClient = z.strictObject({
  codeCourt: z.string().min(1).max(16),
  message: z.string().min(1).max(1000),
  stack: z.string().max(4000).optional(),
  route: z.string().max(200).optional().default(""),
  version: z.string().max(60).optional(),
  langue: z.string().max(5).optional(),
  appareilId: z.string().min(1).max(60),
  utilisateurId: z.string().max(40).optional(),
  etablissementId: z.string().max(40).optional(),
});

export type ChargeErreurClient = z.infer<typeof schemaErreurClient>;

// ---------- Création idempotente de la table ----------

let tablePrete: Promise<void> | null = null;

/** Crée la table + index si absents (idempotent, mémoïsé) */
export function assurerTableErreursClient(): Promise<void> {
  if (!tablePrete) {
    tablePrete = (async () => {
      await getDb().execute(sql`
        CREATE TABLE IF NOT EXISTS erreurs_client (
          id varchar(40) PRIMARY KEY,
          cree_le varchar(30) NOT NULL,
          utilisateur_id varchar(40),
          etablissement_id varchar(40),
          route varchar(200) NOT NULL DEFAULT '',
          message varchar(1000) NOT NULL,
          stack varchar(4000),
          user_agent varchar(300),
          version varchar(60),
          langue varchar(5),
          code_court varchar(12) NOT NULL
        )
      `);
      await getDb().execute(sql`CREATE INDEX IF NOT EXISTS idx_err_code ON erreurs_client (code_court)`);
      await getDb().execute(sql`CREATE INDEX IF NOT EXISTS idx_err_date ON erreurs_client (cree_le)`);
    })().catch((e) => {
      tablePrete = null; // prochain appel : nouvelle tentative
      throw e;
    });
  }
  return tablePrete;
}

// ---------- Limite de débit : 10 / minute / appareil ----------

const MAX_PAR_MINUTE = 10;
const FENETRE_MS = 60_000;

/** Horodatages des envois récents par clé (ip|appareil) */
const passages = new Map<string, number[]>();

/**
 * Vrai si l'envoi est accepté (et comptabilisé), faux si la limite
 * est atteinte. Fenêtre glissante d'une minute.
 */
export function erreurPermise(cle: string): boolean {
  const maintenantMs = Date.now();
  // Purge paresseuse : évite une fuite mémoire si beaucoup d'appareils
  if (passages.size > 1000) {
    for (const [k, liste] of passages) {
      const vivants = liste.filter((t) => maintenantMs - t < FENETRE_MS);
      if (vivants.length === 0) passages.delete(k);
      else passages.set(k, vivants);
    }
  }
  const liste = (passages.get(cle) ?? []).filter((t) => maintenantMs - t < FENETRE_MS);
  if (liste.length >= MAX_PAR_MINUTE) {
    passages.set(cle, liste);
    return false;
  }
  liste.push(maintenantMs);
  passages.set(cle, liste);
  return true;
}

/** Utilitaire de test : vide tous les compteurs */
export function viderLimiteurErreurs(): void {
  passages.clear();
}

// ---------- Enregistrement ----------

/** Insère une erreur validée (user_agent vient de l'en-tête, pas du client) */
export async function enregistrerErreurClient(
  charge: ChargeErreurClient,
  userAgent: string | undefined,
): Promise<void> {
  await assurerTableErreursClient();
  await getDb().insert(s.erreursClient).values({
    id: uid("err"),
    creeLe: maintenant(),
    utilisateurId: charge.utilisateurId ?? null,
    etablissementId: charge.etablissementId ?? null,
    route: (charge.route ?? "").slice(0, 200),
    // Double troncature défensive (le schéma borne déjà) : la colonne
    // ne dépasse jamais sa taille, même avec des caractères exotiques.
    message: charge.message.slice(0, 1000),
    stack: charge.stack ? charge.stack.slice(0, 4000) : null,
    userAgent: userAgent ? userAgent.slice(0, 300) : null,
    version: charge.version ?? null,
    langue: charge.langue ?? null,
    codeCourt: charge.codeCourt.slice(0, 12),
  });
}

// ---------- Lecture super-admin : erreurs groupées ----------

export interface GroupeErreurs {
  message: string;
  codeCourt: string;
  total: number;
  dernierLe: string;
  routes: string[];
  versions: string[];
  langues: string[];
}

/**
 * Erreurs groupées par message + code court, les plus fréquentes
 * d'abord (50 max). C'est la vue « qu'est-ce qui casse en prod ? »
 * de la page super-admin.
 */
export async function erreursGroupees(): Promise<GroupeErreurs[]> {
  await assurerTableErreursClient();
  const lignes = await getDb()
    .select({
      message: s.erreursClient.message,
      codeCourt: s.erreursClient.codeCourt,
      total: sql<number>`count(*)::int`,
      dernierLe: sql<string>`max(${s.erreursClient.creeLe})`,
      routes: sql<string[]>`array_agg(DISTINCT ${s.erreursClient.route})`,
      versions: sql<string[]>`array_remove(array_agg(DISTINCT ${s.erreursClient.version}), NULL)`,
      langues: sql<string[]>`array_remove(array_agg(DISTINCT ${s.erreursClient.langue}), NULL)`,
    })
    .from(s.erreursClient)
    .groupBy(s.erreursClient.message, s.erreursClient.codeCourt)
    .orderBy(sql`count(*) DESC`, sql`max(${s.erreursClient.creeLe}) DESC`)
    .limit(50);
  return lignes.map((l) => ({
    ...l,
    routes: (l.routes ?? []).slice(0, 5),
    versions: (l.versions ?? []).slice(0, 5),
    langues: (l.langues ?? []).slice(0, 5),
  }));
}
