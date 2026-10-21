// ============================================================
// GBS / Nganda POS — Fixtures de démonstration (boucle 2)
//
// ZÉRO DÉMO EN PRODUCTION : tout ce fichier est de la DONNÉE DE
// DÉMONSTRATION. Il n'est exécuté que :
//   - en développement / recette avec ANNUAIRE_DEMO actif ;
//   - par les tests (api/__tests__) ;
//   - à la main : npx tsx db/seed.ts --avec-demo
// La production réelle (ANNUAIRE_DEMO=false) n'exécute que le
// référentiel de db/seed.ts — jamais ce fichier.
//
// Contenu : organisation « Nganda Group » + 4 personas, 6
// établissements (terrasse, boutique, quincaillerie, pharmacie,
// restaurant, hôtel), sélections de produits, abonnements ESSAI,
// session de service, 2 commandes, 2 alertes STOCK_BAS.
//
// Contraintes : idempotent (onConflictDoNothing), IDs fixes,
// commenté en français.
// ============================================================

import * as s from "./schema";
import { ajouterJours, maintenant } from "../api/gbsUtils";
import { chiffrerPin } from "../api/lib/pin";
import {
  executerSeedReferentiel,
  genererCatalogueMultiPays,
  parLots,
  prixPour,
  type ProduitCatalogueSeed,
} from "./seed";

// ------------------------------------------------------------
// Constantes de la démo (IDs fixes et prévisibles)
// ------------------------------------------------------------
const ORG_ID = "org_demo_001";
const USR_PROP = "usr_prop_001"; // Papa Jean — propriétaire
const USR_GER = "usr_ger_001"; // Mama Njoki — gérante
const USR_SERV_1 = "usr_serv_001"; // Marie — serveuse terrasse
const USR_SERV_2 = "usr_serv_002"; // Chantal — serveuse boutique
const ETAB_TERR = "etab_terr_001"; // Chez Mama Njoki (TERRASSE, 6 tables)
const ETAB_BOUT = "etab_bout_001"; // Boutique du Coin (BOUTIQUE, 1 zone)
const TOKEN_BOUTIQUE = "tok_boutique_du_coin_0001"; // QR mural de la boutique
const ETAB_QUINC = "etab_quinc_001"; // Quincaillerie Les Bâtisseurs (QUINCAILLERIE, 1 comptoir)
const ETAB_PHARM = "etab_pharm_001"; // Pharmacie Espoir (PHARMACIE, 1 comptoir)
const ETAB_REST = "etab_rest_001"; // Chez Maman Mado (RESTAURANT, 8 tables)
const ETAB_HOTEL = "etab_hotel_001"; // Hôtel Les Palmiers (GUEST_HOUSE, 6 chambres QR)
const TOKEN_QUINC = "tok_quincaillerie_0001"; // QR mural quincaillerie
const TOKEN_PHARM = "tok_pharmacie_0001"; // QR mural pharmacie

const ilY = (min: number) => new Date(Date.now() - min * 60_000).toISOString();

/** PIN de démonstration (affichés par l'annuaire démo uniquement —
 *  en base ils sont hachés scrypt ; jamais utilisés en production
 *  car ANNUAIRE_DEMO=false y est exigé). */
export const DEMO_PINS: Record<string, string> = {
  "+243810000001": "1234", // Papa Jean (propriétaire)
  "+243810000002": "2345", // Mama Njoki (gérante)
  "+243810000003": "3456", // Marie (serveuse)
  "+243810000004": "4567", // Chantal (serveuse boutique)
};

// ------------------------------------------------------------
// Sélection de produits par établissement (depuis le catalogue
// référentiel — les prix viennent de prixPour, cf. db/seed.ts)
// ------------------------------------------------------------
/** Construit les lignes `produits` d'un établissement depuis le catalogue. */
function importerSelection(
  catalogue: ProduitCatalogueSeed[],
  etablissementId: string,
  prefixeId: string,
  categories: string[],
  limite: number,
  incontournables: string[], // « nom|variante » à inclure coûte que coûte
): (typeof s.produits.$inferInsert)[] {
  const eligibles = catalogue.filter(
    (c) => categories.includes(c.categorie) && !/^(Casier|Carton|Pack)/.test(c.variante ?? ""),
  );
  const choisis: ProduitCatalogueSeed[] = [];
  // D'abord les incontournables (utilisés par les commandes de démo)
  for (const cle of incontournables) {
    const [nom, variante] = cle.split("|");
    const trouve = eligibles.find((c) => c.nom === nom && c.variante === variante);
    if (trouve && !choisis.includes(trouve)) choisis.push(trouve);
  }
  // Puis le reste, dans l'ordre d'affichage
  for (const c of eligibles) {
    if (choisis.length >= limite) break;
    if (!choisis.includes(c)) choisis.push(c);
  }
  return choisis.slice(0, limite).map((c, i) => {
    const { cdf, usd } = prixPour(c.nom, c.variante ?? null, c.categorie);
    return {
      id: `${prefixeId}_${String(i + 1).padStart(3, "0")}`,
      terrasseId: etablissementId,
      nom: c.variante ? `${c.nom} ${c.variante}` : c.nom,
      categorie: c.categorie,
      prixCdf: cdf,
      prixUsd: usd,
      stock: 24 + (i % 25), // 24 à 48 unités, déterministe
      stockReserve: 0,
      seuilAlerte: 6,
      actif: true,
      photoUrl: c.photoUrl,
      photoThumbnailUrl: c.photoThumbnailUrl,
      photoSource: "CATALOGUE",
      variante: c.variante,
      consignable: c.consignable,
      bouteillesParCasier: c.bouteillesParCasier,
    };
  });
}

// ------------------------------------------------------------
// Nouveaux établissements : quincaillerie, pharmacie, restaurant, hôtel
// (même organisation « Nganda Group », Papa Jean gérant partout)
// ------------------------------------------------------------
async function seedNouveauxEtablissements(
  catalogue: ProduitCatalogueSeed[],
  debut: string,
  now: string,
): Promise<void> {
  const commun = {
    organisationId: ORG_ID,
    seuilEcartCdf: 5000,
    seuilEcartUsd: 200,
    tauxUsdCdf: 2800,
    creeLe: debut,
  };

  // Établissements (adresses fictives de démonstration)
  await parLots(s.terrasses, [
    { ...commun, id: ETAB_QUINC, nom: "Quincaillerie Les Bâtisseurs", adresse: "Quartier Golf, Lubumbashi", typeEtablissement: "QUINCAILLERIE", tokenQrBoutique: TOKEN_QUINC },
    { ...commun, id: ETAB_PHARM, nom: "Pharmacie Espoir", adresse: "Centre-ville, Lubumbashi", typeEtablissement: "PHARMACIE", tokenQrBoutique: TOKEN_PHARM },
    { ...commun, id: ETAB_REST, nom: "Chez Maman Mado", adresse: "Quartier Bel-Air, Lubumbashi", typeEtablissement: "RESTAURANT", tokenQrBoutique: null },
    { ...commun, id: ETAB_HOTEL, nom: "Hôtel Les Palmiers", adresse: "Centre-ville, Lubumbashi", typeEtablissement: "GUEST_HOUSE", tokenQrBoutique: null },
  ]);

  // Tables / zones QR
  const tables: (typeof s.tablesQr.$inferInsert)[] = [
    { id: "tbl_quinc_comptoir", terrasseId: ETAB_QUINC, numero: 1, tokenQr: "tok_quinc_comptoir_01", actif: true, creeLe: debut, archiveLe: null },
    { id: "tbl_pharm_comptoir", terrasseId: ETAB_PHARM, numero: 1, tokenQr: "tok_pharm_comptoir_01", actif: true, creeLe: debut, archiveLe: null },
  ];
  // Restaurant : 8 tables
  for (let i = 1; i <= 8; i++) {
    const n = String(i).padStart(2, "0");
    tables.push({ id: `tbl_rest_${n}`, terrasseId: ETAB_REST, numero: i, tokenQr: `tok_rest_${n}`, actif: true, creeLe: debut, archiveLe: null });
  }
  // Hôtel : 6 chambres, le numéro de la table = numéro de chambre (room service par QR)
  for (let i = 101; i <= 106; i++) {
    tables.push({ id: `tbl_hotel_${i}`, terrasseId: ETAB_HOTEL, numero: i, tokenQr: `tok_hotel_${i}`, actif: true, creeLe: debut, archiveLe: null });
  }
  await parLots(s.tablesQr, tables);

  // Affectations : Papa Jean gère les 4 ; Marie sert au restaurant ; Chantal à la pharmacie
  await parLots(s.affectations, [
    { id: "aff_prop_quinc", utilisateurId: USR_PROP, terrasseId: ETAB_QUINC, role: "GERANT", actif: true, creeLe: debut },
    { id: "aff_prop_pharm", utilisateurId: USR_PROP, terrasseId: ETAB_PHARM, role: "GERANT", actif: true, creeLe: debut },
    { id: "aff_prop_rest", utilisateurId: USR_PROP, terrasseId: ETAB_REST, role: "GERANT", actif: true, creeLe: debut },
    { id: "aff_prop_hotel", utilisateurId: USR_PROP, terrasseId: ETAB_HOTEL, role: "GERANT", actif: true, creeLe: debut },
    { id: "aff_marie_rest", utilisateurId: USR_SERV_1, terrasseId: ETAB_REST, role: "SERVEUSE", actif: true, creeLe: debut },
    { id: "aff_chantal_pharm", utilisateurId: USR_SERV_2, terrasseId: ETAB_PHARM, role: "SERVEUSE", actif: true, creeLe: debut },
  ]);

  // Marie sert les 8 tables du restaurant
  await parLots(s.tableServeuse,
    Array.from({ length: 8 }, (_, k) => ({
      id: `ts_marie_rest_${String(k + 1).padStart(2, "0")}`,
      tableId: `tbl_rest_${String(k + 1).padStart(2, "0")}`,
      serveuseId: USR_SERV_1, actif: true, depuisLe: ilY(300),
    })),
  );

  // Produits : chaque métier prend d'abord SES articles (sinon les 100+ bières
  // du catalogue épuiseraient la limite avant d'atteindre les plats).
  const produitsQuinc = importerSelection(
    catalogue, ETAB_QUINC, "prd_quinc", ["Quincaillerie"], 60,
    ["Ciment gris|Sac 50kg", "Tôle ondulée|3m", "Peinture à l'eau blanche|Seau 20L", "Cadenas|Moyen"],
  );

  const produitsPharm = importerSelection(
    catalogue, ETAB_PHARM, "prd_pharm", ["Pharmacie"], 40,
    ["Paracétamol 500 mg|Plaquette 10 cp", "Artéméther-luméfantrine|Boîte 24 cp", "Test de paludisme (TDR)|Unité"],
  );
  // Stock volontairement bas sur l'antipaludéen → alerte STOCK_BAS (démo)
  const antipalu = produitsPharm.find((p) => p.nom.startsWith("Artéméther-luméfantrine"));
  if (antipalu) antipalu.stock = 3;

  const platsRest = importerSelection(
    catalogue, ETAB_REST, "prd_rest", ["Restaurant"], 30,
    ["Poulet braisé|Quart", "Brochettes de bœuf|Portion 5", "Riz + haricots|Assiette"],
  );
  const boissonsRest = importerSelection(
    catalogue, ETAB_REST, "prd_restb", ["Bières", "Boissons"], 15,
    ["Primus|33cl", "Coca-Cola|33cl"],
  );

  const prestationsHotel = importerSelection(
    catalogue, ETAB_HOTEL, "prd_hotel", ["Hôtel & hébergement"], 20,
    ["Chambre Standard|Nuit", "Chambre Climatisée|Nuit", "Suite|Nuit"],
  );
  // Chambres : peu d'unités (6/6/2) ; services (blanchisserie, navette) : jamais en rupture
  for (const p of prestationsHotel) {
    if (/^(Chambre|Suite|Lit supplémentaire)/.test(p.nom)) {
      p.stock = p.nom.startsWith("Suite") ? 2 : 6;
      p.seuilAlerte = 1;
    } else if (/^(Blanchisserie|Navette)/.test(p.nom)) {
      p.stock = 999;
      p.seuilAlerte = 0;
    }
  }
  const minibarHotel = importerSelection(
    catalogue, ETAB_HOTEL, "prd_hotelb", ["Boissons"], 10,
    ["Coca-Cola|33cl", "Eau Vive|50cl"],
  );

  await parLots(s.produits, [
    ...produitsQuinc, ...produitsPharm, ...platsRest, ...boissonsRest, ...prestationsHotel, ...minibarHotel,
  ]);

  // Plans : plan minimum de chaque type (le client peut monter de plan)
  await parLots(s.abonnements, [
    { id: "abo_quinc_001", terrasseId: ETAB_QUINC, plan: "BOUTIQUE", tranche: "PETITE", statut: "ESSAI", typeEtablissement: "QUINCAILLERIE", essaiFin: ajouterJours(now, 14), periodeDebut: now, periodeFin: ajouterJours(now, 14), annuel: false, nbTablesMaxPeriode: 1, prorataDu: 0, fraisInstallPayes: false },
    { id: "abo_pharm_001", terrasseId: ETAB_PHARM, plan: "ESSENTIEL", tranche: "PETITE", statut: "ESSAI", typeEtablissement: "PHARMACIE", essaiFin: ajouterJours(now, 14), periodeDebut: now, periodeFin: ajouterJours(now, 14), annuel: false, nbTablesMaxPeriode: 1, prorataDu: 0, fraisInstallPayes: false },
    { id: "abo_rest_001", terrasseId: ETAB_REST, plan: "ESSENTIEL", tranche: "PETITE", statut: "ESSAI", typeEtablissement: "RESTAURANT", essaiFin: ajouterJours(now, 14), periodeDebut: now, periodeFin: ajouterJours(now, 14), annuel: false, nbTablesMaxPeriode: 8, prorataDu: 0, fraisInstallPayes: false },
    { id: "abo_hotel_001", terrasseId: ETAB_HOTEL, plan: "ESSENTIEL", tranche: "PETITE", statut: "ESSAI", typeEtablissement: "GUEST_HOUSE", essaiFin: ajouterJours(now, 14), periodeDebut: now, periodeFin: ajouterJours(now, 14), annuel: false, nbTablesMaxPeriode: 6, prorataDu: 0, fraisInstallPayes: false },
  ]);

  // Alerte de démo : stock bas sur l'antipaludéen
  if (antipalu) {
    await parLots(s.alertes, [
      {
        id: "alt_pharm_001", terrasseId: ETAB_PHARM, type: "STOCK_BAS",
        message: `Stock bas : ${antipalu.nom} (3 restants, seuil 6)`,
        lu: false, creeLe: ilY(60),
      },
    ]);
  }
}

// ------------------------------------------------------------
// Fixtures de démonstration — idempotent (onConflictDoNothing).
// Prérequis : le référentiel doit être en base (le catalogue sert
// à construire les sélections de produits). Ne jamais appeler en
// production réelle : voir api/gbsSeed.ts (assurerSeed).
// ------------------------------------------------------------
export async function executerFixturesDemo() {
  const now = maintenant();
  const debut = ajouterJours(now, -14);

  // Organisation et utilisateurs --------------------------------
  await parLots(s.organisations, [
    { id: ORG_ID, nom: "Nganda Group", proprietaireId: USR_PROP, creeLe: debut },
  ]);
  // PIN hachés (scrypt) : la base ne contient jamais de PIN en clair.
  // L'annuaire démo affiche les PIN depuis DEMO_PINS (ci-dessus),
  // pas depuis la base.
  await parLots(s.utilisateurs, [
    { id: USR_PROP, nom: "Papa Jean", telephone: "+243810000001", pin: chiffrerPin("1234"), creeLe: debut },
    { id: USR_GER, nom: "Mama Njoki", telephone: "+243810000002", pin: chiffrerPin("2345"), creeLe: debut },
    { id: USR_SERV_1, nom: "Marie", telephone: "+243810000003", pin: chiffrerPin("3456"), creeLe: debut },
    { id: USR_SERV_2, nom: "Chantal", telephone: "+243810000004", pin: chiffrerPin("4567"), creeLe: debut },
  ]);

  // Établissements ----------------------------------------------
  await parLots(s.terrasses, [
    {
      id: ETAB_TERR, organisationId: ORG_ID, nom: "Chez Mama Njoki",
      adresse: "Av. Kasavubu, Lubumbashi", typeEtablissement: "TERRASSE",
      tokenQrBoutique: null, seuilEcartCdf: 5000, seuilEcartUsd: 200,
      tauxUsdCdf: 2800, creeLe: debut,
    },
    {
      id: ETAB_BOUT, organisationId: ORG_ID, nom: "Boutique du Coin",
      adresse: "Av. Lumumba, Lubumbashi", typeEtablissement: "BOUTIQUE",
      tokenQrBoutique: TOKEN_BOUTIQUE, seuilEcartCdf: 5000, seuilEcartUsd: 200,
      tauxUsdCdf: 2800, creeLe: debut,
    },
  ]);

  // Tables : 6 tables pour la terrasse, 1 zone « Comptoir » pour la boutique
  const tables: (typeof s.tablesQr.$inferInsert)[] = [];
  for (let i = 1; i <= 6; i++) {
    tables.push({
      id: `tbl_terr_${String(i).padStart(2, "0")}`, terrasseId: ETAB_TERR,
      numero: i, tokenQr: `tok_terr_${String(i).padStart(2, "0")}`,
      actif: true, creeLe: debut, archiveLe: null,
    });
  }
  tables.push({
    id: "tbl_bout_comptoir", terrasseId: ETAB_BOUT, numero: 1,
    tokenQr: "tok_bout_comptoir_01", actif: true, creeLe: debut, archiveLe: null,
  });
  await parLots(s.tablesQr, tables);

  // Affectations -------------------------------------------------
  await parLots(s.affectations, [
    { id: "aff_prop_terr", utilisateurId: USR_PROP, terrasseId: ETAB_TERR, role: "GERANT", actif: true, creeLe: debut },
    { id: "aff_prop_bout", utilisateurId: USR_PROP, terrasseId: ETAB_BOUT, role: "GERANT", actif: true, creeLe: debut },
    { id: "aff_ger_terr", utilisateurId: USR_GER, terrasseId: ETAB_TERR, role: "GERANT", actif: true, creeLe: debut },
    { id: "aff_marie_terr", utilisateurId: USR_SERV_1, terrasseId: ETAB_TERR, role: "SERVEUSE", actif: true, creeLe: debut },
    { id: "aff_chantal_bout", utilisateurId: USR_SERV_2, terrasseId: ETAB_BOUT, role: "SERVEUSE", actif: true, creeLe: debut },
  ]);

  // Sélections de produits depuis le catalogue référentiel -------
  const catalogue = genererCatalogueMultiPays();

  const produitsTerrasse = importerSelection(
    catalogue, ETAB_TERR, "prd_terr",
    ["Bières", "Boissons", "Snacks & conserves"], 40,
    ["Nkoyi Blonde|33cl", "Tembo|33cl", "Primus|33cl", "Coca-Cola|33cl"],
  );
  // Stock volontairement bas sur Nkoyi Blonde 33cl → alerte STOCK_BAS
  const nkoyi = produitsTerrasse.find((p) => p.nom === "Nkoyi Blonde 33cl");
  if (nkoyi) nkoyi.stock = 5;
  // Codes-barres de démo : le scan caméra trouve ces produits sur la carte
  const codesDemo: Record<string, string> = {
    "Coca-Cola 33cl": "5449000000996",
    "Fanta Orange 33cl": "5000112637939",
    "Sprite 33cl": "5000112637960",
  };
  for (const p of produitsTerrasse) {
    const code = codesDemo[p.nom];
    if (code) p.codeBarres = code;
  }
  await parLots(s.produits, produitsTerrasse);

  const produitsBoutique = importerSelection(
    catalogue, ETAB_BOUT, "prd_bout",
    ["Savons & détergents", "Produits de base", "Poissons", "Snacks & conserves", "Divers", "Boissons"], 60,
    ["Riz Lion|Sac 25kg", "Savon Lecoq|Carton 24", "Huile de palme|Bidon 5L"],
  );
  await parLots(s.produits, produitsBoutique);

  // Marie sert toutes les tables de la terrasse
  await parLots(s.tableServeuse,
    [1, 2, 3, 4, 5, 6].map((i) => ({
      id: `ts_marie_${String(i).padStart(2, "0")}`,
      tableId: `tbl_terr_${String(i).padStart(2, "0")}`,
      serveuseId: USR_SERV_1, actif: true, depuisLe: ilY(300),
    })),
  );

  // Abonnements ESSAI 14 jours ------------------------------------
  await parLots(s.abonnements, [
    {
      id: "abo_terr_001", terrasseId: ETAB_TERR, plan: "ESSENTIEL", tranche: "PETITE",
      statut: "ESSAI", typeEtablissement: "TERRASSE", essaiFin: ajouterJours(now, 14),
      periodeDebut: now, periodeFin: ajouterJours(now, 14),
      annuel: false, nbTablesMaxPeriode: 6, prorataDu: 0, fraisInstallPayes: false,
    },
    {
      id: "abo_bout_001", terrasseId: ETAB_BOUT, plan: "BOUTIQUE", tranche: "PETITE",
      statut: "ESSAI", typeEtablissement: "BOUTIQUE", essaiFin: ajouterJours(now, 14),
      periodeDebut: now, periodeFin: ajouterJours(now, 14),
      annuel: false, nbTablesMaxPeriode: 1, prorataDu: 0, fraisInstallPayes: false,
    },
  ]);

  // Session de service, commandes de démo, alerte ------------------
  await parLots(s.sessionsService, [
    { id: "ses_marie_001", terrasseId: ETAB_TERR, serveuseId: USR_SERV_1, statut: "OUVERTE", ouverteLe: ilY(240), clotureeLe: null },
  ]);
  await parLots(s.clientsSession, [
    { id: "cli_terr_t1", tableId: "tbl_terr_01", prenom: "Patrick", creeLe: ilY(90) },
    { id: "cli_terr_t3", tableId: "tbl_terr_03", prenom: "Sarah", creeLe: ilY(30) },
  ]);

  const prdNkoyi = produitsTerrasse.find((p) => p.nom === "Nkoyi Blonde 33cl")!;
  const prdTembo = produitsTerrasse.find((p) => p.nom === "Tembo 33cl")!;
  const prdCoca = produitsTerrasse.find((p) => p.nom === "Coca-Cola 33cl")!;
  const prixNkoyi = prixPour("Nkoyi Blonde", "33cl", "Bières");
  const prixTembo = prixPour("Tembo", "33cl", "Bières");
  const prixCoca = prixPour("Coca-Cola", "33cl", "Boissons");
  await parLots(s.commandes, [
    {
      id: "cmd_terr_001", terrasseId: ETAB_TERR, tableId: "tbl_terr_03",
      clientSessionId: "cli_terr_t3", statut: "EN_ATTENTE",
      lignes: [{ produitId: prdNkoyi.id, nom: prdNkoyi.nom, quantite: 2, prixCdf: prixNkoyi.cdf, prixUsdCentimes: prixNkoyi.usd }],
      totalCdf: 2 * prixNkoyi.cdf, totalUsd: 2 * prixNkoyi.usd,
      cleIdempotence: "seed_terr_001",
      creeLe: ilY(25), confirmeeLe: null, servieLe: null, annuleLe: null,
      motifAnnulation: null, serviePar: null,
    },
    {
      id: "cmd_terr_002", terrasseId: ETAB_TERR, tableId: "tbl_terr_01",
      clientSessionId: "cli_terr_t1", statut: "SERVIE",
      lignes: [
        { produitId: prdTembo.id, nom: prdTembo.nom, quantite: 1, prixCdf: prixTembo.cdf, prixUsdCentimes: prixTembo.usd },
        { produitId: prdCoca.id, nom: prdCoca.nom, quantite: 1, prixCdf: prixCoca.cdf, prixUsdCentimes: prixCoca.usd },
      ],
      totalCdf: prixTembo.cdf + prixCoca.cdf, totalUsd: prixTembo.usd + prixCoca.usd,
      cleIdempotence: "seed_terr_002",
      creeLe: ilY(85), confirmeeLe: ilY(82), servieLe: ilY(70), annuleLe: null,
      motifAnnulation: null, serviePar: USR_SERV_1,
    },
  ]);

  await parLots(s.alertes, [
    {
      id: "alt_terr_001", terrasseId: ETAB_TERR, type: "STOCK_BAS",
      message: `Stock bas : Nkoyi Blonde 33cl (5 restants, seuil 6)`,
      lu: false, creeLe: ilY(120),
    },
  ]);

  // Quincaillerie, pharmacie, restaurant, hôtel
  await seedNouveauxEtablissements(catalogue, debut, now);
}

// ------------------------------------------------------------
// Seed canonique historique = référentiel + fixtures de démo.
// Conservé pour les tests et le développement ; la production
// n'exécute que executerSeedReferentiel (db/seed.ts).
// ------------------------------------------------------------
export async function executerSeedCanonique() {
  const { nbCatalogue } = await executerSeedReferentiel();
  await executerFixturesDemo();
  return { nbCatalogue };
}
