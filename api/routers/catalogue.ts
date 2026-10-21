// ============================================================
// GBS — Routeur tRPC « catalogue » (Étape 7)
// Catalogue de démarrage multi-pays : liste + import dans un
// établissement (prix par défaut ou indicatifs, stock à 0).
// ============================================================

import { z } from "zod";
import { asc, eq, inArray, sql } from "drizzle-orm";
import * as s from "@db/schema";
import { createRouter, protegee } from "../middleware";
import { db, exigerProprietaire, journaliser } from "../gbsRouter";
import { prixPour } from "../../db/seed";
import { uid } from "../gbsUtils";
import { chercherOpenFoodFacts, REGEX_CODE_BARRES } from "../services/openFoodFacts";
import { maintenant } from "../gbsUtils";

// L'identité de l'appelant vient du jeton de session (ctx.session) —
// un éventuel acteurId legacy envoyé par un ancien client est ignoré.

const zListerCatalogue = z.object({});

const zImporterDansEtablissement = z.object({
  etablissementId: z.string().min(1),
  produitIds: z.array(z.string().min(1)).min(1).max(200),
  /** Prix appliqué à tous les articles importés (sinon prix indicatifs) */
  prixParDefaut: z.object({
    prixCdf: z.number().int().min(0),
    prixUsdCentimes: z.number().int().min(0),
  }).optional(),
});

export const catalogueRouter = createRouter({
  /** Tous les articles actifs du catalogue, triés catégorie puis ordre */
  lister: protegee
    .input(zListerCatalogue)
    .query(async ({ ctx }) => {
      // Réservé au personnel identifié (le catalogue n'est pas public)
      const [u] = await db().select({ id: s.utilisateurs.id }).from(s.utilisateurs)
        .where(eq(s.utilisateurs.id, ctx.session.utilisateurId)).limit(1);
      if (!u) return [];
      return db().select().from(s.catalogueProduits)
        .where(eq(s.catalogueProduits.actif, true))
        .orderBy(asc(s.catalogueProduits.categorie), asc(s.catalogueProduits.ordreAffichage));
    }),

  /** Importe des articles du catalogue dans un établissement (PROPRIETAIRE) */
  importerDansEtablissement: protegee
    .input(zImporterDansEtablissement)
    .mutation(async ({ input, ctx }) => {
      const acteurId = ctx.session.utilisateurId;
      // Sécurité : le rôle RESPONSABLE n'existant pas, PROPRIETAIRE uniquement
      await exigerProprietaire(acteurId, input.etablissementId);

      const articles = await db().select().from(s.catalogueProduits)
        .where(inArray(s.catalogueProduits.id, input.produitIds));
      const actifs = articles.filter((a) => a.actif);

      // Idempotence : on ignore les doublons déjà présents (même nom affiché)
      const existants = await db().select({ nom: s.produits.nom })
        .from(s.produits).where(eq(s.produits.terrasseId, input.etablissementId));
      const dejaLa = new Set(existants.map((p) => p.nom));

      const crees: (typeof s.produits.$inferInsert)[] = [];
      for (const a of actifs) {
        const nomAffiche = a.variante ? `${a.nom} ${a.variante}` : a.nom;
        if (dejaLa.has(nomAffiche)) continue;
        const prix = input.prixParDefaut
          ? { cdf: input.prixParDefaut.prixCdf, usd: input.prixParDefaut.prixUsdCentimes }
          : prixPour(a.nom, a.variante, a.categorie);
        crees.push({
          id: uid("prd"), terrasseId: input.etablissementId,
          nom: nomAffiche,
          categorie: a.categorie,
          prixCdf: prix.cdf, prixUsd: prix.usd,
          stock: 0, stockReserve: 0, seuilAlerte: 6, actif: true,
          photoUrl: a.photoUrl, photoThumbnailUrl: a.photoThumbnailUrl,
          photoSource: "CATALOGUE",
          variante: a.variante,
          consignable: a.consignable,
          bouteillesParCasier: a.bouteillesParCasier,
        });
        dejaLa.add(nomAffiche);
      }

      if (crees.length > 0) {
        await db().insert(s.produits).values(crees);
        await journaliser(acteurId, "PROPRIETAIRE", "IMPORT_CATALOGUE",
          `${crees.length} article(s) importé(s) du catalogue`);
      }
      return { importes: crees.length, produits: crees };
    }),

  // ----------------------------------------------------------
  // Codes-barres (scan caméra) : référentiel local puis OFF
  // ----------------------------------------------------------

  /** Recherche un code-barres : 1. base locale (+ compteur),
   *  2. Open Food Facts (mis en cache), 3. null si inconnu. */
  rechercherParCodeBarres: protegee
    .input(z.object({ codeBarres: z.string().trim().regex(REGEX_CODE_BARRES, "8 à 14 chiffres") }))
    .query(async ({ input }) => {
      const code = input.codeBarres;

      // 1. Référentiel local : immédiat, sans réseau
      const [local] = await db().select().from(s.catalogueCodesBarres)
        .where(eq(s.catalogueCodesBarres.codeBarres, code)).limit(1);
      if (local) {
        await db().update(s.catalogueCodesBarres)
          .set({ nbUtilisations: sql`${s.catalogueCodesBarres.nbUtilisations} + 1` })
          .where(eq(s.catalogueCodesBarres.id, local.id));
        return {
          source: "LOCAL" as const,
          codeBarres: local.codeBarres,
          nom: local.nom,
          categorie: local.categorie,
          variante: local.variante,
          photoUrl: local.photoUrl,
          consignable: local.consignable,
          bouteillesParCasier: local.bouteillesParCasier,
          prixCdfMoyen: local.prixCdfMoyen,
          prixUsdMoyen: local.prixUsdMoyen,
        };
      }

      // 2. Open Food Facts : succès → mis en cache pour les prochains scans
      const off = await chercherOpenFoodFacts(code);
      if (off) {
        await db().insert(s.catalogueCodesBarres).values({
          id: uid("cb"),
          codeBarres: code,
          nom: off.nom.slice(0, 120),
          categorie: off.categorie,
          variante: off.format?.slice(0, 60) ?? null,
          photoUrl: off.photoUrl?.slice(0, 500) ?? null,
          consignable: false,
          bouteillesParCasier: null,
          prixCdfMoyen: null,
          prixUsdMoyen: null,
          nbUtilisations: 1,
          source: "OPEN_FOOD_FACTS",
          creeLe: maintenant(),
        }).onConflictDoNothing();
        return {
          source: "OPEN_FOOD_FACTS" as const,
          codeBarres: code,
          nom: off.nom.slice(0, 120),
          categorie: off.categorie,
          variante: off.format?.slice(0, 60) ?? null,
          photoUrl: off.photoUrl?.slice(0, 500) ?? null,
          consignable: false,
          bouteillesParCasier: null as number | null,
          prixCdfMoyen: null as number | null,
          prixUsdMoyen: null as number | null,
        };
      }

      // 3. Inconnu partout : le client bascule en saisie manuelle
      return null;
    }),

  /** Enregistre un code-barres saisi manuellement (ignore les doublons). */
  enregistrerCodeBarres: protegee
    .input(z.object({
      codeBarres: z.string().trim().regex(REGEX_CODE_BARRES, "8 à 14 chiffres"),
      nom: z.string().trim().min(1).max(120),
      categorie: z.string().trim().min(1).max(60).default("Divers"),
      variante: z.string().trim().max(60).optional(),
      consignable: z.boolean().default(false),
      bouteillesParCasier: z.number().int().min(1).max(48).optional(),
      prixCdfMoyen: z.number().int().min(0).optional(),
      prixUsdMoyen: z.number().int().min(0).optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const insere = await db().insert(s.catalogueCodesBarres).values({
        id: uid("cb"),
        codeBarres: input.codeBarres,
        nom: input.nom,
        categorie: input.categorie,
        variante: input.variante ?? null,
        photoUrl: null,
        consignable: input.consignable,
        bouteillesParCasier: input.bouteillesParCasier ?? null,
        prixCdfMoyen: input.prixCdfMoyen ?? null,
        prixUsdMoyen: input.prixUsdMoyen ?? null,
        nbUtilisations: 1,
        source: "MANUEL",
        creeLe: maintenant(),
      }).onConflictDoNothing().returning({ id: s.catalogueCodesBarres.id });
      if (insere.length > 0) {
        await journaliser(ctx.session.utilisateurId, null, "CODE_BARRES_ENREGISTRE",
          `${input.codeBarres} — ${input.nom}`);
      }
      return { insere: insere.length > 0 };
    }),
});
