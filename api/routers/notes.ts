// ============================================================
// GBS — Routeur tRPC « notes » : note client unique (ANNEXE-2) et
// « payer pour quelqu'un » (ANNEXE-3).
//
// Note unique : un client reconnu (clientSessionId) a UNE note par
// organisation ; commandes, tokens de billard et nuitées s'y
// rattachent via note_lignes (référence unique = idempotence).
//
// Argent physique (§5) : un encaissement CASH reste EN_MAIN de
// l'employé jusqu'à une remise_caisse VALIDÉE par le receveur ;
// l'écart déclenche l'alerte propriétaire. Le MOBILE_MONEY n'est
// pas du cash physique : REMIS d'office. La ventilation par espace
// (note_ventilations) est COMPTABLE uniquement.
//
// Concurrence : encaisserNoteDb s'exécute en transaction avec
// verrou FOR UPDATE sur la note (§5.9 — pas de double
// encaissement). L'ouverture de note tolère la course par l'index
// unique partiel + relecture.
//
// Confidentialité (§2) : un client ne voit que SA note ; les notes
// de chambre (sejour_id) sont réservées à la réception et à la
// gérance. Aucune identité du payeur n'est exposée (ANNEXE-3).
// ============================================================

import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import * as s from "@db/schema";
import {
  EXPIRATION_PRISE_EN_CHARGE_MIN,
  SEUIL_PAIRE_PRISE_7J,
  SEUIL_PRISES_PAR_SERVEUSE_PAR_JOUR,

  resteDu,
  totauxNote,
  ventilerParEspace,
  type EspaceNote,
  type LigneNoteVue,
  type NoteVue,
  type StatutLigneNote,
  type TypeLigneNote,
} from "@contracts/notes";
import type { RoleActif } from "@contracts/types";
import { normaliserReferenceMobile, referenceMobileValide } from "@contracts/billard";
import { createRouter, protegee, publicQuery } from "../middleware";
import { alerter, db, erreur, journaliser, resoudreTableParToken, tauxCourantDb } from "../gbsRouter";
import { ajouterJours, maintenant, uid } from "../gbsUtils";

type ClientRow = typeof s.clients.$inferSelect;
type NoteRow = typeof s.notes.$inferSelect;

/** Qui peut encaisser une note (ANNEXE-2 §5.1 : tout employé autorisé
 *  de l'organisation — liste explicite pour exclure CUISINE_BAR,
 *  GOUVERNANTE, BILLARDIER, VENDEUR, PHARMACIEN, PRESTATAIRE). */
const ROLES_ENCAISSEMENT = ["PROPRIETAIRE", "GERANT", "SERVEUSE", "RECEPTIONNISTE"] as const;
/** Note rattachée à un séjour : réception ou gérance SEULEMENT (§5.1). */
const ROLES_RECEPTION = ["PROPRIETAIRE", "GERANT", "RECEPTIONNISTE"] as const;
const ROLES_GERANCE = ["PROPRIETAIRE", "GERANT"] as const;
/** Décision d'une prise en charge : serveuse de la zone ou gérant (§1.4). */
const ROLES_DECISION_PEC = ["PROPRIETAIRE", "GERANT", "SERVEUSE"] as const;

// ---------------- Helpers rôles à l'échelle ORGANISATION ----------------

/** Rôles d'un utilisateur sur TOUTES les terrasses d'une organisation
 *  (la note unique traverse les établissements de l'organisation). */
export async function rolesSurOrganisation(acteurId: string, organisationId: string): Promise<RoleActif[]> {
  const [org] = await db().select().from(s.organisations).where(eq(s.organisations.id, organisationId)).limit(1);
  if (!org) return [];
  const roles: RoleActif[] = [];
  if (org.proprietaireId === acteurId) roles.push("PROPRIETAIRE");
  const affs = await db().select({ role: s.affectations.role }).from(s.affectations)
    .innerJoin(s.terrasses, eq(s.affectations.terrasseId, s.terrasses.id))
    .where(and(
      eq(s.terrasses.organisationId, organisationId),
      eq(s.affectations.utilisateurId, acteurId),
      eq(s.affectations.actif, true),
    ));
  for (const a of affs) {
    if (!roles.includes(a.role as RoleActif)) roles.push(a.role as RoleActif);
  }
  return roles;
}

/** Exige un rôle parmi `autorises` sur l'organisation ; tout refus est
 *  journalisé (traçabilité « GBS le voit »). */
async function exigerRoleOrganisation(
  acteurId: string, organisationId: string, autorises: readonly string[], quoi: string,
): Promise<RoleActif> {
  const roles = await rolesSurOrganisation(acteurId, organisationId);
  const accorde = roles.find((r) => autorises.includes(r));
  if (!accorde) {
    await journaliser(acteurId, roles[0] ?? null, "ACCES_REFUSE",
      `${quoi} refusé (rôles : ${roles.join(", ") || "aucun"})`);
    erreur("Vous n'avez pas le rôle requis pour cette opération.");
  }
  return accorde;
}

// ---------------- Helpers client / note (réutilisés par d'autres routeurs) ----------------

/** Client rattaché à une session d'appareil, ou NULL si la session
 *  n'a jamais été associée (comptoir anonyme). */
export async function clientDeSessionDb(clientSessionId: string): Promise<ClientRow | null> {
  const [app] = await db().select().from(s.clientAppareils)
    .where(eq(s.clientAppareils.clientSessionId, clientSessionId)).limit(1);
  if (!app) return null;
  const [c] = await db().select().from(s.clients).where(eq(s.clients.id, app.clientId)).limit(1);
  return c ?? null;
}

/** Crée (si besoin) le client d'une session d'appareil : prénom de la
 *  session, organisation déduite de la table du premier scan. */
export async function assurerClientDb(clientSessionId: string): Promise<ClientRow | null> {
  const existant = await clientDeSessionDb(clientSessionId);
  if (existant) return existant;
  const [sess] = await db().select().from(s.clientsSession)
    .where(eq(s.clientsSession.id, clientSessionId)).limit(1);
  if (!sess) return null;
  const [table] = await db().select().from(s.tablesQr).where(eq(s.tablesQr.id, sess.tableId)).limit(1);
  if (!table) return null;
  const [terrasse] = await db().select().from(s.terrasses).where(eq(s.terrasses.id, table.terrasseId)).limit(1);
  if (!terrasse) return null;
  const client: ClientRow = {
    id: uid("clt"), organisationId: terrasse.organisationId,
    prenom: sess.prenom, telephone: null, creeLe: maintenant(),
  };
  await db().insert(s.clients).values(client);
  await db().insert(s.clientAppareils)
    .values({ clientSessionId, clientId: client.id, creeLe: maintenant() })
    .onConflictDoNothing();
  return client;
}

/** Note OUVERTE ou A_REGLER du client (une seule — index partiel). */
export async function noteOuverteDb(clientId: string): Promise<NoteRow | null> {
  const [n] = await db().select().from(s.notes)
    .where(and(eq(s.notes.clientId, clientId), inArray(s.notes.statut, ["OUVERTE", "A_REGLER"])))
    .limit(1);
  return n ?? null;
}

/** ANNEXE-2 §3 : à chaque scan, réutiliser la note ouverte ou en
 *  créer une. Course entre deux appareils : l'index unique partiel
 *  rejette le second insert → on relit la note gagnante. */
export async function ouvrirOuRetrouverNoteDb(client: ClientRow, tauxUsdCdf: number | null): Promise<NoteRow> {
  const ouverte = await noteOuverteDb(client.id);
  if (ouverte) return ouverte;
  const note: NoteRow = {
    id: uid("not"), organisationId: client.organisationId, clientId: client.id,
    sejourId: null, statut: "OUVERTE", ouverteLe: maintenant(), regleeLe: null,
    tauxUsdCdf, motifLitige: null, litigeLe: null, litigeDeclarePar: null,
  };
  try {
    await db().insert(s.notes).values(note);
    return note;
  } catch (e) {
    const gagnante = await noteOuverteDb(client.id);
    if (gagnante) return gagnante;
    throw e;
  }
}

export interface LigneAAjouter {
  refId: string;
  libelle: string;
  quantite: number;
  montantCdf: number;
  montantUsd: number; // centimes
  statut?: StatutLigneNote;
  tauxUsdCdf?: number | null;
}

/** Branche une vente sur la note du client (ANNEXE-2 §3). Idempotent
 *  par (type, ref_id). NULL si la session n'a pas de client
 *  identifiable (vente au comptoir sans session : hors note). */
export async function ajouterLignesNoteDb(params: {
  clientSessionId: string | null;
  terrasseId: string;
  espace: EspaceNote;
  type: TypeLigneNote;
  lignes: LigneAAjouter[];
  creeParId?: string | null;
}): Promise<string | null> {
  if (!params.clientSessionId || params.lignes.length === 0) return null;
  const client = await assurerClientDb(params.clientSessionId);
  if (!client) return null;
  const [terrasse] = await db().select().from(s.terrasses).where(eq(s.terrasses.id, params.terrasseId)).limit(1);
  const note = await ouvrirOuRetrouverNoteDb(client, terrasse?.tauxUsdCdf ?? null);
  const refs = params.lignes.map((l) => l.refId);
  const existantes = await db().select({ refId: s.noteLignes.refId }).from(s.noteLignes)
    .where(and(eq(s.noteLignes.type, params.type), inArray(s.noteLignes.refId, refs)));
  const deja = new Set(existantes.map((x) => x.refId));
  const fraiches = params.lignes.filter((l) => !deja.has(l.refId));
  if (fraiches.length > 0) {
    await db().insert(s.noteLignes).values(fraiches.map((l) => ({
      id: uid("nln"), noteId: note.id, terrasseId: params.terrasseId, espace: params.espace,
      type: params.type, refId: l.refId, libelle: l.libelle.slice(0, 200), quantite: l.quantite,
      montantCdf: l.montantCdf, montantUsd: l.montantUsd,
      tauxUsdCdf: l.tauxUsdCdf ?? note.tauxUsdCdf,
      statut: l.statut ?? "EN_ATTENTE", creeParId: params.creeParId ?? null, creeLe: maintenant(),
    })));
  }
  return note.id;
}

/** Synchronise le statut des lignes d'une commande avec son cycle
 *  métier (EN_ATTENTE → CONFIRMEE → SERVIE, ou ANNULEE avec motif). */
export async function synchroniserLignesCommandeDb(
  commandeId: string, statut: StatutLigneNote, acteurId: string | null, motif?: string,
): Promise<void> {
  await db().update(s.noteLignes).set({
    statut,
    ...(statut === "ANNULEE"
      ? { annuleLe: maintenant(), annulePar: acteurId, motifAnnulation: (motif ?? "").slice(0, 200) || null }
      : {}),
  }).where(and(
    eq(s.noteLignes.type, "COMMANDE"),
    sql`${s.noteLignes.refId} LIKE ${`${commandeId}:%`}`,
  ));
}

/** Note de chambre (§3) : à l'enregistrement, la réception crée un
 *  client « comptoir » (prénom = nom du séjour) et une note rattachée
 *  au séjour — elle reste ouverte jusqu'au règlement, pas au
 *  check-out. Idempotent par sejour_id. */
export async function ouvrirNoteSejourDb(params: {
  terrasseId: string; sejourId: string; clientNom: string; creeParId: string;
  clientSessionId?: string;
  prixNuitCdf?: number;
  prixHeureCdf?: number;
  mode?: 'NUIT' | 'HEURE';
}): Promise<string | null> {
  const [existante] = await db().select({ id: s.notes.id }).from(s.notes)
    .where(eq(s.notes.sejourId, params.sejourId)).limit(1);
  if (existante) return existante.id;

  const [terrasse] = await db().select().from(s.terrasses).where(eq(s.terrasses.id, params.terrasseId)).limit(1);
  if (!terrasse) return null;

  // On cherche une note ouverte pour ce client (via clientSessionId)
  let noteExistante = null;
  if (params.clientSessionId) {
    // On cherche d'abord si le client a une note ouverte (créée par une commande terrasse)
    const [sess] = await db().select().from(s.clientsSession)
      .where(eq(s.clientsSession.id, params.clientSessionId)).limit(1);
    if (sess) {
      const [note] = await db().select().from(s.notes)
        .where(and(eq(s.notes.clientId, sess.id), eq(s.notes.statut, "OUVERTE"))).limit(1);
      if (note) noteExistante = note;
    }
  }

  // Si on a trouvé une note existante, on y ajoute la chambre
  if (noteExistante) {
    await db().update(s.notes)
      .set({ sejourId: params.sejourId })
      .where(eq(s.notes.id, noteExistante.id));
    
    const montantChambre = params.mode === 'HEURE' 
      ? (params.prixHeureCdf ?? 0) 
      : (params.prixNuitCdf ?? 0);
    
    await db().insert(s.noteLignes).values({
      id: uid("nln"), noteId: noteExistante.id, terrasseId: params.terrasseId, espace: "HOTEL", type: "CHAMBRE",
      refId: params.sejourId, libelle: `Chambre ${params.mode === 'HEURE' ? '(heure)' : '(nuit)'}`, quantite: 1,
      montantCdf: montantChambre, montantUsd: 0, tauxUsdCdf: null,
      statut: "CONFIRMEE", creeParId: params.creeParId, creeLe: maintenant(),
    });
    return noteExistante.id;
  }

  // Sinon, on crée une nouvelle note (comportement actuel)
  const clientId = uid("clt");
  await db().insert(s.clients).values({
    id: clientId, organisationId: terrasse.organisationId,
    prenom: params.clientNom.slice(0, 60), telephone: null, creeLe: maintenant(),
  });
  const noteId = uid("not");
  await db().insert(s.notes).values({
    id: noteId, organisationId: terrasse.organisationId, clientId,
    sejourId: params.sejourId, statut: "OUVERTE", ouverteLe: maintenant(),
    tauxUsdCdf: terrasse.tauxUsdCdf,
  });
  
  const montantChambre = params.mode === 'HEURE' 
    ? (params.prixHeureCdf ?? 0) 
    : (params.prixNuitCdf ?? 0);
    
  await db().insert(s.noteLignes).values({
    id: uid("nln"), noteId, terrasseId: params.terrasseId, espace: "HOTEL", type: "CHAMBRE",
    refId: params.sejourId, libelle: `Chambre ${params.mode === 'HEURE' ? '(heure)' : '(nuit)'}`, quantite: 1,
    montantCdf: montantChambre, montantUsd: 0, tauxUsdCdf: terrasse.tauxUsdCdf,
    statut: "CONFIRMEE", creeParId: params.creeParId, creeLe: maintenant(),
  });
  return noteId;
}

/** Au check-out : la ligne CHAMBRE prend son montant définitif. */
export async function finaliserLigneSejourDb(sejourId: string, montantCdf: number, libelle: string): Promise<void> {
  await db().update(s.noteLignes).set({ montantCdf, libelle: libelle.slice(0, 200), statut: "SERVIE" })
    .where(and(eq(s.noteLignes.type, "CHAMBRE"), eq(s.noteLignes.refId, sejourId)));
}

/** Totaux et reste dû d'une note (lignes non annulées − encaissé). */
export async function sommesNoteDb(noteId: string) {
  const lignes = await db().select().from(s.noteLignes).where(eq(s.noteLignes.noteId, noteId));
  const encs = await db().select().from(s.encaissements).where(eq(s.encaissements.noteId, noteId));
  const { totalCdf, totalUsd } = totauxNote(lignes);
  const encaisseCdf = encs.reduce((x, e) => x + e.montantCdf, 0);
  const encaisseUsd = encs.reduce((x, e) => x + e.montantUsd, 0);
  return {
    lignes, encs, totalCdf, totalUsd, encaisseCdf, encaisseUsd,
    resteCdf: resteDu(totalCdf, encaisseCdf),
    resteUsd: resteDu(totalUsd, encaisseUsd),
  };
}

/** Note (reste dû + nouvel achat) à partir de laquelle le téléphone du client est exigé */
const SEUIL_TELEPHONE_CDF = 30_000;
const SEUIL_TELEPHONE_USD = 1_000; // centimes = 10 $

/** Règle commune à TOUS les espaces (terrasse, billard, hôtel, boutique…) :
 *  au-delà du seuil, le client doit avoir déclaré son téléphone — sinon sa
 *  note ne se retrouve plus s'il change d'appareil. Exempt : client en
 *  chambre (le folio garantit le paiement).
 *  shortcut: seuils fixes pour tous les établissements, à rendre
 *  configurables (colonne par établissement) si les gérants le demandent. */
export async function exigerTelephoneSiGrosseNoteDb(
  clientSessionId: string, ajoutCdf: number, ajoutUsd = 0,
): Promise<void> {
  const client = await assurerClientDb(clientSessionId);
  if (!client || client.telephone) return;
  const note = await noteOuverteDb(client.id);
  if (note?.sejourId) return;
  const du = note ? await sommesNoteDb(note.id) : { resteCdf: 0, resteUsd: 0 };
  if (du.resteCdf + ajoutCdf >= SEUIL_TELEPHONE_CDF || du.resteUsd + ajoutUsd >= SEUIL_TELEPHONE_USD) {
    erreur("Votre note dépasse le seuil : indiquez votre numéro de téléphone dans l'onglet « Ma note » pour continuer.");
  }
}

/** Statut métier vivant de la source d'une ligne (commande en
 *  préparation, token en file…) — pour l'écran « Ma note ». */
async function detailStatutsDb(lignes: { type: string; refId: string | null }[]): Promise<Map<string, string>> {
  const details = new Map<string, string>();
  const commandeIds = [...new Set(lignes.filter((l) => l.type === "COMMANDE" && l.refId)
    .map((l) => (l.refId ?? "").split(":")[0] ?? ""))].filter((x) => x.length > 0);
  const tokenIds = lignes.filter((l) => l.type === "TOKEN_BILLARD" && l.refId).map((l) => l.refId ?? "");
  const sejourIds = lignes.filter((l) => l.type === "CHAMBRE" && l.refId).map((l) => l.refId ?? "");
  if (commandeIds.length > 0) {
    const commandes = await db().select({ id: s.commandes.id, statut: s.commandes.statut })
      .from(s.commandes).where(inArray(s.commandes.id, commandeIds));
    const parId = new Map(commandes.map((c) => [c.id, c.statut]));
    for (const l of lignes) {
      if (l.type !== "COMMANDE" || !l.refId) continue;
      const st = parId.get(l.refId.split(":")[0] ?? "");
      if (st) details.set(l.refId, st);
    }
  }
  if (tokenIds.length > 0) {
    const tokens = await db().select({ id: s.tokensBillard.id, statut: s.tokensBillard.statut, numero: s.tokensBillard.numero })
      .from(s.tokensBillard).where(inArray(s.tokensBillard.id, tokenIds));
    for (const t of tokens) details.set(t.id, t.statut);
  }
  if (sejourIds.length > 0) {
    const sejours = await db().select({ id: s.sejours.id, statut: s.sejours.statut })
      .from(s.sejours).where(inArray(s.sejours.id, sejourIds));
    for (const sej of sejours) details.set(sej.id, sej.statut);
  }
  return details;
}

/** Construit la vue « Ma note » (client ou personnel). */
async function vueNoteDb(note: NoteRow, prenom: string): Promise<NoteVue> {
  const sommes = await sommesNoteDb(note.id);
  const details = await detailStatutsDb(sommes.lignes);
  const lignes: LigneNoteVue[] = sommes.lignes
    .map((l) => ({
      id: l.id,
      espace: l.espace as EspaceNote,
      type: l.type as TypeLigneNote,
      libelle: l.libelle,
      quantite: l.quantite,
      montantCdf: l.montantCdf,
      montantUsd: l.montantUsd,
      statut: l.statut as StatutLigneNote,
      creeLe: l.creeLe,
      detailStatut: l.refId ? (details.get(l.refId) ?? null) : null,
      priseEnChargeId: l.priseEnChargeId,
    }))
    .sort((a, b) => a.creeLe.localeCompare(b.creeLe));
  return {
    id: note.id, statut: note.statut as NoteVue["statut"], prenom,
    ouverteLe: note.ouverteLe, lignes,
    totalCdf: sommes.totalCdf, totalUsd: sommes.totalUsd,
    encaisseCdf: sommes.encaisseCdf, encaisseUsd: sommes.encaisseUsd,
    resteCdf: sommes.resteCdf, resteUsd: sommes.resteUsd,
    tauxUsdCdf: note.tauxUsdCdf,
  };
}

/** Marque payées les ventes liées à une note soldée : commandes
 *  (payee_le) et tokens « sur note » (paye_le). Idempotent. */
async function solderVentesLieesDb(noteId: string, acteurId: string): Promise<void> {
  const lignes = await db().select({ type: s.noteLignes.type, refId: s.noteLignes.refId })
    .from(s.noteLignes).where(eq(s.noteLignes.noteId, noteId));
  const commandeIds = [...new Set(lignes.filter((l) => l.type === "COMMANDE" && l.refId)
    .map((l) => (l.refId ?? "").split(":")[0] ?? ""))].filter((x) => x.length > 0);
  if (commandeIds.length > 0) {
    await db().update(s.commandes)
      .set({ payeeLe: maintenant(), payeePar: acteurId })
      .where(and(inArray(s.commandes.id, commandeIds), sql`${s.commandes.payeeLe} IS NULL`, sql`${s.commandes.statut} <> 'ANNULEE'`));
  }
  const tokenIds = lignes.filter((l) => l.type === "TOKEN_BILLARD" && l.refId).map((l) => l.refId ?? "");
  if (tokenIds.length > 0) {
    await db().update(s.tokensBillard)
      .set({ payeLe: maintenant(), payePar: acteurId })
      .where(and(inArray(s.tokensBillard.id, tokenIds), eq(s.tokensBillard.surNote, true), sql`${s.tokensBillard.payeLe} IS NULL`));
  }
}

/** Cœur de l'encaissement (ANNEXE-2 §5.9) : transaction + verrou
 *  FOR UPDATE sur la note — un double encaissement est impossible.
 *  Réutilisé par l'endpoint, par marquerPayee (commande) et par la
 *  validation cash d'un token billard. */
export async function encaisserNoteDb(params: {
  noteId: string;
  acteurId: string;
  montantCdf: number;
  montantUsd: number;
  mode: "CASH" | "MOBILE_MONEY";
  referenceMobile?: string | null;
  pourboireCdf?: number;
  pourboireUsd?: number;
}): Promise<{ resteCdf: number; resteUsd: number; reglee: boolean }> {
  const montantCdf = Math.trunc(params.montantCdf);
  const montantUsd = Math.trunc(params.montantUsd);
  const pourboireCdf = Math.trunc(params.pourboireCdf ?? 0);
  const pourboireUsd = Math.trunc(params.pourboireUsd ?? 0);
  if (montantCdf < 0 || montantUsd < 0 || pourboireCdf < 0 || pourboireUsd < 0) {
    erreur("Montant invalide.");
  }
  if (montantCdf === 0 && montantUsd === 0) erreur("Rien à encaisser : montant nul.");
  let reference: string | null = null;
  if (params.mode === "MOBILE_MONEY") {
    if (!params.referenceMobile || !referenceMobileValide(params.referenceMobile)) {
      erreur("Référence de transaction mobile money invalide ou manquante.");
    }
    reference = normaliserReferenceMobile(params.referenceMobile);
  }

  const resultat = await db().transaction(async (tx) => {
    // Verrou de la note : deux encaissements simultanés se sérialisent.
    const [note] = await tx.select().from(s.notes)
      .where(eq(s.notes.id, params.noteId)).limit(1).for("update");
    if (!note) erreur("Note introuvable.");
    if (note.statut === "REGLEE") erreur("Cette note est déjà réglée.");
    if (note.statut === "FUSIONNEE") erreur("Cette note a été fusionnée dans une autre.");

    const lignes = await tx.select().from(s.noteLignes).where(eq(s.noteLignes.noteId, note.id));
    const encs = await tx.select().from(s.encaissements).where(eq(s.encaissements.noteId, note.id));
    const { totalCdf, totalUsd } = totauxNote(lignes);
    const resteCdf = resteDu(totalCdf, encs.reduce((x, e) => x + e.montantCdf, 0));
    const resteUsd = resteDu(totalUsd, encs.reduce((x, e) => x + e.montantUsd, 0));
    if (montantCdf > resteCdf || montantUsd > resteUsd) {
      erreur(`Montant supérieur au reste dû (${resteCdf} FC / ${resteUsd} ¢).`);
    }
    // Unicité de la référence mobile money revérifiée DANS le verrou
    // (l'index unique partiel reste la garde ultime).
    if (reference) {
      const [dup] = await tx.select({ id: s.encaissements.id }).from(s.encaissements)
        .where(and(eq(s.encaissements.organisationId, note.organisationId), eq(s.encaissements.referenceMobile, reference)))
        .limit(1);
      if (dup) erreur("Cette référence de transaction a déjà été enregistrée.");
    }

    const encaissementId = uid("enc");
    const maintenantIso = maintenant();
    // MOBILE_MONEY : l'argent est chez l'opérateur, pas en main — REMIS
    // d'office (le suivi EN_MAIN ne concerne que le cash physique, §5.6).
    const statutEnc = params.mode === "CASH" ? "EN_MAIN" : "REMIS";
    await tx.insert(s.encaissements).values({
      id: encaissementId, noteId: note.id, organisationId: note.organisationId,
      encaisseParId: params.acteurId, montantCdf, montantUsd, mode: params.mode,
      referenceMobile: reference, statut: statutEnc,
      creeLe: maintenantIso, remisLe: statutEnc === "REMIS" ? maintenantIso : null,
    });
    if (pourboireCdf > 0 || pourboireUsd > 0) {
      // §5.4 : pourboire À PART — hors CA et hors ventilation par espace.
      await tx.insert(s.pourboires).values({
        id: uid("ptb"), noteId: note.id, encaissementId,
        employeId: params.acteurId, montantCdf: pourboireCdf, montantUsd: pourboireUsd,
        creeLe: maintenantIso,
      });
    }

    // Ventilation COMPTABLE par espace (§5.8) : restes par
    // (terrasse, espace) = lignes non annulées − déjà ventilé.
    const dejaVentile = await tx.select({
      terrasseId: s.noteVentilations.terrasseId, espace: s.noteVentilations.espace,
      montantCdf: s.noteVentilations.montantCdf, montantUsd: s.noteVentilations.montantUsd,
    }).from(s.noteVentilations)
      .innerJoin(s.encaissements, eq(s.noteVentilations.encaissementId, s.encaissements.id))
      .where(eq(s.encaissements.noteId, note.id));
    const cle = (t: string, e: string) => `${t}|${e}`;
    const restesParEspace = new Map<string, { espace: EspaceNote; terrasseId: string; resteCdf: number; resteUsd: number }>();
    for (const l of lignes) {
      if (l.statut === "ANNULEE") continue;
      const k = cle(l.terrasseId, l.espace);
      const r = restesParEspace.get(k) ?? { espace: l.espace as EspaceNote, terrasseId: l.terrasseId, resteCdf: 0, resteUsd: 0 };
      r.resteCdf += l.montantCdf;
      r.resteUsd += l.montantUsd;
      restesParEspace.set(k, r);
    }
    for (const v of dejaVentile) {
      const r = restesParEspace.get(cle(v.terrasseId, v.espace));
      if (r) {
        r.resteCdf -= v.montantCdf;
        r.resteUsd -= v.montantUsd;
      }
    }
    for (const part of ventilerParEspace([...restesParEspace.values()], montantCdf, montantUsd)) {
      await tx.insert(s.noteVentilations).values({
        id: uid("vnt"), encaissementId, terrasseId: part.terrasseId, espace: part.espace,
        montantCdf: part.montantCdf, montantUsd: part.montantUsd, creeLe: maintenantIso,
      });
    }

    const nouveauResteCdf = resteCdf - montantCdf;
    const nouveauResteUsd = resteUsd - montantUsd;
    // Solde zéro (§5.5) : le client paie en CDF **ou** en USD (§4 :
    // jamais de mélange de devises dans un même total). La note est
    // soldée quand l'une des deux devises est entièrement couverte —
    // l'autre montant n'est qu'un équivalent au taux figé.
    const reglee = (totalCdf > 0 || totalUsd > 0)
      && ((totalCdf > 0 && nouveauResteCdf === 0) || (totalUsd > 0 && nouveauResteUsd === 0));
    if (reglee) {
      await tx.update(s.notes).set({ statut: "REGLEE", regleeLe: maintenantIso }).where(eq(s.notes.id, note.id));
    } else if (note.statut === "A_REGLER") {
      await tx.update(s.notes).set({ statut: "OUVERTE" }).where(eq(s.notes.id, note.id));
    }
    return { resteCdf: nouveauResteCdf, resteUsd: nouveauResteUsd, reglee };
  });

  if (resultat.reglee) await solderVentesLieesDb(params.noteId, params.acteurId);
  return resultat;
}

// ---------------- Prise en charge : helpers (ANNEXE-3) ----------------

/** Expiration paresseuse (§2) : les demandes EN_ATTENTE dont le délai
 *  est dépassé passent EXPIREE et REMONTENT au gérant (alerte) qui
 *  peut trancher à la place de la serveuse. */
async function expirerPrisesDb(): Promise<void> {
  const expirees = await db().update(s.prisesEnCharge)
    .set({ statut: "EXPIREE" })
    .where(and(eq(s.prisesEnCharge.statut, "EN_ATTENTE"), sql`${s.prisesEnCharge.expireLe} < ${maintenant()}`))
    .returning({ id: s.prisesEnCharge.id, terrasseId: s.prisesEnCharge.terrasseId });
  for (const p of expirees) {
    await alerter(p.terrasseId, "PRISE_EN_CHARGE_EXPIREE",
      "Une demande de prise en charge a expiré sans réponse — au gérant de trancher.");
  }
}

interface LigneFiguee { id: string; libelle: string; quantite: number; montantCdf: number; montantUsd: number }

/** Acceptation d'une prise en charge : FIGE les lignes impayées de la
 *  note bénéficiaire (elles ne bougent plus) et, si le payeur est un
 *  client connu, les DÉPLACE sur sa note (§5 : la prise en charge
 *  déplace des lignes — l'encaissement reste cash / mobile manuel). */
async function accepterPriseEnChargeDb(pecId: string, decideur: string | null, roleDecideur: RoleActif | null) {
  const resultat = await db().transaction(async (tx) => {
    const [pec] = await tx.select().from(s.prisesEnCharge)
      .where(eq(s.prisesEnCharge.id, pecId)).limit(1).for("update");
    if (!pec) erreur("Demande introuvable.");
    if (pec.statut !== "EN_ATTENTE" && pec.statut !== "EXPIREE") erreur("Cette demande a déjà été tranchée.");
    const lignes = await tx.select().from(s.noteLignes)
      .where(and(eq(s.noteLignes.noteId, pec.noteBeneficiaireId), sql`${s.noteLignes.statut} <> 'ANNULEE'`,
        isNull(s.noteLignes.priseEnChargeId)));
    if (lignes.length === 0) erreur("Plus rien à prendre en charge sur cette note.");
    const figees: LigneFiguee[] = lignes.map((l) => ({
      id: l.id, libelle: l.libelle, quantite: l.quantite, montantCdf: l.montantCdf, montantUsd: l.montantUsd,
    }));
    const montantCdf = figees.reduce((x, l) => x + l.montantCdf, 0);
    const montantUsd = figees.reduce((x, l) => x + l.montantUsd, 0);
    const ids = figees.map((l) => l.id);
    if (pec.payeurClientId) {
      // Payeur client connu : les lignes sont DÉPLACÉES sur sa note.
      const [payeur] = await tx.select().from(s.clients).where(eq(s.clients.id, pec.payeurClientId)).limit(1);
      if (!payeur) erreur("Payeur introuvable.");
      const [notePayeurOuverte] = await tx.select().from(s.notes)
        .where(and(eq(s.notes.clientId, payeur.id), inArray(s.notes.statut, ["OUVERTE", "A_REGLER"]))).limit(1);
      let notePayeurId = notePayeurOuverte?.id ?? null;
      if (!notePayeurId) {
        notePayeurId = uid("not");
        await tx.insert(s.notes).values({
          id: notePayeurId, organisationId: payeur.organisationId, clientId: payeur.id,
          statut: "OUVERTE", ouverteLe: maintenant(), tauxUsdCdf: null,
        });
      }
      await tx.update(s.noteLignes)
        .set({ noteId: notePayeurId, priseEnChargeId: pec.id })
        .where(inArray(s.noteLignes.id, ids));
    } else {
      // Déclaré au comptoir : les lignes restent sur la note de la
      // bénéficiaire mais sont MARQUÉES — la serveuse encaisse le
      // payeur présent (annexe 3 §5 : encaissement cash existant).
      await tx.update(s.noteLignes)
        .set({ priseEnChargeId: pec.id })
        .where(inArray(s.noteLignes.id, ids));
    }
    await tx.update(s.prisesEnCharge).set({
      statut: "ACCEPTEE", lignes: figees, montantCdf, montantUsd,
      decidePar: decideur, decideLe: maintenant(),
    }).where(eq(s.prisesEnCharge.id, pec.id));
    return { pec, figees, montantCdf, montantUsd };
  });

  // Anti-abus (§3) : fréquence par serveuse et paire récurrente.
  if (decideur) {
    const debutJour = maintenant().slice(0, 10);
    const accepteesJour = await db().select({ id: s.prisesEnCharge.id }).from(s.prisesEnCharge)
      .where(and(eq(s.prisesEnCharge.decidePar, decideur), eq(s.prisesEnCharge.statut, "ACCEPTEE"),
        sql`${s.prisesEnCharge.decideLe} >= ${debutJour}`));
    if (accepteesJour.length >= SEUIL_PRISES_PAR_SERVEUSE_PAR_JOUR) {
      await alerter(resultat.pec.terrasseId, "PRISE_EN_CHARGE_ABUS",
        `Prises en charge inhabituelles : ${accepteesJour.length} acceptées aujourd'hui par le même employé.`);
    }
  }
  if (resultat.pec.payeurClientId) {
    const [noteBenef] = await db().select().from(s.notes).where(eq(s.notes.id, resultat.pec.noteBeneficiaireId)).limit(1);
    if (noteBenef) {
      const ilYA7j = ajouterJours(maintenant(), -7);
      const paires = await db().select({ id: s.prisesEnCharge.id }).from(s.prisesEnCharge)
        .innerJoin(s.notes, eq(s.prisesEnCharge.noteBeneficiaireId, s.notes.id))
        .where(and(
          eq(s.prisesEnCharge.payeurClientId, resultat.pec.payeurClientId),
          eq(s.notes.clientId, noteBenef.clientId),
          eq(s.prisesEnCharge.statut, "ACCEPTEE"),
          sql`${s.prisesEnCharge.decideLe} >= ${ilYA7j}`,
        ));
      if (paires.length >= SEUIL_PAIRE_PRISE_7J) {
        await alerter(resultat.pec.terrasseId, "PRISE_EN_CHARGE_ABUS",
          `Même paire payeur → bénéficiaire ${paires.length} fois en 7 jours — vérifier.`);
      }
    }
  }
  await journaliser(decideur, roleDecideur, "PRISE_EN_CHARGE_ACCEPTEE",
    `Note ${resultat.pec.noteBeneficiaireId} : ${resultat.figees.length} ligne(s) figée(s)`,
    { terrasseId: resultat.pec.terrasseId, apres: JSON.stringify(resultat.figees) });
  return resultat;
}

// ============================================================
// Endpoints
// ============================================================

export const notesRouter = createRouter({

  // ---------------- CLIENT (public, session d'appareil) ----------------

  /** À chaque scan : retrouve (ou crée) la note ouverte du client
   *  dans l'organisation du QR scanné (ANNEXE-2 §3). */
  ouvrirOuRetrouverNote: publicQuery
    .input(z.object({ token: z.string(), clientSessionId: z.string() }))
    .mutation(async ({ input }) => {
      const table = await resoudreTableParToken(input.token);
      if (!table) erreur("QR code invalide ou révoqué.");
      const client = await assurerClientDb(input.clientSessionId);
      if (!client) erreur("Session invalide — rescannez le QR code.");
      const taux = await tauxCourantDb(table.terrasseId);
      const note = await ouvrirOuRetrouverNoteDb(client, taux);
      const vue = await vueNoteDb(note, client.prenom);
      return vue;
    }),

  /** Écran « Ma note / Mon historique » (§4) : la note ouverte +
   *  les notes réglées passées du client reconnu. Le client ne voit
   *  QUE sa note (§2). */
  voirMaNote: publicQuery
    .input(z.object({ clientSessionId: z.string() }))
    .query(async ({ input }) => {
      const client = await clientDeSessionDb(input.clientSessionId);
      if (!client) return { note: null, historique: [] as NoteVue[], priseEnChargeRecue: null, telephone: false };
      await expirerPrisesDb();
      const note = await noteOuverteDb(client.id);
      // Proposition « quelqu'un paie pour vous » en attente (ANNEXE-3) :
      // montant et lignes figées visibles, JAMAIS l'identité du payeur.
      let priseEnChargeRecue: { id: string; nbLignes: number; montantCdf: number; montantUsd: number } | null = null;
      if (note) {
        const [pec] = await db().select().from(s.prisesEnCharge)
          .where(and(eq(s.prisesEnCharge.noteBeneficiaireId, note.id), eq(s.prisesEnCharge.statut, "EN_ATTENTE")))
          .orderBy(desc(s.prisesEnCharge.creeLe)).limit(1);
        if (pec) {
          // Montant PROPOSÉ = lignes encore prises en charge possibles
          // (calcul en direct ; le figé exact est fixé à l'acceptation).
          const lignesEligibles = await db().select().from(s.noteLignes)
            .where(and(eq(s.noteLignes.noteId, note.id), sql`${s.noteLignes.statut} <> 'ANNULEE'`,
              isNull(s.noteLignes.priseEnChargeId)));
          priseEnChargeRecue = {
            id: pec.id,
            nbLignes: lignesEligibles.length,
            montantCdf: lignesEligibles.reduce((x, l) => x + l.montantCdf, 0),
            montantUsd: lignesEligibles.reduce((x, l) => x + l.montantUsd, 0),
          };
        }
      }
      const reglees = await db().select().from(s.notes)
        .where(and(eq(s.notes.clientId, client.id), eq(s.notes.statut, "REGLEE")))
        .orderBy(desc(s.notes.regleeLe)).limit(10);
      const historique: NoteVue[] = [];
      for (const n of reglees) historique.push(await vueNoteDb(n, client.prenom));
      return { note: note ? await vueNoteDb(note, client.prenom) : null, historique, priseEnChargeRecue, telephone: client.telephone !== null };
    }),

  /** Le client déclare son téléphone pour retrouver sa note sur un
   *  autre appareil (§2 — le rattachement effectif reste validé par
   *  la serveuse : pas de SMS en v1). */
  declarerTelephone: publicQuery
    .input(z.object({ clientSessionId: z.string(), telephone: z.string().min(6).max(20) }))
    .mutation(async ({ input }) => {
      const client = await assurerClientDb(input.clientSessionId);
      if (!client) erreur("Session invalide — rescannez le QR code.");
      const tel = input.telephone.replace(/\D/g, "").replace(/^243/, "").replace(/^0/, "");
      if (tel.length < 9) erreur("Numéro de téléphone invalide.");
      if (client.telephone === tel) return { ok: true as const };
      if (client.telephone) erreur("Téléphone déjà renseigné — demandez à la serveuse pour le changer.");
      const [pris] = await db().select({ id: s.clients.id }).from(s.clients)
        .where(and(eq(s.clients.organisationId, client.organisationId), eq(s.clients.telephone, tel))).limit(1);
      if (pris) erreur("Ce numéro est déjà rattaché à un autre client — voyez la serveuse.");
      await db().update(s.clients).set({ telephone: tel }).where(eq(s.clients.id, client.id));
      return { ok: true as const };
    }),

  /** « Demander l'addition » (§5.2) : alerte le personnel des espaces
   *  où le client a consommé ; la note passe A_REGLER. */
  demanderAddition: publicQuery
    .input(z.object({ clientSessionId: z.string() }))
    .mutation(async ({ input }) => {
      const client = await clientDeSessionDb(input.clientSessionId);
      if (!client) erreur("Aucune note à régler.");
      const note = await noteOuverteDb(client.id);
      if (!note) erreur("Aucune note ouverte.");
      const sommes = await sommesNoteDb(note.id);
      if (sommes.resteCdf === 0 && sommes.resteUsd === 0) erreur("Rien à régler sur cette note.");
      await db().update(s.notes).set({ statut: "A_REGLER" })
        .where(and(eq(s.notes.id, note.id), eq(s.notes.statut, "OUVERTE")));
      const terrasses = [...new Set(sommes.lignes.filter((l) => l.statut !== "ANNULEE").map((l) => l.terrasseId))];
      for (const t of terrasses) {
        await alerter(t, "ADDITION_DEMANDEE",
          `${client.prenom} demande l'addition — reste ${sommes.resteCdf} FC / ${sommes.resteUsd} ¢.`);
      }
      return { ok: true as const };
    }),

  /** ANNEXE-3 §1.1 : le payeur déclare « je paie pour la table N »
   *  depuis son téléphone. La décision appartient à la bénéficiaire,
   *  enregistrée par la serveuse — jamais par le payeur. */
  proposerPriseEnCharge: publicQuery
    .input(z.object({ clientSessionId: z.string(), numeroTableBeneficiaire: z.string().min(1).max(10) }))
    .mutation(async ({ input }) => {
      const payeur = await assurerClientDb(input.clientSessionId);
      if (!payeur) erreur("Session invalide — rescannez le QR code.");
      const [sess] = await db().select().from(s.clientsSession)
        .where(eq(s.clientsSession.id, input.clientSessionId)).limit(1);
      const [tablePayeur] = await db().select().from(s.tablesQr).where(eq(s.tablesQr.id, sess?.tableId ?? "")).limit(1);
      if (!tablePayeur) erreur("Table d'origine introuvable.");
      const numeroBenef = Number.parseInt(input.numeroTableBeneficiaire, 10);
      if (!Number.isInteger(numeroBenef)) erreur(`Aucune table « ${input.numeroTableBeneficiaire} » ici.`);
      const [tableBenef] = await db().select().from(s.tablesQr)
        .where(and(eq(s.tablesQr.terrasseId, tablePayeur.terrasseId), eq(s.tablesQr.numero, numeroBenef)))
        .limit(1);
      if (!tableBenef) erreur(`Aucune table « ${input.numeroTableBeneficiaire} » ici.`);
      const [sessBenef] = await db().select().from(s.clientsSession)
        .where(eq(s.clientsSession.tableId, tableBenef.id)).orderBy(desc(s.clientsSession.creeLe)).limit(1);
      if (!sessBenef) erreur("Personne n'a scanné cette table — voyez la serveuse.");
      const beneficiaire = await clientDeSessionDb(sessBenef.id);
      if (!beneficiaire) erreur("La table n'a pas de note — voyez la serveuse.");
      if (beneficiaire.id === payeur.id) erreur("C'est votre propre table.");
      const note = await noteOuverteDb(beneficiaire.id);
      if (!note) erreur("La table n'a pas de note ouverte — la serveuse peut l'ouvrir.");
      const sommes = await sommesNoteDb(note.id);
      if (sommes.resteCdf === 0 && sommes.resteUsd === 0) erreur("Rien à payer sur cette note.");
      await expirerPrisesDb();
      const [deja] = await db().select({ id: s.prisesEnCharge.id }).from(s.prisesEnCharge)
        .where(and(eq(s.prisesEnCharge.noteBeneficiaireId, note.id), eq(s.prisesEnCharge.statut, "EN_ATTENTE"))).limit(1);
      if (deja) erreur("Une demande est déjà en attente pour cette table.");
      // Anti-abus : un payeur ne multiplie pas les demandes du jour.
      const debutJour = maintenant().slice(0, 10);
      const duJour = await db().select({ id: s.prisesEnCharge.id }).from(s.prisesEnCharge)
        .where(and(eq(s.prisesEnCharge.payeurClientId, payeur.id), sql`${s.prisesEnCharge.creeLe} >= ${debutJour}`));
      if (duJour.length >= SEUIL_PRISES_PAR_SERVEUSE_PAR_JOUR) {
        erreur("Trop de demandes aujourd'hui — voyez le gérant.");
      }
      const [terrasse] = await db().select().from(s.terrasses).where(eq(s.terrasses.id, tablePayeur.terrasseId)).limit(1);
      const id = uid("pec");
      const expireLe = new Date(Date.now() + EXPIRATION_PRISE_EN_CHARGE_MIN * 60_000).toISOString();
      await db().insert(s.prisesEnCharge).values({
        id, organisationId: terrasse?.organisationId ?? "", terrasseId: tablePayeur.terrasseId,
        noteBeneficiaireId: note.id, payeurClientId: payeur.id, proposePar: input.clientSessionId,
        lignes: [], montantCdf: 0, montantUsd: 0, statut: "EN_ATTENTE", expireLe, creeLe: maintenant(),
      });
      await alerter(tablePayeur.terrasseId, "PRISE_EN_CHARGE",
        `Prise en charge proposée pour la table ${tableBenef.numero} — accord de la cliente à recueillir.`);
      await journaliser(null, "CLIENT", "PRISE_EN_CHARGE_PROPOSEE", `Table ${tableBenef.numero}`,
        { terrasseId: tablePayeur.terrasseId });
      return { id };
    }),

  /** Confort (ANNEXE-3 §4, jamais une obligation) : la bénéficiaire
   *  qui a scanné le QR peut accepter/refuser ELLE-MÊME depuis son
   *  téléphone. La voie serveuse reste la voie par défaut. */
  deciderPriseEnChargeCliente: publicQuery
    .input(z.object({ id: z.string(), clientSessionId: z.string(), decision: z.enum(["ACCEPTEE", "REFUSEE"]) }))
    .mutation(async ({ input }) => {
      await expirerPrisesDb();
      const client = await clientDeSessionDb(input.clientSessionId);
      if (!client) erreur("Session invalide.");
      const [pec] = await db().select().from(s.prisesEnCharge).where(eq(s.prisesEnCharge.id, input.id)).limit(1);
      if (!pec) erreur("Demande introuvable.");
      const [note] = await db().select().from(s.notes).where(eq(s.notes.id, pec.noteBeneficiaireId)).limit(1);
      if (!note || note.clientId !== client.id) erreur("Cette demande ne concerne pas votre note.");
      if (pec.statut !== "EN_ATTENTE") erreur("Cette demande n'est plus en attente.");
      if (input.decision === "ACCEPTEE") {
        await accepterPriseEnChargeDb(pec.id, null, "CLIENT");
      } else {
        await db().update(s.prisesEnCharge).set({ statut: "REFUSEE", decideLe: maintenant() })
          .where(eq(s.prisesEnCharge.id, pec.id));
        await journaliser(null, "CLIENT", "PRISE_EN_CHARGE_REFUSEE", `Note ${pec.noteBeneficiaireId}`,
          { terrasseId: pec.terrasseId });
      }
      return { ok: true as const };
    }),

  // ---------------- PERSONNEL (protégé) ----------------

  /** Notes ouvertes de l'organisation (écran « à encaisser »).
   *  Confidentialité §2 : les notes de chambre ne remontent qu'à la
   *  réception et à la gérance. */
  notesOuvertes: protegee
    .input(z.object({ terrasseId: z.string() }))
    .query(async ({ input, ctx }) => {
      const [terrasse] = await db().select().from(s.terrasses).where(eq(s.terrasses.id, input.terrasseId)).limit(1);
      if (!terrasse) erreur("Établissement introuvable.");
      const role = await exigerRoleOrganisation(ctx.session.utilisateurId, terrasse.organisationId,
        ROLES_ENCAISSEMENT, "Consultation des notes ouvertes");
      const liste = await db().select().from(s.notes)
        .where(and(eq(s.notes.organisationId, terrasse.organisationId),
          inArray(s.notes.statut, ["OUVERTE", "A_REGLER", "LITIGE"])))
        .orderBy(desc(s.notes.ouverteLe)).limit(200);
      const reception = (ROLES_RECEPTION as readonly string[]).includes(role);
      const vues: NoteVue[] = [];
      for (const n of liste) {
        if (n.sejourId && !reception) continue; // note de chambre : réception/gérance seules
        const [client] = await db().select().from(s.clients).where(eq(s.clients.id, n.clientId)).limit(1);
        vues.push(await vueNoteDb(n, client?.prenom ?? "?"));
      }
      return vues;
    }),

  /** Détail d'une note pour l'écran d'encaissement (mêmes règles de
   *  confidentialité que notesOuvertes). */
  voirNote: protegee
    .input(z.object({ noteId: z.string() }))
    .query(async ({ input, ctx }) => {
      const [note] = await db().select().from(s.notes).where(eq(s.notes.id, input.noteId)).limit(1);
      if (!note) erreur("Note introuvable.");
      const role = await exigerRoleOrganisation(ctx.session.utilisateurId, note.organisationId,
        ROLES_ENCAISSEMENT, "Consultation de note");
      if (note.sejourId && !(ROLES_RECEPTION as readonly string[]).includes(role)) {
        await journaliser(ctx.session.utilisateurId, role, "ACCES_REFUSE", "Note de chambre : réception/gérance seules",
          { terrasseId: undefined });
        erreur("Note de chambre : réception ou gérance uniquement.");
      }
      const [client] = await db().select().from(s.clients).where(eq(s.clients.id, note.clientId)).limit(1);
      return vueNoteDb(note, client?.prenom ?? "?");
    }),

  /** Encaisser (§5) : tout employé autorisé de l'organisation ;
   *  EXCEPTION chambre : réception ou gérance seulement. Acompte
   *  accepté (§5.5) : la note ne passe REGLEE qu'à solde zéro. */
  encaisserNote: protegee
    .input(z.object({
      noteId: z.string(),
      montantCdf: z.number().int().min(0).default(0),
      montantUsd: z.number().int().min(0).default(0),
      mode: z.enum(["CASH", "MOBILE_MONEY"]),
      referenceMobile: z.string().max(30).optional(),
      pourboireCdf: z.number().int().min(0).default(0),
      pourboireUsd: z.number().int().min(0).default(0),
    }))
    .mutation(async ({ input, ctx }) => {
      const [note] = await db().select().from(s.notes).where(eq(s.notes.id, input.noteId)).limit(1);
      if (!note) erreur("Note introuvable.");
      const role = await exigerRoleOrganisation(ctx.session.utilisateurId, note.organisationId,
        note.sejourId ? ROLES_RECEPTION : ROLES_ENCAISSEMENT, "Encaissement de note");
      const r = await encaisserNoteDb({
        noteId: note.id, acteurId: ctx.session.utilisateurId,
        montantCdf: input.montantCdf, montantUsd: input.montantUsd, mode: input.mode,
        referenceMobile: input.referenceMobile ?? null,
        pourboireCdf: input.pourboireCdf, pourboireUsd: input.pourboireUsd,
      });
      await journaliser(ctx.session.utilisateurId, role, "ENCAISSEMENT_NOTE",
        `Note ${note.id} : ${input.montantCdf} FC / ${input.montantUsd} ¢ (${input.mode})${r.reglee ? " — SOLDÉE" : ""}`,
        { terrasseId: undefined });
      return r;
    }),

  /** « Ma caisse » (§5.11) : cash actuellement EN_MAIN de l'employé +
   *  pourboires du jour (hors CA). */
  maCaisse: protegee
    .query(async ({ ctx }) => {
      const enMain = await db().select().from(s.encaissements)
        .where(and(eq(s.encaissements.encaisseParId, ctx.session.utilisateurId),
          eq(s.encaissements.statut, "EN_MAIN")));
      const debutJour = maintenant().slice(0, 10);
      const tips = await db().select().from(s.pourboires)
        .where(and(eq(s.pourboires.employeId, ctx.session.utilisateurId),
          sql`${s.pourboires.creeLe} >= ${debutJour}`));
      return {
        enMainCdf: enMain.reduce((x, e) => x + e.montantCdf, 0),
        enMainUsd: enMain.reduce((x, e) => x + e.montantUsd, 0),
        pourboiresCdf: tips.reduce((x, p) => x + p.montantCdf, 0),
        pourboiresUsd: tips.reduce((x, p) => x + p.montantUsd, 0),
        nbEnMain: enMain.length,
      };
    }),

  /** Remise de caisse (§5.6) : l'employé remet TOUT son cash EN_MAIN
   *  de l'organisation ; le montant attendu est figé à la déclaration. */
  remettreCaisse: protegee
    .input(z.object({ terrasseId: z.string() }))
    .mutation(async ({ input, ctx }) => {
      const [terrasse] = await db().select().from(s.terrasses).where(eq(s.terrasses.id, input.terrasseId)).limit(1);
      if (!terrasse) erreur("Établissement introuvable.");
      const role = await exigerRoleOrganisation(ctx.session.utilisateurId, terrasse.organisationId,
        ROLES_ENCAISSEMENT, "Remise de caisse");
      // Une remise déjà EN_ATTENTE couvre le cash en main : pas de
      // seconde déclaration avant validation par le receveur.
      const [enAttente] = await db().select({ id: s.remisesCaisse.id }).from(s.remisesCaisse)
        .where(and(eq(s.remisesCaisse.employeId, ctx.session.utilisateurId),
          eq(s.remisesCaisse.organisationId, terrasse.organisationId),
          eq(s.remisesCaisse.statut, "EN_ATTENTE"))).limit(1);
      if (enAttente) erreur("Une remise est déjà en attente de validation par le receveur.");
      const enMain = await db().select().from(s.encaissements)
        .where(and(eq(s.encaissements.encaisseParId, ctx.session.utilisateurId),
          eq(s.encaissements.organisationId, terrasse.organisationId),
          eq(s.encaissements.statut, "EN_MAIN"),
          sql`${s.encaissements.remiseId} IS NULL`));
      if (enMain.length === 0) erreur("Aucun cash en main à remettre.");
      const attenduCdf = enMain.reduce((x, e) => x + e.montantCdf, 0);
      const attenduUsd = enMain.reduce((x, e) => x + e.montantUsd, 0);
      const remiseId = uid("rem");
      await db().transaction(async (tx) => {
        await tx.insert(s.remisesCaisse).values({
          id: remiseId, organisationId: terrasse.organisationId, employeId: ctx.session.utilisateurId,
          attenduCdf, attenduUsd, statut: "EN_ATTENTE", creeLe: maintenant(),
        });
        await tx.update(s.encaissements).set({ remiseId })
          .where(and(eq(s.encaissements.encaisseParId, ctx.session.utilisateurId),
            eq(s.encaissements.organisationId, terrasse.organisationId),
            eq(s.encaissements.statut, "EN_MAIN"),
            sql`${s.encaissements.remiseId} IS NULL`));
      });
      await journaliser(ctx.session.utilisateurId, role, "REMISE_CAISSE_DECLAREE",
        `${attenduCdf} FC / ${attenduUsd} ¢ à remettre`);
      return { id: remiseId, attenduCdf, attenduUsd };
    }),

  /** Remises en attente de validation (écran gérant, §5.6). */
  remisesEnAttente: protegee
    .input(z.object({ terrasseId: z.string() }))
    .query(async ({ input, ctx }) => {
      const [terrasse] = await db().select().from(s.terrasses).where(eq(s.terrasses.id, input.terrasseId)).limit(1);
      if (!terrasse) erreur("Établissement introuvable.");
      await exigerRoleOrganisation(ctx.session.utilisateurId, terrasse.organisationId,
        ROLES_GERANCE, "Validation des remises");
      const remises = await db().select().from(s.remisesCaisse)
        .where(and(eq(s.remisesCaisse.organisationId, terrasse.organisationId),
          eq(s.remisesCaisse.statut, "EN_ATTENTE")))
        .orderBy(asc(s.remisesCaisse.creeLe));
      const noms = new Map<string, string>();
      for (const r of remises) {
        if (!noms.has(r.employeId)) {
          const [u] = await db().select({ nom: s.utilisateurs.nom }).from(s.utilisateurs)
            .where(eq(s.utilisateurs.id, r.employeId)).limit(1);
          noms.set(r.employeId, u?.nom ?? "?");
        }
      }
      return remises.map((r) => ({ ...r, employeNom: noms.get(r.employeId) ?? "?" }));
    }),

  /** Validation PAR LE RECEVEUR (§5.6) : attendu vs reçu ; tout écart
   *  exige un motif et déclenche l'alerte propriétaire immédiate. */
  validerRemise: protegee
    .input(z.object({
      remiseId: z.string(),
      recuCdf: z.number().int().min(0),
      recuUsd: z.number().int().min(0),
      motif: z.string().max(200).default(""),
    }))
    .mutation(async ({ input, ctx }) => {
      const [remise] = await db().select().from(s.remisesCaisse)
        .where(eq(s.remisesCaisse.id, input.remiseId)).limit(1);
      if (!remise) erreur("Remise introuvable.");
      const role = await exigerRoleOrganisation(ctx.session.utilisateurId, remise.organisationId,
        ROLES_GERANCE, "Validation de remise");
      if (remise.statut !== "EN_ATTENTE") erreur("Cette remise a déjà été validée.");
      if (remise.employeId === ctx.session.utilisateurId) {
        erreur("Le receveur ne peut pas valider sa propre remise.");
      }
      const ecart = input.recuCdf !== remise.attenduCdf || input.recuUsd !== remise.attenduUsd;
      if (ecart && !input.motif.trim()) erreur("Un écart exige un motif.");
      await db().transaction(async (tx) => {
        await tx.update(s.remisesCaisse).set({
          statut: ecart ? "ECART" : "VALIDEE", recuCdf: input.recuCdf, recuUsd: input.recuUsd,
          validePar: ctx.session.utilisateurId, valideLe: maintenant(),
          motifEcart: ecart ? input.motif.trim() : null,
        }).where(eq(s.remisesCaisse.id, remise.id));
        await tx.update(s.encaissements)
          .set({ statut: ecart ? "ECART" : "REMIS", remisLe: maintenant() })
          .where(eq(s.encaissements.remiseId, remise.id));
      });
      if (ecart) {
        const terrasses = await db().select({ id: s.terrasses.id }).from(s.terrasses)
          .where(eq(s.terrasses.organisationId, remise.organisationId));
        for (const t of terrasses) {
          await alerter(t.id, "ECART_REMISE",
            `Écart de remise de caisse : attendu ${remise.attenduCdf} FC / ${remise.attenduUsd} ¢, reçu ${input.recuCdf} FC / ${input.recuUsd} ¢ — ${input.motif.trim()}`);
        }
      }
      await journaliser(ctx.session.utilisateurId, role, ecart ? "REMISE_ECART" : "REMISE_VALIDEE",
        `Remise ${remise.id} : attendu ${remise.attenduCdf}/${remise.attenduUsd}, reçu ${input.recuCdf}/${input.recuUsd}`,
        { avant: `attendu ${remise.attenduCdf}/${remise.attenduUsd}`, apres: `reçu ${input.recuCdf}/${input.recuUsd}` });
      return { ok: true as const, ecart };
    }),

  /** Client parti sans payer (§5.3) : la note passe LITIGE et n'est
   *  JAMAIS supprimée ; motif obligatoire, tracé au journal. */
  declarerLitige: protegee
    .input(z.object({ noteId: z.string(), motif: z.string().min(3).max(200) }))
    .mutation(async ({ input, ctx }) => {
      const [note] = await db().select().from(s.notes).where(eq(s.notes.id, input.noteId)).limit(1);
      if (!note) erreur("Note introuvable.");
      const role = await exigerRoleOrganisation(ctx.session.utilisateurId, note.organisationId,
        ROLES_GERANCE, "Déclaration de litige");
      if (note.statut !== "OUVERTE" && note.statut !== "A_REGLER") erreur("Seule une note ouverte passe en litige.");
      await db().update(s.notes).set({
        statut: "LITIGE", motifLitige: input.motif.trim(),
        litigeLe: maintenant(), litigeDeclarePar: ctx.session.utilisateurId,
      }).where(eq(s.notes.id, note.id));
      const sommes = await sommesNoteDb(note.id);
      const terrasses = [...new Set(sommes.lignes.map((l) => l.terrasseId))];
      for (const t of terrasses) {
        await alerter(t, "NOTE_LITIGE",
          `Client parti sans payer : ${sommes.resteCdf} FC / ${sommes.resteUsd} ¢ — ${input.motif.trim()}`);
      }
      await journaliser(ctx.session.utilisateurId, role, "NOTE_LITIGE",
        `Note ${note.id} : ${input.motif.trim()}`, { terrasseId: terrasses[0] ?? null });
      return { ok: true as const };
    }),

  /** Fusion de deux notes ouvertes (§101) : lignes ET encaissements
   *  déplacés vers la note cible ; la source passe FUSIONNEE (ligne
   *  conservée pour l'audit). Validation serveuse obligatoire. */
  fusionnerNotes: protegee
    .input(z.object({ noteSourceId: z.string(), noteCibleId: z.string() }))
    .mutation(async ({ input, ctx }) => {
      if (input.noteSourceId === input.noteCibleId) erreur("Même note des deux côtés.");
      const [source] = await db().select().from(s.notes).where(eq(s.notes.id, input.noteSourceId)).limit(1);
      const [cible] = await db().select().from(s.notes).where(eq(s.notes.id, input.noteCibleId)).limit(1);
      if (!source || !cible) erreur("Note introuvable.");
      if (source.organisationId !== cible.organisationId) erreur("Fusion impossible entre deux organisations.");
      const role = await exigerRoleOrganisation(ctx.session.utilisateurId, source.organisationId,
        ROLES_ENCAISSEMENT, "Fusion de notes");
      if (!["OUVERTE", "A_REGLER"].includes(source.statut) || !["OUVERTE", "A_REGLER"].includes(cible.statut)) {
        erreur("Seules des notes ouvertes peuvent être fusionnées.");
      }
      await db().transaction(async (tx) => {
        // Verrous dans un ordre stable : pas d'interblocage.
        const ids = [source.id, cible.id].sort();
        for (const nid of ids) {
          await tx.select({ id: s.notes.id }).from(s.notes).where(eq(s.notes.id, nid)).for("update");
        }
        await tx.update(s.noteLignes).set({ noteId: cible.id }).where(eq(s.noteLignes.noteId, source.id));
        await tx.update(s.encaissements).set({ noteId: cible.id }).where(eq(s.encaissements.noteId, source.id));
        await tx.update(s.notes).set({ statut: "FUSIONNEE", regleeLe: maintenant() }).where(eq(s.notes.id, source.id));
      });
      await journaliser(ctx.session.utilisateurId, role, "NOTES_FUSIONNEES",
        `Note ${source.id} fusionnée dans ${cible.id}`,
        { avant: source.id, apres: cible.id });
      return { ok: true as const };
    }),

  /** Récupération d'un client sur un autre appareil (§2) : pas de SMS
   *  en v1 — la serveuse valide et rattache l'appareil au client qui
   *  a ce téléphone. */
  rattacherAppareil: protegee
    .input(z.object({ terrasseId: z.string(), telephone: z.string().min(6).max(20), clientSessionId: z.string() }))
    .mutation(async ({ input, ctx }) => {
      const [terrasse] = await db().select().from(s.terrasses).where(eq(s.terrasses.id, input.terrasseId)).limit(1);
      if (!terrasse) erreur("Établissement introuvable.");
      const role = await exigerRoleOrganisation(ctx.session.utilisateurId, terrasse.organisationId,
        ROLES_ENCAISSEMENT, "Rattachement d'appareil");
      const tel = input.telephone.replace(/\D/g, "").replace(/^243/, "").replace(/^0/, "");
      const [client] = await db().select().from(s.clients)
        .where(and(eq(s.clients.organisationId, terrasse.organisationId), eq(s.clients.telephone, tel))).limit(1);
      if (!client) erreur("Aucun client avec ce numéro dans cette organisation.");
      const [sess] = await db().select().from(s.clientsSession)
        .where(eq(s.clientsSession.id, input.clientSessionId)).limit(1);
      if (!sess) erreur("Session d'appareil introuvable.");
      await db().insert(s.clientAppareils)
        .values({ clientSessionId: input.clientSessionId, clientId: client.id, creeLe: maintenant() })
        .onConflictDoNothing();
      await journaliser(ctx.session.utilisateurId, role, "APPAREIL_RATTACHE",
        `Appareil rattaché au client ${client.id}`);
      return { ok: true as const, prenom: client.prenom };
    }),

  /** Client en chambre (§3) : la réception rattache la note du séjour
   *  à l'appareil du client (il voit alors sa note depuis le QR de la
   *  chambre). */
  lierNoteSejour: protegee
    .input(z.object({ sejourId: z.string(), clientSessionId: z.string() }))
    .mutation(async ({ input, ctx }) => {
      const [sejour] = await db().select().from(s.sejours).where(eq(s.sejours.id, input.sejourId)).limit(1);
      if (!sejour) erreur("Séjour introuvable.");
      const [terrasse] = await db().select().from(s.terrasses).where(eq(s.terrasses.id, sejour.terrasseId)).limit(1);
      if (!terrasse) erreur("Établissement introuvable.");
      const role = await exigerRoleOrganisation(ctx.session.utilisateurId, terrasse.organisationId,
        ROLES_RECEPTION, "Liaison note de chambre");
      const [note] = await db().select().from(s.notes).where(eq(s.notes.sejourId, sejour.id)).limit(1);
      if (!note) erreur("Aucune note liée à ce séjour.");
      const client = await assurerClientDb(input.clientSessionId);
      if (!client) erreur("Session d'appareil introuvable.");
      await db().update(s.notes).set({ clientId: client.id }).where(eq(s.notes.id, note.id));
      await journaliser(ctx.session.utilisateurId, role, "NOTE_SEJOUR_LIEE",
        `Note ${note.id} rattachée au client ${client.id}`);
      return { ok: true as const };
    }),

  /** Paramètres anti-fraude (§6) : plafond de note impayée et
   *  exception « token sur note ». Gérance seulement. NULL = pas de
   *  plafond (comportement historique inchangé). */
  configurerNote: protegee
    .input(z.object({
      terrasseId: z.string(),
      notePlafondCdf: z.number().int().positive().nullable(),
      tokenSurNote: z.boolean(),
    }))
    .mutation(async ({ input, ctx }) => {
      const role = await exigerRoleOrganisationTerrasse(ctx.session.utilisateurId, input.terrasseId,
        ROLES_GERANCE, "Paramétrage de la note");
      await db().update(s.terrasses).set({
        notePlafondCdf: input.notePlafondCdf, tokenSurNote: input.tokenSurNote,
      }).where(eq(s.terrasses.id, input.terrasseId));
      await journaliser(ctx.session.utilisateurId, role, "CONFIG_NOTE",
        `Plafond ${input.notePlafondCdf ?? "aucun"} FC, token sur note ${input.tokenSurNote ? "activé" : "désactivé"}`,
        { terrasseId: input.terrasseId });
      return { ok: true as const };
    }),

  /** Billard automatique (ANNEXE-2 §6) : le token entre EN FILE
   *  immédiatement, sans encaissement préalable — il est mis SUR LA
   *  NOTE. Réservé aux clients en chambre (garantis par le folio) ou,
   *  si le gérant l'a activé, aux clients dont la note reste sous le
   *  plafond configuré. */
  acheterTokenSurNote: publicQuery
    .input(z.object({ token: z.string(), clientSessionId: z.string() }))
    .mutation(async ({ input }) => {
      const table = await resoudreTableParToken(input.token);
      if (!table || table.kind !== "BILLARD") erreur("QR de billard invalide.");
      const [terrasse] = await db().select().from(s.terrasses).where(eq(s.terrasses.id, table.terrasseId)).limit(1);
      if (!terrasse) erreur("Établissement introuvable.");
      const client = await assurerClientDb(input.clientSessionId);
      if (!client) erreur("Session invalide — rescannez le QR code.");
      const note = await noteOuverteDb(client.id);
      const enChambre = note?.sejourId != null;
      if (!enChambre && !terrasse.tokenSurNote) {
        erreur("Le token sur note n'est pas activé ici — payez d'abord à la serveuse.");
      }
      const sommes = note ? await sommesNoteDb(note.id) : null;
      const [config] = await db().select().from(s.configBillard)
        .where(eq(s.configBillard.terrasseId, table.terrasseId)).limit(1);
      const prix = config?.prixTokenCdf ?? 5000;
      await exigerTelephoneSiGrosseNoteDb(input.clientSessionId, prix);
      if (!enChambre && terrasse.notePlafondCdf !== null && sommes
        && sommes.resteCdf + prix > terrasse.notePlafondCdf) {
        erreur("Plafond de note atteint — réglez d'abord une partie auprès de la serveuse.");
      }
      // Numéro du jour par billard (même convention que billard.ts).
      const debutJour = maintenant().slice(0, 10);
      const duJour = await db().select({ numero: s.tokensBillard.numero }).from(s.tokensBillard)
        .where(and(eq(s.tokensBillard.tableId, table.id), sql`${s.tokensBillard.creeLe} >= ${debutJour}`));
      const numero = duJour.reduce((m, t) => Math.max(m, t.numero), 0) + 1;
      const taux = await tauxCourantDb(table.terrasseId);
      const tokenId = uid("tok");
      const maintenantIso = maintenant();
      await db().insert(s.tokensBillard).values({
        id: tokenId, terrasseId: table.terrasseId, tableId: table.id, numero,
        clientSessionId: input.clientSessionId, prenom: client.prenom, prixCdf: prix,
        statut: "EN_FILE", serie: 0, creeLe: maintenantIso, entreeFileLe: maintenantIso,
        surNote: true, tauxUsdCdf: taux,
      });
      await ajouterLignesNoteDb({
        clientSessionId: input.clientSessionId, terrasseId: table.terrasseId, espace: "BILLARD",
        type: "TOKEN_BILLARD", creeParId: null,
        lignes: [{
          refId: tokenId, libelle: `Token billard n°${numero}`, quantite: 1,
          montantCdf: prix, montantUsd: 0, statut: "CONFIRMEE", tauxUsdCdf: taux,
        }],
      });
      await journaliser(null, "CLIENT", "TOKEN_SUR_NOTE",
        `Token n°${numero} sur note (${client.prenom})`, { terrasseId: table.terrasseId });
      return { id: tokenId, numero };
    }),

  // ---------------- « Payer pour quelqu'un » — voie serveuse ----------------

  /** La serveuse ouvre la demande pour la bénéficiaire (§2 : si la
   *  table n'a pas de note, la serveuse l'ouvre à ce moment-là ; une
   *  note SANS lignes refuse la demande). */
  proposerPriseEnChargeComptoir: protegee
    .input(z.object({ noteId: z.string() }))
    .mutation(async ({ input, ctx }) => {
      const [note] = await db().select().from(s.notes).where(eq(s.notes.id, input.noteId)).limit(1);
      if (!note) erreur("Note introuvable.");
      const role = await exigerRoleOrganisation(ctx.session.utilisateurId, note.organisationId,
        ROLES_DECISION_PEC, "Prise en charge au comptoir");
      if (note.statut !== "OUVERTE" && note.statut !== "A_REGLER") erreur("La note n'est pas ouverte.");
      const sommes = await sommesNoteDb(note.id);
      const lignesAPrendre = sommes.lignes.filter((l) => l.statut !== "ANNULEE" && !l.priseEnChargeId);
      if (lignesAPrendre.length === 0) erreur("Note sans lignes à prendre en charge.");
      await expirerPrisesDb();
      const [deja] = await db().select({ id: s.prisesEnCharge.id }).from(s.prisesEnCharge)
        .where(and(eq(s.prisesEnCharge.noteBeneficiaireId, note.id), eq(s.prisesEnCharge.statut, "EN_ATTENTE"))).limit(1);
      if (deja) erreur("Une demande est déjà en attente pour cette note.");
      const id = uid("pec");
      const terrasseId = lignesAPrendre[0]?.terrasseId ?? "";
      const expireLe = new Date(Date.now() + EXPIRATION_PRISE_EN_CHARGE_MIN * 60_000).toISOString();
      await db().insert(s.prisesEnCharge).values({
        id, organisationId: note.organisationId, terrasseId,
        noteBeneficiaireId: note.id, payeurClientId: null, proposePar: ctx.session.utilisateurId,
        lignes: [], statut: "EN_ATTENTE", expireLe, creeLe: maintenant(),
      });
      await journaliser(ctx.session.utilisateurId, role, "PRISE_EN_CHARGE_PROPOSEE_COMPTOIR",
        `Note ${note.id} (déclaré au comptoir)`, { terrasseId });
      return { id };
    }),

  /** Demandes visibles du personnel de la zone : EN_ATTENTE pour les
   *  serveuses, + EXPIREE pour la gérance (§2 : remontée au gérant). */
  prisesEnChargeEnCours: protegee
    .input(z.object({ terrasseId: z.string() }))
    .query(async ({ input, ctx }) => {
      const [terrasse] = await db().select().from(s.terrasses).where(eq(s.terrasses.id, input.terrasseId)).limit(1);
      if (!terrasse) erreur("Établissement introuvable.");
      const role = await exigerRoleOrganisation(ctx.session.utilisateurId, terrasse.organisationId,
        ROLES_DECISION_PEC, "Consultation des prises en charge");
      await expirerPrisesDb();
      const statuts = (ROLES_GERANCE as readonly string[]).includes(role)
        ? ["EN_ATTENTE", "EXPIREE"] as const
        : ["EN_ATTENTE"] as const;
      const liste = await db().select().from(s.prisesEnCharge)
        .where(and(eq(s.prisesEnCharge.organisationId, terrasse.organisationId),
          inArray(s.prisesEnCharge.statut, [...statuts])))
        .orderBy(desc(s.prisesEnCharge.creeLe)).limit(50);
      // JAMAIS d'identité du payeur (§1.2) : lignes + total + note.
      const resultat = [];
      for (const p of liste) {
        const sommes = await sommesNoteDb(p.noteBeneficiaireId);
        const [note] = await db().select().from(s.notes).where(eq(s.notes.id, p.noteBeneficiaireId)).limit(1);
        const [benef] = note
          ? await db().select().from(s.clients).where(eq(s.clients.id, note.clientId)).limit(1)
          : [null];
        resultat.push({
          id: p.id, statut: p.statut, expireLe: p.expireLe, creeLe: p.creeLe,
          noteId: p.noteBeneficiaireId,
          prenomBeneficiaire: benef?.prenom ?? "?",
          resteCdf: sommes.resteCdf, resteUsd: sommes.resteUsd,
          nbLignes: sommes.lignes.filter((l) => l.statut !== "ANNULEE" && !l.priseEnChargeId).length,
        });
      }
      return resultat;
    }),

  /** La serveuse de la zone (ou le gérant) enregistre la décision de
   *  la bénéficiaire — prise DE VIVE VOIX (§1.3). Sur EXPIREE, seule
   *  la gérance peut encore trancher (§2). */
  deciderPriseEnCharge: protegee
    .input(z.object({ id: z.string(), decision: z.enum(["ACCEPTEE", "REFUSEE"]) }))
    .mutation(async ({ input, ctx }) => {
      await expirerPrisesDb();
      const [pec] = await db().select().from(s.prisesEnCharge).where(eq(s.prisesEnCharge.id, input.id)).limit(1);
      if (!pec) erreur("Demande introuvable.");
      const role = await exigerRoleOrganisation(ctx.session.utilisateurId, pec.organisationId,
        ROLES_DECISION_PEC, "Décision de prise en charge");
      if (pec.statut === "EXPIREE" && !(ROLES_GERANCE as readonly string[]).includes(role)) {
        erreur("Demande expirée — seul le gérant peut encore trancher.");
      }
      if (pec.statut !== "EN_ATTENTE" && pec.statut !== "EXPIREE") erreur("Cette demande a déjà été tranchée.");
      if (input.decision === "ACCEPTEE") {
        await accepterPriseEnChargeDb(pec.id, ctx.session.utilisateurId, role);
      } else {
        await db().update(s.prisesEnCharge).set({
          statut: "REFUSEE", decidePar: ctx.session.utilisateurId, decideLe: maintenant(),
        }).where(eq(s.prisesEnCharge.id, pec.id));
        await journaliser(ctx.session.utilisateurId, role, "PRISE_EN_CHARGE_REFUSEE",
          `Note ${pec.noteBeneficiaireId}`, { terrasseId: pec.terrasseId });
      }
      return { ok: true as const };
    }),
});

/** Variante par terrasse pour configurerNote (rôle sur CETTE
 *  terrasse, pas n'importe laquelle de l'organisation). */
async function exigerRoleOrganisationTerrasse(
  acteurId: string, terrasseId: string, autorises: readonly string[], quoi: string,
): Promise<RoleActif> {
  const [terrasse] = await db().select().from(s.terrasses).where(eq(s.terrasses.id, terrasseId)).limit(1);
  if (!terrasse) erreur("Établissement introuvable.");
  return exigerRoleOrganisation(acteurId, terrasse.organisationId, autorises, quoi);
}
