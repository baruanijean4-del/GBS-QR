// ============================================================
// GBS — Schémas Zod des établissements (Étape 6)
// L'identité de l'appelant vient du jeton de session (ctx) —
// jamais d'un acteurId fourni par le client.
// ============================================================

import { z } from "zod";

/** Création d'un établissement (terrasse, boutique ou autre métier) */
export const zCreerEtablissement = z.object({
  organisationId: z.string().min(1),
  nom: z.string().min(1).max(120),
  adresse: z.string().max(200).default(""),
  type: z.enum(["TERRASSE", "GUEST_HOUSE", "BOUTIQUE", "RESTAURANT", "PHARMACIE", "SALON", "AUTRE", "QUINCAILLERIE"]),
  /** Nombre de tables (ignoré pour une zone unique : 1 seule zone « Comptoir ») */
  nombreTables: z.number().int().min(1).max(100).default(6),
});

/** Liste des établissements visibles par l'utilisateur connecté */
export const zListerEtablissements = z.object({}); // un éventuel acteurId legacy est ignoré

/** Ajout d'une table (terrasse uniquement — refusé pour une boutique) */
export const zAjouterTable = z.object({
  etablissementId: z.string().min(1),
  numero: z.number().int().min(1).max(100).optional(),
});

/** Archivage d'une table (soft delete) */
export const zSupprimerTable = z.object({
  tableId: z.string().min(1),
});
