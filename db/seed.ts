// ============================================================
// GBS / Nganda POS — Seed du RÉFÉRENTIEL (boucle 2)
//
// ZÉRO DÉMO EN PRODUCTION : ce fichier ne contient que les
// données de référence indispensables au fonctionnement :
//   - catalogue multi-pays ~1000 articles (fonction génératrice) ;
//   - 10 plans tarifaires (dont le plan BOUTIQUE 5 USD/mois) ;
//   - 10 codes-barres connus (catalogueCodesBarres) ;
//   - compteur de factures (meta).
//
// Les données de démonstration (organisation « Nganda Group »,
// 4 personas, 6 établissements, commandes, alertes) vivent dans
// db/fixtures-demo.ts — jamais exécutées en production.
//
// Contraintes : idempotent, insertion par lots de 100,
// commenté en français.
//
// Exécution :  npx tsx db/seed.ts                    (référentiel seul)
//              npx tsx db/seed.ts --avec-demo        (+ fixtures démo)
//              npx tsx db/seed.ts --reinitialiser [--avec-demo]
// ============================================================

import { getDb } from "../api/queries/connection";
import type { PgTable } from "drizzle-orm/pg-core";
import * as s from "./schema";
import { maintenant } from "../api/gbsUtils";
import { CATEGORIES_PAR_TYPE } from "../contracts/types";

// ------------------------------------------------------------
// 4.4 / 4.5 — Catalogue multi-pays : fonction génératrice
// ------------------------------------------------------------
type CategorieSlug =
  | "bieres" | "boissons" | "savons" | "produits-base" | "poissons" | "snacks" | "divers"
  // Nouveaux métiers
  | "quincaillerie" | "pharmacie" | "restaurant" | "hotel";

const LIBELLE_CATEGORIE: Record<CategorieSlug, string> = {
  bieres: "Bières",
  boissons: "Boissons",
  savons: "Savons & détergents",
  "produits-base": "Produits de base",
  poissons: "Poissons",
  snacks: "Snacks & conserves",
  divers: "Divers",
  quincaillerie: "Quincaillerie",
  pharmacie: "Pharmacie",
  restaurant: "Restaurant",
  hotel: "Hôtel & hébergement",
};

/** Une marque de base + ses formats (variantes de conditionnement). */
interface ProduitBase {
  nom: string;
  formats: string[];
  /** bouteille verre consignée (casiers générés automatiquement) */
  consignable?: boolean;
  /** génère « Pack 6 × format » pour les petits formats */
  pack6?: boolean;
  /** génère « Carton N × format » pour les petits formats */
  carton?: number;
  /** génère « Display 12 × format » (présentoir comptoir) pour les petits formats */
  display12?: boolean;
}

/** Ligne d'insertion du catalogue référentiel (exportée pour les fixtures). */
export type ProduitCatalogueSeed = typeof s.catalogueProduits.$inferInsert;

/**
 * Prix indicatifs (CDF) des produits « métiers » : clé « nom|format ».
 * Remplis automatiquement par baseAvecPrix() : le format et son prix sont
 * déclarés au même endroit, impossible de les désynchroniser.
 * ⚠️ Estimations de départ, à valider sur le terrain (Lubumbashi, 2026).
 */
const PRIX_INDICATIFS_CDF: Record<string, number> = {};

/** Déclare un produit avec ses formats ET ses prix en CDF. */
function baseAvecPrix(nom: string, prixParFormat: Record<string, number>): ProduitBase {
  for (const [format, cdf] of Object.entries(prixParFormat)) {
    PRIX_INDICATIFS_CDF[`${nom}|${format}`] = cdf;
  }
  return { nom, formats: Object.keys(prixParFormat) };
}

/** Petit format de vente au détail (éligible Pack 6 / Carton 24). */
function estPetitFormat(format: string): boolean {
  // Gros conditionnements explicites → pas de déclinaison supplémentaire
  if (/^(Casier|Pack|Carton|Sac|Bidon|Lot|Display|Grand format)/.test(format)) return false;
  // Formats vrac lourds (sacs, bidons, kilos, litres) → pas de carton gros
  if (/\d+(?:,\d+)?\s*(kg|L)\b/.test(format)) return false;
  return true;
}

/** Volume en cl d'un format bouteille (0 si non liquide). */
function volumeCl(format: string): number {
  const cl = /^(\d+)\s*cl/.exec(format);
  if (cl) return Number(cl[1]);
  const ml = /^(\d+)\s*ml/.exec(format);
  if (ml) return Number(ml[1]) / 100;
  const l = /^(\d+(?:,\d+)?)\s*L/.exec(format);
  if (l) return Number(l[1].replace(",", ".")) * 100;
  return 0;
}

/**
 * Génère le catalogue complet : chaque produit de base est déployé en
 * variantes de format, puis enrichi des conditionnements gros
 * (Casier 12/24 pour le verre consigné, Pack 6, Carton N).
 * Compte cible : ~1000 articles.
 */
export function genererCatalogueMultiPays(): ProduitCatalogueSeed[] {
  const tous: ProduitCatalogueSeed[] = [];
  let ordre = 0;

  const pousser = (
    categorie: CategorieSlug,
    nom: string,
    format: string | null,
    consignable: boolean,
    bouteillesParCasier: number | null,
  ) => {
    ordre += 1;
    tous.push({
      id: `cat_${String(ordre).padStart(4, "0")}`,
      categorie: LIBELLE_CATEGORIE[categorie],
      nom,
      variante: format,
      consignable,
      bouteillesParCasier,
      // Photos génériques par catégorie (marques non reproduites)
      photoUrl: `/catalogue/${categorie}.webp`,
      photoThumbnailUrl: `/catalogue/${categorie}-vignette.webp`,
      ordreAffichage: ordre,
      actif: true,
    });
  };

  const deployer = (categorie: CategorieSlug, base: ProduitBase) => {
    for (const format of base.formats) {
      const consignable = Boolean(base.consignable) && volumeCl(format) > 0 && !/Canette/.test(format);
      pousser(categorie, base.nom, format, consignable, null);
      // Verre consigné → casier (24 pour ≤ 33cl, 12 au-delà)
      if (consignable) {
        const taille = volumeCl(format) <= 33 ? 24 : 12;
        pousser(categorie, base.nom, `Casier ${taille}×${format}`, true, taille);
      }
      // Conditionnements gros pour les petits formats (boutique)
      if (estPetitFormat(format)) {
        if (base.pack6) pousser(categorie, base.nom, `Pack 6×${format}`, false, null);
        if (base.display12) pousser(categorie, base.nom, `Display 12×${format}`, false, null);
        if (base.carton) pousser(categorie, base.nom, `Carton ${base.carton}×${format}`, false, null);
      }
    }
  };

  for (const [categorie, bases] of Object.entries(CATALOGUE_BASE) as [CategorieSlug, ProduitBase[]][]) {
    for (const base of bases) deployer(categorie, base);
  }
  return tous;
}

// ------------------------------------------------------------
// Données de base du catalogue (réalités Katanga, RDC, Angola,
// Congo-Brazzaville, Zambie, Afrique du Sud)
// ------------------------------------------------------------
const CATALOGUE_BASE: Record<CategorieSlug, ProduitBase[]> = {
  // ~240 articles après déploiement
  bieres: [
    // Katanga (base)
    { nom: "Simba", formats: ["33cl", "73cl", "33cl Canette"], consignable: true, pack6: true, carton: 24 },
    { nom: "Tembo", formats: ["33cl", "60cl"], consignable: true, carton: 24 },
    { nom: "Skol", formats: ["33cl", "65cl"], consignable: true, carton: 24 },
    // RDC
    { nom: "Primus", formats: ["33cl", "65cl", "72cl"], consignable: true, carton: 24 },
    { nom: "Mützig", formats: ["33cl", "65cl"], consignable: true, carton: 24 },
    { nom: "Turbo King", formats: ["33cl", "65cl"], consignable: true, carton: 24 },
    { nom: "Legend", formats: ["33cl", "65cl"], consignable: true, carton: 24 },
    { nom: "Nkoyi Blonde", formats: ["33cl", "50cl", "65cl"], consignable: true, carton: 24 },
    { nom: "Castel", formats: ["33cl", "65cl"], consignable: true, carton: 24 },
    { nom: "Beaufort", formats: ["33cl", "65cl"], consignable: true, carton: 24 },
    { nom: "Doppel München", formats: ["33cl", "65cl"], consignable: true, carton: 24 },
    { nom: "Heineken", formats: ["33cl", "65cl", "33cl Canette"], consignable: true, pack6: true, carton: 24 },
    { nom: "Guinness Foreign Extra", formats: ["33cl"], consignable: true, carton: 24 },
    { nom: "Savanna Dry", formats: ["33cl"], consignable: true, carton: 24 },
    // Angola
    { nom: "Cuca", formats: ["31cl", "33cl", "25cl Mini", "33cl Canette"], consignable: true, pack6: true, carton: 24 },
    { nom: "Nocal", formats: ["33cl", "33cl Canette"], consignable: true, pack6: true, carton: 24 },
    { nom: "EKA", formats: ["33cl", "33cl Canette"], consignable: true, pack6: true, carton: 24 },
    { nom: "N'gola", formats: ["33cl", "33cl Canette"], consignable: true, pack6: true, carton: 24 },
    { nom: "Doppel", formats: ["33cl", "33cl Canette"], consignable: true, pack6: true, carton: 24 },
    { nom: "33 Export", formats: ["33cl", "33cl Canette"], consignable: true, pack6: true, carton: 24 },
    { nom: "Booster", formats: ["33cl", "33cl Canette"], consignable: true, pack6: true, carton: 24 },
    { nom: "Sagres", formats: ["33cl", "33cl Canette"], consignable: true, pack6: true, carton: 24 },
    { nom: "Super Bock", formats: ["33cl", "33cl Canette"], consignable: true, pack6: true, carton: 24 },
    { nom: "Cristal", formats: ["33cl", "33cl Canette"], consignable: true, pack6: true, carton: 24 },
    { nom: "Luberg", formats: ["33cl", "50cl"], consignable: true, carton: 24 },
    // Congo-Brazzaville
    { nom: "Ngok", formats: ["33cl", "65cl"], consignable: true, carton: 24 },
    { nom: "Class", formats: ["33cl", "65cl"], consignable: true, carton: 24 },
    // Zambie
    { nom: "Mosi", formats: ["33cl", "50cl", "33cl Canette"], consignable: true, pack6: true, carton: 24 },
    { nom: "Eagle", formats: ["33cl", "50cl"], consignable: true, carton: 24 },
    { nom: "Eagle Extra", formats: ["375ml", "50cl"], consignable: true, carton: 24 },
    { nom: "Carling Black Label", formats: ["33cl", "50cl", "33cl Canette"], consignable: true, pack6: true, carton: 24 },
    { nom: "Castle Lite", formats: ["33cl", "50cl"], consignable: true, carton: 24 },
    { nom: "Corona", formats: ["33cl", "33cl Canette"], pack6: true, carton: 24 },
    { nom: "Budweiser", formats: ["33cl", "33cl Canette"], pack6: true, carton: 24 },
    { nom: "Stella Artois", formats: ["33cl", "33cl Canette"], pack6: true, carton: 24 },
    // Afrique du Sud (craft + premium)
    { nom: "Soul Barrel Wild African Soul", formats: ["33cl", "75cl"], consignable: true, carton: 12 },
    { nom: "Richmond Hill Car Park John", formats: ["33cl", "50cl"], consignable: true, carton: 12 },
    { nom: "Jack Black's Lager", formats: ["33cl", "50cl"], consignable: true, carton: 12 },
    { nom: "Darling Bone Crusher", formats: ["33cl", "50cl"], consignable: true, carton: 12 },
    { nom: "Devil's Peak King's Blockhouse", formats: ["33cl", "50cl"], consignable: true, carton: 12 },
    { nom: "CBC Amber Weiss", formats: ["33cl", "50cl"], consignable: true, carton: 12 },
  ],

  // ~150 articles après déploiement
  boissons: [
    { nom: "Coca-Cola", formats: ["33cl", "1L", "1,5L", "2L", "33cl Canette"], consignable: true, pack6: true, carton: 24 },
    { nom: "Fanta Orange", formats: ["33cl", "1L", "2L", "33cl Canette"], consignable: true, pack6: true, carton: 24 },
    { nom: "Fanta Citron", formats: ["33cl", "1L"], consignable: true, carton: 24 },
    { nom: "Fanta Cocktail", formats: ["33cl", "1L"], consignable: true, carton: 24 },
    { nom: "Sprite", formats: ["33cl", "1L", "2L", "33cl Canette"], consignable: true, pack6: true, carton: 24 },
    { nom: "Schweppes Tonic", formats: ["33cl"], consignable: true, carton: 24 },
    { nom: "XXL Energy", formats: ["33cl", "50cl"], carton: 24 },
    { nom: "Power Horse", formats: ["33cl", "50cl"], carton: 24 },
    { nom: "Red Bull", formats: ["25cl Canette"], pack6: true, carton: 24 },
    { nom: "Malta Guinness", formats: ["33cl"], consignable: true, carton: 24 },
    { nom: "Vital'O", formats: ["33cl"], consignable: true, carton: 24 },
    { nom: "Tangawisi (gingembre)", formats: ["33cl"], consignable: true, carton: 24 },
    { nom: "Eau Alpina", formats: ["50cl", "1L", "1,5L", "5L Bidon"], carton: 12 },
    { nom: "Eau Vive", formats: ["50cl", "1L", "1,5L"], carton: 12 },
    { nom: "Canadian Pure", formats: ["50cl", "1,5L"], carton: 12 },
    { nom: "Eau Swissta", formats: ["50cl", "1,5L"], carton: 12 },
    { nom: "Jus Top Mangue", formats: ["1L", "33cl"], carton: 12 },
    { nom: "Jus Top Ananas", formats: ["1L", "33cl"], carton: 12 },
    { nom: "Jus Top Goyave", formats: ["1L", "33cl"], carton: 12 },
    { nom: "Jus Jambo Multivitamine", formats: ["1L"], carton: 12 },
    { nom: "Eau Jambo", formats: ["50cl", "1,5L"], carton: 12 },
    { nom: "Eau Dasani", formats: ["50cl", "1,5L"], carton: 12 },
    { nom: "Maltina", formats: ["33cl"], consignable: true, carton: 24 },
    { nom: "Amstel Malta", formats: ["33cl"], consignable: true, carton: 24 },
    { nom: "Mirinda Orange", formats: ["33cl", "33cl Canette"], consignable: true, pack6: true, carton: 24 },
    { nom: "Thé glacé Fuze", formats: ["33cl", "50cl"], carton: 24 },
    { nom: "Café glacé Rio", formats: ["33cl Canette"], pack6: true, carton: 24 },
    { nom: "Limonade Lorina", formats: ["33cl"], consignable: true, carton: 24 },
    { nom: "Eau gazéifiée Perrier", formats: ["33cl", "1L"], consignable: true, carton: 24 },
    { nom: "Jus Ceres Mangue", formats: ["1L", "33cl"], carton: 12 },
    { nom: "Jus Ceres Ananas", formats: ["1L"], carton: 12 },
  ],

  // ~120 articles après déploiement
  savons: [
    { nom: "Savon Lecoq", formats: ["Blanc", "Rose", "Jaune", "Vert", "Pièce", "Paquet 4", "Carton 24"], carton: 48 },
    { nom: "Savon Munganga", formats: ["Medical", "Mutoza", "Pièce", "Carton 24", "Carton 48"], carton: 48 },
    { nom: "Savon Génie", formats: ["Pièce", "Carton 24"], carton: 48 },
    { nom: "Savon Klin", formats: ["Pièce", "Carton 24"], carton: 48 },
    { nom: "Savon Spring", formats: ["Pièce", "Carton 24"], carton: 48 },
    { nom: "Savon Lux", formats: ["Pièce", "Paquet 3"], carton: 48 },
    { nom: "Savon Dettol", formats: ["Pièce", "Paquet 3"], carton: 48 },
    { nom: "Omo", formats: ["500g Sachet", "1kg Sachet", "Carton 12"], carton: 24 },
    { nom: "Ariel", formats: ["500g Sachet", "1kg Sachet"], carton: 24 },
    { nom: "Sunlight (liquide)", formats: ["400ml Sachet", "750ml Bouteille"], carton: 24 },
    { nom: "Bleu Band", formats: ["1kg Sachet"], carton: 24 },
    { nom: "Lessive Maq", formats: ["500g Sachet", "1kg Sachet", "2kg Sachet"], carton: 24 },
    { nom: "Lessive Dixan", formats: ["1kg Sachet", "Paquet 3kg"], carton: 24 },
    { nom: "Savon Palmolive", formats: ["Pièce", "Paquet 3"], carton: 48 },
    { nom: "Liquide vaisselle Sunlight", formats: ["400ml Bouteille", "750ml Bouteille"], carton: 24 },
    { nom: "Désinfectant Dettol", formats: ["250ml Bouteille", "500ml Bouteille"], carton: 24 },
    { nom: "Savon de Marseille", formats: ["Bloc 400g", "Pièce"], carton: 48 },
    { nom: "Lessive Sunlight (poudre)", formats: ["500g Sachet", "1kg Sachet", "Carton 12"], carton: 24 },
    { nom: "Adoucissant Comfort", formats: ["500ml Bouteille", "1L Bouteille"], carton: 24 },
    { nom: "Savon noir traditionnel", formats: ["Pièce", "Paquet 4"], carton: 48 },
    { nom: "Détergent multi-usage", formats: ["500ml Bouteille", "1L Bouteille"], carton: 24 },
    { nom: "Pastilles Javel", formats: ["Tube 20", "Carton 24"], carton: 48 },
    { nom: "Javel La Croix", formats: ["1L Bouteille", "2L Bidon"], carton: 12 },
  ],

  // ~200 articles après déploiement
  "produits-base": [
    { nom: "Riz Lion", formats: ["Sac 25kg", "Sac 50kg", "Kopo", "Détail 1kg"], carton: 20 },
    { nom: "Riz BB", formats: ["Sac 25kg", "Sac 50kg", "Kopo", "Détail 1kg"], carton: 20 },
    { nom: "Riz Riano", formats: ["Sac 25kg", "Kopo", "Détail 1kg"], carton: 20 },
    { nom: "Riz Tigre", formats: ["Sac 25kg", "Sac 50kg", "Détail 1kg"], carton: 20 },
    { nom: "Farine de maïs Extra", formats: ["Sac 50kg", "Sac 25kg", "Kopo", "Détail 1kg"], carton: 20 },
    { nom: "Farine de maïs Standard", formats: ["Sac 50kg", "Sac 25kg", "Kopo", "Détail 1kg"], carton: 20 },
    { nom: "Farine de manioc", formats: ["Sac 50kg", "Sac 25kg", "Kopo", "Cossettes 5kg", "Détail 1kg"], carton: 20 },
    { nom: "Semoule de maïs Extra", formats: ["Sac 25kg", "Sac 5kg", "Détail 1kg"], carton: 20 },
    { nom: "Sucre Kwilu-Ngongo", formats: ["Sac 50kg", "Sachet 5kg", "Kopo 1kg"], carton: 20 },
    { nom: "Sucre cristallisé", formats: ["Sac 50kg", "Sachet 5kg"], carton: 20 },
    { nom: "Sel", formats: ["Sac 10kg", "Paquet 1kg", "Carton 24×500g"], carton: 24 },
    { nom: "Haricots Madesu ya Lufu", formats: ["Kopo", "Sakombi", "Sac 100kg", "Détail 1kg"], carton: 20 },
    { nom: "Haricots BilBil", formats: ["Kopo", "Sac 100kg", "Détail 1kg"], carton: 20 },
    { nom: "Niébé (Mbuengi)", formats: ["Kopo", "Sakombi", "Détail 1kg"], carton: 20 },
    { nom: "Arachide", formats: ["Kopo", "Sachet 1kg", "Sac 50kg"], carton: 20 },
    { nom: "Cossettes de manioc", formats: ["Kopo", "Sac 50kg", "Sac 5kg"], carton: 20 },
    { nom: "Feuilles de manioc (pondu)", formats: ["Paquet", "Sakombi"], carton: 20 },
    { nom: "Pâte d'arachide", formats: ["Pot 500g", "Kopo"], carton: 20 },
    { nom: "Maïs grain", formats: ["Sac 50kg", "Sac 25kg", "Kopo", "Détail 1kg"], carton: 20 },
    { nom: "Soja sec", formats: ["Sac 50kg", "Kopo", "Détail 1kg"], carton: 20 },
    { nom: "Riz Pouni", formats: ["Sac 25kg", "Kopo", "Détail 1kg"], carton: 20 },
    { nom: "Farine panifiable", formats: ["Sac 50kg", "Sachet 5kg"], carton: 20 },
    { nom: "Levure Saf", formats: ["Paquet 500g", "Pièce 11g"], carton: 40 },
    { nom: "Semoule de maïs Standard", formats: ["Sac 25kg", "Sac 5kg"], carton: 20 },
    { nom: "Piment séché", formats: ["Sachet 250g", "Kopo"], carton: 20 },
    { nom: "Ail en poudre", formats: ["Sachet 100g"], carton: 40 },
    { nom: "Riz Jasmin", formats: ["Sac 25kg", "Détail 1kg"], carton: 20 },
    { nom: "Farine de blé T55", formats: ["Sac 50kg", "Sachet 5kg", "Détail 1kg"], carton: 20 },
    { nom: "Farine de sorgho", formats: ["Sac 25kg", "Kopo"], carton: 20 },
    { nom: "Gari (manioc torréfié)", formats: ["Sac 25kg", "Kopo", "Sachet 1kg"], carton: 20 },
    { nom: "Sucre roux", formats: ["Sac 50kg", "Sachet 1kg"], carton: 20 },
    { nom: "Maïzena", formats: ["Boîte 400g", "Sachet 1kg"], carton: 24 },
    { nom: "Pois chiches", formats: ["Kopo", "Sac 50kg", "Détail 1kg"], carton: 20 },
    { nom: "Lentilles", formats: ["Kopo", "Sachet 1kg"], carton: 20 },
    { nom: "Flocons d'avoine", formats: ["Paquet 500g", "Carton 12"], carton: 24 },
    { nom: "Fonio", formats: ["Sachet 1kg", "Sac 25kg"], carton: 20 },
    { nom: "Gingembre séché", formats: ["Sachet 100g", "Kopo"], carton: 40 },
    { nom: "Curry en poudre", formats: ["Sachet 100g", "Pot 500g"], carton: 40 },
  ],

  // ~100 articles après déploiement
  poissons: [
    { nom: "Poisson Thomson (Chinchard)", formats: ["Pièce", "Kg", "Carton 10kg", "Lot 5 pièces", "Carton 20kg"], carton: 24 },
    { nom: "Makayabu (salé)", formats: ["Pièce", "Kg", "Carton", "Lot 5 pièces"], carton: 24 },
    { nom: "Mpiodi (congelé)", formats: ["Kg", "Carton 10kg"], carton: 24 },
    { nom: "Tilapia (congelé)", formats: ["Pièce", "Kg", "Lot 5 pièces"], carton: 24 },
    { nom: "Hareng (fumé)", formats: ["Pièce", "Kg", "Lot 5 pièces"], carton: 24 },
    { nom: "Capitaine (congelé)", formats: ["Pièce", "Kg"], carton: 24 },
    { nom: "Poisson fumé local", formats: ["Pièce", "Paquet"], carton: 24 },
    { nom: "Carpe du Kasaï", formats: ["Pièce", "Kg"], carton: 24 },
    { nom: "Sanaga (congelé)", formats: ["Pièce", "Kg", "Carton 10kg"], carton: 24 },
    { nom: "Makayabu doux", formats: ["Pièce", "Kg"], carton: 24 },
    { nom: "Chinchard fumé", formats: ["Pièce", "Paquet 5"], carton: 24 },
    { nom: "Mukeke (fumé)", formats: ["Pièce", "Kg"], carton: 24 },
    { nom: "Ngulu (congelé)", formats: ["Pièce", "Kg"], carton: 24 },
    { nom: "Pilchards Glenryck", formats: ["Boîte 425g", "Carton 24"], carton: 48 },
  ],

  // ~100 articles après déploiement
  snacks: [
    { nom: "Sardines Bella", formats: ["Boîte 125g", "Boîte 250g", "Carton 24"], display12: true, carton: 48 },
    { nom: "Sardines Exeter", formats: ["Boîte", "Carton 6", "Carton 24"], carton: 48 },
    { nom: "Sardines Anny", formats: ["Boîte", "Carton 24"], carton: 48 },
    { nom: "Pilchards Africa Queen", formats: ["Boîte", "Carton 24"], carton: 48 },
    { nom: "Spaghettis Lion", formats: ["Paquet 500g", "Carton 20"], carton: 40 },
    { nom: "Tomate Apollo", formats: ["Boîte", "Carton 100×70", "Grand format"], carton: 48 },
    { nom: "Tomate Benny", formats: ["Boîte", "Carton 100×70"], carton: 48 },
    { nom: "Tomate Lion", formats: ["Boîte", "Carton 100×70"], carton: 48 },
    { nom: "Mayonnaise Bomdia", formats: ["Pot 1kg", "Carton 12"], carton: 24 },
    { nom: "Cubes Maggi", formats: ["Paquet 4 cubes", "Carton 48"], display12: true, carton: 96 },
    { nom: "Thé Le Best", formats: ["Paquet 25 sachets", "Carton 20"], display12: true, carton: 40 },
    { nom: "Biscuits Assortis", formats: ["Paquet", "Pièce", "Carton 50"], display12: true, carton: 100 },
    { nom: "Bonbons Assortis", formats: ["Pièce", "Sachet 10", "Carton 200"], display12: true, carton: 400 },
    { nom: "Chocolat Everyday", formats: ["Tablette", "Carton 24"], display12: true, carton: 48 },
    { nom: "Allumettes", formats: ["Paquet", "Carton 100"], display12: true, carton: 200 },
    { nom: "Beignets (mikaté)", formats: ["Pièce", "Paquet 5"], carton: 100 },
    { nom: "Lait concentré sucré", formats: ["Boîte 400g", "Carton 24"], carton: 48 },
    { nom: "Corned beef Exeter", formats: ["Boîte 340g", "Carton 12"], carton: 48 },
    { nom: "Macaroni Lion", formats: ["Paquet 500g", "Carton 20"], carton: 40 },
    { nom: "Spaghettis Anny", formats: ["Paquet 500g", "Carton 20"], carton: 40 },
    { nom: "Chocolat Chocologo", formats: ["Tablette", "Carton 24"], display12: true, carton: 48 },
    { nom: "Chips plantain", formats: ["Sachet 80g", "Carton 24"], display12: true, carton: 48 },
    { nom: "Arachides grillées", formats: ["Sachet 100g", "Carton 24"], display12: true, carton: 48 },
  ],

  // ~90 articles après déploiement
  divers: [
    { nom: "Lait Nido", formats: ["Boîte 1,8kg", "Boîte 2,5kg"], carton: 12 },
    { nom: "Lait Belle Hollandaise", formats: ["Boîte 900g", "Boîte 1,8kg", "Boîte 2,5kg"], carton: 12 },
    { nom: "Lait Cowbel", formats: ["Boîte 1,8kg", "Boîte 2,5kg"], carton: 12 },
    { nom: "Lait Bomdia", formats: ["Boîte 400g"], carton: 24 },
    { nom: "Huile Avena", formats: ["Bidon 5L", "Bidon 1L"], carton: 12 },
    { nom: "Huile Regina", formats: ["Bidon 5L"], carton: 12 },
    { nom: "Huile d'Afrique", formats: ["Bidon 5L", "Bidon 10L", "Bidon 20L", "Bidon 25L"], carton: 12 },
    { nom: "Huile de palme", formats: ["Bidon 5L", "Bidon 25L"], carton: 12 },
    { nom: "Dentifrice Colgate", formats: ["Tube", "Paquet 12"], display12: true, carton: 48 },
    { nom: "Piles AA", formats: ["Paquet 4", "Pièce"], display12: true, carton: 48 },
    { nom: "Piles AAA", formats: ["Paquet 4", "Pièce"], display12: true, carton: 48 },
    { nom: "Bougies", formats: ["Paquet 6", "Pièce"], display12: true, carton: 48 },
    { nom: "Café Robusta", formats: ["Sachet 100g", "Paquet 250g"], display12: true, carton: 48 },
    { nom: "Épices assorties", formats: ["Sachet", "Paquet"], display12: true, carton: 48 },
    { nom: "Moustiquaire 2 places", formats: ["Pièce"], carton: 24 },
    { nom: "Lampe solaire", formats: ["Unité"], carton: 12 },
    { nom: "Pagne Wax", formats: ["Pièce 6 yards"], carton: 12 },
    { nom: "Natte 2 places", formats: ["Pièce"], carton: 12 },
    { nom: "Papier toilette", formats: ["Rouleau", "Paquet 4", "Carton 48"], carton: 96 },
    { nom: "Serviettes hygiéniques", formats: ["Paquet 10", "Carton 24"], carton: 48 },
    { nom: "Déodorant Nivea", formats: ["Stick", "Spray 150ml"], carton: 24 },
    { nom: "Crème corporelle Venus", formats: ["Pot 400ml", "Tube 100ml"], carton: 24 },
    { nom: "Lames de rasoir", formats: ["Paquet 5", "Carton 100"], carton: 200 },
    { nom: "Stylos bille", formats: ["Pièce", "Boîte 50"], carton: 100 },
    { nom: "Cahiers 200 pages", formats: ["Pièce", "Carton 24"], carton: 48 },
    { nom: "Balais en fibres", formats: ["Pièce"], carton: 24 },
    { nom: "Seaux plastique 10L", formats: ["Pièce"], carton: 24 },
    { nom: "Charbon de bois", formats: ["Sac 10kg", "Sac 25kg"], carton: 12 },
  ],

  // ~45 articles — matériaux, outillage, électricité, plomberie, peinture
  quincaillerie: [
    baseAvecPrix("Ciment gris", { "Sac 50kg": 38000 }),
    baseAvecPrix("Fer à béton 8mm", { "Barre 12m": 18000 }),
    baseAvecPrix("Fer à béton 10mm", { "Barre 12m": 27000 }),
    baseAvecPrix("Fer à béton 12mm", { "Barre 12m": 38000 }),
    baseAvecPrix("Tôle ondulée", { "3m": 30000, "2m": 21000 }),
    baseAvecPrix("Clous", { "2 pouces (kg)": 6500, "3 pouces (kg)": 6500, "4 pouces (kg)": 6500 }),
    baseAvecPrix("Fil de fer recuit", { "Rouleau 5kg": 32000 }),
    baseAvecPrix("Vis à bois", { "Boîte 100": 6000 }),
    baseAvecPrix("Peinture à l'eau blanche", { "Seau 20L": 120000, "Pot 4L": 30000 }),
    baseAvecPrix("Peinture à huile", { "Pot 4L": 45000 }),
    baseAvecPrix("Pinceau", { "N°2": 2500, "N°3": 3000, "N°4": 3500 }),
    baseAvecPrix("Rouleau de peinture", { "Pièce": 5000 }),
    baseAvecPrix("Cadenas", { "Petit": 5000, "Moyen": 9000, "Grand": 16000 }),
    baseAvecPrix("Serrure de porte", { "Pièce": 20000 }),
    baseAvecPrix("Verrou", { "Pièce": 6000 }),
    baseAvecPrix("Charnières", { "Paire": 3500 }),
    baseAvecPrix("Tuyau PVC 32mm", { "Barre 6m": 15000 }),
    baseAvecPrix("Tuyau PVC 50mm", { "Barre 6m": 25000 }),
    baseAvecPrix("Robinet", { "Pièce": 8000 }),
    baseAvecPrix("Fil électrique 1,5mm²", { "Rouleau 100m": 90000 }),
    baseAvecPrix("Fil électrique 2,5mm²", { "Rouleau 100m": 140000 }),
    baseAvecPrix("Interrupteur", { "Simple": 3500, "Double": 5500 }),
    baseAvecPrix("Prise murale", { "Pièce": 4500 }),
    baseAvecPrix("Ampoule LED", { "9W": 3500, "12W": 5000 }),
    baseAvecPrix("Disjoncteur", { "16A": 12000, "32A": 16000 }),
    baseAvecPrix("Rallonge électrique", { "5m": 12000 }),
    baseAvecPrix("Lampe torche", { "Pièce": 8000 }),
    baseAvecPrix("Marteau", { "Pièce": 9000 }),
    baseAvecPrix("Pelle", { "Pièce": 12000 }),
    baseAvecPrix("Pioche", { "Pièce": 14000 }),
    baseAvecPrix("Houe", { "Pièce": 8000 }),
    baseAvecPrix("Machette", { "Pièce": 6000 }),
    baseAvecPrix("Brouette", { "Pièce": 85000 }),
    baseAvecPrix("Truelle", { "Pièce": 5000 }),
    baseAvecPrix("Mètre ruban", { "5m": 4500 }),
    baseAvecPrix("Niveau à bulle", { "60cm": 9000 }),
    baseAvecPrix("Scie à métaux", { "Pièce": 10000 }),
    baseAvecPrix("Disque à tronçonner", { "Pièce": 5000 }),
    baseAvecPrix("Gants de travail", { "Paire": 3500 }),
    baseAvecPrix("Bottes de sécurité", { "Paire": 35000 }),
    baseAvecPrix("Casque de chantier", { "Pièce": 12000 }),
    baseAvecPrix("Silicone", { "Tube": 8000 }),
    baseAvecPrix("Adhésif toile", { "Rouleau": 4000 }),
  ],

  // ~30 articles — médicaments courants, tests, pansements, hygiène
  pharmacie: [
    baseAvecPrix("Paracétamol 500 mg", { "Plaquette 10 cp": 1500, "Boîte 100 cp": 12000 }),
    baseAvecPrix("Ibuprofène 400 mg", { "Plaquette 10 cp": 2500 }),
    baseAvecPrix("Amoxicilline 500 mg", { "Plaquette 10 gél.": 4500 }),
    baseAvecPrix("Métronidazole 500 mg", { "Plaquette 10 cp": 3000 }),
    baseAvecPrix("Cotrimoxazole 480 mg", { "Plaquette 10 cp": 2500 }),
    baseAvecPrix("Artéméther-luméfantrine", { "Boîte 24 cp": 12000 }),
    baseAvecPrix("Artésunate-amodiaquine", { "Boîte adulte": 9000 }),
    baseAvecPrix("Test de paludisme (TDR)", { "Unité": 3500 }),
    baseAvecPrix("Sels de réhydratation orale", { "Sachet": 800 }),
    baseAvecPrix("Zinc 20 mg", { "Plaquette 10 cp": 2500 }),
    baseAvecPrix("Albendazole 400 mg", { "Plaquette 1 cp": 1500 }),
    baseAvecPrix("Vitamine C 500 mg", { "Tube 20 cp": 4000 }),
    baseAvecPrix("Fer + acide folique", { "Plaquette 30 cp": 3500 }),
    baseAvecPrix("Sirop de paracétamol enfant", { "Flacon 100ml": 4500 }),
    baseAvecPrix("Sérum physiologique nasal", { "Boîte 20 unidoses": 6000 }),
    baseAvecPrix("Alcool 70°", { "Flacon 250ml": 3500 }),
    baseAvecPrix("Bétadine", { "Flacon 125ml": 7000 }),
    baseAvecPrix("Gel hydroalcoolique", { "Flacon 100ml": 4000 }),
    baseAvecPrix("Pommade antifongique", { "Tube 15g": 4500 }),
    baseAvecPrix("Compresses stériles", { "Paquet 10": 2000 }),
    baseAvecPrix("Bande de crêpe", { "Pièce": 2500 }),
    baseAvecPrix("Sparadrap", { "Rouleau": 1500 }),
    baseAvecPrix("Gants d'examen", { "Boîte 100": 18000 }),
    baseAvecPrix("Masques chirurgicaux", { "Boîte 50": 8000 }),
    baseAvecPrix("Seringue 5ml", { "Unité": 500 }),
    baseAvecPrix("Thermomètre digital", { "Pièce": 6000 }),
    baseAvecPrix("Préservatifs", { "Boîte 3": 1500 }),
    baseAvecPrix("Test de grossesse", { "Unité": 3000 }),
  ],

  // ~25 articles — plats congolais, grillades, petit-déjeuner
  restaurant: [
    baseAvecPrix("Poulet braisé", { "Quart": 7000, "Demi": 13000, "Entier": 24000 }),
    baseAvecPrix("Poisson braisé (tilapia)", { "Portion": 15000 }),
    baseAvecPrix("Brochettes de bœuf", { "Portion 5": 8000 }),
    baseAvecPrix("Brochettes de chèvre", { "Portion 5": 8000 }),
    baseAvecPrix("Riz + haricots", { "Assiette": 6000 }),
    baseAvecPrix("Riz + poulet", { "Assiette": 12000 }),
    baseAvecPrix("Bukari + poisson", { "Assiette": 9000 }),
    baseAvecPrix("Bukari + saka-saka", { "Assiette": 7000 }),
    baseAvecPrix("Chikwangue + poisson", { "Assiette": 9000 }),
    baseAvecPrix("Poulet à la moambe", { "Assiette": 14000 }),
    baseAvecPrix("Frites", { "Portion": 4000 }),
    baseAvecPrix("Plantain frit", { "Portion": 3500 }),
    baseAvecPrix("Chawarma", { "Poulet": 7000, "Bœuf": 8000 }),
    baseAvecPrix("Omelette", { "Pièce": 3500 }),
    baseAvecPrix("Salade composée", { "Assiette": 5000 }),
    baseAvecPrix("Soupe de poisson", { "Bol": 6000 }),
    baseAvecPrix("Pain + œufs", { "Petit-déjeuner": 5000 }),
    baseAvecPrix("Café", { "Tasse": 2000 }),
    baseAvecPrix("Thé", { "Tasse": 1500 }),
  ],

  // ~12 articles — chambres, services, petit-déjeuner
  hotel: [
    baseAvecPrix("Chambre Standard", { "Nuit": 55000 }),
    baseAvecPrix("Chambre Climatisée", { "Nuit": 82000 }),
    baseAvecPrix("Suite", { "Nuit": 137000 }),
    baseAvecPrix("Lit supplémentaire", { "Nuit": 14000 }),
    baseAvecPrix("Petit-déjeuner continental", { "Portion": 8000 }),
    baseAvecPrix("Blanchisserie", { "Chemise": 2500, "Pantalon": 3000, "Robe": 4000 }),
    baseAvecPrix("Navette aéroport", { "Course": 55000 }),
  ],
};

// ------------------------------------------------------------
// 4.6 — Prix réalistes (RDC, 2026) : paires confirmées + heuristique
// ------------------------------------------------------------
/** Prix confirmés sur le terrain (CDF en francs, USD en centimes). */
const PRIX_CONFIRMES: Record<string, [number, number]> = {
  "Primus|33cl": [3000, 110],
  "Nkoyi Blonde|33cl": [3000, 110],
  "Tembo|33cl": [3000, 110],
  "Simba|33cl": [3000, 110],
  "Coca-Cola|33cl": [2419, 88],
  "Riz Lion|Sac 25kg": [46000, 1680],
  "Riz BB|Sac 25kg": [52000, 1900],
  "Farine de maïs Extra|Sac 25kg": [50000, 1820],
  "Savon Lecoq|Carton 24": [24000, 870],
  "Savon Munganga|Carton 24": [27900, 1016],
  "Huile de palme|Bidon 5L": [19000, 690],
  "Lait Nido|Boîte 2,5kg": [68800, 2500],
  "Lait Belle Hollandaise|Boîte 2,5kg": [68750, 2500],
};

/** Taux pivot utilisé pour convertir les prix de référence : 27,4 FC par cent. */
const FC_PAR_CENT = 27.4;

/** Prix de base (CDF) au 33cl / à l'unité selon la catégorie. */
function prixBaseCategorie(categorie: string): number {
  switch (categorie) {
    case "Bières": return 3000;
    case "Boissons": return 2400;
    case "Savons & détergents": return 1200;
    case "Produits de base": return 2500;
    case "Poissons": return 3500;
    case "Snacks & conserves": return 2000;
    default: return 4000;
  }
}

/** Multiplicateur de conditionnement déduit du libellé de format. */
function multiplicateurFormat(format: string): number {
  const casier = /^Casier (\d+)×/.exec(format);
  if (casier) return Number(casier[1]) * 0.92; // léger rabais gros
  const pack = /^Pack (\d+)×/.exec(format);
  if (pack) return Number(pack[1]);
  const carton = /^Carton (\d+)×?/.exec(format);
  if (carton) return Number(carton[1]) * 0.9;
  const cl = volumeCl(format);
  if (cl > 0) return Math.max(0.6, cl / 33);
  const kg = /(\d+(?:,\d+)?)\s*kg/.exec(format);
  if (kg) return Number(kg[1].replace(",", ".")) * 8;
  const l = /(\d+(?:,\d+)?)\s*L/.exec(format);
  if (l) return Number(l[1].replace(",", "."));
  const g = /(\d+)\s*g/.exec(format);
  if (g) return Math.max(0.3, Number(g[1]) / 500);
  return 1;
}

/** Prix (CDF francs + USD centimes) pour un article du catalogue. */
export function prixPour(nom: string, variante: string | null, categorie: string): { cdf: number; usd: number } {
  const confirme = PRIX_CONFIRMES[`${nom}|${variante ?? ""}`];
  if (confirme) return { cdf: confirme[0], usd: confirme[1] };
  // Prix indicatifs des produits « métiers » (quincaillerie, pharmacie, restaurant, hôtel)
  const indicatif = PRIX_INDICATIFS_CDF[`${nom}|${variante ?? ""}`];
  if (indicatif) {
    return { cdf: indicatif, usd: Math.max(18, Math.round(indicatif / FC_PAR_CENT)) };
  }
  const brut = prixBaseCategorie(categorie) * multiplicateurFormat(variante ?? "");
  const cdf = Math.max(500, Math.round(brut / 100) * 100);
  return { cdf, usd: Math.max(18, Math.round(cdf / FC_PAR_CENT)) };
}

// ------------------------------------------------------------
// Insertion par lots de 100 (évite les timeouts Neon).
// Exportée pour les fixtures de démo (db/fixtures-demo.ts).
// ------------------------------------------------------------
export async function parLots<T extends object>(table: PgTable, lignes: T[]) {
  const db = getDb();
  for (let i = 0; i < lignes.length; i += 100) {
    // PgTable générique : les lignes sont typées à l'appel (inferInsert),
    // l'insertion par lots reste volontairement non paramétrée par table.
    await db.insert(table).values(lignes.slice(i, i + 100)).onConflictDoNothing();
  }
}

/** Vide toutes les tables (ordre logique, sans contraintes FK). */
export async function viderTables() {
  const db = getDb();
  await db.delete(s.factures);
  await db.delete(s.paiements);
  await db.delete(s.historiqueTranches);
  await db.delete(s.abonnements);
  await db.delete(s.auditLog);
  await db.delete(s.mouvementsStock);
  await db.delete(s.alertes);
  await db.delete(s.demandesStock);
  await db.delete(s.invitations);
  await db.delete(s.avis);
  await db.delete(s.depots);
  await db.delete(s.sessionsService);
  await db.delete(s.commandes);
  await db.delete(s.clientsSession);
  await db.delete(s.tableServeuse);
  await db.delete(s.produits);
  await db.delete(s.tablesQr);
  await db.delete(s.affectations);
  await db.delete(s.terrasses);
  await db.delete(s.utilisateurs);
  await db.delete(s.organisations);
  await db.delete(s.plansTarifs);
  await db.delete(s.catalogueProduits);
  await db.delete(s.catalogueCodesBarres);
  await db.delete(s.meta);
}

// ------------------------------------------------------------
// Seed codes-barres — 10 codes connus vendus à Lubumbashi.
// Le référentiel s'enrichit ensuite via Open Food Facts et la
// saisie manuelle (source = MANUEL | OPEN_FOOD_FACTS).
// Catégories alignées sur CATEGORIES_PRODUIT (contracts/types.ts).
// ------------------------------------------------------------
const CODES_BARRES_CONNUS: Omit<typeof s.catalogueCodesBarres.$inferInsert, "id" | "creeLe">[] = [
  { codeBarres: "5449000000996", nom: "Coca-Cola", categorie: "Boissons", variante: "33 cl", photoUrl: null, consignable: false, bouteillesParCasier: 24, prixCdfMoyen: 2000, prixUsdMoyen: 100, nbUtilisations: 0, source: "MANUEL" },
  { codeBarres: "5449000054227", nom: "Coca-Cola", categorie: "Boissons", variante: "1 L", photoUrl: null, consignable: false, bouteillesParCasier: null, prixCdfMoyen: 5000, prixUsdMoyen: 200, nbUtilisations: 0, source: "MANUEL" },
  { codeBarres: "5000112637939", nom: "Fanta Orange", categorie: "Boissons", variante: "33 cl", photoUrl: null, consignable: false, bouteillesParCasier: 24, prixCdfMoyen: 2000, prixUsdMoyen: 100, nbUtilisations: 0, source: "MANUEL" },
  { codeBarres: "5000112637960", nom: "Sprite", categorie: "Boissons", variante: "33 cl", photoUrl: null, consignable: false, bouteillesParCasier: 24, prixCdfMoyen: 2000, prixUsdMoyen: 100, nbUtilisations: 0, source: "MANUEL" },
  { codeBarres: "8712000037673", nom: "Heineken", categorie: "Bières", variante: "33 cl", photoUrl: null, consignable: true, bouteillesParCasier: 24, prixCdfMoyen: 3500, prixUsdMoyen: 150, nbUtilisations: 0, source: "MANUEL" },
  { codeBarres: "5000159459228", nom: "Red Bull", categorie: "Boissons", variante: "25 cl", photoUrl: null, consignable: false, bouteillesParCasier: null, prixCdfMoyen: 7000, prixUsdMoyen: 250, nbUtilisations: 0, source: "MANUEL" },
  { codeBarres: "3574661272135", nom: "Colgate", categorie: "Savons & détergents", variante: "Dentifrice", photoUrl: null, consignable: false, bouteillesParCasier: null, prixCdfMoyen: 4000, prixUsdMoyen: 150, nbUtilisations: 0, source: "MANUEL" },
  { codeBarres: "7622300336738", nom: "Maggi", categorie: "Produits de base", variante: "Bouillon", photoUrl: null, consignable: false, bouteillesParCasier: null, prixCdfMoyen: 2500, prixUsdMoyen: 100, nbUtilisations: 0, source: "MANUEL" },
  { codeBarres: "3046920022651", nom: "Lindt", categorie: "Snacks & conserves", variante: "Chocolat", photoUrl: null, consignable: false, bouteillesParCasier: null, prixCdfMoyen: 12000, prixUsdMoyen: 450, nbUtilisations: 0, source: "MANUEL" },
  { codeBarres: "3068320115433", nom: "Evian", categorie: "Boissons", variante: "1,5 L", photoUrl: null, consignable: false, bouteillesParCasier: null, prixCdfMoyen: 4000, prixUsdMoyen: 150, nbUtilisations: 0, source: "MANUEL" },
];

/** Insère les codes-barres connus si absents (idempotent). Appelé par le
 *  seed référentiel ET au démarrage production (les bases déjà seedées ne
 *  repassent pas par executerSeedReferentiel). */
export async function assurerSeedCodesBarres() {
  const debut = maintenant();
  await parLots(
    s.catalogueCodesBarres,
    CODES_BARRES_CONNUS.map((c, i) => ({ ...c, id: `cb_seed_${String(i + 1).padStart(2, "0")}`, creeLe: debut })),
  );
}

// ------------------------------------------------------------
// Seed du référentiel — idempotent. SEUL seed autorisé en
// production (ZÉRO DÉMO) : grille tarifaire, catalogue
// multi-pays, codes-barres connus, compteur de factures.
// Les données de démonstration sont dans db/fixtures-demo.ts.
// ------------------------------------------------------------
export async function executerSeedReferentiel() {
  // 4.7 — Plans tarifaires (9 terrasses + 1 boutique) -----------------
  // Grille divisée par deux (boucle 1). Prix mensuels en centimes USD :
  // ESSENTIEL 10/15/20 $, PRO 17,50/25/35 $, BUSINESS 25/37,50/50 $.
  // Les frais d'installation dépendent désormais du TYPE d'établissement
  // (fraisInstallationPour : 5 $ boutique/salon, 10 $ sinon) ; la colonne
  // frais_install_usd garde une valeur de référence cohérente (500/1000).
  const GRILLE_PLANS = [
    { plan: "ESSENTIEL", tranche: "PETITE", tablesMin: 1, tablesMax: 9, prixUsd: 1000, fraisInstallUsd: 1000, typeEtablissementCible: null },
    { plan: "PRO", tranche: "PETITE", tablesMin: 1, tablesMax: 9, prixUsd: 1750, fraisInstallUsd: 1000, typeEtablissementCible: null },
    { plan: "BUSINESS", tranche: "PETITE", tablesMin: 1, tablesMax: 9, prixUsd: 2500, fraisInstallUsd: 1000, typeEtablissementCible: null },
    { plan: "ESSENTIEL", tranche: "MOYENNE", tablesMin: 10, tablesMax: 19, prixUsd: 1500, fraisInstallUsd: 1000, typeEtablissementCible: null },
    { plan: "PRO", tranche: "MOYENNE", tablesMin: 10, tablesMax: 19, prixUsd: 2500, fraisInstallUsd: 1000, typeEtablissementCible: null },
    { plan: "BUSINESS", tranche: "MOYENNE", tablesMin: 10, tablesMax: 19, prixUsd: 3750, fraisInstallUsd: 1000, typeEtablissementCible: null },
    { plan: "ESSENTIEL", tranche: "GRANDE", tablesMin: 20, tablesMax: null, prixUsd: 2000, fraisInstallUsd: 1000, typeEtablissementCible: null },
    { plan: "PRO", tranche: "GRANDE", tablesMin: 20, tablesMax: null, prixUsd: 3500, fraisInstallUsd: 1000, typeEtablissementCible: null },
    { plan: "BUSINESS", tranche: "GRANDE", tablesMin: 20, tablesMax: null, prixUsd: 5000, fraisInstallUsd: 1000, typeEtablissementCible: null },
    // Plan boutique : 5 USD/mois, 1 zone de vente (installation : 5 $ boutique/salon, 10 $ sinon)
    { plan: "BOUTIQUE", tranche: "PETITE", tablesMin: 1, tablesMax: 1, prixUsd: 500, fraisInstallUsd: 500, typeEtablissementCible: "BOUTIQUE" },
  ] as const;
  // La grille est la SEULE donnée de seed mise à jour en cas de ré-exécution :
  // les nouvelles valeurs s'appliquent aux prochaines échéances — abonnements
  // et factures déjà émis ne bougent pas.
  for (const ligne of GRILLE_PLANS) {
    await getDb().insert(s.plansTarifs).values(ligne).onConflictDoUpdate({
      target: [s.plansTarifs.plan, s.plansTarifs.tranche],
      set: { prixUsd: ligne.prixUsd, fraisInstallUsd: ligne.fraisInstallUsd, tablesMin: ligne.tablesMin, tablesMax: ligne.tablesMax },
    });
  }

  // 4.4 / 4.5 — Catalogue multi-pays (~1000 articles) -----------------
  const catalogue = genererCatalogueMultiPays();
  await parLots(s.catalogueProduits, catalogue);

  // Boucle 3 — Référentiel des catégories produit par type
  // d'établissement (32 entrées, IDs fixes, idempotent).
  await parLots(
    s.categoriesProduit,
    CATEGORIES_PAR_TYPE.map((c) => ({
      id: `cat_${c.typeEtablissement}_${c.code}`,
      code: c.code,
      typeEtablissement: c.typeEtablissement,
      nomFr: c.nomFr,
      nomEn: c.nomEn,
      nomPt: c.nomPt,
      icone: c.icone,
      ordreAffichage: c.ordreAffichage,
    })),
  );

  // Référentiel codes-barres (10 codes connus)
  await assurerSeedCodesBarres();

  // Compteur de factures (GBS-YYYY-NNNNN)
  await parLots(s.meta, [{ cle: "compteurFacture", valeur: 0 }]);

  return { nbCatalogue: catalogue.length };
}


// ------------------------------------------------------------
// Point d'entrée CLI : npx tsx db/seed.ts [--avec-demo] [--reinitialiser]
// Par défaut : RÉFÉRENTIEL SEUL (production, ZÉRO DÉMO).
// --avec-demo ajoute les fixtures de db/fixtures-demo.ts (développement).
// ------------------------------------------------------------
const lanceDirectement =
  Boolean(process.argv[1]?.endsWith("seed.ts")) && import.meta.url.endsWith("/db/seed.ts");

if (lanceDirectement) {
  (async () => {
    // Garde-fou ZÉRO DÉMO : les fixtures ne peuvent JAMAIS être insérées
    // avec NODE_ENV=production, même à la main. Pour une démo publique,
    // utiliser NODE_ENV=development sur une base jetable.
    if (process.argv.includes("--avec-demo") && process.env.NODE_ENV === "production") {
      console.error("Refusé : --avec-demo est interdit avec NODE_ENV=production (ZÉRO DÉMO).");
      process.exit(1);
    }
    if (process.argv.includes("--reinitialiser")) {
      console.log("Réinitialisation : vidage des tables…");
      await viderTables();
    }
    const { nbCatalogue } = await executerSeedReferentiel();
    console.log(`Seed référentiel appliqué (${nbCatalogue} articles de catalogue, 0 donnée de démo).`);
    if (process.argv.includes("--avec-demo")) {
      // Import dynamique : les fixtures ne sont chargées qu'à la demande.
      const { executerFixturesDemo } = await import("./fixtures-demo");
      await executerFixturesDemo();
      console.log("Fixtures de démonstration insérées (6 établissements, 4 personas).");
    }
    process.exit(0);
  })().catch((e) => {
    console.error("Échec du seed :", e);
    process.exit(1);
  });
}
