// ============================================================
// GBS / Nganda POS — Types partagés frontend ↔ backend
// ------------------------------------------------------------
// Conventions :
// - Montants en entiers : CDF en francs, USD en centimes.
// - Dates : chaînes ISO (fuseau Africa/Lubumbashi géré côté app).
// - Aucune donnée secrète ici : les PIN ne quittent jamais le serveur.
// ============================================================

export * from "./errors";

// ---------- Rôles et énumérations métier ----------

/** Rôle d'un membre au sein d'un établissement (annexe §7, étape 2).
 *  PROPRIETAIRE n'y figure pas : c'est le compte propriétaire,
 *  pas une affectation. */
export type RoleEtablissement =
  | "GERANT" | "SERVEUSE" | "CAISSIER" | "CUISINE_BAR" | "BILLARDIER"
  | "RECEPTIONNISTE" | "GOUVERNANTE" | "PHARMACIEN" | "VENDEUR" | "PRESTATAIRE"
  | "CHEF" | "MAGASINIER";

/** Rôle actif global d'un utilisateur dans l'application :
 *  les rôles transverses + tout rôle d'établissement (annexe §7). */
export type RoleActif = "PROPRIETAIRE" | "CLIENT" | "SUPER_ADMIN" | RoleEtablissement;

// ============================================================
// RBAC — annexe « Expérience par type » §7 (étape 2)
// ============================================================

/** Action sensible contrôlée par le RBAC. Chaque refus et chaque
 *  exécution sont journalisés dans audit_log (qui, quoi, quand,
 *  établissement, avant/après). */
export type ActionSensible =
  | "VOIR_RAPPORTS"        // rapports et caisse consolidée
  | "DECLARER_CAISSE"      // déclarer sa caisse en fin de shift
  | "VALIDER_CAISSE"       // valider/contester une déclaration de caisse
  | "MODIFIER_PRIX"        // prix / tarifs
  | "REMISE"               // remise dans la limite du seuil du rôle
  | "REMISE_HORS_SEUIL"    // remise au-delà du seuil (approbation)
  | "ANNULER_VENTE"        // annuler une vente après encaissement
  | "AJUSTER_STOCK"        // ajustement manuel de stock (motif exigé)
  | "VALIDER_TOKEN_BILLARD"// encaisser un token billard
  | "VALIDER_ORDONNANCE"   // valider ordonnance / substances contrôlées
  | "VOIR_CREDITS"         // crédits clients
  | "GERER_EQUIPE";        // invitations, affectations, révocations

const TOUTES_LES_ACTIONS: readonly ActionSensible[] = [
  "VOIR_RAPPORTS", "MODIFIER_PRIX", "REMISE", "REMISE_HORS_SEUIL",
  "ANNULER_VENTE", "AJUSTER_STOCK", "VALIDER_TOKEN_BILLARD",
  "VALIDER_ORDONNANCE", "VOIR_CREDITS", "GERER_EQUIPE",
];

/** Matrice des permissions par rôle (table de l'annexe §7).
 *  Le propriétaire peut TOUT — il n'apparaît donc pas ici : peut()
 *  court-circuite sur PROPRIETAIRE. Toute ligne est surchargeable
 *  par le propriétaire via la table permissions_surcharge. */
export const PERMISSIONS_PAR_ROLE: Record<RoleEtablissement, readonly ActionSensible[]> = {
  GERANT: [
    "VOIR_RAPPORTS", "MODIFIER_PRIX", "REMISE", "REMISE_HORS_SEUIL",
    "ANNULER_VENTE", "AJUSTER_STOCK", "VALIDER_TOKEN_BILLARD", "VOIR_CREDITS",
  ],
  SERVEUSE: ["REMISE", "VALIDER_TOKEN_BILLARD"],
  CAISSIER: ["REMISE", "VALIDER_TOKEN_BILLARD"],
  CUISINE_BAR: [],
  BILLARDIER: ["REMISE", "VALIDER_TOKEN_BILLARD"],
  RECEPTIONNISTE: ["REMISE", "VOIR_CREDITS"],
  GOUVERNANTE: [],
  PHARMACIEN: ["REMISE", "VALIDER_ORDONNANCE"],
  VENDEUR: ["REMISE"],
  PRESTATAIRE: ["REMISE"],
  CHEF: [],                    // traiteur : fiches de production, aucun prix visible
  MAGASINIER: ["AJUSTER_STOCK"], // traiteur : bons de sortie et comptages, aucun prix visible
};

/** Seuil de remise par rôle, en pour cent (0-100). null = illimité.
 *  « Configurable par rôle » (annexe §7) : ces valeurs sont les défauts ;
 *  le propriétaire pourra les ajuster par établissement (surcharge). */
export const SEUIL_REMISE_PAR_ROLE: Record<RoleEtablissement, number | null> = {
  GERANT: null,
  SERVEUSE: 5,
  CAISSIER: 5,
  CUISINE_BAR: 0,
  BILLARDIER: 5,
  RECEPTIONNISTE: 5,
  GOUVERNANTE: 0,
  PHARMACIEN: 5,
  VENDEUR: 5,
  PRESTATAIRE: 0,
  CHEF: 0,
  MAGASINIER: 0,
};

/** Permissions par défaut d'un rôle (ensemble déduit de la matrice). */
export function permissionsParDefaut(role: RoleEtablissement): Set<ActionSensible> {
  return new Set(PERMISSIONS_PAR_ROLE[role] ?? []);
}

/** Seuil de remise par défaut d'un rôle (null = illimité). */
export function seuilRemisePour(role: RoleEtablissement): number | null {
  return SEUIL_REMISE_PAR_ROLE[role];
}

/** Liste exhaustive des actions sensibles (validation, tests). */
export function toutesLesActionsSensibles(): readonly ActionSensible[] {
  return TOUTES_LES_ACTIONS;
}

export type StatutCommande = "EN_ATTENTE" | "CONFIRMEE" | "SERVIE" | "ANNULEE";

/** Tranche tarifaire selon le nombre de tables/zones actives */
export type Tranche = "PETITE" | "MOYENNE" | "GRANDE";

/**
 * Plans d'abonnement.
 * BOUTIQUE : plan d'entrée à 5 USD/mois réservé aux boutiques de quartier
 * (1 seule zone « Comptoir »). Une boutique peut ensuite évoluer vers
 * ESSENTIEL/PRO/BUSINESS : son type d'origine reste une simple étiquette.
 */
export type PlanCode = "ESSENTIEL" | "PRO" | "BUSINESS" | "BOUTIQUE";

/** Type d'établissement : terrasse (tables multiples), boutique ou autre
 *  commerce de quartier. GUEST_HOUSE est le code métier des hôtels.
 *  BILLARD = salle de billard (file Vincaire). Un établissement peut
 *  FUSIONNER 1 à 3 types (type principal + types_secondaires). */
export type TypeEtablissement =
  | "TERRASSE"
  | "GUEST_HOUSE"
  | "BOUTIQUE"
  | "RESTAURANT"
  | "PHARMACIE"
  | "SALON"
  | "AUTRE"
  | "QUINCAILLERIE"
  | "BILLARD";

// ---------- Registre central TYPES_ETABLISSEMENT (Annexe « Expérience
// par type ») — source UNIQUE des différences entre métiers ----------
// Interdit : des `if (type === …)` dispersés dans les composants.
// Toute différence d'expérience passe par ce registre ; les surcharges
// par établissement (feature flags) vivent en base (modules_etablissement).

/** Modules activables (feature flags). Liste fixe de l'annexe §0. */
export type Module =
  | "MENU" | "COMMANDES" | "CUISINE_BAR" | "STOCK" | "CAISSE" | "ALERTES"
  | "BILLARD_FILE" | "CHAMBRES" | "FOLIO" | "MENAGE"
  | "LOTS_PEREMPTION" | "ORDONNANCES" | "CATALOGUE"
  | "CREDIT_CLIENT" | "RENDEZ_VOUS";

/** Nature de QR qu'un type peut imprimer. ZONE = table/chambre/poste ;
 *  COMPTOIR = QR mural des commerces à zone unique ; BILLARD = file
 *  Vincaire (QR posé sur le billard). */
export type QrAutorise = "ZONE" | "COMPTOIR" | "BILLARD" | "CHAMBRE";

/** Vocabulaire par métier : comment on nomme une zone de vente. */
export interface Libelle {
  fr: string;
  en: string;
  pt: string;
  sw: string;
}

/** Définition complète d'un type d'établissement. */
export interface TypeEtablissementDef {
  type: TypeEtablissement;
  /** Modules activés PAR DÉFAUT (surchargeables par établissement) */
  modules: readonly Module[];
  /** Vocabulaire de la zone de vente (singulier / pluriel) */
  zone: Libelle;
  zones: Libelle;
  qrAutorises: readonly QrAutorise[];
  roles: readonly RoleEtablissement[];
  /** Identifiants de widgets du tableau de bord propriétaire */
  widgets: readonly string[];
  /** Codes de règles d'alerte de traçabilité (annexe §9) */
  alertes: readonly string[];
  /** Règles historiques reprises telles quelles (boucle 1) : */
  fraisInstallationUsd: number; // 500 boutique/salon, 1000 sinon
  zoneUnique: boolean;          // comptoir + QR mural
  rechercheProduit: boolean;    // recherche par nom dans la carte client
}

const TABLE: Libelle = { fr: "table", en: "table", pt: "mesa", sw: "meza" };
const TABLES: Libelle = { fr: "tables", en: "tables", pt: "mesas", sw: "meza" };
const CHAMBRE: Libelle = { fr: "chambre", en: "room", pt: "quarto", sw: "chumba" };
const CHAMBRES: Libelle = { fr: "chambres", en: "rooms", pt: "quartos", sw: "vyumba" };
const COMPTOIR: Libelle = { fr: "comptoir", en: "counter", pt: "balcão", sw: "kaunta" };

const ALERTES_COMMUNES = [
  "REMISE_SUSPECTE", "ECART_CAISSE", "ECART_STOCK", "ANNULATION_APRES_ENCAISSEMENT",
] as const;

/** Le registre. Chaque type = une expérience, un seul produit. */
export const TYPES_ETABLISSEMENT: Record<TypeEtablissement, TypeEtablissementDef> = {
  TERRASSE: {
    type: "TERRASSE",
    modules: ["MENU", "COMMANDES", "CUISINE_BAR", "STOCK", "CAISSE", "ALERTES", "BILLARD_FILE", "CATALOGUE"],
    zone: TABLE, zones: TABLES,
    qrAutorises: ["ZONE", "BILLARD"],
    roles: ["GERANT", "SERVEUSE", "CAISSIER", "CUISINE_BAR", "BILLARDIER", "CHEF", "MAGASINIER"],
    widgets: ["ventes_jour", "caisse_jour", "stock_bas", "top_produits", "file_billard", "alertes"],
    alertes: [...ALERTES_COMMUNES, "PARTIE_SANS_TOKEN", "TOKEN_ANNULE_PAYE", "JOUEUR_ABSENT", "TABLE_SANS_PAIEMENT", "SERVI_NON_FACTURE", "RUPTURE_STOCK"],
    fraisInstallationUsd: 1000, zoneUnique: false, rechercheProduit: false,
  },
  GUEST_HOUSE: {
    type: "GUEST_HOUSE",
    modules: ["MENU", "COMMANDES", "CUISINE_BAR", "STOCK", "CAISSE", "ALERTES", "BILLARD_FILE", "CHAMBRES", "FOLIO", "MENAGE", "CATALOGUE"],
    zone: CHAMBRE, zones: CHAMBRES,
    qrAutorises: ["ZONE", "BILLARD"],
    roles: ["GERANT", "SERVEUSE", "RECEPTIONNISTE", "CHEF"],
    widgets: ["occupation_chambres", "caisse_jour", "menage", "file_billard", "ventes_jour", "alertes"],
    alertes: [...ALERTES_COMMUNES, "PARTIE_SANS_TOKEN", "TOKEN_ANNULE_PAYE", "JOUEUR_ABSENT", "CHAMBRE_SANS_NOTE", "CHECKOUT_SANS_SOLDE", "MENAGE_NON_VALIDE"],
    fraisInstallationUsd: 1000, zoneUnique: false, rechercheProduit: false,
  },
  RESTAURANT: {
    type: "RESTAURANT",
    modules: ["MENU", "COMMANDES", "CUISINE_BAR", "STOCK", "CAISSE", "ALERTES", "CATALOGUE"],
    zone: TABLE, zones: TABLES,
    qrAutorises: ["ZONE"],
    roles: ["GERANT", "SERVEUSE", "CUISINE_BAR", "CAISSIER", "CHEF", "MAGASINIER"],
    widgets: ["ventes_jour", "caisse_jour", "stock_bas", "top_produits", "tables_ouvertes", "alertes"],
    alertes: [...ALERTES_COMMUNES, "TABLE_SANS_PAIEMENT", "SERVI_NON_FACTURE", "RUPTURE_STOCK"],
    fraisInstallationUsd: 1000, zoneUnique: false, rechercheProduit: false,
  },
  BOUTIQUE: {
    type: "BOUTIQUE",
    modules: ["CATALOGUE", "COMMANDES", "STOCK", "CAISSE", "ALERTES", "CREDIT_CLIENT"],
    zone: COMPTOIR, zones: COMPTOIR,
    qrAutorises: ["COMPTOIR"],
    roles: ["GERANT", "VENDEUR", "CAISSIER"],
    widgets: ["ventes_jour", "caisse_jour", "ruptures", "credits", "alertes"],
    alertes: [...ALERTES_COMMUNES, "RUPTURE_STOCK", "ECART_INVENTAIRE", "CREDIT_PLAFOND"],
    fraisInstallationUsd: 500, zoneUnique: true, rechercheProduit: true,
  },
  PHARMACIE: {
    type: "PHARMACIE",
    modules: ["CATALOGUE", "COMMANDES", "STOCK", "CAISSE", "ALERTES", "LOTS_PEREMPTION", "ORDONNANCES"],
    zone: COMPTOIR, zones: COMPTOIR,
    qrAutorises: ["ZONE", "COMPTOIR"], // plusieurs comptoirs/rayons (règle historique)
    roles: ["GERANT", "PHARMACIEN", "VENDEUR"],
    widgets: ["ventes_jour", "caisse_jour", "peremptions", "ruptures", "ordonnances_attente", "alertes"],
    alertes: [...ALERTES_COMMUNES, "LOT_PEREMPTION", "ORDONNANCE_SANS_VALIDATION", "ECART_REGISTRE", "RUPTURE_STOCK"],
    fraisInstallationUsd: 1000, zoneUnique: false, rechercheProduit: true,
  },
  QUINCAILLERIE: {
    type: "QUINCAILLERIE",
    modules: ["CATALOGUE", "COMMANDES", "STOCK", "CAISSE", "ALERTES", "CREDIT_CLIENT"],
    zone: COMPTOIR, zones: COMPTOIR,
    qrAutorises: ["COMPTOIR"],
    roles: ["GERANT", "VENDEUR", "CAISSIER"],
    widgets: ["ventes_jour", "caisse_jour", "ruptures", "credits", "devis_en_cours", "alertes"],
    alertes: [...ALERTES_COMMUNES, "RUPTURE_STOCK", "ECART_INVENTAIRE", "CREDIT_PLAFOND"],
    fraisInstallationUsd: 1000, zoneUnique: true, rechercheProduit: true,
  },
  SALON: {
    type: "SALON",
    modules: ["RENDEZ_VOUS", "CATALOGUE", "STOCK", "CAISSE", "ALERTES"],
    zone: COMPTOIR, zones: COMPTOIR,
    qrAutorises: ["COMPTOIR"],
    roles: ["GERANT", "PRESTATAIRE"],
    widgets: ["rdv_jour", "caisse_jour", "commissions", "alertes"],
    alertes: [...ALERTES_COMMUNES, "RUPTURE_STOCK"],
    fraisInstallationUsd: 500, zoneUnique: true, rechercheProduit: false,
  },
  AUTRE: {
    type: "AUTRE",
    modules: ["CATALOGUE", "COMMANDES", "STOCK", "CAISSE", "ALERTES"],
    zone: COMPTOIR, zones: COMPTOIR,
    qrAutorises: ["COMPTOIR"],
    roles: ["GERANT", "SERVEUSE", "VENDEUR"],
    widgets: ["ventes_jour", "caisse_jour", "stock_bas", "alertes"],
    alertes: [...ALERTES_COMMUNES],
    fraisInstallationUsd: 1000, zoneUnique: true, rechercheProduit: false,
  },
  BILLARD: {
    type: "BILLARD",
    modules: ["MENU", "COMMANDES", "STOCK", "CAISSE", "ALERTES", "BILLARD_FILE", "CATALOGUE"],
    zone: { fr: "billard", en: "pool table", pt: "bilhar", sw: "billiard" },
    zones: { fr: "billards", en: "pool tables", pt: "bilhares", sw: "billiards" },
    qrAutorises: ["BILLARD"],
    roles: ["GERANT", "BILLARDIER", "SERVEUSE", "CAISSIER"],
    widgets: ["file_billard", "caisse_jour", "ventes_jour", "alertes"],
    alertes: [...ALERTES_COMMUNES, "PARTIE_SANS_TOKEN", "TOKEN_ANNULE_PAYE", "JOUEUR_ABSENT"],
    fraisInstallationUsd: 1000, zoneUnique: false, rechercheProduit: false,
  },
};

/** Vrai si le type a de vraies « zones » numérotées (tables de salle,
 *  chambres, billards). Faux pour les établissements à comptoir
 *  (pharmacie, boutique, quincaillerie, salon…) : un seul QR comptoir
 *  est créé à l'inscription — une pharmacie n'a pas de « tables ». */
export function aTablesDeSalle(type: TypeEtablissement): boolean {
  return TYPES_ETABLISSEMENT[type].zone.fr !== "comptoir";
}

/** Tous les types d'un établissement : principal + secondaires fusionnés. */
export function tousLesTypes(
  principal: TypeEtablissement,
  secondaires: readonly TypeEtablissement[] = [],
): TypeEtablissement[] {
  return [principal, ...secondaires.filter((t) => t !== principal)];
}

/** Définition FUSIONNÉE d'un établissement multi-métiers (1 à 3 types) :
 *  union des modules, QR, rôles, widgets et alertes ; vocabulaire et
 *  frais d'installation du type PRINCIPAL (règle de tarification
 *  inchangée — décision produit) ; zone unique seulement si TOUS les
 *  types fusionnés sont à comptoir unique. */
export function defFusionnee(
  principal: TypeEtablissement,
  secondaires: readonly TypeEtablissement[] = [],
): TypeEtablissementDef {
  const base = TYPES_ETABLISSEMENT[principal];
  const types = tousLesTypes(principal, secondaires);
  if (types.length === 1) return base;
  const defs = types.map((t) => TYPES_ETABLISSEMENT[t]);
  const union = <T,>(pick: (d: TypeEtablissementDef) => readonly T[]): T[] =>
    [...new Set(defs.flatMap(pick))];
  return {
    ...base,
    modules: union((d) => d.modules),
    qrAutorises: union((d) => d.qrAutorises),
    roles: union((d) => d.roles),
    widgets: union((d) => d.widgets),
    alertes: union((d) => d.alertes),
    zoneUnique: defs.every((d) => d.zoneUnique),
    rechercheProduit: defs.some((d) => d.rechercheProduit),
  };
}

/** Définition du registre pour un type (raccourci typé). */
export function defType(type: TypeEtablissement): TypeEtablissementDef {
  return TYPES_ETABLISSEMENT[type];
}

/** Modules activés par défaut pour un type (avant surcharges). */
export function modulesParDefaut(type: TypeEtablissement): readonly Module[] {
  return TYPES_ETABLISSEMENT[type].modules;
}

// --- Helpers historiques CONSERVÉS (mêmes signatures, zéro appelant
//     modifié) : ils délèguent désormais au registre. ---

/**
 * Frais d'installation uniques (centimes USD), débités à la première
 * échéance payée. Règle métier fixe (prompt maître, boucle 1) :
 * 5 $ boutique/salon, 10 $ sinon. Source : registre.
 */
export function fraisInstallationPour(type: TypeEtablissement): number {
  return TYPES_ETABLISSEMENT[type].fraisInstallationUsd;
}

/** Types à zone de vente unique (« Comptoir » + QR mural, plan BOUTIQUE
 *  possible). Dérivé du registre (champ zoneUnique). */
export const TYPES_ZONE_UNIQUE: readonly TypeEtablissement[] = (
  Object.keys(TYPES_ETABLISSEMENT) as TypeEtablissement[]
).filter((t) => TYPES_ETABLISSEMENT[t].zoneUnique);

/** Types orientés produits : recherche par nom dans la carte client.
 *  Dérivé du registre (champ rechercheProduit). */
export const TYPES_RECHERCHE_PRODUIT: readonly TypeEtablissement[] = (
  Object.keys(TYPES_ETABLISSEMENT) as TypeEtablissement[]
).filter((t) => TYPES_ETABLISSEMENT[t].rechercheProduit);

export type TypeMouvement =
  | "RESERVATION" | "LIBERATION" | "VENTE"
  | "ENTREE" | "PERTE" | "INVENTAIRE" | "AJUSTEMENT"
  // Sortie de stock pour un bon traiteur (MODULE-TRAITEUR §4)
  | "TRAITEUR";

/** Provenance de la photo d'un produit */
export type SourcePhoto = "CATALOGUE" | "UPLOAD";

// ---------- Entités ----------

export interface Organisation {
  id: string;
  nom: string;
  proprietaireId: string;
  /** Langue de l'organisation (« fr » | « en » | « pt ») — boucle 5 */
  langue?: string;
  creeLe: string;
}

export interface Utilisateur {
  id: string;
  nom: string;
  telephone: string;
  creeLe: string;
  // Le PIN n'apparaît JAMAIS ici : vérifié côté serveur uniquement.
}

export interface ParametresTerrasse {
  seuilEcartCdf: number;
  seuilEcartUsdCentimes: number;
  /** Taux USD→FC de l'établissement ; null = mono-devise (bouton
   *  FC/$ masqué, aucune conversion implicite — règle taux). */
  tauxUsdCdf: number | null;
}

/**
 * Établissement géré par la plateforme.
 * Le nom historique « Terrasse » est conservé pour la rétrocompatibilité ;
 * l'alias `Etablissement` (ci-dessous) est le nom métier à privilégier.
 */
export interface Terrasse {
  id: string;
  organisationId: string;
  nom: string;
  adresse: string;
  /** Type PRINCIPAL (1er coché à l'inscription) — commande la
   *  tarification et le vocabulaire. */
  type: TypeEtablissement;
  /** Types fusionnés en plus du principal (0 à 2) — l'expérience
   *  est l'union des définitions du registre (defFusionnee). */
  typesSecondaires: TypeEtablissement[];
  /** QR mural unique d'une boutique (null pour une terrasse) */
  tokenQrBoutique: string | null;
  parametres: ParametresTerrasse;
  creeLe: string;
}

/** Alias métier : une « terrasse » au sens technique = un établissement */
export type Etablissement = Terrasse;

export interface Affectation {
  id: string;
  utilisateurId: string;
  terrasseId: string;
  role: RoleEtablissement;
  actif: boolean;
  creeLe: string;
}

export interface TableT {
  id: string;
  terrasseId: string;
  numero: number;
  tokenQr: string;
  actif: boolean;
  creeLe: string;
  archiveLe: string | null;
  /** Nature de la zone scannée : ZONE = table/comptoir classique,
   *  BILLARD = table de billard (file Vincaire). Défaut ZONE. */
  kind: "ZONE" | "BILLARD" | "CHAMBRE";
}

/**
 * Catégories proposées dans la liste déroulante du formulaire produit.
 * « Divers » est la valeur par défaut pour un produit sans catégorie
 * définie — la base accepte néanmoins toute chaîne libre.
 *
 * @deprecated boucle 3 : liste plate historique, remplacée par le
 * référentiel CATEGORIES_PAR_TYPE ci-dessous (table categories_produit).
 * Conservée pour la compatibilité des écrans existants le temps de la
 * migration du formulaire.
 */
export const CATEGORIES_PRODUIT = [
  "Bières",
  "Boissons",
  "Snacks & conserves",
  "Produits de base",
  "Poissons",
  "Savons & détergents",
  "Divers",
] as const;

// ---------------------------------------------------------------
// Boucle 3 — Référentiel des catégories de produit par type
// d'établissement (miroir de la table categories_produit).
// Une même catégorie (ex. Bières) existe pour plusieurs types :
// l'unicité est (code, type_etablissement).
// ---------------------------------------------------------------

/** Nature du produit : pilote les champs du formulaire et le stock.
 *  MARCHANDISE = stock décrémenté ; CHAMBRE = capacité requise ;
 *  SERVICE = durée requise ; BILLARD = partie/jetons.
 *  SERVICE et BILLARD ne décrémentent jamais le stock et ne
 *  déclenchent jamais d'alerte STOCK_BAS. */
export type TypeProduit = "MARCHANDISE" | "CHAMBRE" | "SERVICE" | "BILLARD";

export interface CategorieProduit {
  /** Code stable en majuscules (BIERES, PLATS, CHAMBRES…) */
  code: string;
  typeEtablissement: TypeEtablissement;
  nomFr: string;
  nomEn: string;
  nomPt: string;
  /** Nom d'icône Lucide (résolu côté UI, jamais stocké en dur) */
  icone: string;
  ordreAffichage: number;
}

/** Référentiel canonique (prompt maître, boucle 3). La colonne
 *  produits.categorie garde le libellé FRANÇAIS (nomFr) pour la
 *  compatibilité des données existantes. */
export const CATEGORIES_PAR_TYPE: readonly CategorieProduit[] = [
  // TERRASSE
  { code: "BIERES", typeEtablissement: "TERRASSE", nomFr: "Bières", nomEn: "Beers", nomPt: "Cervejas", icone: "Beer", ordreAffichage: 10 },
  { code: "BOISSONS", typeEtablissement: "TERRASSE", nomFr: "Boissons", nomEn: "Drinks", nomPt: "Bebidas", icone: "CupSoda", ordreAffichage: 20 },
  { code: "BILLARD", typeEtablissement: "TERRASSE", nomFr: "Billard", nomEn: "Pool", nomPt: "Bilhar", icone: "Target", ordreAffichage: 30 },
  { code: "SNACKS", typeEtablissement: "TERRASSE", nomFr: "Snacks & conserves", nomEn: "Snacks & canned goods", nomPt: "Snacks e conservas", icone: "Cookie", ordreAffichage: 40 },
  { code: "PLATS", typeEtablissement: "TERRASSE", nomFr: "Plats", nomEn: "Dishes", nomPt: "Pratos", icone: "UtensilsCrossed", ordreAffichage: 50 },
  // GUEST_HOUSE
  { code: "CHAMBRES", typeEtablissement: "GUEST_HOUSE", nomFr: "Chambres", nomEn: "Rooms", nomPt: "Quartos", icone: "BedDouble", ordreAffichage: 10 },
  { code: "BIERES", typeEtablissement: "GUEST_HOUSE", nomFr: "Bières", nomEn: "Beers", nomPt: "Cervejas", icone: "Beer", ordreAffichage: 20 },
  { code: "BOISSONS", typeEtablissement: "GUEST_HOUSE", nomFr: "Boissons", nomEn: "Drinks", nomPt: "Bebidas", icone: "CupSoda", ordreAffichage: 30 },
  { code: "BILLARD", typeEtablissement: "GUEST_HOUSE", nomFr: "Billard", nomEn: "Pool", nomPt: "Bilhar", icone: "Target", ordreAffichage: 40 },
  { code: "SERVICES", typeEtablissement: "GUEST_HOUSE", nomFr: "Services", nomEn: "Services", nomPt: "Serviços", icone: "ConciergeBell", ordreAffichage: 50 },
  { code: "PETIT_DEJEUNER", typeEtablissement: "GUEST_HOUSE", nomFr: "Petit-déjeuner", nomEn: "Breakfast", nomPt: "Pequeno-almoço", icone: "Croissant", ordreAffichage: 60 },
  // RESTAURANT
  { code: "PLATS", typeEtablissement: "RESTAURANT", nomFr: "Plats", nomEn: "Dishes", nomPt: "Pratos", icone: "UtensilsCrossed", ordreAffichage: 10 },
  { code: "BOISSONS", typeEtablissement: "RESTAURANT", nomFr: "Boissons", nomEn: "Drinks", nomPt: "Bebidas", icone: "CupSoda", ordreAffichage: 20 },
  { code: "BIERES", typeEtablissement: "RESTAURANT", nomFr: "Bières", nomEn: "Beers", nomPt: "Cervejas", icone: "Beer", ordreAffichage: 30 },
  { code: "DESSERTS", typeEtablissement: "RESTAURANT", nomFr: "Desserts", nomEn: "Desserts", nomPt: "Sobremesas", icone: "IceCreamCone", ordreAffichage: 40 },
  // BOUTIQUE
  { code: "PRODUITS_BASE", typeEtablissement: "BOUTIQUE", nomFr: "Produits de base", nomEn: "Staples", nomPt: "Bens de base", icone: "Wheat", ordreAffichage: 10 },
  { code: "SAVONS", typeEtablissement: "BOUTIQUE", nomFr: "Savons & détergents", nomEn: "Soaps & detergents", nomPt: "Sabões e detergentes", icone: "Droplets", ordreAffichage: 20 },
  { code: "SNACKS", typeEtablissement: "BOUTIQUE", nomFr: "Snacks & conserves", nomEn: "Snacks & canned goods", nomPt: "Snacks e conservas", icone: "Cookie", ordreAffichage: 30 },
  { code: "BOISSONS", typeEtablissement: "BOUTIQUE", nomFr: "Boissons", nomEn: "Drinks", nomPt: "Bebidas", icone: "CupSoda", ordreAffichage: 40 },
  { code: "POISSONS", typeEtablissement: "BOUTIQUE", nomFr: "Poissons", nomEn: "Fish", nomPt: "Peixes", icone: "Fish", ordreAffichage: 50 },
  { code: "DIVERS", typeEtablissement: "BOUTIQUE", nomFr: "Divers", nomEn: "Miscellaneous", nomPt: "Diversos", icone: "Package", ordreAffichage: 60 },
  // PHARMACIE
  { code: "MEDICAMENTS", typeEtablissement: "PHARMACIE", nomFr: "Médicaments", nomEn: "Medicines", nomPt: "Medicamentos", icone: "Pill", ordreAffichage: 10 },
  { code: "PARAPHARMACIE", typeEtablissement: "PHARMACIE", nomFr: "Parapharmacie", nomEn: "Parapharmacy", nomPt: "Parafarmácia", icone: "HeartPulse", ordreAffichage: 20 },
  { code: "TESTS", typeEtablissement: "PHARMACIE", nomFr: "Tests", nomEn: "Tests", nomPt: "Testes", icone: "TestTube2", ordreAffichage: 30 },
  { code: "HYGIENE", typeEtablissement: "PHARMACIE", nomFr: "Hygiène", nomEn: "Hygiene", nomPt: "Higiene", icone: "Sparkles", ordreAffichage: 40 },
  // QUINCAILLERIE
  { code: "ELECTRICITE", typeEtablissement: "QUINCAILLERIE", nomFr: "Électricité", nomEn: "Electrical", nomPt: "Eletricidade", icone: "Zap", ordreAffichage: 10 },
  { code: "CONSTRUCTION", typeEtablissement: "QUINCAILLERIE", nomFr: "Construction", nomEn: "Construction", nomPt: "Construção", icone: "HardHat", ordreAffichage: 20 },
  { code: "OUTILLAGE", typeEtablissement: "QUINCAILLERIE", nomFr: "Outillage", nomEn: "Tools", nomPt: "Ferramentas", icone: "Wrench", ordreAffichage: 30 },
  { code: "PEINTURE", typeEtablissement: "QUINCAILLERIE", nomFr: "Peinture", nomEn: "Paint", nomPt: "Pintura", icone: "PaintRoller", ordreAffichage: 40 },
  { code: "PLOMBERIE", typeEtablissement: "QUINCAILLERIE", nomFr: "Plomberie", nomEn: "Plumbing", nomPt: "Canalização", icone: "ShowerHead", ordreAffichage: 50 },
  // SALON
  { code: "COUPES", typeEtablissement: "SALON", nomFr: "Coupes", nomEn: "Haircuts", nomPt: "Cortes", icone: "Scissors", ordreAffichage: 10 },
  { code: "TRESSES", typeEtablissement: "SALON", nomFr: "Tresses", nomEn: "Braids", nomPt: "Tranças", icone: "Ribbon", ordreAffichage: 20 },
  { code: "SOINS", typeEtablissement: "SALON", nomFr: "Soins", nomEn: "Treatments", nomPt: "Cuidados", icone: "Sparkles", ordreAffichage: 30 },
  { code: "PRODUITS_CAPILLAIRES", typeEtablissement: "SALON", nomFr: "Produits capillaires", nomEn: "Hair products", nomPt: "Produtos capilares", icone: "SprayCan", ordreAffichage: 40 },
  // AUTRE
  { code: "DIVERS", typeEtablissement: "AUTRE", nomFr: "Divers", nomEn: "Miscellaneous", nomPt: "Diversos", icone: "Package", ordreAffichage: 10 },
  // BILLARD (salle de billard — file Vincaire)
  { code: "BILLARD", typeEtablissement: "BILLARD", nomFr: "Parties de billard", nomEn: "Pool games", nomPt: "Partidas de bilhar", icone: "Target", ordreAffichage: 10 },
  { code: "BIERES", typeEtablissement: "BILLARD", nomFr: "Bières", nomEn: "Beers", nomPt: "Cervejas", icone: "Beer", ordreAffichage: 20 },
  { code: "BOISSONS", typeEtablissement: "BILLARD", nomFr: "Boissons", nomEn: "Drinks", nomPt: "Bebidas", icone: "CupSoda", ordreAffichage: 30 },
  { code: "SNACKS", typeEtablissement: "BILLARD", nomFr: "Snacks & conserves", nomEn: "Snacks & canned goods", nomPt: "Snacks e conservas", icone: "Cookie", ordreAffichage: 40 },
];

/** Catégories d'un type d'établissement, triées pour l'affichage. */
export function categoriesPour(type: TypeEtablissement): CategorieProduit[] {
  return CATEGORIES_PAR_TYPE
    .filter((c) => c.typeEtablissement === type)
    .sort((a, b) => a.ordreAffichage - b.ordreAffichage);
}

/** Type de produit par défaut déduit du code de catégorie :
 *  CHAMBRES → CHAMBRE, BILLARD → BILLARD, services du quotidien
 *  (SERVICES, COUPES, TRESSES, SOINS) → SERVICE, sinon MARCHANDISE. */
export function typeProduitParDefaut(codeCategorie: string): TypeProduit {
  if (codeCategorie === "CHAMBRES") return "CHAMBRE";
  if (codeCategorie === "BILLARD") return "BILLARD";
  if (["SERVICES", "COUPES", "TRESSES", "SOINS"].includes(codeCategorie)) return "SERVICE";
  return "MARCHANDISE";
}

/** Retrouve une catégorie du référentiel par son libellé français
 *  (produits.categorie stocke le libellé, pas le code). */
export function categorieParLibelle(libelle: string, type: TypeEtablissement): CategorieProduit | undefined {
  return CATEGORIES_PAR_TYPE.find((c) => c.typeEtablissement === type && c.nomFr === libelle);
}

/** Types de produit qui ne touchent jamais le stock (ni décrément,
 *  ni alerte STOCK_BAS) : services et parties de billard. */
export const TYPES_SANS_STOCK: readonly TypeProduit[] = ["SERVICE", "BILLARD"];

export interface Produit {
  id: string;
  terrasseId: string;
  nom: string;
  categorie: string;
  prixCdf: number;
  prixUsdCentimes: number;
  stock: number;
  stockReserve: number;
  seuilAlerte: number;
  actif: boolean;
  // --- Photos (obligatoires dans le menu client après scan QR) ---
  /** Image WebP 800×800 (≤ 40 Ko) — null = photo générique de catégorie */
  photoUrl: string | null;
  /** Vignette WebP 200×200 (≤ 8 Ko) pour les listes */
  photoThumbnailUrl: string | null;
  /** CATALOGUE = photo générique livrée ; UPLOAD = photo du gérant */
  photoSource: SourcePhoto | null;
  // --- Identité commerciale ---
  /** Variante du produit : « Normal », « Rock », « Energy »… */
  variante: string | null;
  /** true pour les bières en bouteille verre consignée */
  consignable: boolean;
  /** 12 ou 24 pour les produits vendus au casier, sinon null */
  bouteillesParCasier: number | null;
  /** Code-barres EAN-13 / EAN-8 / Code 128 (scan caméra), null si non renseigné */
  codeBarres: string | null;
  // --- Boucle 3 : formulaire adaptatif (colonnes nullables) ---
  /** Nature du produit ; null sur les données anciennes = MARCHANDISE */
  typeProduit: TypeProduit | null;
  /** Unité de vente libre : « pièce », « kg », « nuit », « heure »… */
  unite: string | null;
  /** Durée de la prestation (SERVICE), en minutes */
  dureeMinutes: number | null;
  /** Capacité d'accueil (CHAMBRE : nombre de lits/personnes) */
  capacite: number | null;
  /** Numéro de lot (pharmacie, denrées) */
  lot: string | null;
  /** Date de péremption ISO « AAAA-MM-JJ » (pharmacie, denrées) */
  datePeremption: string | null;
}

/**
 * Entrée du catalogue de démarrage (photos génériques par catégorie,
 * sans marque protégée). Importable dans n'importe quel établissement.
 * La table DB correspondante arrive à l'étape 2 ; le type est posé ici.
 */
export interface ProduitCatalogue {
  id: string;
  categorie: string;
  nom: string;
  variante: string | null;
  consignable: boolean;
  bouteillesParCasier: number | null;
  photoUrl: string | null;
  photoThumbnailUrl: string | null;
  ordreAffichage: number;
  actif: boolean;
}

export interface TableServeuse {
  id: string;
  tableId: string;
  serveuseId: string;
  actif: boolean;
  depuisLe: string;
}

export interface ClientSession {
  id: string;
  tableId: string;
  prenom: string;
  creeLe: string;
}

export interface LigneCommande {
  produitId: string;
  nom: string;
  quantite: number;
  prixCdf: number;
  prixUsdCentimes: number;
}

export interface Commande {
  id: string;
  terrasseId: string;
  tableId: string;
  clientSessionId: string;
  statut: StatutCommande;
  lignes: LigneCommande[];
  totalCdf: number;
  totalUsdCentimes: number;
  /** Clé d'idempotence : un double envoi ne crée jamais deux commandes */
  cleIdempotence: string;
  creeLe: string;
  confirmeeLe: string | null;
  servieLe: string | null;
  annuleLe: string | null;
  motifAnnulation: string | null;
  serviePar: string | null;
  /** Encaissement cash : null tant que la serveuse/le comptoir n'a pas encaissé */
  payeeLe: string | null;
  payeePar: string | null;
}

export interface SessionService {
  id: string;
  terrasseId: string;
  serveuseId: string;
  statut: "OUVERTE" | "CLOTUREE";
  ouverteLe: string;
  clotureeLe: string | null;
}

export interface Depot {
  id: string;
  sessionId: string;
  terrasseId: string;
  serveuseId: string;
  typeDepot: "CHAMBRE" | "COMMANDE";
  montantAttenduCdf: number;
  montantAttenduUsdCentimes: number;
  declareCdf: number;
  declareUsdCentimes: number;
  statut: "DECLARE" | "VALIDE" | "CONTESTE";
  declareLe: string;
  valideLe: string | null;
  validePar: string | null;
  motifContest: string | null;
}

/** Dépense de caisse : sortie d'argent qui réduit le solde de la boutique */
export interface Depense {
  id: string;
  terrasseId: string;
  montantCdf: number;
  montantUsdCentimes: number;
  motif: string;
  saisiPar: string;
  roleActif: RoleActif | null;
  creeLe: string;
}

export interface Avis {
  id: string;
  commandeId: string;
  serveuseId: string;
  terrasseId: string;
  note: number;
  commentaire: string;
  masque: boolean;
  motifMasquage: string | null;
  creeLe: string;
}

export interface Invitation {
  id: string;
  code: string;
  terrasseId: string;
  role: RoleEtablissement;
  creePar: string;
  nomPrevu: string;
  expireLe: string;
  statut: "ACTIVE" | "UTILISEE" | "EXPIREE" | "REVOQUEE";
  creeLe: string;
}

export interface DemandeStock {
  id: string;
  terrasseId: string;
  produitId: string;
  quantite: number;
  type: "REAPPRO" | "PERTE" | "ECART";
  motif: string;
  statut: "EN_ATTENTE" | "APPROUVEE" | "REFUSEE";
  creePar: string;
  creeLe: string;
  traitePar: string | null;
  traiteLe: string | null;
}

export interface Alerte {
  id: string;
  terrasseId: string;
  type: "ECART_CAISSE" | "STOCK_BAS" | "AVIS_NEGATIFS" | "ABONNEMENT" | "INFO"
    | "BILLARD_ABSENT" | "BILLARD_ANNULATION_PAYEE"
    | "TAUX_VARIATION" | "TAUX_FREQUENCE"
    // Note unique (ANNEXE-2 §6) et prise en charge (ANNEXE-3 §3)
    | "ADDITION_DEMANDEE" | "NOTE_LITIGE" | "ECART_REMISE"
    | "PRISE_EN_CHARGE" | "PRISE_EN_CHARGE_EXPIREE" | "PRISE_EN_CHARGE_ABUS"
    // Traiteur (MODULE-TRAITEUR §7bis) : écart d'inventaire détecté
    // lors d'un comptage à l'aveugle — message en QUANTITÉ seule.
    | "ECART_COMPTAGE";
  message: string;
  lu: boolean;
  creeLe: string;
}

export interface MouvementStock {
  id: string;
  produitId: string;
  terrasseId: string;
  type: TypeMouvement;
  quantite: number;
  motif: string;
  acteurId: string | null;
  roleActif: RoleActif | null;
  creeLe: string;
}

export interface AuditLog {
  id: string;
  acteurId: string | null;
  roleActif: RoleActif | null;
  action: string;
  details: string;
  creeLe: string;
}

// ---------- Abonnements et facturation ----------

export interface PlanTarif {
  plan: PlanCode;
  tranche: Tranche;
  tablesMin: number;
  tablesMax: number | null;
  prixUsdCentimes: number;
  fraisInstallUsdCentimes: number;
  /**
   * Type d'établissement cible du tarif.
   * Absent (undefined) = tarif terrasse historique ; "BOUTIQUE" = plan 5 USD.
   */
  typeEtablissementCible?: TypeEtablissement;
}

export interface Abonnement {
  id: string;
  terrasseId: string;
  plan: PlanCode;
  tranche: Tranche;
  statut: "ESSAI" | "ACTIF" | "EN_GRACE" | "LECTURE_SEULE" | "SUSPENDU";
  /** Étiquette du type d'établissement au moment de la souscription */
  typeEtablissement?: TypeEtablissement;
  essaiFin: string | null;
  periodeDebut: string;
  periodeFin: string;
  annuel: boolean;
  /** Anti-contournement : maximum de tables atteint sur la période */
  nbTablesMaxPeriode: number;
  prorataDuUsdCentimes: number;
  fraisInstallPayes: boolean;
}

export interface HistoriqueTranche {
  id: string;
  abonnementId: string;
  ancienne: Tranche;
  nouvelle: Tranche;
  nbTables: number;
  prorataUsdCentimes: number;
  creePar: string;
  creeLe: string;
}

export interface Paiement {
  id: string;
  abonnementId: string;
  terrasseId: string;
  montantUsdCentimes: number;
  methode: "M_PESA" | "AIRTEL_MONEY" | "ORANGE_MONEY";
  reference: string;
  statut: "EN_ATTENTE" | "VALIDE" | "REJETE";
  soumisPar: string;
  creeLe: string;
  valideLe: string | null;
  validePar: string | null;
}

export interface Facture {
  id: string;
  numero: string;
  abonnementId: string;
  terrasseId: string;
  plan: PlanCode;
  tranche: Tranche;
  montantUsdCentimes: number;
  creeLe: string;
}

// ---------- Snapshot et portées ----------

/** Image complète des données (filtrée selon la portée de l'appelant) */
export interface DB {
  version: number;
  organisations: Organisation[];
  utilisateurs: Utilisateur[];
  terrasses: Terrasse[];
  affectations: Affectation[];
  tables: TableT[];
  produits: Produit[];
  tableServeuse: TableServeuse[];
  clientsSession: ClientSession[];
  commandes: Commande[];
  sessionsService: SessionService[];
  depots: Depot[];
  depenses: Depense[];
  avis: Avis[];
  invitations: Invitation[];
  demandesStock: DemandeStock[];
  alertes: Alerte[];
  mouvementsStock: MouvementStock[];
  auditLog: AuditLog[];
  plansTarifs: PlanTarif[];
  abonnements: Abonnement[];
  historiqueTranches: HistoriqueTranche[];
  paiements: Paiement[];
  factures: Facture[];
  /** Catalogue de démarrage global (photos génériques), importable par établissement */
  catalogueProduits: ProduitCatalogue[];
  compteurFacture: number;
}

/** Portée de lecture demandée au serveur */
export type Portee =
  | { kind: "public" }
  /** La portée admin exige le PIN plateforme (vérifié côté serveur) */
  | { kind: "admin"; pin: string }
  /** Côté client : { kind: "staff" } suffit — l'identité vient du jeton Bearer.
   *  Côté serveur, le routeur résout la portée en { kind: "staff"; utilisateurId }
   *  avant filtrage (jamais depuis l'entrée client). */
  | { kind: "staff"; utilisateurId?: string }
  | { kind: "client"; token: string; sessionId?: string };

/** Entrée de l'annuaire démo (page de connexion) */
export interface EntreeAnnuaire {
  id: string;
  nom: string;
  /** Pré-remplissage du formulaire de connexion en mode démo */
  telephone: string;
  pin: string;
  roles: RoleActif[];
  terrasses: { id: string; nom: string }[];
}
