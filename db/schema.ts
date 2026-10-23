// ============================================================
// GBS — Schéma Drizzle (PostgreSQL / Neon). Miroir du modèle métier.
// Identifiants : chaînes générées par l'application.
// Dates : chaînes ISO (fuseau géré côté application).
// Montants : entiers (CDF en francs, USD en centimes).
// ============================================================

import {
  bigint, boolean, index, integer, jsonb, pgTable, primaryKey, text, unique, uniqueIndex, varchar,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import type { LigneCommande, TypeEtablissement } from "@contracts/types";

const id = () => varchar("id", { length: 40 }).primaryKey();
const iso = (nom: string) => varchar(nom, { length: 30 });
const isoNul = (nom: string) => varchar(nom, { length: 30 });

export const organisations = pgTable("organisations", {
  id: id(),
  nom: varchar("nom", { length: 120 }).notNull(),
  proprietaireId: varchar("proprietaire_id", { length: 40 }).notNull(),
  // Langue de l'organisation (« fr » | « en » | « pt ») — synchronisée
  // depuis l'appareil du propriétaire connecté (boucle 5).
  langue: varchar("langue", { length: 2 }).notNull().default("fr"),
  creeLe: iso("cree_le").notNull(),
});

export const utilisateurs = pgTable("utilisateurs", {
  id: id(),
  nom: varchar("nom", { length: 120 }).notNull(),
  telephone: varchar("telephone", { length: 30 }).notNull(),
  // PIN du personnel : haché scrypt (« scrypt$sel$empreinte » ≈ 105 car.).
  // Exception assumée : le PIN du super-admin plateforme est stocké EN
  // CLAIR (= ADMIN_PIN, choix produit — voir api/lib/superAdmin.ts).
  pin: varchar("pin", { length: 120 }).notNull(),
  creeLe: iso("cree_le").notNull(),
});

export const terrasses = pgTable("terrasses", {
  id: id(),
  organisationId: varchar("organisation_id", { length: 40 }).notNull(),
  nom: varchar("nom", { length: 120 }).notNull(),
  adresse: varchar("adresse", { length: 200 }).notNull(),
  // Étape 2 — boutiques de quartier, puis 4 métiers (quincaillerie,
  // pharmacie, restaurant, hôtel) : varchar(20) car « QUINCAILLERIE » = 13.
  // Défaut TERRASSE = rétrocompatible.
  typeEtablissement: varchar("type_etablissement", { length: 20 }).notNull().default("TERRASSE"),
  // Types fusionnés en plus du type principal (0 à 2) — l'expérience
  // de l'établissement est l'UNION des définitions du registre
  // (defFusionnee, contracts/types.ts). [] = mono-type (défaut).
  typesSecondaires: jsonb("types_secondaires").$type<TypeEtablissement[]>().notNull().default([]),
  // QR mural unique d'une boutique (null pour une terrasse)
  tokenQrBoutique: varchar("token_qr_boutique", { length: 40 }).unique(),
  seuilEcartCdf: integer("seuil_ecart_cdf").notNull().default(5000),
  seuilEcartUsd: integer("seuil_ecart_usd").notNull().default(200),
  // Taux USD→FC FACULTATIF (règle taux, docs/REGLE-TAUX-CHANGE.md) :
  // NULL = établissement mono-devise (bouton FC/$ masqué, aucune
  // conversion implicite). Ex-colonne « taux_change » (rename 0016,
  // valeurs conservées). Seuils d'alerte et plafond de saisie.
  tauxUsdCdf: integer("taux_usd_cdf"),
  tauxAlerteVariationPct: integer("taux_alerte_variation_pct").notNull().default(5),
  tauxAlerteMaxParJour: integer("taux_alerte_max_par_jour").notNull().default(3),
  tauxPlafondCdf: integer("taux_plafond_cdf").notNull().default(10000),
  // ANNEXE-2 §6 (migration 0018) : plafond de note impayée pour les
  // clients non résidents (NULL = pas de plafond, comportement
  // historique inchangé) et exception « token sur note » (le gérant
  // autorise les clients connus à jouer avant d'avoir payé).
  notePlafondCdf: integer("note_plafond_cdf"),
  tokenSurNote: boolean("token_sur_note").notNull().default(false),
  creeLe: iso("cree_le").notNull(),
});

export const affectations = pgTable(
  "affectations",
  {
    id: id(),
    utilisateurId: varchar("utilisateur_id", { length: 40 }).notNull(),
    terrasseId: varchar("terrasse_id", { length: 40 }).notNull(),
    role: varchar("role", { length: 16 }).notNull(), // RoleEtablissement (10 rôles, annexe §7)
    actif: boolean("actif").notNull().default(true),
    creeLe: iso("cree_le").notNull(),
  },
  (t) => [index("idx_aff_util").on(t.utilisateurId), index("idx_aff_ter").on(t.terrasseId)],
);

export const tablesQr = pgTable(
  "tables_qr",
  {
    id: id(),
    terrasseId: varchar("terrasse_id", { length: 40 }).notNull(),
    numero: integer("numero").notNull(),
    tokenQr: varchar("token_qr", { length: 40 }).notNull().unique(),
    /** Nature de la zone : ZONE (table classique) | BILLARD (table de
     *  billard Vincaire — annexe §1). COMPTOIR reste géré par
     *  tokenQrBoutique sur terrasses. */
    kind: varchar("kind", { length: 12 }).notNull().default("ZONE"), // ZONE | BILLARD | CHAMBRE,
    actif: boolean("actif").notNull().default(true),
    creeLe: iso("cree_le").notNull(),
    archiveLe: isoNul("archive_le"),
  },
  (t) => [index("idx_tables_ter").on(t.terrasseId)],
);

// ============================================================
// BILLARD « Vincaire » (annexe §1, étape 3)
// ============================================================

/** Configuration billard par établissement : prix du token, règle du
 *  perdant, limites du vincaire, délai de présence après appel.
 *  Une seule ligne par établissement (gérée par le gérant). */
export const configBillard = pgTable("config_billard", {
  id: id(),
  terrasseId: varchar("terrasse_id", { length: 40 }).notNull().unique(),
  prixTokenCdf: integer("prix_token_cdf").notNull().default(5000),
  reglePerdant: varchar("regle_perdant", { length: 10 }).notNull().default("RACHAT"), // RACHAT | FIN_FILE | SORTIE
  maxPartiesVincaire: integer("max_parties_vincaire"), // NULL = illimité
  delaiPresenceMin: integer("delai_presence_min").notNull().default(3),
  modifiePar: varchar("modifie_par", { length: 40 }),
  modifieLe: iso("modifie_le").notNull(),
});

/** Token = place achetée dans la file d'un billard. Le token n'entre
 *  dans la file qu'une fois le paiement cash validé (payeLe non null).
 *  Table « tokens » : pré-existante en base (prototype), réutilisée et
 *  étendue par la migration 0011 (annexe : « ne recrée rien »). */
export const tokensBillard = pgTable("tokens", {
  id: id(),
  terrasseId: varchar("terrasse_id", { length: 40 }).notNull(),
  tableId: varchar("table_id", { length: 40 }).notNull(),
  numero: integer("numero").notNull(), // numéro du jour, par billard
  clientSessionId: varchar("client_session_id", { length: 40 }), // NULL = ajouté au comptoir
  prenom: varchar("prenom", { length: 60 }).notNull(),
  prixCdf: integer("prix_cdf").notNull(),
  statut: varchar("statut", { length: 20 }).notNull().default("ATTENTE_PAIEMENT"),
  serie: integer("serie").notNull().default(0), // victoires consécutives
  creeLe: iso("cree_le").notNull(),
  payeLe: isoNul("paye_le"),
  payePar: varchar("paye_par", { length: 40 }),
  entreeFileLe: isoNul("entree_file_le"), // ordre FIFO de la file
  appeleLe: isoNul("appele_le"),
  annuleLe: isoNul("annule_le"),
  annulePar: varchar("annule_par", { length: 40 }),
  // Boucle 6 — Airtel Money flux manuel : référence de transaction
  // déclarée par le client (NULL = cash). Unique par établissement
  // (index partiel : la même référence ne peut payer qu'un token).
  referenceMobile: varchar("reference_mobile", { length: 30 }),
  // ANNEXE-2 §6 (migration 0018) : token entré en file SANS paiement
  // cash préalable — il sera réglé via la note unique (clients en
  // chambre, ou plafond gérant). paye_le reste NULL jusqu'au règlement.
  surNote: boolean("sur_note").notNull().default(false),
  // Règle taux : taux USD→FC FIGÉ à l'achat du token (NULL = avant
  // la règle ou établissement sans taux — jamais réécrit).
  tauxUsdCdf: integer("taux_usd_cdf"),
}, (t) => [
  index("idx_tokens_file").on(t.tableId, t.statut, t.entreeFileLe),
  index("idx_tokens_terrasse_date").on(t.terrasseId, t.creeLe),
  index("idx_tokens_client").on(t.clientSessionId),
  uniqueIndex("uq_tokens_reference_mobile").on(t.terrasseId, t.referenceMobile)
    .where(sql`reference_mobile IS NOT NULL`),
]);

/** Partie vincaire contre challenger. Une seule partie EN_COURS par
 *  billard (garanti par verrou de ligne dans terminerPartie/lancerPartie).
 *  Table « parties » : pré-existante en base (prototype), réutilisée
 *  et étendue par la migration 0011. */
export const partiesBillard = pgTable("parties", {
  id: id(),
  terrasseId: varchar("terrasse_id", { length: 40 }).notNull(),
  tableId: varchar("table_id", { length: 40 }).notNull(),
  numero: integer("numero").notNull().default(0), // numéro de partie du jour, par billard
  vincaireTokenId: varchar("vincaire_token_id", { length: 40 }), // NULL si première partie sans tenant
  challengerTokenId: varchar("challenger_token_id", { length: 40 }).notNull(),
  gagnantTokenId: varchar("gagnant_token_id", { length: 40 }),
  statut: varchar("statut", { length: 20 }).notNull().default("EN_COURS"), // EN_COURS | TERMINEE | ANNULEE
  debutLe: iso("debut_le").notNull(),
  finLe: isoNul("fin_le"),
  terminePar: varchar("termine_par", { length: 40 }),
}, (t) => [
  // idx_parties_table existe déjà en base sur (table_id) : réutilisé
  index("idx_parties_table").on(t.tableId),
  index("idx_parties_terrasse_date").on(t.terrasseId, t.debutLe),
]);

// ============================================================
// HÔTEL / CHAMBRES (prompt maître §4 et §6) — séjours et ménage
// ============================================================

/** Chambre d'hôtel : cycle d'occupation LIBRE → OCCUPEE (check-in) →
 *  A_NETTOYER (check-out) → LIBRE (ménage validé par la gouvernante).
 *  Le QR de la chambre reste une tables_qr classique (vocabulaire
 *  « chambre » du registre GUEST_HOUSE) : le client scanne pour
 *  commander des boissons (§4) — pas de doublon de QR ici. */
export const chambres = pgTable("chambres", {
  id: id(),
  terrasseId: varchar("terrasse_id", { length: 40 }).notNull(),
  numero: varchar("numero", { length: 10 }).notNull(), // « 12 », « A3 »…
  type: varchar("type", { length: 20 }).notNull().default("SIMPLE"), // SIMPLE | DOUBLE | SUITE
  statut: varchar("statut", { length: 12 }).notNull().default("LIBRE"), // LIBRE | OCCUPEE | A_NETTOYER
  prixNuitCdf: integer("prix_nuit_cdf").notNull(),
  prixHeureCdf: integer("prix_heure_cdf"), // NULL = pas de location à l'heure
    photoUrl: varchar("photo_url", { length: 500 }),
    creeLe: iso("cree_le").notNull(),
}, (t) => [
  unique("uq_chambres_terrasse_numero").on(t.terrasseId, t.numero),
  index("idx_chambres_terrasse_statut").on(t.terrasseId, t.statut),
]);

/** Séjour (check-in / check-out — §6). Le montant n'est calculé
 *  qu'au check-out : nuitées ou heures ENTAMÉES, minimum 1. */
export const sejours = pgTable("sejours", {
  id: id(),
  chambreId: varchar("chambre_id", { length: 40 }).notNull(),
  terrasseId: varchar("terrasse_id", { length: 40 }).notNull(),
  clientNom: varchar("client_nom", { length: 120 }).notNull(),
  pieceIdentite: varchar("piece_identite", { length: 60 }), // n° de pièce (§4)
  mode: varchar("mode", { length: 6 }).notNull(), // NUIT | HEURE
  arriveeLe: iso("arrivee_le").notNull(),
  departLe: isoNul("depart_le"),
  montantTotalCdf: integer("montant_total_cdf"), // NULL tant que EN_COURS
  statut: varchar("statut", { length: 10 }).notNull().default("EN_COURS"), // EN_COURS | CLOTURE
  // Règle taux : taux USD→FC FIGÉ au check-in (NULL = avant la
  // règle ou établissement sans taux — jamais réécrit).
  tauxUsdCdf: integer("taux_usd_cdf"),
  creePar: varchar("cree_par", { length: 40 }).notNull(),
  creeLe: iso("cree_le").notNull(),
}, (t) => [
  index("idx_sejours_chambre").on(t.chambreId, t.statut),
  index("idx_sejours_terrasse_date").on(t.terrasseId, t.creeLe),
]);

export const produits = pgTable(
  "produits",
  {
    id: id(),
    terrasseId: varchar("terrasse_id", { length: 40 }).notNull(),
    nom: varchar("nom", { length: 120 }).notNull(),
    categorie: varchar("categorie", { length: 60 }).notNull(),
    prixCdf: integer("prix_cdf").notNull().default(0),
    prixUsd: integer("prix_usd").notNull().default(0), // centimes
    stock: integer("stock").notNull().default(0),
    stockReserve: integer("stock_reserve").notNull().default(0),
    seuilAlerte: integer("seuil_alerte").notNull().default(0),
    actif: boolean("actif").notNull().default(true),
    // Étape 2 — photos produits (obligatoires dans le menu client) :
    photoUrl: varchar("photo_url", { length: 500 }), // WebP 800×800 ≤ 40 Ko
    photoThumbnailUrl: varchar("photo_thumbnail_url", { length: 500 }), // vignette 200×200 ≤ 8 Ko
    photoSource: varchar("photo_source", { length: 10 }), // CATALOGUE | UPLOAD
    // Étape 2 — identité commerciale :
    variante: varchar("variante", { length: 60 }), // « Normal », « Rock », « Energy »…
    consignable: boolean("consignable").notNull().default(false), // bouteille verre consignée
    bouteillesParCasier: integer("bouteilles_par_casier"), // 12 ou 24, sinon null
    // Scan code-barres : EAN-13 / EAN-8 / Code 128 lu à la caméra (null = non renseigné)
    codeBarres: varchar("code_barres", { length: 50 }),
    // Boucle 3 — formulaire produit adaptatif (colonnes nullables :
    // les produits existants restent lisibles, null = MARCHANDISE).
    typeProduit: varchar("type_produit", { length: 12 }), // MARCHANDISE | CHAMBRE | SERVICE | BILLARD
    unite: varchar("unite", { length: 20 }), // « pièce », « kg », « nuit », « heure »…
    dureeMinutes: integer("duree_minutes"), // obligatoire pour un SERVICE (validation API)
    capacite: integer("capacite"), // obligatoire pour une CHAMBRE (validation API)
    lot: varchar("lot", { length: 60 }), // pharmacie, denrées
    datePeremption: varchar("date_peremption", { length: 10 }), // ISO « AAAA-MM-JJ »
    // 0019 — traiteur : coût d'achat en centimes USD par unité de stock (visible PROPRIETAIRE seul)
    coutAchatUsd: integer("cout_achat_usd"),
  },
  (t) => [
    index("idx_prod_ter").on(t.terrasseId),
    index("idx_prod_consignable").on(t.consignable),
    index("idx_produits_code_barres").on(t.codeBarres),
  ],
);

// Référentiel des catégories de produit par type d'établissement
// (boucle 3). La source de vérité des libellés est
// CATEGORIES_PAR_TYPE (contracts/types.ts) ; la table sert aux
// requêtes SQL et aux futurs écrans d'administration du référentiel.
// Unicité : (code, type_etablissement) — « Bières » existe pour
// plusieurs types. produits.categorie garde le libellé français.
export const categoriesProduit = pgTable(
  "categories_produit",
  {
    id: id(),
    code: varchar("code", { length: 30 }).notNull(), // BIERES, PLATS, CHAMBRES…
    typeEtablissement: varchar("type_etablissement", { length: 20 }).notNull(),
    nomFr: varchar("nom_fr", { length: 60 }).notNull(),
    nomEn: varchar("nom_en", { length: 60 }).notNull(),
    nomPt: varchar("nom_pt", { length: 60 }).notNull(),
    icone: varchar("icone", { length: 40 }).notNull(), // nom d'icône Lucide
    ordreAffichage: integer("ordre_affichage").notNull().default(0),
    actif: boolean("actif").notNull().default(true),
  },
  (t) => [
    index("idx_catprod_type").on(t.typeEtablissement),
    unique("uq_catprod_code_type").on(t.code, t.typeEtablissement),
  ],
);

// Annexe « Expérience par type » §0 — feature flags par établissement.
// Une ligne = une SURCHARGE du défaut du registre TYPES_ETABLISSEMENT
// (contracts/types.ts) : absence de ligne = défaut du registre pour le
// type. Le propriétaire active/désactive les modules de SON établissement.
export const modulesEtablissement = pgTable(
  "modules_etablissement",
  {
    id: id(),
    terrasseId: varchar("terrasse_id", { length: 40 }).notNull(),
    module: varchar("module", { length: 20 }).notNull(), // MENU, STOCK, FOLIO…
    actif: boolean("actif").notNull().default(true),
    modifiePar: varchar("modifie_par", { length: 40 }),
    modifieLe: iso("modifie_le").notNull(),
  },
  (t) => [
    index("idx_modetab_terrasse").on(t.terrasseId),
    unique("uq_modetab_terrasse_module").on(t.terrasseId, t.module),
  ],
);

// Catalogue de démarrage : photos génériques par catégorie (sans marques
// protégées), importable dans n'importe quel établissement.
export const catalogueProduits = pgTable(
  "catalogue_produits",
  {
    id: id(),
    categorie: varchar("categorie", { length: 60 }).notNull(),
    nom: varchar("nom", { length: 120 }).notNull(),
    variante: varchar("variante", { length: 60 }),
    consignable: boolean("consignable").notNull().default(false),
    bouteillesParCasier: integer("bouteilles_par_casier"),
    photoUrl: varchar("photo_url", { length: 500 }),
    photoThumbnailUrl: varchar("photo_thumbnail_url", { length: 500 }),
    ordreAffichage: integer("ordre_affichage").notNull().default(0),
    actif: boolean("actif").notNull().default(true),
  },
  (t) => [index("idx_catalogue_categorie").on(t.categorie)],
);

// Référentiel codes-barres : cache partagé entre toutes les terrasses.
// Rempli par le seed (codes connus), par Open Food Facts (OPEN_FOOD_FACTS)
// et par saisie manuelle (MANUEL). nb_utilisations sert à repérer
// les codes les plus scannés pour améliorer le référentiel.
export const catalogueCodesBarres = pgTable(
  "catalogue_codes_barres",
  {
    id: id(),
    codeBarres: varchar("code_barres", { length: 50 }).notNull().unique(), // EAN-13 / EAN-8 / Code 128
    nom: varchar("nom", { length: 120 }).notNull(),
    categorie: varchar("categorie", { length: 60 }).notNull().default("Divers"),
    variante: varchar("variante", { length: 60 }), // « 33 cl », « 1 L »…
    photoUrl: varchar("photo_url", { length: 500 }), // URL distante (Open Food Facts) ou locale
    consignable: boolean("consignable").notNull().default(false),
    bouteillesParCasier: integer("bouteilles_par_casier"), // 12 ou 24, sinon null
    prixCdfMoyen: integer("prix_cdf_moyen"), // prix indicatif observé, en francs
    prixUsdMoyen: integer("prix_usd_moyen"), // prix indicatif observé, en centimes
    nbUtilisations: integer("nb_utilisations").notNull().default(0),
    source: varchar("source", { length: 20 }).notNull().default("MANUEL"), // MANUEL | OPEN_FOOD_FACTS | LOCAL
    creeLe: iso("cree_le").notNull(),
  },
  (t) => [index("idx_codes_barres_code").on(t.codeBarres)],
);

export const tableServeuse = pgTable("table_serveuse", {
  id: id(),
  tableId: varchar("table_id", { length: 40 }).notNull(),
  serveuseId: varchar("serveuse_id", { length: 40 }).notNull(),
  actif: boolean("actif").notNull().default(true),
  depuisLe: iso("depuis_le").notNull(),
});

export const clientsSession = pgTable("clients_session", {
  id: id(),
  tableId: varchar("table_id", { length: 40 }).notNull(),
  prenom: varchar("prenom", { length: 60 }).notNull(),
  creeLe: iso("cree_le").notNull(),
});

export const commandes = pgTable(
  "commandes",
  {
    id: id(),
    terrasseId: varchar("terrasse_id", { length: 40 }).notNull(),
    tableId: varchar("table_id", { length: 40 }).notNull(),
    clientSessionId: varchar("client_session_id", { length: 40 }).notNull(),
    statut: varchar("statut", { length: 15 }).notNull(), // EN_ATTENTE | CONFIRMEE | SERVIE | ANNULEE
    lignes: jsonb("lignes").$type<LigneCommande[]>().notNull(),
    totalCdf: integer("total_cdf").notNull().default(0),
    totalUsd: integer("total_usd").notNull().default(0), // centimes
    // Règle taux : taux USD→FC FIGÉ à la commande (NULL = avant la
    // règle ou établissement sans taux — jamais réécrit).
    tauxUsdCdf: integer("taux_usd_cdf"),
    cleIdempotence: varchar("cle_idempotence", { length: 60 }).notNull().unique(),
    creeLe: iso("cree_le").notNull(),
    confirmeeLe: isoNul("confirmee_le"),
    servieLe: isoNul("servie_le"),
    annuleLe: isoNul("annule_le"),
    motifAnnulation: varchar("motif_annulation", { length: 200 }),
    serviePar: varchar("servie_par", { length: 40 }),
    // Encaissement cash : tant qu'une commande SERVIE n'est pas payée,
    // le client ne peut pas en passer une nouvelle (marquerPayee / passerCommande)
    payeeLe: isoNul("payee_le"),
    payeePar: varchar("payee_par", { length: 40 }),
  },
  (t) => [
    index("idx_cmd_ter").on(t.terrasseId),
    index("idx_cmd_table").on(t.tableId),
    // Requêtes chaudes : ventes du jour / par statut, session client
    index("idx_cmd_ter_statut").on(t.terrasseId, t.statut),
    index("idx_cmd_session").on(t.clientSessionId),
  ],
);

// Session glissante (docs/SESSION-GLISSANTE.md) : une ligne par
// connexion. Le jeton signé porte « sid » ; la vérification lit la
// ligne (révocation immédiate, plafond absolu, glissement d'activité).
export const sessionsAppareils = pgTable(
  "sessions_appareils",
  {
    id: id(),
    utilisateurId: varchar("utilisateur_id", { length: 40 }).notNull(),
    appareilId: varchar("appareil_id", { length: 60 }).notNull(),
    creeLe: iso("cree_le").notNull(),
    derniereActiviteLe: iso("derniere_activite_le").notNull(),
    expireAbsoluLe: iso("expire_absolu_le").notNull(),
    revoqueLe: isoNul("revoque_le"),
  },
  (t) => [
    index("idx_sessapp_util").on(t.utilisateurId),
    index("idx_sessapp_appareil").on(t.appareilId),
  ],
);

export const sessionsService = pgTable("sessions_service", {
  id: id(),
  terrasseId: varchar("terrasse_id", { length: 40 }).notNull(),
  serveuseId: varchar("serveuse_id", { length: 40 }).notNull(),
  statut: varchar("statut", { length: 10 }).notNull(), // OUVERTE | CLOTUREE
  ouverteLe: iso("ouverte_le").notNull(),
  clotureeLe: isoNul("cloturee_le"),
});

export const depots = pgTable("depots", {
  id: id(),
  sessionId: varchar("session_id", { length: 40 }).notNull(),
  terrasseId: varchar("terrasse_id", { length: 40 }).notNull(),
  serveuseId: varchar("serveuse_id", { length: 40 }).notNull(),
  typeDepot: varchar("type_depot", { length: 12 }).notNull().default("COMMANDE"), // CHAMBRE | COMMANDE
  attenduCdf: integer("attendu_cdf").notNull().default(0),
  attenduUsd: integer("attendu_usd").notNull().default(0),
  declareCdf: integer("declare_cdf").notNull().default(0),
  declareUsd: integer("declare_usd").notNull().default(0),
  statut: varchar("statut", { length: 10 }).notNull(), // DECLARE | VALIDE | CONTESTE
  declareLe: iso("declare_le").notNull(),
  valideLe: isoNul("valide_le"),
  validePar: varchar("valide_par", { length: 40 }),
  motifContest: varchar("motif_contest", { length: 200 }),
});

export const avis = pgTable("avis", {
  id: id(),
  commandeId: varchar("commande_id", { length: 40 }).notNull().unique(),
  serveuseId: varchar("serveuse_id", { length: 40 }).notNull(),
  terrasseId: varchar("terrasse_id", { length: 40 }).notNull(),
  note: integer("note").notNull(),
  commentaire: varchar("commentaire", { length: 300 }).notNull().default(""),
  masque: boolean("masque").notNull().default(false),
  motifMasquage: varchar("motif_masquage", { length: 200 }),
  creeLe: iso("cree_le").notNull(),
});

export const invitations = pgTable("invitations", {
  id: id(),
  code: varchar("code", { length: 8 }).notNull().unique(),
  terrasseId: varchar("terrasse_id", { length: 40 }).notNull(),
  role: varchar("role", { length: 16 }).notNull(),
  creePar: varchar("cree_par", { length: 40 }).notNull(),
  nomPrevu: varchar("nom_prevu", { length: 120 }).notNull().default(""),
  expireLe: iso("expire_le").notNull(),
  statut: varchar("statut", { length: 10 }).notNull(), // ACTIVE | UTILISEE | EXPIREE | REVOQUEE
  creeLe: iso("cree_le").notNull(),
});

export const demandesStock = pgTable("demandes_stock", {
  id: id(),
  terrasseId: varchar("terrasse_id", { length: 40 }).notNull(),
  produitId: varchar("produit_id", { length: 40 }).notNull(),
  quantite: integer("quantite").notNull(),
  type: varchar("type", { length: 10 }).notNull(), // REAPPRO | PERTE | ECART
  motif: varchar("motif", { length: 200 }).notNull(),
  statut: varchar("statut", { length: 10 }).notNull(), // EN_ATTENTE | APPROUVEE | REFUSEE
  creePar: varchar("cree_par", { length: 40 }).notNull(),
  creeLe: iso("cree_le").notNull(),
  traitePar: varchar("traite_par", { length: 40 }),
  traiteLe: isoNul("traite_le"),
});

export const alertes = pgTable(
  "alertes",
  {
    id: id(),
    terrasseId: varchar("terrasse_id", { length: 40 }).notNull(),
    // 30 : « BILLARD_ANNULATION_PAYEE » (24 caractères) — annexe §1
    type: varchar("type", { length: 30 }).notNull(),
    message: varchar("message", { length: 300 }).notNull(),
    lu: boolean("lu").notNull().default(false),
    creeLe: iso("cree_le").notNull(),
  },
  (t) => [index("idx_alertes_ter").on(t.terrasseId)],
);

export const mouvementsStock = pgTable(
  "mouvements_stock",
  {
    id: id(),
    produitId: varchar("produit_id", { length: 40 }).notNull(),
    terrasseId: varchar("terrasse_id", { length: 40 }).notNull(),
    type: varchar("type", { length: 12 }).notNull(),
    quantite: integer("quantite").notNull(),
    motif: varchar("motif", { length: 200 }).notNull(),
    acteurId: varchar("acteur_id", { length: 40 }),
    roleActif: varchar("role_actif", { length: 12 }),
    creeLe: iso("cree_le").notNull(),
  },
  (t) => [
    index("idx_mvt_ter").on(t.terrasseId),
    // Requêtes chaudes : historique de stock d'une terrasse par date
    index("idx_mvt_ter_date").on(t.terrasseId, t.creeLe),
  ],
);

export const auditLog = pgTable("audit_log", {
  id: id(),
  acteurId: varchar("acteur_id", { length: 40 }),
  roleActif: varchar("role_actif", { length: 16 }),
  action: varchar("action", { length: 40 }).notNull(),
  details: varchar("details", { length: 300 }).notNull(),
  // Annexe §7 : qui, quoi, quand, établissement, avant/après
  terrasseId: varchar("terrasse_id", { length: 40 }),
  avant: text("avant"),
  apres: text("apres"),
  creeLe: iso("cree_le").notNull(),
}, (t) => [
  index("idx_audit_date").on(t.creeLe),
  index("idx_audit_action_date").on(t.action, t.creeLe),
  index("idx_audit_terrasse_date").on(t.terrasseId, t.creeLe),
]);

/** Surcharges de permission décidées par le propriétaire (annexe §7 :
 *  « tout est surchargeable par le propriétaire »). Une ligne prime sur
 *  la matrice PERMISSIONS_PAR_ROLE pour ce membre, cette action,
 *  cet établissement. */
export const permissionsSurcharge = pgTable("permissions_surcharge", {
  id: id(),
  terrasseId: varchar("terrasse_id", { length: 40 }).notNull(),
  utilisateurId: varchar("utilisateur_id", { length: 40 }).notNull(),
  action: varchar("action", { length: 40 }).notNull(), // ActionSensible
  autorisee: boolean("autorisee").notNull(),
  creePar: varchar("cree_par", { length: 40 }).notNull(),
  creeLe: iso("cree_le").notNull(),
  modifieLe: iso("modifie_le").notNull(),
}, (t) => [
  unique("uq_permsurch").on(t.terrasseId, t.utilisateurId, t.action),
  index("idx_permsurch_ter").on(t.terrasseId),
]);

// Dépenses de caisse d'une terrasse : chaque sortie d'argent réduit
// le solde de la boutique (ventes servies − dépenses − dépôts validés).
export const depenses = pgTable("depenses", {
  id: id(),
  terrasseId: varchar("terrasse_id", { length: 40 }).notNull(),
  montantCdf: integer("montant_cdf").notNull().default(0),
  montantUsd: integer("montant_usd").notNull().default(0), // centimes
  motif: varchar("motif", { length: 200 }).notNull(),
  saisiPar: varchar("saisi_par", { length: 40 }).notNull(),
  roleActif: varchar("role_actif", { length: 12 }),
  creeLe: iso("cree_le").notNull(),
}, (t) => [index("idx_dep_ter_date").on(t.terrasseId, t.creeLe)]);

export const plansTarifs = pgTable(
  "plans_tarifs",
  {
    plan: varchar("plan", { length: 10 }).notNull(), // ESSENTIEL | PRO | BUSINESS
    tranche: varchar("tranche", { length: 10 }).notNull(), // PETITE | MOYENNE | GRANDE
    tablesMin: integer("tables_min").notNull(),
    tablesMax: integer("tables_max"),
    prixUsd: integer("prix_usd").notNull(), // centimes / mois
    fraisInstallUsd: integer("frais_install_usd").notNull(), // centimes
    // Étape 2 : type d'établissement cible (null = tarif terrasse historique, "BOUTIQUE" = plan 5 USD)
    typeEtablissementCible: varchar("type_etablissement_cible", { length: 20 }),
  },
  (t) => [primaryKey({ columns: [t.plan, t.tranche] })],
);

export const abonnements = pgTable("abonnements", {
  id: id(),
  terrasseId: varchar("terrasse_id", { length: 40 }).notNull().unique(),
  plan: varchar("plan", { length: 10 }).notNull(),
  tranche: varchar("tranche", { length: 10 }).notNull(),
  statut: varchar("statut", { length: 15 }).notNull(), // ESSAI | ACTIF | EN_GRACE | LECTURE_SEULE | SUSPENDU
  // Étape 2 : étiquette du type d'établissement au moment de la souscription
  typeEtablissement: varchar("type_etablissement", { length: 20 }),
  essaiFin: isoNul("essai_fin"),
  periodeDebut: iso("periode_debut").notNull(),
  periodeFin: iso("periode_fin").notNull(),
  annuel: boolean("annuel").notNull().default(false),
  nbTablesMaxPeriode: integer("nb_tables_max_periode").notNull().default(0),
  prorataDu: integer("prorata_du").notNull().default(0),
  fraisInstallPayes: boolean("frais_install_payes").notNull().default(false),
});

export const historiqueTranches = pgTable("historique_tranches", {
  id: id(),
  abonnementId: varchar("abonnement_id", { length: 40 }).notNull(),
  ancienne: varchar("ancienne", { length: 10 }).notNull(),
  nouvelle: varchar("nouvelle", { length: 10 }).notNull(),
  nbTables: integer("nb_tables").notNull(),
  prorataUsd: integer("prorata_usd").notNull(),
  creePar: varchar("cree_par", { length: 40 }).notNull(),
  creeLe: iso("cree_le").notNull(),
});

export const paiements = pgTable("paiements", {
  id: id(),
  abonnementId: varchar("abonnement_id", { length: 40 }).notNull(),
  terrasseId: varchar("terrasse_id", { length: 40 }).notNull(),
  montantUsd: integer("montant_usd").notNull(),
  methode: varchar("methode", { length: 15 }).notNull(), // M_PESA | AIRTEL_MONEY | ORANGE_MONEY
  reference: varchar("reference", { length: 60 }).notNull(),
  statut: varchar("statut", { length: 10 }).notNull(), // EN_ATTENTE | VALIDE | REJETE
  soumisPar: varchar("soumis_par", { length: 40 }).notNull(),
  creeLe: iso("cree_le").notNull(),
  valideLe: isoNul("valide_le"),
  validePar: varchar("valide_par", { length: 40 }),
});

export const factures = pgTable("factures", {
  id: id(),
  numero: varchar("numero", { length: 20 }).notNull().unique(),
  abonnementId: varchar("abonnement_id", { length: 40 }).notNull(),
  terrasseId: varchar("terrasse_id", { length: 40 }).notNull(),
  plan: varchar("plan", { length: 10 }).notNull(),
  tranche: varchar("tranche", { length: 10 }).notNull(),
  montantUsd: integer("montant_usd").notNull(),
  creeLe: iso("cree_le").notNull(),
});

export const meta = pgTable("meta", {
  cle: varchar("cle", { length: 30 }).primaryKey(),
  valeur: integer("valeur").notNull().default(0),
});

// Journal des erreurs côté client (Phase B.6) : chaque écran de
// secours, erreur JS globale ou promesse rejetée est envoyée par
// l'app (POST /api/erreurs, limité à 10/min/appareil) pour que le
// support retrouve les pannes par leur code court — fin de la
// cécité de production. HYGIÈNE : jamais de PIN, mot de passe,
// jeton ni contenu de formulaire (schéma strict côté route).
export const erreursClient = pgTable(
  "erreurs_client",
  {
    id: id(),
    creeLe: iso("cree_le").notNull(),
    utilisateurId: varchar("utilisateur_id", { length: 40 }), // opaque, nullable
    etablissementId: varchar("etablissement_id", { length: 40 }), // opaque, nullable
    route: varchar("route", { length: 200 }).notNull().default(""),
    message: varchar("message", { length: 1000 }).notNull(),
    stack: varchar("stack", { length: 4000 }), // tronquée côté client ET serveur
    userAgent: varchar("user_agent", { length: 300 }),
    version: varchar("version", { length: 60 }), // version injectée au build
    langue: varchar("langue", { length: 5 }),
    codeCourt: varchar("code_court", { length: 12 }).notNull(), // ex. ERR-7K2F
  },
  (t) => [
    index("idx_err_code").on(t.codeCourt),
    index("idx_err_date").on(t.creeLe),
  ],
);

// ============================================================
// NOTE CLIENT UNIQUE (ANNEXE-2, migration 0018) — folio par client
// à l'échelle de l'ORGANISATION : toute commande, tout token de
// billard et toute nuitée s'ajoute à LA MÊME note, quel que soit
// le QR scanné. La caisse suit l'ARGENT PHYSIQUE (qui le détient,
// §5) ; la ventilation par espace est comptable uniquement (§5.8).
// Règle permanente : AUCUNE table « espaces » — l'espace est une
// étiquette varchar sur chaque ligne.
// ============================================================

/** Client reconnu sur tous les QR de l'organisation (ANNEXE-2 §2).
 *  Identité = clientSessionId (ou téléphone vérifié) — JAMAIS de
 *  fusion sur le prénom seul. Téléphone optionnel. */
export const clients = pgTable(
  "clients",
  {
    id: id(),
    organisationId: varchar("organisation_id", { length: 40 }).notNull(),
    prenom: varchar("prenom", { length: 60 }).notNull(),
    telephone: varchar("telephone", { length: 20 }), // chiffres normalisés
    creeLe: iso("cree_le").notNull(),
  },
  (t) => [
    index("idx_clients_org").on(t.organisationId),
    // Un téléphone n'identifie qu'UN client par organisation
    uniqueIndex("uq_clients_org_tel").on(t.organisationId, t.telephone)
      .where(sql`telephone IS NOT NULL`),
  ],
);

/** Plusieurs appareils pour un même client (ANNEXE-2 §2) : rattache
 *  une session d'appareil (clients_session) à un client. */
export const clientAppareils = pgTable(
  "client_appareils",
  {
    clientSessionId: varchar("client_session_id", { length: 40 }).primaryKey(),
    clientId: varchar("client_id", { length: 40 }).notNull(),
    creeLe: iso("cree_le").notNull(),
  },
  (t) => [index("idx_appareils_client").on(t.clientId)],
);

/** La note (folio). Une seule note OUVERTE/A_REGLER par client
 *  (index partiel unique). LITIGE = client parti sans payer :
 *  jamais supprimée, imputation décidée par le gérant avec motif. */
export const notes = pgTable(
  "notes",
  {
    id: id(),
    organisationId: varchar("organisation_id", { length: 40 }).notNull(),
    clientId: varchar("client_id", { length: 40 }).notNull(),
    sejourId: varchar("sejour_id", { length: 40 }), // note de chambre
    statut: varchar("statut", { length: 10 }).notNull().default("OUVERTE"),
    ouverteLe: iso("ouverte_le").notNull(),
    regleeLe: isoNul("reglee_le"),
    tauxUsdCdf: integer("taux_usd_cdf"), // taux figé à l'ouverture
    motifLitige: varchar("motif_litige", { length: 200 }),
    litigeLe: isoNul("litige_le"),
    litigeDeclarePar: varchar("litige_declare_par", { length: 40 }),
  },
  (t) => [
    uniqueIndex("uq_notes_client_ouverte").on(t.clientId)
      .where(sql`statut IN ('OUVERTE','A_REGLER')`),
    index("idx_notes_org_statut").on(t.organisationId, t.statut),
    index("idx_notes_sejour").on(t.sejourId),
  ],
);

/** Ligne de note. ref_id = origine métier : « <commandeId>:<idx> »,
 *  tokenId ou sejourId — l'unicité (type, ref_id) rend le
 *  branchement idempotent. Taux figé par ligne (règle taux). */
export const noteLignes = pgTable(
  "note_lignes",
  {
    id: id(),
    noteId: varchar("note_id", { length: 40 }).notNull(),
    terrasseId: varchar("terrasse_id", { length: 40 }).notNull(),
    espace: varchar("espace", { length: 20 }).notNull(),
    type: varchar("type", { length: 15 }).notNull(),
    refId: varchar("ref_id", { length: 80 }),
    libelle: varchar("libelle", { length: 200 }).notNull(),
    quantite: integer("quantite").notNull().default(1),
    montantCdf: integer("montant_cdf").notNull().default(0),
    montantUsd: integer("montant_usd").notNull().default(0), // centimes
    tauxUsdCdf: integer("taux_usd_cdf"),
    statut: varchar("statut", { length: 12 }).notNull().default("EN_ATTENTE"),
    creeParId: varchar("cree_par_id", { length: 40 }),
    creeLe: iso("cree_le").notNull(),
    annuleLe: isoNul("annule_le"),
    annulePar: varchar("annule_par", { length: 40 }),
    motifAnnulation: varchar("motif_annulation", { length: 200 }),
    // ANNEXE-3 : ligne prise en charge par un tiers (figée à
    // l'acceptation) — la demande garde la copie immuable.
    priseEnChargeId: varchar("prise_en_charge_id", { length: 40 }),
  },
  (t) => [
    uniqueIndex("uq_note_lignes_ref").on(t.type, t.refId).where(sql`ref_id IS NOT NULL`),
    index("idx_note_lignes_note").on(t.noteId, t.statut),
    index("idx_note_lignes_terrasse_date").on(t.terrasseId, t.creeLe),
  ],
);

/** Encaissement = argent PHYSIQUE remis à un employé (ANNEXE-2 §5).
 *  CASH : reste EN_MAIN de l'employé jusqu'à la remise validée.
 *  MOBILE_MONEY : déclaré par le client, validé avec la référence
 *  UNIQUE de transaction (§5.7). */
export const encaissements = pgTable(
  "encaissements",
  {
    id: id(),
    noteId: varchar("note_id", { length: 40 }).notNull(),
    organisationId: varchar("organisation_id", { length: 40 }).notNull(),
    encaisseParId: varchar("encaisse_par_id", { length: 40 }).notNull(),
    montantCdf: integer("montant_cdf").notNull().default(0),
    montantUsd: integer("montant_usd").notNull().default(0),
    mode: varchar("mode", { length: 12 }).notNull(), // CASH | MOBILE_MONEY
    referenceMobile: varchar("reference_mobile", { length: 30 }),
    statut: varchar("statut", { length: 10 }).notNull().default("EN_MAIN"),
    remiseId: varchar("remise_id", { length: 40 }),
    creeLe: iso("cree_le").notNull(),
    remisLe: isoNul("remis_le"),
  },
  (t) => [
    uniqueIndex("uq_encaissements_reference").on(t.organisationId, t.referenceMobile)
      .where(sql`reference_mobile IS NOT NULL`),
    index("idx_enc_note").on(t.noteId),
    index("idx_enc_employe_statut").on(t.encaisseParId, t.statut),
  ],
);

/** Ventilation COMPTABLE par espace d'un encaissement (§5.8) :
 *  alimente la caisse du jour de chaque espace, sans jamais changer
 *  qui détient l'argent. (Table dédiée : « paiements » appartient à
 *  la facturation des abonnements — intouchable.) */
export const noteVentilations = pgTable(
  "note_ventilations",
  {
    id: id(),
    encaissementId: varchar("encaissement_id", { length: 40 }).notNull(),
    terrasseId: varchar("terrasse_id", { length: 40 }).notNull(),
    espace: varchar("espace", { length: 20 }).notNull(),
    montantCdf: integer("montant_cdf").notNull().default(0),
    montantUsd: integer("montant_usd").notNull().default(0),
    creeLe: iso("cree_le").notNull(),
  },
  (t) => [
    index("idx_ventil_enc").on(t.encaissementId),
    index("idx_ventil_terrasse_date").on(t.terrasseId, t.creeLe),
  ],
);

/** Remise de caisse (§5.6) : l'employé remet son cash EN_MAIN ;
 *  le RECEVEUR valide attendu vs reçu. Tout écart = alerte
 *  immédiate au propriétaire. */
export const remisesCaisse = pgTable(
  "remises_caisse",
  {
    id: id(),
    organisationId: varchar("organisation_id", { length: 40 }).notNull(),
    employeId: varchar("employe_id", { length: 40 }).notNull(),
    attenduCdf: integer("attendu_cdf").notNull().default(0),
    attenduUsd: integer("attendu_usd").notNull().default(0),
    recuCdf: integer("recu_cdf").notNull().default(0),
    recuUsd: integer("recu_usd").notNull().default(0),
    statut: varchar("statut", { length: 12 }).notNull().default("EN_ATTENTE"),
    validePar: varchar("valide_par", { length: 40 }),
    motifEcart: varchar("motif_ecart", { length: 200 }),
    creeLe: iso("cree_le").notNull(),
    valideLe: isoNul("valide_le"),
  },
  (t) => [
    index("idx_remises_org").on(t.organisationId, t.statut),
    index("idx_remises_employe").on(t.employeId, t.creeLe),
  ],
);

/** Pourboire (§5.4) : à l'employé qui encaisse, enregistré À PART —
 *  hors chiffre d'affaires et hors ventilation par espace. */
export const pourboires = pgTable(
  "pourboires",
  {
    id: id(),
    noteId: varchar("note_id", { length: 40 }).notNull(),
    encaissementId: varchar("encaissement_id", { length: 40 }).notNull(),
    employeId: varchar("employe_id", { length: 40 }).notNull(),
    montantCdf: integer("montant_cdf").notNull().default(0),
    montantUsd: integer("montant_usd").notNull().default(0),
    creeLe: iso("cree_le").notNull(),
  },
  (t) => [index("idx_pourboires_employe").on(t.employeId, t.creeLe)],
);

// ============================================================
// PAYER POUR QUELQU'UN (ANNEXE-3) — voie serveuse par défaut :
// la bénéficiaire décide DE VIVE VOIX, la serveuse enregistre.
// Les lignes acceptées sont FIGÉES (copie immuable ci-dessous) ;
// aucune identité du payeur n'est exposée.
// ============================================================
export const prisesEnCharge = pgTable(
  "prises_en_charge",
  {
    id: id(),
    organisationId: varchar("organisation_id", { length: 40 }).notNull(),
    terrasseId: varchar("terrasse_id", { length: 40 }).notNull(), // zone de la bénéficiaire
    noteBeneficiaireId: varchar("note_beneficiaire_id", { length: 40 }).notNull(),
    payeurClientId: varchar("payeur_client_id", { length: 40 }), // NULL = déclaré au comptoir
    proposePar: varchar("propose_par", { length: 40 }).notNull(), // session client ou employé
    lignes: jsonb("lignes").notNull(), // figées à l'acceptation
    montantCdf: integer("montant_cdf").notNull().default(0),
    montantUsd: integer("montant_usd").notNull().default(0),
    statut: varchar("statut", { length: 12 }).notNull().default("EN_ATTENTE"),
    decidePar: varchar("decide_par", { length: 40 }),
    decideLe: isoNul("decide_le"),
    expireLe: iso("expire_le").notNull(), // défaut : 10 min (§2)
    creeLe: iso("cree_le").notNull(),
  },
  (t) => [
    index("idx_pec_terrasse_statut").on(t.terrasseId, t.statut),
    index("idx_pec_note").on(t.noteBeneficiaireId),
  ],
);

// ============================================================
// 0019 — Module traiteur (docs/MODULE-TRAITEUR.md §8, fidèle au doc).
// Recettes versionnées immuables après validation ; quantités en unité
// de base entière ; composition figée dans le plan ; bons sans prix ;
// coûts visibles du propriétaire seul (contrôle API).
// ============================================================

export const traiteurComposants = pgTable(
  "traiteur_composants",
  {
    id: id(),
    terrasseId: varchar("terrasse_id", { length: 40 }).notNull(),
    nom: varchar("nom", { length: 120 }).notNull(),
    kind: varchar("kind", { length: 20 }).notNull(), // PLAT | SAUCE | ACCOMPAGNEMENT | BOISSON
    actif: boolean("actif").notNull().default(true),
    creeLe: iso("cree_le").notNull(),
  },
  (t) => [index("idx_composants_terrasse").on(t.terrasseId, t.actif)],
);

export const traiteurRecettes = pgTable(
  "traiteur_recettes",
  {
    id: id(),
    composantId: varchar("composant_id", { length: 40 }).notNull(),
    version: integer("version").notNull().default(1),
    statut: varchar("statut", { length: 20 }).notNull().default("PROPOSEE"), // PROPOSEE | VALIDEE
    proposePar: varchar("propose_par", { length: 40 }).notNull(), // chef
    validePar: varchar("valide_par", { length: 40 }), // propriétaire
    valideeLe: isoNul("validee_le"),
    creeLe: iso("cree_le").notNull(),
  },
  (t) => [unique("uq_recette_composant_version").on(t.composantId, t.version)],
);

export const traiteurRecetteLignes = pgTable(
  "traiteur_recette_lignes",
  {
    id: id(),
    recetteId: varchar("recette_id", { length: 40 }).notNull(),
    produitId: varchar("produit_id", { length: 40 }).notNull(),
    sousRecetteId: varchar("sous_recette_id", { length: 40 }), // v2 prévu, NULL en v1 (§7)
    quantiteParPersonneBase: bigint("quantite_par_personne_base", { mode: "number" }).notNull(), // mg|ml|pièces
    tauxPertePct: integer("taux_perte_pct").notNull().default(0), // 0 = produit acheté non cuisiné
  },
  (t) => [index("idx_rec_lignes_recette").on(t.recetteId)],
);

export const traiteurMenus = pgTable("traiteur_menus", {
  id: id(),
  terrasseId: varchar("terrasse_id", { length: 40 }).notNull(),
  nom: varchar("nom", { length: 120 }).notNull(),
  prixPersonneUsd: integer("prix_personne_usd").notNull(), // centimes USD
  version: integer("version").notNull().default(1), // incrémentée à chaque modification (§6)
  actif: boolean("actif").notNull().default(true),
  creeLe: iso("cree_le").notNull(),
});

export const traiteurMenuLignes = pgTable(
  "traiteur_menu_lignes",
  {
    id: id(),
    menuId: varchar("menu_id", { length: 40 }).notNull(),
    composantId: varchar("composant_id", { length: 40 }).notNull(),
    qteParPersonneX1000: integer("qte_par_personne_x1000").notNull().default(1000), // 1000 = 1
    position: integer("position").notNull().default(0),
  },
  (t) => [index("idx_menu_lignes_menu").on(t.menuId)],
);

export const traiteurPlans = pgTable(
  "traiteur_plans",
  {
    id: id(),
    terrasseId: varchar("terrasse_id", { length: 40 }).notNull(),
    menuId: varchar("menu_id", { length: 40 }).notNull(),
    menuVersion: integer("menu_version").notNull(), // version du menu au démarrage (§6)
    entreprise: varchar("entreprise", { length: 200 }).notNull(),
    nbPersonnes: integer("nb_personnes").notNull(),
    jour: varchar("jour", { length: 10 }).notNull(), // ISO « AAAA-MM-JJ »
    heure: varchar("heure", { length: 5 }).notNull(), // « HH:MM »
    repartitionOptions: jsonb("repartition_options"), // {menuLigneId: personnes}, somme = nbPersonnes
    composition: jsonb("composition").notNull(), // FIGÉE au démarrage (§6)
    statut: varchar("statut", { length: 20 }).notNull().default("BROUILLON"), // BROUILLON|EN_COURS|TERMINE|ANNULE
    creePar: varchar("cree_par", { length: 40 }).notNull(),
    creeLe: iso("cree_le").notNull(),
  },
  (t) => [index("idx_plans_terrasse").on(t.terrasseId, t.jour)],
);

export const traiteurPlanExclusions = pgTable(
  "traiteur_plan_exclusions",
  {
    id: id(),
    planId: varchar("plan_id", { length: 40 }).notNull(),
    composantId: varchar("composant_id", { length: 40 }).notNull(), // §3 : par composant
    motif: varchar("motif", { length: 200 }),
  },
  (t) => [unique("uq_plan_exclusion").on(t.planId, t.composantId)],
);

export const traiteurBonsSortie = pgTable(
  "traiteur_bons_sortie",
  {
    id: id(),
    terrasseId: varchar("terrasse_id", { length: 40 }).notNull(),
    planId: varchar("plan_id", { length: 40 }).notNull(),
    statut: varchar("statut", { length: 20 }).notNull().default("BROUILLON"), // BROUILLON | EMIS
    magasinierId: varchar("magasinier_id", { length: 40 }).notNull(),
    emisLe: isoNul("emis_le"),
    creeLe: iso("cree_le").notNull(),
  },
  (t) => [unique("uq_bon_plan").on(t.planId)], // un plan = un jour = un bon
);

export const traiteurBonLignes = pgTable(
  "traiteur_bon_lignes",
  {
    id: id(),
    bonId: varchar("bon_id", { length: 40 }).notNull(),
    produitId: varchar("produit_id", { length: 40 }).notNull(),
    lot: varchar("lot", { length: 60 }), // lot FEFO retenu à l'émission
    quantiteBase: bigint("quantite_base", { mode: "number" }).notNull(), // mg|ml|pièces exact
    details: jsonb("details"), // traçabilité : [{composantId, quantiteBase}]
  },
  (t) => [unique("uq_bon_ligne").on(t.bonId, t.produitId)], // UNE ligne par ingrédient (§4)
);

export const traiteurComptages = pgTable(
  "traiteur_comptages",
  {
    id: id(),
    terrasseId: varchar("terrasse_id", { length: 40 }).notNull(),
    produitId: varchar("produit_id", { length: 40 }).notNull(),
    comptePar: varchar("compte_par", { length: 40 }).notNull(),
    quantiteComptee: integer("quantite_comptee").notNull(), // saisie à l'aveugle
    theorique: integer("theorique").notNull(), // rempli serveur, jamais affiché au compteur
    ecart: integer("ecart").notNull(), // théorique - compté
    creeLe: iso("cree_le").notNull(),
  },
  (t) => [index("idx_comptages_terrasse").on(t.terrasseId, t.creeLe)],
);
