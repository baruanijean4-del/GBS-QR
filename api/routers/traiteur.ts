// ============================================================
// GBS — Routeur tRPC « traiteur » (docs/MODULE-TRAITEUR.md).
//
// Règles permanentes du module :
//  * AUCUN montant visible du gérant, du chef et du magasinier —
//    coûts, prix et marges ne sortent QUE pour le propriétaire (§5) ;
//  * recettes versionnées, immuables après validation (§1, §6) ;
//  * composition du menu figée dans le plan au démarrage (§6) ;
//  * calcul en unités de base entières (mg, ml, pièces), aucun
//    arrondi intermédiaire (§4) ;
//  * bon de sortie groupé par ingrédient, lot FEFO, sans prix (§4) ;
//  * comptage à l'aveugle : le théorique n'est jamais affiché au
//    compteur ; l'écart sort en quantité seule pour le personnel,
//    en valeur pour le propriétaire seul (§7bis).
// ============================================================

import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import * as s from "@db/schema";
import {
  baseParUniteProduit,
  coutTotalCentimes,
  familleUnite,
  formatBase,
  type CoutProduit,
  type FamilleUnite,
} from "@contracts/traiteur";
import type { RoleActif } from "@contracts/types";
import { createRouter, protegee } from "../middleware";
import { alerter, db, erreur, estProprietaireDb, journaliser, rolesSurDb } from "../gbsRouter";
import { maintenant, uid } from "../gbsUtils";

/** Rôles qui voient les données traiteur SANS montants (§9). */
const ROLES_TRAITEUR = ["PROPRIETAIRE", "GERANT", "CHEF", "MAGASINIER"] as const;

/** Seuil d'alerte d'écart de comptage (§7bis) : au-delà de 5 % du
 *  théorique (minimum 2 unités), le propriétaire est alerté. Défaut v1. */
const SEUIL_ECART_COMPTAGE_PCT = 5;
const SEUIL_ECART_COMPTAGE_MIN = 2;

type Ctx = { session: { utilisateurId: string } };

/** Exige un des rôles traiteur sur la terrasse ; renvoie le rôle retenu. */
async function exigerRoleTraiteur(ctx: Ctx, terrasseId: string, roles: readonly RoleActif[]): Promise<RoleActif> {
  const acteurId = ctx.session.utilisateurId;
  const rolesActeur = await rolesSurDb(acteurId, terrasseId);
  const role = roles.find((r) => rolesActeur.includes(r));
  if (!role) erreur("Accès refusé : rôle traiteur requis sur cet établissement.");
  return role;
}

/** Exige le propriétaire (seul rôle à voir un montant, §5). */
async function exigerProprioTraiteur(ctx: Ctx, terrasseId: string): Promise<void> {
  if (!(await estProprietaireDb(ctx.session.utilisateurId, terrasseId))) {
    erreur("Réservé au propriétaire : les coûts et marges ne sortent que pour lui.");
  }
}

/** Composition figée d'un plan démarré (§6). */
interface CompositionFige {
  menuId: string;
  menuVersion: number;
  lignes: {
    menuLigneId: string;
    composantId: string;
    nom: string;
    kind: string;
    qteParPersonneX1000: number;
    recetteId: string | null;
    recetteVersion: number | null;
  }[];
  exclusions: string[]; // composantId absents pour ce contrat (§3)
}

/** Personnes par ligne de menu : répartition des options si fournie
 *  (somme = nbPersonnes, §2), sinon nbPersonnes pour chaque ligne. */
function personnesParLigne(plan: typeof s.traiteurPlans.$inferSelect): Map<string, number> {
  const rep = (plan.repartitionOptions ?? null) as Record<string, number> | null;
  const carte = new Map<string, number>();
  const comp = plan.composition as CompositionFige;
  for (const l of comp.lignes) {
    carte.set(l.menuLigneId, rep && rep[l.menuLigneId] != null ? rep[l.menuLigneId] : plan.nbPersonnes);
  }
  return carte;
}

/** Charge les lignes de recette (figées par version) d'une composition. */
async function composantsDuPlan(comp: CompositionFige, plan: typeof s.traiteurPlans.$inferSelect) {
  const personnes = personnesParLigne(plan);
  const resultat: { ligne: CompositionFige["lignes"][number]; personnes: number; ingredients: (typeof s.traiteurRecetteLignes.$inferSelect)[] }[] = [];
  for (const l of comp.lignes) {
    if (comp.exclusions.includes(l.composantId)) continue; // §3
    const nb = personnes.get(l.menuLigneId) ?? plan.nbPersonnes;
    if (nb <= 0) continue;
    if (!l.recetteId) erreur(`Le composant « ${l.nom} » n'a aucune recette validée.`);
    const ingredients = await db().select().from(s.traiteurRecetteLignes)
      .where(eq(s.traiteurRecetteLignes.recetteId, l.recetteId));
    resultat.push({ ligne: l, personnes: nb, ingredients });
  }
  return resultat;
}

/** Quantités exactes par ingrédient, en unité de base (§4) : arithmétique
 *  BigInt, dénominateur commun 100 000 (= 1000 × 100), UN SEUL arrondi
 *  (ceil) à la toute fin. Les effectifs par ligne (répartition d'options,
 *  §2) sont déjà appliqués via personnesParLigne. */
function agregerIngredients(
  detail: Awaited<ReturnType<typeof composantsDuPlan>>,
): { produitId: string; quantiteBase: number }[] {
  const DEN = 100_000n;
  const totaux = new Map<string, bigint>();
  for (const d of detail) {
    for (const ing of d.ingredients) {
      const num = BigInt(ing.quantiteParPersonneBase)
        * BigInt(d.personnes)
        * BigInt(d.ligne.qteParPersonneX1000)
        * BigInt(100 + ing.tauxPertePct);
      totaux.set(ing.produitId, (totaux.get(ing.produitId) ?? 0n) + num);
    }
  }
  return [...totaux.entries()].map(([produitId, num]) => ({
    produitId,
    quantiteBase: Number((num + DEN - 1n) / DEN),
  }));
}

export const traiteurRouter = createRouter({
  // ---------------- Composants ----------------

  listeComposants: protegee
    .input(z.object({ terrasseId: z.string() }))
    .query(async ({ ctx, input }) => {
      await exigerRoleTraiteur(ctx as Ctx, input.terrasseId, ROLES_TRAITEUR);
      return db().select().from(s.traiteurComposants)
        .where(and(eq(s.traiteurComposants.terrasseId, input.terrasseId), eq(s.traiteurComposants.actif, true)))
        .orderBy(asc(s.traiteurComposants.nom));
    }),

  creerComposant: protegee
    .input(z.object({
      terrasseId: z.string(),
      nom: z.string().trim().min(1).max(120),
      kind: z.enum(["PLAT", "SAUCE", "ACCOMPAGNEMENT", "BOISSON"]),
    }))
    .mutation(async ({ ctx, input }) => {
      const role = await exigerRoleTraiteur(ctx as Ctx, input.terrasseId, ["PROPRIETAIRE", "GERANT", "CHEF"]);
      const id = uid("cmp");
      await db().insert(s.traiteurComposants).values({
        id, terrasseId: input.terrasseId, nom: input.nom, kind: input.kind, actif: true, creeLe: maintenant(),
      });
      await journaliser(ctx.session.utilisateurId, role, "TRAITEUR_COMPOSANT", `Composant « ${input.nom} » (${input.kind})`, { terrasseId: input.terrasseId });
      return { id };
    }),

  // ---------------- Recettes (§1 : proposées par le chef, validées par
  // le propriétaire, versionnées, immuables après validation) ----------

  proposerRecette: protegee
    .input(z.object({
      composantId: z.string(),
      lignes: z.array(z.object({
        produitId: z.string(),
        quantiteParPersonneBase: z.number().int().positive(), // mg | ml | pièces
        tauxPertePct: z.number().int().min(0).max(100).default(0),
      })).min(1),
    }))
    .mutation(async ({ ctx, input }) => {
      const [comp] = await db().select().from(s.traiteurComposants).where(eq(s.traiteurComposants.id, input.composantId)).limit(1);
      if (!comp) erreur("Composant introuvable.");
      const role = await exigerRoleTraiteur(ctx as Ctx, comp.terrasseId, ["PROPRIETAIRE", "CHEF"]);
      // Un produit acheté non cuisiné (boisson) : JAMAIS de taux de perte (§1).
      if (comp.kind === "BOISSON" && input.lignes.some((l) => l.tauxPertePct !== 0)) {
        erreur("Une boisson (produit acheté non cuisiné) n'a aucun taux de perte.");
      }
      // Chaque produit doit exister et avoir une unité convertible en base.
      for (const l of input.lignes) {
        const [p] = await db().select().from(s.produits).where(eq(s.produits.id, l.produitId)).limit(1);
        if (!p || p.terrasseId !== comp.terrasseId) erreur("Produit introuvable sur cet établissement.");
        if (!familleUnite(p.unite)) erreur(`L'unité du produit « ${p.nom} » est inconnue (mg/g/kg, ml/cl/l, pièce attendus).`);
      }
      const versions = await db().select({ v: s.traiteurRecettes.version }).from(s.traiteurRecettes)
        .where(eq(s.traiteurRecettes.composantId, input.composantId)).orderBy(desc(s.traiteurRecettes.version)).limit(1);
      const version = (versions[0]?.v ?? 0) + 1; // nouvelle version — jamais d'écrasement (§6)
      const recetteId = uid("rec");
      await db().insert(s.traiteurRecettes).values({
        id: recetteId, composantId: input.composantId, version, statut: "PROPOSEE",
        proposePar: ctx.session.utilisateurId, creeLe: maintenant(),
      });
      await db().insert(s.traiteurRecetteLignes).values(input.lignes.map((l) => ({
        id: uid("rcl"), recetteId, produitId: l.produitId, sousRecetteId: null,
        quantiteParPersonneBase: l.quantiteParPersonneBase, tauxPertePct: l.tauxPertePct,
      })));
      await journaliser(ctx.session.utilisateurId, role, "TRAITEUR_RECETTE", `Recette « ${comp.nom} » v${version} proposée`, { terrasseId: comp.terrasseId });
      return { recetteId, version };
    }),

  validerRecette: protegee
    .input(z.object({ recetteId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const [rec] = await db().select().from(s.traiteurRecettes).where(eq(s.traiteurRecettes.id, input.recetteId)).limit(1);
      if (!rec) erreur("Recette introuvable.");
      const [comp] = await db().select().from(s.traiteurComposants).where(eq(s.traiteurComposants.id, rec.composantId)).limit(1);
      if (!comp) erreur("Composant introuvable.");
      await exigerProprioTraiteur(ctx as Ctx, comp.terrasseId); // propriétaire SEUL (§1)
      if (rec.statut !== "PROPOSEE") erreur("Seule une recette PROPOSÉE peut être validée.");
      await db().update(s.traiteurRecettes).set({
        statut: "VALIDEE", validePar: ctx.session.utilisateurId, valideeLe: maintenant(),
      }).where(eq(s.traiteurRecettes.id, input.recetteId));
      await journaliser(ctx.session.utilisateurId, "PROPRIETAIRE", "TRAITEUR_RECETTE_VALIDEE", `Recette « ${comp.nom} » v${rec.version} validée`, { terrasseId: comp.terrasseId });
      return { ok: true };
    }),

  listeRecettes: protegee
    .input(z.object({ composantId: z.string() }))
    .query(async ({ ctx, input }) => {
      const [comp] = await db().select().from(s.traiteurComposants).where(eq(s.traiteurComposants.id, input.composantId)).limit(1);
      if (!comp) erreur("Composant introuvable.");
      await exigerRoleTraiteur(ctx as Ctx, comp.terrasseId, ROLES_TRAITEUR);
      const recettes = await db().select().from(s.traiteurRecettes)
        .where(eq(s.traiteurRecettes.composantId, input.composantId)).orderBy(desc(s.traiteurRecettes.version));
      const lignes = recettes.length
        ? await db().select().from(s.traiteurRecetteLignes)
            .where(eq(s.traiteurRecetteLignes.recetteId, recettes[0].id)) // détail de la dernière version
        : [];
      return { recettes, lignes }; // SANS aucun coût (§5)
    }),

  /** Écran propriétaire : toutes les recettes PROPOSÉES de
   *  l'établissement, avec leur détail — sans aucun coût (la
   *  validation se fait sur la composition, pas sur les montants). */
  recettesAValider: protegee
    .input(z.object({ terrasseId: z.string() }))
    .query(async ({ ctx, input }) => {
      await exigerRoleTraiteur(ctx as Ctx, input.terrasseId, ROLES_TRAITEUR);
      const comps = await db().select().from(s.traiteurComposants)
        .where(and(eq(s.traiteurComposants.terrasseId, input.terrasseId), eq(s.traiteurComposants.actif, true)));
      const resultat = [];
      for (const c of comps) {
        const recettes = await db().select().from(s.traiteurRecettes)
          .where(and(eq(s.traiteurRecettes.composantId, c.id), eq(s.traiteurRecettes.statut, "PROPOSEE")))
          .orderBy(desc(s.traiteurRecettes.version));
        for (const r of recettes) {
          const lignes = await db().select().from(s.traiteurRecetteLignes)
            .where(eq(s.traiteurRecetteLignes.recetteId, r.id));
          const produits = lignes.length
            ? await db().select().from(s.produits).where(inArray(s.produits.id, lignes.map((l) => l.produitId)))
            : [];
          const parId = new Map(produits.map((p) => [p.id, p]));
          resultat.push({
            recetteId: r.id, version: r.version, composant: c.nom, kind: c.kind,
            ingredients: lignes.map((l) => {
              const p = parId.get(l.produitId);
              const fam = familleUnite(p?.unite) ?? ("PIECE" as FamilleUnite);
              return {
                produit: p?.nom ?? l.produitId,
                quantite: formatBase(fam, l.quantiteParPersonneBase),
                tauxPertePct: l.tauxPertePct,
              };
            }),
          });
        }
      }
      return resultat;
    }),

  // ---------------- Menus (prix = propriétaire) ----------------

  creerMenu: protegee
    .input(z.object({
      terrasseId: z.string(),
      nom: z.string().trim().min(1).max(120),
      prixPersonneUsd: z.number().int().min(0), // centimes USD
      lignes: z.array(z.object({
        composantId: z.string(),
        qteParPersonneX1000: z.number().int().positive().default(1000), // 1000 = 1
      })).min(1),
    }))
    .mutation(async ({ ctx, input }) => {
      await exigerProprioTraiteur(ctx as Ctx, input.terrasseId);
      const menuId = uid("mnu");
      await db().insert(s.traiteurMenus).values({
        id: menuId, terrasseId: input.terrasseId, nom: input.nom,
        prixPersonneUsd: input.prixPersonneUsd, version: 1, actif: true, creeLe: maintenant(),
      });
      await db().insert(s.traiteurMenuLignes).values(input.lignes.map((l, i) => ({
        id: uid("mnl"), menuId, composantId: l.composantId, qteParPersonneX1000: l.qteParPersonneX1000, position: i,
      })));
      await journaliser(ctx.session.utilisateurId, "PROPRIETAIRE", "TRAITEUR_MENU", `Menu « ${input.nom} » créé`, { terrasseId: input.terrasseId });
      return { menuId };
    }),

  /** Modification d'un menu : version +1 — les plans démarrés gardent
   *  leur composition figée (§6). */
  modifierMenu: protegee
    .input(z.object({
      menuId: z.string(),
      nom: z.string().trim().min(1).max(120).optional(),
      prixPersonneUsd: z.number().int().min(0).optional(),
      lignes: z.array(z.object({
        composantId: z.string(),
        qteParPersonneX1000: z.number().int().positive().default(1000),
      })).min(1).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const [menu] = await db().select().from(s.traiteurMenus).where(eq(s.traiteurMenus.id, input.menuId)).limit(1);
      if (!menu) erreur("Menu introuvable.");
      await exigerProprioTraiteur(ctx as Ctx, menu.terrasseId);
      await db().update(s.traiteurMenus).set({
        nom: input.nom ?? menu.nom,
        prixPersonneUsd: input.prixPersonneUsd ?? menu.prixPersonneUsd,
        version: menu.version + 1,
      }).where(eq(s.traiteurMenus.id, input.menuId));
      if (input.lignes) {
        await db().delete(s.traiteurMenuLignes).where(eq(s.traiteurMenuLignes.menuId, input.menuId));
        await db().insert(s.traiteurMenuLignes).values(input.lignes.map((l, i) => ({
          id: uid("mnl"), menuId: input.menuId, composantId: l.composantId, qteParPersonneX1000: l.qteParPersonneX1000, position: i,
        })));
      }
      await journaliser(ctx.session.utilisateurId, "PROPRIETAIRE", "TRAITEUR_MENU", `Menu « ${menu.nom} » modifié (v${menu.version + 1})`, { terrasseId: menu.terrasseId });
      return { version: menu.version + 1 };
    }),

  listeMenus: protegee
    .input(z.object({ terrasseId: z.string() }))
    .query(async ({ ctx, input }) => {
      const roles = await rolesSurDb(ctx.session.utilisateurId, input.terrasseId);
      if (!ROLES_TRAITEUR.some((r) => roles.includes(r))) erreur("Accès refusé : rôle traiteur requis.");
      const proprio = roles.includes("PROPRIETAIRE");
      const menus = await db().select().from(s.traiteurMenus)
        .where(and(eq(s.traiteurMenus.terrasseId, input.terrasseId), eq(s.traiteurMenus.actif, true)))
        .orderBy(asc(s.traiteurMenus.nom));
      // §5 : le prix n'est renvoyé QU'au propriétaire.
      return menus.map((m) => ({
        id: m.id, nom: m.nom, version: m.version,
        prixPersonneUsd: proprio ? m.prixPersonneUsd : null,
      }));
    }),

  // ---------------- Plans du jour (gérant, §2 — sans prix) ----------------

  creerPlan: protegee
    .input(z.object({
      menuId: z.string(),
      entreprise: z.string().trim().min(1).max(200),
      nbPersonnes: z.number().int().positive(),
      jour: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      heure: z.string().regex(/^\d{2}:\d{2}$/),
      // Menu à choix : { menuLigneId: personnes } — somme = nbPersonnes (§2)
      repartitionOptions: z.record(z.string(), z.number().int().min(0)).optional(),
      exclusions: z.array(z.object({ composantId: z.string(), motif: z.string().max(200).optional() })).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const [menu] = await db().select().from(s.traiteurMenus).where(eq(s.traiteurMenus.id, input.menuId)).limit(1);
      if (!menu) erreur("Menu introuvable.");
      const role = await exigerRoleTraiteur(ctx as Ctx, menu.terrasseId, ["PROPRIETAIRE", "GERANT"]);
      if (input.repartitionOptions) {
        const somme = Object.values(input.repartitionOptions).reduce((a, b) => a + b, 0);
        if (somme !== input.nbPersonnes) erreur(`La répartition des options (${somme}) doit égaler le nombre de personnes (${input.nbPersonnes}).`);
      }
      const planId = uid("pln");
      await db().insert(s.traiteurPlans).values({
        id: planId, terrasseId: menu.terrasseId, menuId: input.menuId, menuVersion: menu.version,
        entreprise: input.entreprise, nbPersonnes: input.nbPersonnes, jour: input.jour, heure: input.heure,
        repartitionOptions: input.repartitionOptions ?? null,
        composition: { menuId: input.menuId, menuVersion: menu.version, lignes: [], exclusions: [] }, // figée au démarrage
        statut: "BROUILLON", creePar: ctx.session.utilisateurId, creeLe: maintenant(),
      });
      if (input.exclusions?.length) {
        await db().insert(s.traiteurPlanExclusions).values(input.exclusions.map((e) => ({
          id: uid("pex"), planId, composantId: e.composantId, motif: e.motif ?? null,
        })));
      }
      await journaliser(ctx.session.utilisateurId, role, "TRAITEUR_PLAN", `Plan « ${input.entreprise} » ${input.jour} (${input.nbPersonnes} pers.)`, { terrasseId: menu.terrasseId });
      return { planId };
    }),

  /** Démarrage : la composition (lignes du menu + versions des recettes
   *  validées + exclusions du contrat) est FIGÉE (§6). */
  demarrerPlan: protegee
    .input(z.object({ planId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const [plan] = await db().select().from(s.traiteurPlans).where(eq(s.traiteurPlans.id, input.planId)).limit(1);
      if (!plan) erreur("Plan introuvable.");
      const role = await exigerRoleTraiteur(ctx as Ctx, plan.terrasseId, ["PROPRIETAIRE", "GERANT"]);
      if (plan.statut !== "BROUILLON") erreur("Seul un plan BROUILLON peut être démarré.");
      const lignesMenu = await db().select().from(s.traiteurMenuLignes)
        .where(eq(s.traiteurMenuLignes.menuId, plan.menuId)).orderBy(asc(s.traiteurMenuLignes.position));
      const exclusions = await db().select().from(s.traiteurPlanExclusions).where(eq(s.traiteurPlanExclusions.planId, plan.id));
      const lignes: CompositionFige["lignes"] = [];
      for (const lm of lignesMenu) {
        const [comp] = await db().select().from(s.traiteurComposants).where(eq(s.traiteurComposants.id, lm.composantId)).limit(1);
        if (!comp) continue;
        // Dernière recette VALIDÉE du composant (jamais une brouillon).
        const [rec] = await db().select().from(s.traiteurRecettes)
          .where(and(eq(s.traiteurRecettes.composantId, lm.composantId), eq(s.traiteurRecettes.statut, "VALIDEE")))
          .orderBy(desc(s.traiteurRecettes.version)).limit(1);
        lignes.push({
          menuLigneId: lm.id, composantId: comp.id, nom: comp.nom, kind: comp.kind,
          qteParPersonneX1000: lm.qteParPersonneX1000,
          recetteId: rec?.id ?? null, recetteVersion: rec?.version ?? null,
        });
      }
      const composition: CompositionFige = {
        menuId: plan.menuId, menuVersion: plan.menuVersion, lignes,
        exclusions: exclusions.map((e) => e.composantId),
      };
      await db().update(s.traiteurPlans).set({ composition, statut: "EN_COURS" }).where(eq(s.traiteurPlans.id, plan.id));
      await journaliser(ctx.session.utilisateurId, role, "TRAITEUR_PLAN_DEMARRE", `Plan « ${plan.entreprise} » démarré (composition figée)`, { terrasseId: plan.terrasseId });
      return { ok: true };
    }),

  listePlans: protegee
    .input(z.object({ terrasseId: z.string() }))
    .query(async ({ ctx, input }) => {
      await exigerRoleTraiteur(ctx as Ctx, input.terrasseId, ROLES_TRAITEUR);
      const plans = await db().select().from(s.traiteurPlans)
        .where(eq(s.traiteurPlans.terrasseId, input.terrasseId)).orderBy(desc(s.traiteurPlans.jour));
      // Jamais de prix ni de coût ici (§5) : on ne renvoie que l'opérationnel.
      return plans.map((p) => ({
        id: p.id, entreprise: p.entreprise, jour: p.jour, heure: p.heure,
        nbPersonnes: p.nbPersonnes, statut: p.statut, menuVersion: p.menuVersion,
      }));
    }),

  // ---------------- Fiche de production (chef, §4 — par composant,
  // SANS prix) ----------------

  ficheProduction: protegee
    .input(z.object({ planId: z.string() }))
    .query(async ({ ctx, input }) => {
      const [plan] = await db().select().from(s.traiteurPlans).where(eq(s.traiteurPlans.id, input.planId)).limit(1);
      if (!plan) erreur("Plan introuvable.");
      await exigerRoleTraiteur(ctx as Ctx, plan.terrasseId, ROLES_TRAITEUR);
      if (plan.statut === "BROUILLON") erreur("Démarrez le plan d'abord : la composition n'est pas encore figée.");
      const detail = await composantsDuPlan(plan.composition as CompositionFige, plan);
      const produitIds = [...new Set(detail.flatMap((d) => d.ingredients.map((i) => i.produitId)))];
      const produits = produitIds.length
        ? await db().select().from(s.produits).where(inArray(s.produits.id, produitIds))
        : [];
      const parId = new Map(produits.map((p) => [p.id, p]));
      return detail.map((d) => ({
        composant: d.ligne.nom,
        kind: d.ligne.kind,
        personnes: d.personnes,
        ingredients: d.ingredients.map((ing) => {
          const p = parId.get(ing.produitId);
          const fam = familleUnite(p?.unite) ?? ("PIECE" as FamilleUnite);
          // Quantité exacte BigInt, arrondi unique à l'affichage (§4).
          const num = BigInt(ing.quantiteParPersonneBase) * BigInt(d.personnes)
            * BigInt(d.ligne.qteParPersonneX1000) * BigInt(100 + ing.tauxPertePct);
          const base = Number((num + 100_000n - 1n) / 100_000n);
          return { produit: p?.nom ?? ing.produitId, quantite: formatBase(fam, base), quantiteBase: base };
        }),
      }));
    }),

  // ---------------- Bon de sortie (magasinier, §4 — par ingrédient,
  // lot FEFO, SANS prix) ----------------

  emettreBonSortie: protegee
    .input(z.object({ planId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const [plan] = await db().select().from(s.traiteurPlans).where(eq(s.traiteurPlans.id, input.planId)).limit(1);
      if (!plan) erreur("Plan introuvable.");
      await exigerRoleTraiteur(ctx as Ctx, plan.terrasseId, ["PROPRIETAIRE", "MAGASINIER"]);
      if (plan.statut !== "EN_COURS") erreur("Le plan doit être EN_COURS pour émettre un bon de sortie.");
      const existant = await db().select({ id: s.traiteurBonsSortie.id }).from(s.traiteurBonsSortie)
        .where(eq(s.traiteurBonsSortie.planId, plan.id)).limit(1);
      if (existant.length) erreur("Un bon de sortie existe déjà pour ce plan (un plan = un bon).");
      const detail = await composantsDuPlan(plan.composition as CompositionFige, plan);
      const lignesAgregees = agregerIngredients(detail);
      if (!lignesAgregees.length) erreur("Aucun ingrédient à sortir (recettes manquantes ?).");
      // Traçabilité par composant (§4) — produitId → composants concernés.
      const composantsParProduit = new Map<string, string[]>();
      for (const d of detail) {
        for (const ing of d.ingredients) {
          const liste = composantsParProduit.get(ing.produitId) ?? [];
          if (!liste.includes(d.ligne.composantId)) liste.push(d.ligne.composantId);
          composantsParProduit.set(ing.produitId, liste);
        }
      }
      const bonId = uid("bon");
      await db().transaction(async (tx) => {
        await tx.insert(s.traiteurBonsSortie).values({
          id: bonId, terrasseId: plan.terrasseId, planId: plan.id, statut: "EMIS",
          magasinierId: ctx.session.utilisateurId, emisLe: maintenant(), creeLe: maintenant(),
        });
        for (const l of lignesAgregees) {
          // Verrou produit : pas de double décrément concurrent.
          const [p] = await tx.select().from(s.produits).where(eq(s.produits.id, l.produitId)).for("update").limit(1);
          if (!p) erreur("Produit introuvable.");
          const facteur = baseParUniteProduit(p.unite);
          if (!facteur) erreur(`L'unité du produit « ${p.nom} » est inconnue.`);
          const unitesStock = Math.ceil(l.quantiteBase / facteur); // base → unité de stock (entier)
          if (p.stock - p.stockReserve < unitesStock) {
            erreur(`Stock insuffisant pour « ${p.nom} » : ${p.stock - p.stockReserve} ${p.unite ?? "unités"} disponibles.`);
          }
          await tx.update(s.produits).set({ stock: p.stock - unitesStock }).where(eq(s.produits.id, p.id));
          await tx.insert(s.traiteurBonLignes).values({
            id: uid("bnl"), bonId, produitId: l.produitId, lot: p.lot ?? null, // lot FEFO retenu
            quantiteBase: l.quantiteBase,
            details: (composantsParProduit.get(l.produitId) ?? []).map((composantId) => ({ composantId })),
          });
          await tx.insert(s.mouvementsStock).values({
            id: uid("mvt"), produitId: l.produitId, terrasseId: plan.terrasseId, type: "TRAITEUR",
            quantite: -unitesStock, motif: `Bon traiteur ${plan.entreprise} ${plan.jour}`,
            acteurId: ctx.session.utilisateurId, roleActif: "MAGASINIER", creeLe: maintenant(),
          });
        }
      });
      await journaliser(ctx.session.utilisateurId, "MAGASINIER", "TRAITEUR_BON", `Bon de sortie émis pour « ${plan.entreprise} » ${plan.jour}`, { terrasseId: plan.terrasseId });
      return { bonId };
    }),

  /** Bon de sortie groupé par ingrédient — SANS AUCUN prix (§4). */
  voirBonSortie: protegee
    .input(z.object({ planId: z.string() }))
    .query(async ({ ctx, input }) => {
      const [plan] = await db().select().from(s.traiteurPlans).where(eq(s.traiteurPlans.id, input.planId)).limit(1);
      if (!plan) erreur("Plan introuvable.");
      await exigerRoleTraiteur(ctx as Ctx, plan.terrasseId, ROLES_TRAITEUR);
      const [bon] = await db().select().from(s.traiteurBonsSortie).where(eq(s.traiteurBonsSortie.planId, plan.id)).limit(1);
      if (!bon) erreur("Aucun bon de sortie pour ce plan.");
      const lignes = await db().select().from(s.traiteurBonLignes).where(eq(s.traiteurBonLignes.bonId, bon.id));
      const produits = lignes.length
        ? await db().select().from(s.produits).where(inArray(s.produits.id, lignes.map((l) => l.produitId)))
        : [];
      const parId = new Map(produits.map((p) => [p.id, p]));
      return {
        id: bon.id, statut: bon.statut, emisLe: bon.emisLe,
        lignes: lignes.map((l) => {
          const p = parId.get(l.produitId);
          const fam = familleUnite(p?.unite) ?? ("PIECE" as FamilleUnite);
          return {
            produit: p?.nom ?? l.produitId, lot: l.lot,
            quantite: formatBase(fam, l.quantiteBase), quantiteBase: l.quantiteBase,
          };
        }),
      };
    }),

  // ---------------- Coûts et marges (§5 — PROPRIÉTAIRE SEUL) ----------------

  coutsPlan: protegee
    .input(z.object({ planId: z.string() }))
    .query(async ({ ctx, input }) => {
      const [plan] = await db().select().from(s.traiteurPlans).where(eq(s.traiteurPlans.id, input.planId)).limit(1);
      if (!plan) erreur("Plan introuvable.");
      await exigerProprioTraiteur(ctx as Ctx, plan.terrasseId); // §5 : propriétaire SEUL
      if (plan.statut === "BROUILLON") erreur("Démarrez le plan d'abord.");
      const [menu] = await db().select().from(s.traiteurMenus).where(eq(s.traiteurMenus.id, plan.menuId)).limit(1);
      const detail = await composantsDuPlan(plan.composition as CompositionFige, plan);
      const produitIds = [...new Set(detail.flatMap((d) => d.ingredients.map((i) => i.produitId)))];
      const produits = produitIds.length
        ? await db().select().from(s.produits).where(inArray(s.produits.id, produitIds))
        : [];
      const parId = new Map(produits.map((p) => [p.id, p]));
      const coutProduit = (produitId: string, quantiteBase: number): CoutProduit => {
        const p = parId.get(produitId);
        return {
          produitId, quantiteBase,
          coutUniteCentimes: p?.coutAchatUsd ?? 0,
          baseParUnite: baseParUniteProduit(p?.unite) ?? 1,
        };
      };
      // Coût par composant, puis total du jour (contrat = exclusions appliquées).
      let totalJour = 0;
      const parComposant = detail.map((d) => {
        const lignes: CoutProduit[] = d.ingredients.map((ing) => {
          const num = BigInt(ing.quantiteParPersonneBase) * BigInt(d.personnes)
            * BigInt(d.ligne.qteParPersonneX1000) * BigInt(100 + ing.tauxPertePct);
          return coutProduit(ing.produitId, Number((num + 100_000n - 1n) / 100_000n));
        });
        const cout = coutTotalCentimes(lignes);
        totalJour += cout;
        return { composant: d.ligne.nom, kind: d.ligne.kind, personnes: d.personnes, coutCentimes: cout };
      });
      const recette = (menu?.prixPersonneUsd ?? 0) * plan.nbPersonnes;
      const marge = recette - totalJour;
      return {
        entreprise: plan.entreprise, jour: plan.jour, nbPersonnes: plan.nbPersonnes,
        prixPersonneCentimes: menu?.prixPersonneUsd ?? 0,
        parComposant,
        coutParPersonneCentimes: Math.round(totalJour / plan.nbPersonnes),
        coutJourCentimes: totalJour,
        recetteCentimes: recette,
        margeCentimes: marge,
        margePct: recette > 0 ? Math.round((marge * 10000) / recette) / 100 : 0,
      };
    }),

  // ---------------- Comptage à l'aveugle (§7bis) ----------------

  /** Le compteur saisit SANS voir le théorique : celui-ci est rempli par
   *  le serveur et n'est JAMAIS renvoyé. La réponse ne contient que la
   *  quantité comptée et l'écart EN QUANTITÉ. */
  comptageAveugle: protegee
    .input(z.object({
      terrasseId: z.string(),
      produitId: z.string(),
      quantiteComptee: z.number().int().min(0),
    }))
    .mutation(async ({ ctx, input }) => {
      const role = await exigerRoleTraiteur(ctx as Ctx, input.terrasseId, ["PROPRIETAIRE", "GERANT", "MAGASINIER"]);
      const [p] = await db().select().from(s.produits).where(eq(s.produits.id, input.produitId)).limit(1);
      if (!p || p.terrasseId !== input.terrasseId) erreur("Produit introuvable sur cet établissement.");
      const theorique = p.stock; // rempli SERVEUR, jamais affiché au compteur
      const ecart = theorique - input.quantiteComptee;
      const id = uid("cpt");
      await db().insert(s.traiteurComptages).values({
        id, terrasseId: input.terrasseId, produitId: input.produitId,
        comptePar: ctx.session.utilisateurId, quantiteComptee: input.quantiteComptee,
        theorique, ecart, creeLe: maintenant(),
      });
      await journaliser(ctx.session.utilisateurId, role, "TRAITEUR_COMPTAGE",
        `Comptage « ${p.nom} » : ${input.quantiteComptee} comptées`, { terrasseId: input.terrasseId });
      // Alerte propriétaire au-delà du seuil (§7bis) — en QUANTITÉ seule.
      const seuil = Math.max(SEUIL_ECART_COMPTAGE_MIN, Math.ceil((theorique * SEUIL_ECART_COMPTAGE_PCT) / 100));
      if (Math.abs(ecart) > seuil) {
        await alerter(input.terrasseId, "ECART_COMPTAGE",
          `Écart d'inventaire : ${p.nom} — écart de ${ecart > 0 ? "-" : "+"}${Math.abs(ecart)} ${p.unite ?? "unités"}.`);
      }
      return { id, quantiteComptee: input.quantiteComptee, ecart };
    }),

  /** Écarts d'inventaire : QUANTITÉS pour tous les rôles traiteur ;
   *  la VALEUR n'apparaît que pour le propriétaire (§7bis). */
  listeEcarts: protegee
    .input(z.object({ terrasseId: z.string() }))
    .query(async ({ ctx, input }) => {
      const roles = await rolesSurDb(ctx.session.utilisateurId, input.terrasseId);
      if (!ROLES_TRAITEUR.some((r) => roles.includes(r))) erreur("Accès refusé : rôle traiteur requis.");
      const proprio = roles.includes("PROPRIETAIRE");
      const comptages = await db().select().from(s.traiteurComptages)
        .where(eq(s.traiteurComptages.terrasseId, input.terrasseId)).orderBy(desc(s.traiteurComptages.creeLe)).limit(100);
      const produits = comptages.length
        ? await db().select().from(s.produits).where(inArray(s.produits.id, comptages.map((c) => c.produitId)))
        : [];
      const parId = new Map(produits.map((p) => [p.id, p]));
      return comptages.map((c) => {
        const p = parId.get(c.produitId);
        return {
          id: c.id, produit: p?.nom ?? c.produitId, unite: p?.unite ?? null,
          quantiteComptee: c.quantiteComptee, ecart: c.ecart, creeLe: c.creeLe,
          // Valeur de l'écart : propriétaire SEUL (jamais pour le personnel).
          valeurEcartCentimes: proprio ? c.ecart * (p?.coutAchatUsd ?? 0) : null,
        };
      });
    }),
});
