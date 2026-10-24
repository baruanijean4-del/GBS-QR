// ============================================================
// GBS — Chargement de l'image de données (filtrée par portée)
// + cycle de vie des abonnements (équivalent du cron quotidien)
// ============================================================

import { and, eq, inArray } from "drizzle-orm";
import { getDb } from "./queries/connection";
import * as s from "@db/schema";
import type { DB, Portee, Produit, SourcePhoto, TableT, TypeEtablissement, TypeProduit } from "@contracts/types";
import { ajouterJours, joursRestants, maintenant, uid } from "./gbsUtils";

/** Traduit une ligne `tables_qr` (Drizzle) vers le contrat TableT partagé.
 *  kind : varchar en base → union stricte côté contrat (défaut ZONE). */
function mapperTable(t: typeof s.tablesQr.$inferSelect): TableT {
  return {
    id: t.id, terrasseId: t.terrasseId, numero: t.numero, tokenQr: t.tokenQr,
    kind: t.kind as "ZONE" | "BILLARD" | "CHAMBRE",
    actif: t.actif, creeLe: t.creeLe, archiveLe: t.archiveLe ?? null,
  };
}

/** Traduit une ligne `produits` (Drizzle) vers le contrat Produit partagé. */
function mapperProduit(p: typeof s.produits.$inferSelect): Produit {
  return {
    id: p.id, terrasseId: p.terrasseId, nom: p.nom, categorie: p.categorie,
    prixCdf: p.prixCdf, prixUsdCentimes: p.prixUsd, stock: p.stock,
    stockReserve: p.stockReserve, seuilAlerte: p.seuilAlerte, actif: p.actif,
    photoUrl: p.photoUrl ?? null,
    photoThumbnailUrl: p.photoThumbnailUrl ?? null,
    photoSource: (p.photoSource ?? null) as SourcePhoto | null,
    variante: p.variante ?? null,
    consignable: p.consignable,
    bouteillesParCasier: p.bouteillesParCasier ?? null,
    codeBarres: p.codeBarres ?? null,
    typeProduit: (p.typeProduit ?? null) as TypeProduit | null,
    unite: p.unite ?? null,
    dureeMinutes: p.dureeMinutes ?? null,
    capacite: p.capacite ?? null,
    lot: p.lot ?? null,
    datePeremption: p.datePeremption ?? null,
  };
}

/** Charge toute la base sous la forme du contrat DB partagé */
export async function chargerTout(): Promise<DB> {
  const db = getDb();
  const [
    organisations, utilisateurs, terrasses, affectations, tables, produits,
    tableServeuse, clientsSession, commandes, sessionsService, depots, avis,
    invitations, demandesStock, alertes, mouvementsStock, auditLog, plansTarifs,
    abonnements, historiqueTranches, paiements, factures, metaLignes, catalogueProduits,
    depenses, encaissements, remisesCaisse,
    chambres, sejours, notes, noteLignes,
  ] = await Promise.all([
    db.select().from(s.organisations),
    db.select().from(s.utilisateurs),
    db.select().from(s.terrasses),
    db.select().from(s.affectations),
    db.select().from(s.tablesQr),
    db.select().from(s.produits),
    db.select().from(s.tableServeuse),
    db.select().from(s.clientsSession),
    db.select().from(s.commandes),
    db.select().from(s.sessionsService),
    db.select().from(s.depots),
    db.select().from(s.avis),
    db.select().from(s.invitations),
    db.select().from(s.demandesStock),
    db.select().from(s.alertes),
    db.select().from(s.mouvementsStock),
    db.select().from(s.auditLog),
    db.select().from(s.plansTarifs),
    db.select().from(s.abonnements),
    db.select().from(s.historiqueTranches),
    db.select().from(s.paiements),
    db.select().from(s.factures),
    db.select().from(s.meta),
    db.select().from(s.catalogueProduits),
    db.select().from(s.depenses),
    db.select().from(s.encaissements),
    db.select().from(s.remisesCaisse),
    db.select().from(s.chambres),
    db.select().from(s.sejours),
    db.select().from(s.notes),
    db.select().from(s.noteLignes),
  ]);

  return {
    version: 1,
    organisations,
    utilisateurs: utilisateurs.map((u) => ({ id: u.id, nom: u.nom, telephone: u.telephone, creeLe: u.creeLe })),
    terrasses: terrasses.map((t) => ({
      id: t.id, organisationId: t.organisationId, nom: t.nom, adresse: t.adresse,
      type: (t.typeEtablissement ?? "TERRASSE") as TypeEtablissement,
      typesSecondaires: (t.typesSecondaires ?? []) as TypeEtablissement[],
      tokenQrBoutique: t.tokenQrBoutique ?? null,
      parametres: { seuilEcartCdf: t.seuilEcartCdf, seuilEcartUsdCentimes: t.seuilEcartUsd, tauxUsdCdf: t.tauxUsdCdf },
      creeLe: t.creeLe,
    })),
    affectations: affectations.map((a) => ({ ...a, role: a.role as "GERANT" | "SERVEUSE" })),
    tables: tables.map(mapperTable),
    produits: produits.map(mapperProduit),
    tableServeuse,
    clientsSession,
    commandes: commandes.map((c) => ({
      id: c.id, terrasseId: c.terrasseId, tableId: c.tableId, clientSessionId: c.clientSessionId,
      statut: c.statut as DB["commandes"][number]["statut"], lignes: c.lignes,
      totalCdf: c.totalCdf, totalUsdCentimes: c.totalUsd, cleIdempotence: c.cleIdempotence,
      creeLe: c.creeLe, confirmeeLe: c.confirmeeLe ?? null, servieLe: c.servieLe ?? null,
      annuleLe: c.annuleLe ?? null, motifAnnulation: c.motifAnnulation ?? null, serviePar: c.serviePar ?? null,
      payeeLe: c.payeeLe ?? null, payeePar: c.payeePar ?? null,
    })),
    sessionsService: sessionsService.map((x) => ({
      ...x, statut: x.statut as "OUVERTE" | "CLOTUREE", clotureeLe: x.clotureeLe ?? null,
    })),
    depots: depots.map((d) => ({
      id: d.id, sessionId: d.sessionId, terrasseId: d.terrasseId, serveuseId: d.serveuseId,
      typeDepot: d.typeDepot as "CHAMBRE" | "COMMANDE",
      montantAttenduCdf: d.attenduCdf, montantAttenduUsdCentimes: d.attenduUsd,
      declareCdf: d.declareCdf, declareUsdCentimes: d.declareUsd,
      statut: d.statut as "DECLARE" | "VALIDE" | "CONTESTE",
      declareLe: d.declareLe, valideLe: d.valideLe ?? null, validePar: d.validePar ?? null,
      motifContest: d.motifContest ?? null,
    })),
    avis: avis.map((a) => ({ ...a, motifMasquage: a.motifMasquage ?? null })),
    invitations: invitations.map((i) => ({
      ...i, role: i.role as "GERANT" | "SERVEUSE", statut: i.statut as "ACTIVE" | "UTILISEE" | "EXPIREE" | "REVOQUEE",
    })),
    demandesStock: demandesStock.map((d) => ({
      ...d, type: d.type as "REAPPRO" | "PERTE" | "ECART",
      statut: d.statut as "EN_ATTENTE" | "APPROUVEE" | "REFUSEE",
      traitePar: d.traitePar ?? null, traiteLe: d.traiteLe ?? null,
    })),
    alertes: alertes.map((a) => ({ ...a, type: a.type as DB["alertes"][number]["type"] })),
    mouvementsStock: mouvementsStock.map((m) => ({
      ...m, type: m.type as DB["mouvementsStock"][number]["type"],
      acteurId: m.acteurId ?? null, roleActif: (m.roleActif ?? null) as DB["mouvementsStock"][number]["roleActif"],
    })),
    auditLog: auditLog.map((a) => ({
      ...a, acteurId: a.acteurId ?? null, roleActif: (a.roleActif ?? null) as DB["auditLog"][number]["roleActif"],
    })),
    plansTarifs: plansTarifs.map((t) => ({
      plan: t.plan as DB["plansTarifs"][number]["plan"], tranche: t.tranche as DB["plansTarifs"][number]["tranche"],
      tablesMin: t.tablesMin, tablesMax: t.tablesMax ?? null,
      prixUsdCentimes: t.prixUsd, fraisInstallUsdCentimes: t.fraisInstallUsd,
      typeEtablissementCible: (t.typeEtablissementCible ?? undefined) as TypeEtablissement | undefined,
    })),
    abonnements: abonnements.map((a) => ({
      id: a.id, terrasseId: a.terrasseId,
      plan: a.plan as DB["abonnements"][number]["plan"], tranche: a.tranche as DB["abonnements"][number]["tranche"],
      statut: a.statut as DB["abonnements"][number]["statut"],
      typeEtablissement: (a.typeEtablissement ?? undefined) as TypeEtablissement | undefined,
      essaiFin: a.essaiFin ?? null, periodeDebut: a.periodeDebut, periodeFin: a.periodeFin,
      annuel: a.annuel, nbTablesMaxPeriode: a.nbTablesMaxPeriode,
      prorataDuUsdCentimes: a.prorataDu, fraisInstallPayes: a.fraisInstallPayes,
    })),
    historiqueTranches: historiqueTranches.map((h) => ({
      ...h, ancienne: h.ancienne as DB["historiqueTranches"][number]["ancienne"],
      nouvelle: h.nouvelle as DB["historiqueTranches"][number]["nouvelle"],
      prorataUsdCentimes: h.prorataUsd,
    })),
    catalogueProduits,
    depenses: depenses.map((d) => ({
      id: d.id, terrasseId: d.terrasseId, montantCdf: d.montantCdf,
      montantUsdCentimes: d.montantUsd, motif: d.motif, saisiPar: d.saisiPar,
      roleActif: (d.roleActif ?? null) as DB["depenses"][number]["roleActif"],
      creeLe: d.creeLe,
    })),
    encaissements: encaissements.map((e) => ({
      id: e.id, terrasseId: e.organisationId,
      encaisseParId: e.encaisseParId,
      montantCdf: e.montantCdf, montantUsd: e.montantUsd,
      mode: e.mode, statut: e.statut, creeLe: e.creeLe,
      versementId: e.versementId ?? null,
    })),
    remisesCaisse: remisesCaisse.map((r) => ({
      id: r.id, terrasseId: r.organisationId,
      employeId: r.employeId,
      attenduCdf: r.attenduCdf, attenduUsd: r.attenduUsd,
      recuCdf: r.recuCdf, recuUsd: r.recuUsd,
      statut: r.statut, motifEcart: r.motifEcart,
      creeLe: r.creeLe,
    })),
    chambres: chambres.map((c) => ({
      id: c.id, terrasseId: c.terrasseId, numero: c.numero, type: c.type,
      statut: c.statut, prixNuitCdf: c.prixNuitCdf, prixHeureCdf: c.prixHeureCdf,
      photoUrl: c.photoUrl, creeLe: c.creeLe,
    })),
    sejours: sejours.map((sj) => ({
      id: sj.id, chambreId: sj.chambreId, terrasseId: sj.terrasseId,
      clientNom: sj.clientNom, pieceIdentite: sj.pieceIdentite, mode: sj.mode,
      arriveeLe: sj.arriveeLe, departLe: sj.departLe, montantTotalCdf: sj.montantTotalCdf,
      statut: sj.statut, tauxUsdCdf: sj.tauxUsdCdf, creePar: sj.creePar, creeLe: sj.creeLe,
    })),
    notes: notes.map((n) => ({
      id: n.id, organisationId: n.organisationId, clientId: n.clientId,
      sejourId: n.sejourId, statut: n.statut, ouverteLe: n.ouverteLe,
      regleeLe: n.regleeLe, tauxUsdCdf: n.tauxUsdCdf,
      motifLitige: n.motifLitige, litigeLe: n.litigeLe, litigeDeclarePar: n.litigeDeclarePar,
    })),
    noteLignes: noteLignes.map((nl) => ({
      id: nl.id, noteId: nl.noteId, terrasseId: nl.terrasseId, espace: nl.espace,
      type: nl.type, refId: nl.refId, libelle: nl.libelle, quantite: nl.quantite,
      montantCdf: nl.montantCdf, montantUsd: nl.montantUsd, tauxUsdCdf: nl.tauxUsdCdf,
      statut: nl.statut, creeParId: nl.creeParId, creeLe: nl.creeLe,
      annuleLe: nl.annuleLe, annulePar: nl.annulePar, motifAnnulation: nl.motifAnnulation,
    })),
    paiements: paiements.map((p) => ({
      id: p.id, abonnementId: p.abonnementId, terrasseId: p.terrasseId,
      montantUsdCentimes: p.montantUsd, methode: p.methode as DB["paiements"][number]["methode"],
      reference: p.reference, statut: p.statut as DB["paiements"][number]["statut"],
      soumisPar: p.soumisPar, creeLe: p.creeLe, valideLe: p.valideLe ?? null, validePar: p.validePar ?? null,
    })),
    factures: factures.map((f) => ({
      ...f, plan: f.plan as DB["factures"][number]["plan"],
      tranche: f.tranche as DB["factures"][number]["tranche"], montantUsdCentimes: f.montantUsd,
    })),
    compteurFacture: metaLignes.find((m) => m.cle === "compteurFacture")?.valeur ?? 0,
  };
}

/** Image vide (collections non chargées = tableaux vides) */
function dbVide(): DB {
  return {
    version: 1,
    organisations: [], utilisateurs: [], terrasses: [], affectations: [], tables: [],
    produits: [], tableServeuse: [], clientsSession: [], commandes: [], sessionsService: [],
    depots: [], depenses: [], avis: [], invitations: [], demandesStock: [], alertes: [],
    mouvementsStock: [], auditLog: [], plansTarifs: [], abonnements: [],
    historiqueTranches: [], paiements: [], factures: [],
    catalogueProduits: [], compteurFacture: 0,
  };
}

/**
 * Chargeur ciblé pour la portée CLIENT (menu QR).
 * chargerTout() lit les 24 tables en parallèle (~2-4 s sur Neon distant) ;
 * le menu n'a besoin que de 9 collections → 2-3 vagues parallèles (~1-2 s).
 * Le résultat passe par filtrerParPortee, qui reste la source de vérité du filtrage.
 */
export async function chargerPourClient(portee: Extract<Portee, { kind: "client" }>): Promise<DB> {
  const db = getDb();

  // Vague 1 : résoudre le token (QR de table classique OU QR mural de boutique)
  const [tablesToken, boutiques] = await Promise.all([
    db.select().from(s.tablesQr).where(and(eq(s.tablesQr.tokenQr, portee.token), eq(s.tablesQr.actif, true))),
    db.select().from(s.terrasses).where(eq(s.terrasses.tokenQrBoutique, portee.token)),
  ]);

  let table = tablesToken[0];
  let terrasse: typeof boutiques[number] | undefined;
  if (table) {
    const [t] = await db.select().from(s.terrasses).where(eq(s.terrasses.id, table.terrasseId)).limit(1);
    terrasse = t;
  } else if (boutiques[0]) {
    // QR mural : la boutique n'a qu'une zone de vente active (« Comptoir »)
    terrasse = boutiques[0];
    const [zone] = await db
      .select().from(s.tablesQr)
      .where(and(eq(s.tablesQr.terrasseId, terrasse.id), eq(s.tablesQr.actif, true)))
      .limit(1);
    table = zone;
  }
  if (!table || !terrasse) return dbVide();

  // Vague 2 : données de la zone (produits, serveuses affectées, abonnement, session)
  const sessionId = portee.sessionId;
  const [produits, tableServeuse, abonnements, clientsSession, commandes] = await Promise.all([
    db.select().from(s.produits).where(and(eq(s.produits.terrasseId, terrasse.id), eq(s.produits.actif, true))),
    db.select().from(s.tableServeuse).where(and(eq(s.tableServeuse.tableId, table.id), eq(s.tableServeuse.actif, true))),
    db.select().from(s.abonnements).where(eq(s.abonnements.terrasseId, terrasse.id)),
    sessionId ? db.select().from(s.clientsSession).where(eq(s.clientsSession.id, sessionId)) : Promise.resolve([]),
    sessionId ? db.select().from(s.commandes).where(eq(s.commandes.clientSessionId, sessionId)) : Promise.resolve([]),
  ]);

  // Étanchéité : un sessionId ne vaut que pour la table du token scanné.
  // Sans ce contrôle, connaître le sessionId d'une autre table exposerait
  // ses commandes ici (puis dans filtrerParPortee).
  const sessionValide = clientsSession.length > 0 && clientsSession[0].tableId === table.id;
  const sessionLiee = sessionValide ? clientsSession : [];
  const commandesLiees = sessionValide ? commandes : [];

  // Vague 3 : fiches des serveuses affectées + avis liés à mes commandes
  const serveuseIds = [...new Set(tableServeuse.map((x) => x.serveuseId))];
  const commandeIds = commandesLiees.map((c) => c.id);
  const [utilisateurs, avis] = await Promise.all([
    serveuseIds.length > 0
      ? db.select().from(s.utilisateurs).where(inArray(s.utilisateurs.id, serveuseIds))
      : Promise.resolve([]),
    commandeIds.length > 0
      ? db.select().from(s.avis).where(inArray(s.avis.commandeId, commandeIds))
      : Promise.resolve([]),
  ]);

  return {
    ...dbVide(),
    terrasses: [{
      id: terrasse.id, organisationId: terrasse.organisationId, nom: terrasse.nom, adresse: terrasse.adresse,
      type: (terrasse.typeEtablissement ?? "TERRASSE") as TypeEtablissement,
      typesSecondaires: (terrasse.typesSecondaires ?? []) as TypeEtablissement[],
      tokenQrBoutique: terrasse.tokenQrBoutique ?? null,
      parametres: { seuilEcartCdf: terrasse.seuilEcartCdf, seuilEcartUsdCentimes: terrasse.seuilEcartUsd, tauxUsdCdf: terrasse.tauxUsdCdf },
      creeLe: terrasse.creeLe,
    }],
    tables: [mapperTable(table)],
    produits: produits.map(mapperProduit),
    tableServeuse,
    utilisateurs: utilisateurs.map((u) => ({ id: u.id, nom: u.nom, telephone: u.telephone, creeLe: u.creeLe })),
    clientsSession: sessionLiee,
    commandes: commandesLiees.map((c) => ({
      id: c.id, terrasseId: c.terrasseId, tableId: c.tableId, clientSessionId: c.clientSessionId,
      statut: c.statut as DB["commandes"][number]["statut"], lignes: c.lignes,
      totalCdf: c.totalCdf, totalUsdCentimes: c.totalUsd, cleIdempotence: c.cleIdempotence,
      creeLe: c.creeLe, confirmeeLe: c.confirmeeLe ?? null, servieLe: c.servieLe ?? null,
      annuleLe: c.annuleLe ?? null, motifAnnulation: c.motifAnnulation ?? null, serviePar: c.serviePar ?? null,
      payeeLe: c.payeeLe ?? null, payeePar: c.payeePar ?? null,
    })),
    avis: avis.map((a) => ({ ...a, motifMasquage: a.motifMasquage ?? null })),
    abonnements: abonnements.map((a) => ({
      id: a.id, terrasseId: a.terrasseId,
      plan: a.plan as DB["abonnements"][number]["plan"], tranche: a.tranche as DB["abonnements"][number]["tranche"],
      statut: a.statut as DB["abonnements"][number]["statut"],
      typeEtablissement: (a.typeEtablissement ?? undefined) as TypeEtablissement | undefined,
      essaiFin: a.essaiFin ?? null, periodeDebut: a.periodeDebut, periodeFin: a.periodeFin,
      annuel: a.annuel, nbTablesMaxPeriode: a.nbTablesMaxPeriode,
      prorataDuUsdCentimes: a.prorataDu, fraisInstallPayes: a.fraisInstallPayes,
    })),
  };
}

/**
 * Chargeur ciblé pour la portée PUBLIQUE : seuls les plans tarifaires
 * sont exposés (non sensibles) — une seule requête au lieu de 24.
 */
export async function chargerPublic(): Promise<DB> {
  const db = getDb();
  const plansTarifs = await db.select().from(s.plansTarifs);
  return {
    ...dbVide(),
    plansTarifs: plansTarifs.map((t) => ({
      plan: t.plan as DB["plansTarifs"][number]["plan"], tranche: t.tranche as DB["plansTarifs"][number]["tranche"],
      tablesMin: t.tablesMin, tablesMax: t.tablesMax ?? null,
      prixUsdCentimes: t.prixUsd, fraisInstallUsdCentimes: t.fraisInstallUsd,
      typeEtablissementCible: (t.typeEtablissementCible ?? undefined) as TypeEtablissement | undefined,
    })),
  };
}

/** Filtre l'image selon la portée de l'appelant (étanchéité par organisation) */
export function filtrerParPortee(db: DB, portee: Portee): DB {
  if (portee.kind === "admin") return db

  const vide: DB = {
    ...db,
    organisations: [], utilisateurs: [], terrasses: [], affectations: [], tables: [],
    produits: [], tableServeuse: [], clientsSession: [], commandes: [], sessionsService: [],
    depots: [], depenses: [], avis: [], invitations: [], demandesStock: [], alertes: [],
    mouvementsStock: [], auditLog: [], abonnements: [], historiqueTranches: [],
    paiements: [], factures: [], catalogueProduits: [],
  }

  if (portee.kind === "public") return vide // ne garde que plansTarifs (non sensible)

  if (portee.kind === "client") {
    // Table classique, ou QR mural d'une boutique → sa zone unique
    const table =
      db.tables.find((t) => t.tokenQr === portee.token && t.actif) ??
      (() => {
        const boutique = db.terrasses.find((t) => t.tokenQrBoutique === portee.token)
        return boutique
          ? db.tables.find((t) => t.terrasseId === boutique.id && t.actif)
          : undefined
      })()
    if (!table) return vide
    const commandesIds = new Set(
      db.commandes.filter((c) => c.clientSessionId === portee.sessionId).map((c) => c.id),
    )
    return {
      ...vide,
      terrasses: db.terrasses.filter((t) => t.id === table.terrasseId),
      tables: [table],
      produits: db.produits.filter((p) => p.terrasseId === table.terrasseId && p.actif),
      tableServeuse: db.tableServeuse.filter((x) => x.tableId === table.id && x.actif),
      utilisateurs: db.utilisateurs.filter((u) =>
        db.tableServeuse.some((x) => x.tableId === table.id && x.actif && x.serveuseId === u.id),
      ),
      // La session (et ses commandes) n'est exposée que si elle appartient
      // bien à la table du token scanné — un sessionId seul ne suffit pas
      clientsSession: db.clientsSession.filter((c) => c.id === portee.sessionId && c.tableId === table.id),
      commandes: db.commandes.filter((c) => c.clientSessionId === portee.sessionId && c.tableId === table.id),
      avis: db.avis.filter((a) => commandesIds.has(a.commandeId)),
      abonnements: db.abonnements.filter((a) => a.terrasseId === table.terrasseId),
    }
  }

  // staff : organisations où l'utilisateur est propriétaire ou affecté
  // (utilisateurId résolu par le routeur depuis le jeton — garanti présent)
  if (!portee.utilisateurId) {
    throw new Error("filtrerParPortee(staff) sans utilisateurId — le routeur doit résoudre la session d'abord");
  }
  const staffId = portee.utilisateurId;
  const orgIds = new Set<string>()
  for (const o of db.organisations) if (o.proprietaireId === staffId) orgIds.add(o.id)
  const terrasseIdsAffectation = db.affectations
    .filter((a) => a.utilisateurId === staffId)
    .map((a) => a.terrasseId)
  for (const t of db.terrasses) {
    if (orgIds.has(t.organisationId) || terrasseIdsAffectation.includes(t.id)) orgIds.add(t.organisationId)
  }
  const terrasseIds = new Set(db.terrasses.filter((t) => orgIds.has(t.organisationId)).map((t) => t.id))
  const utilisateurIds = new Set<string>()
  for (const o of db.organisations) if (orgIds.has(o.id)) utilisateurIds.add(o.proprietaireId)
  for (const a of db.affectations) if (terrasseIds.has(a.terrasseId)) utilisateurIds.add(a.utilisateurId)

  const parTerrasse = <T extends { terrasseId: string }>(lignes: T[]) => lignes.filter((x) => terrasseIds.has(x.terrasseId))

  // Journal d'audit : réservé au Propriétaire — actions des membres de SES
  // organisations (le Gérant et la Serveuse n'y ont pas accès)
  const orgsPossedees = new Set(
    db.organisations.filter((o) => o.proprietaireId === staffId).map((o) => o.id),
  )
  let journal: DB["auditLog"] = []
  if (orgsPossedees.size > 0) {
    const terrassesPossedees = new Set(db.terrasses.filter((t) => orgsPossedees.has(t.organisationId)).map((t) => t.id))
    const membres = new Set<string>([staffId])
    for (const a of db.affectations) if (terrassesPossedees.has(a.terrasseId)) membres.add(a.utilisateurId)
    journal = db.auditLog.filter((a) => a.acteurId !== null && membres.has(a.acteurId))
  }

  return {
    ...db,
    organisations: db.organisations.filter((o) => orgIds.has(o.id)),
    utilisateurs: db.utilisateurs.filter((u) => utilisateurIds.has(u.id)),
    terrasses: db.terrasses.filter((t) => terrasseIds.has(t.id)),
    affectations: parTerrasse(db.affectations),
    tables: parTerrasse(db.tables),
    produits: parTerrasse(db.produits),
    tableServeuse: db.tableServeuse.filter((x) =>
      db.tables.some((t) => t.id === x.tableId && terrasseIds.has(t.terrasseId)),
    ),
    clientsSession: db.clientsSession.filter((c) =>
      db.tables.some((t) => t.id === c.tableId && terrasseIds.has(t.terrasseId)),
    ),
    commandes: parTerrasse(db.commandes),
    sessionsService: parTerrasse(db.sessionsService),
    depots: parTerrasse(db.depots),
    depenses: parTerrasse(db.depenses),
    avis: parTerrasse(db.avis),
    invitations: parTerrasse(db.invitations),
    demandesStock: parTerrasse(db.demandesStock),
    alertes: parTerrasse(db.alertes),
    mouvementsStock: parTerrasse(db.mouvementsStock),
    abonnements: parTerrasse(db.abonnements),
    historiqueTranches: db.historiqueTranches.filter((h) =>
      db.abonnements.some((a) => a.id === h.abonnementId && terrasseIds.has(a.terrasseId)),
    ),
    paiements: parTerrasse(db.paiements),
    factures: parTerrasse(db.factures),
    auditLog: journal,
  }
}

// Le cycle de vie est quotidien : inutile de rejouer les transitions à chaque
// snapshot (2-3 aller-retours DB séquentiels). Une exécution par heure suffit.
let dernierTick = 0;

/** N'exécute le tick que si la dernière exécution date de plus d'une heure */
export async function tickAbonnementsSiNecessaire() {
  if (Date.now() - dernierTick < 3_600_000) return;
  dernierTick = Date.now();
  await tickAbonnements();
}

/** Transitions du cycle de vie des abonnements (cron quotidien, idempotent) */
export async function tickAbonnements() {
  const db = getDb()
  const maintenantIso = maintenant()
  const abos = await db.select().from(s.abonnements)
  const terrasses = await db.select().from(s.terrasses)

  for (const abo of abos) {
    const t = terrasses.find((x) => x.id === abo.terrasseId)
    if (!t) continue
    const nom = t.nom

    if (abo.statut === "ESSAI" && abo.essaiFin) {
      const j = joursRestants(abo.essaiFin)
      if ([7, 3, 1].includes(j)) {
        const message = `Essai gratuit de « ${nom} » : plus que ${j} jour${j > 1 ? "s" : ""}. Pensez à payer votre abonnement.`
        const existe = await db.select().from(s.alertes).where(eq(s.alertes.message, message)).limit(1)
        if (existe.length === 0) {
          await db.insert(s.alertes).values({ id: uid("alt"), terrasseId: abo.terrasseId, type: "ABONNEMENT", message, lu: false, creeLe: maintenantIso })
        }
      }
      if (maintenantIso > abo.essaiFin) {
        await db.update(s.abonnements).set({ statut: "LECTURE_SEULE" }).where(eq(s.abonnements.id, abo.id))
        await db.insert(s.alertes).values({
          id: uid("alt"), terrasseId: abo.terrasseId, type: "ABONNEMENT", lu: false, creeLe: maintenantIso,
          message: `L'essai de « ${nom} » est terminé : la terrasse est en lecture seule. Payez pour réactiver.`,
        })
      }
    } else if (abo.statut === "ACTIF" && maintenantIso > abo.periodeFin) {
      await db.update(s.abonnements).set({ statut: "EN_GRACE" }).where(eq(s.abonnements.id, abo.id))
      await db.insert(s.alertes).values({
        id: uid("alt"), terrasseId: abo.terrasseId, type: "ABONNEMENT", lu: false, creeLe: maintenantIso,
        message: `Abonnement de « ${nom} » arrivé à échéance : période de grâce de 7 jours.`,
      })
    } else if (abo.statut === "EN_GRACE" && maintenantIso > ajouterJours(abo.periodeFin, 7)) {
      await db.update(s.abonnements).set({ statut: "LECTURE_SEULE" }).where(eq(s.abonnements.id, abo.id))
      await db.insert(s.alertes).values({
        id: uid("alt"), terrasseId: abo.terrasseId, type: "ABONNEMENT", lu: false, creeLe: maintenantIso,
        message: `« ${nom} » est passée en lecture seule (impayé).`,
      })
    } else if (abo.statut === "LECTURE_SEULE" && maintenantIso > ajouterJours(abo.periodeFin, 60)) {
      await db.update(s.abonnements).set({ statut: "SUSPENDU" }).where(eq(s.abonnements.id, abo.id))
      await db.insert(s.alertes).values({
        id: uid("alt"), terrasseId: abo.terrasseId, type: "ABONNEMENT", lu: false, creeLe: maintenantIso,
        message: `« ${nom} » est suspendue après 60 jours d'impayé. Aucune donnée n'est supprimée.`,
      })
    }
  }

  // Expiration des invitations (cron)
  const actives = await db.select().from(s.invitations).where(eq(s.invitations.statut, "ACTIVE"))
  for (const inv of actives) {
    if (inv.expireLe < maintenantIso) {
      await db.update(s.invitations).set({ statut: "EXPIREE" }).where(eq(s.invitations.id, inv.id))
    }
  }
}
