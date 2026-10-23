// ============================================================
// GBS — Magasin de données CONNECTÉ : la base vit sur le
// serveur (MySQL partagé entre tous les appareils). Le frontend
// interroge une image filtrée par portée (polling ~4 s) et
// appelle les actions métier du serveur. C'est ce qui fait
// fonctionner les QR codes et les invitations d'un appareil
// à l'autre.
// ============================================================

/* eslint-disable react-refresh/only-export-components --
 * Ce module EST un magasin d'actions/sélecteurs (aucun composant) :
 * la règle fast-refresh, pensée pour les fichiers de composants,
 * n'y a pas de sens. Chaque fonction exportée y déclenchait une
 * erreur (95 au fil du temps) sans signal réel. */

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { createTRPCClient, httpBatchLink, TRPCClientError } from '@trpc/client'
import superjson from 'superjson'
import { toast } from 'sonner'
import type { AppRouter } from '../../api/router'
import { trpc } from '@/providers/trpc'
import { enteteAuth, ecrireSessionBrute, lireSession } from './sessionLocale'
import { idAppareil } from './appareil'
import { fetchAvecEtag } from './fetchEtag'
import { naviguer } from './router'
import { jourLubu } from './format'
import { prixMensuelTerrasse } from './pricing'
import { assainirDb } from './validation'
import { traduire, type Langue } from '@/i18n'
import type {
  Abonnement, Alerte, ClientSession, DB, Depense, LigneCommande, Paiement, Portee,
  RoleActif, RoleEtablissement, SessionLocale, SessionService, TableT, Terrasse, TypeEtablissement, TypeMouvement, Utilisateur,
} from './types'

// Client tRPC « vanilla » pour les actions (mutations) hors composants.
// Chaque appel présente le jeton de session (Authorization: Bearer).
// fetchAvecEtag : rejoue la réponse mémorisée sur un 304 (snapshots).
const api = createTRPCClient<AppRouter>({
  links: [httpBatchLink({ url: '/api/trpc', transformer: superjson, headers: enteteAuth, fetch: fetchAvecEtag })],
})

// ---------------- Rafraîchissement immédiat après une action ----------------

const auditeurs = new Set<() => void>()

/** Demande à tous les écrans de recharger leur image des données */
function diffuser() {
  auditeurs.forEach((f) => f())
}

/** Vrai si l'erreur est un 401 tRPC (session expirée/invalide) */
function estNonAutorise(e: unknown): boolean {
  return e instanceof TRPCClientError && (e.data as { code?: string } | undefined)?.code === 'UNAUTHORIZED'
}

/** 401 → on coupe la session locale et on renvoie à la connexion */
function gererNonAutorise() {
  if (!lireSession()) return // déjà déconnecté : rien à faire
  ecrireSession(null)
  toast.error(traduire('erreur.session_expiree'))
  naviguer('/connexion')
}

/** Exécute une action serveur puis rafraîchit les écrans (erreur ou non) */
async function exec<T>(promesse: Promise<T>): Promise<T> {
  try {
    const resultat = await promesse
    diffuser()
    return resultat
  } catch (e) {
    if (estNonAutorise(e)) gererNonAutorise()
    diffuser()
    throw e
  }
}

// ---------------- Portée (quel périmètre de données pour cet écran) ----------------

const ContextePortee = createContext<Portee>({ kind: 'public' })

export function FournisseurPortee({ portee, children }: { portee: Portee; children: ReactNode }) {
  // Les vues construisent un nouvel objet `portee` à chaque rendu :
  // on ne publie au contexte qu'une référence stable (mémoïsée par
  // contenu) pour éviter de re-rendre tous les consommateurs inutilement.
  const cle = JSON.stringify(portee)
  // eslint-disable-next-line react-hooks/exhaustive-deps -- cle sérialise portee
  const valeur = useMemo(() => portee, [cle])
  return <ContextePortee.Provider value={valeur}>{children}</ContextePortee.Provider>
}

const DB_VIDE: DB = {
  version: 1,
  organisations: [], utilisateurs: [], terrasses: [], affectations: [], tables: [],
  produits: [], tableServeuse: [], clientsSession: [], commandes: [], sessionsService: [],
  depots: [], depenses: [], avis: [], invitations: [], demandesStock: [], alertes: [],
  mouvementsStock: [], auditLog: [], plansTarifs: [], abonnements: [],
  historiqueTranches: [], paiements: [], factures: [],
  catalogueProduits: [], compteurFacture: 0,
}

function useSnapshot() {
  const portee = useContext(ContextePortee)
  const utils = trpc.useUtils()
  const requete = trpc.gbs.snapshot.useQuery(
    { portee },
    {
      refetchInterval: 4000, // temps réel inter-appareils
      placeholderData: (precedent) => precedent, // pas de flash lors d'un changement de portée
      retry: (echec, erreur) => !estNonAutorise(erreur) && echec < 3, // inutile de réessayer un 401
    },
  )
  // Un 401 sur le polling (jeton expiré en cours de journée) → reconnexion
  useEffect(() => {
    if (requete.error && estNonAutorise(requete.error)) gererNonAutorise()
  }, [requete.error])
  useEffect(() => {
    const f = () => void utils.gbs.snapshot.invalidate()
    auditeurs.add(f)
    return () => {
      auditeurs.delete(f)
    }
  }, [utils])
  return requete
}

/** Image des données (filtrée par la portée de l'écran). Vide tant que ça charge.
 *  Chaque réponse passe par assainirDb (Phase B.7) : un champ null/absent/NaN
 *  reçoit un défaut sûr au lieu de faire planter l'écran. Mémorisé par
 *  référence — ne revalide que quand les données changent réellement. */
export function useDB(): DB {
  const donnees = useSnapshot().data
  return useMemo(() => (donnees ? assainirDb(donnees) : DB_VIDE), [donnees])
}

/** Vrai une fois la première réponse du serveur reçue */
export function useDBPret(): boolean {
  return useSnapshot().data !== undefined
}

/** Annuaire démo (page de connexion) */
export function useAnnuaire() {
  return trpc.gbs.annuaire.useQuery(undefined, { refetchInterval: 10000 })
}

// ---------------- Session locale (par appareil) ----------------
// Stockage dans ./sessionLocale (jeton signé inclus) ; ici on ajoute
// la diffusion du changement à tous les écrans.

export { lireSession }

export function ecrireSession(s: SessionLocale | null) {
  ecrireSessionBrute(s)
  diffuser()
}

export function useSession(): [SessionLocale | null, (s: SessionLocale | null) => void] {
  const [session, setSession] = useState<SessionLocale | null>(lireSession)
  const maj = (s: SessionLocale | null) => {
    ecrireSession(s)
    setSession(s)
  }
  return [session, maj]
}

// ---------------- Sélecteurs (purs, sur l'image des données) ----------------

export function utilisateurDe(db: DB, id: string | null | undefined): Utilisateur | null {
  return db.utilisateurs.find((u) => u.id === id) ?? null
}

export function terrasseDe(db: DB, id: string): Terrasse | null {
  return db.terrasses.find((t) => t.id === id) ?? null
}

export function tableDe(db: DB, id: string): TableT | null {
  return db.tables.find((t) => t.id === id) ?? null
}

export function organisationDe(db: DB, id: string) {
  return db.organisations.find((o) => o.id === id) ?? null
}

export function estProprietaire(db: DB, utilisateurId: string, terrasseId: string): boolean {
  const t = terrasseDe(db, terrasseId)
  if (!t) return false
  const org = organisationDe(db, t.organisationId)
  return org?.proprietaireId === utilisateurId
}

/** Rôles effectifs d'un utilisateur sur une terrasse (PROPRIETAIRE inclus) */
export function rolesSur(db: DB, utilisateurId: string, terrasseId: string): RoleActif[] {
  const roles: RoleActif[] = []
  if (estProprietaire(db, utilisateurId, terrasseId)) roles.push('PROPRIETAIRE')
  for (const a of db.affectations) {
    if (a.utilisateurId === utilisateurId && a.terrasseId === terrasseId && a.actif) roles.push(a.role)
  }
  return roles
}

/** Terrasses visibles par un utilisateur (propriété + affectations actives) */
export function terrassesDe(db: DB, utilisateurId: string): Terrasse[] {
  const ids = new Set<string>()
  for (const o of db.organisations) {
    if (o.proprietaireId === utilisateurId) {
      db.terrasses.filter((t) => t.organisationId === o.id).forEach((t) => ids.add(t.id))
    }
  }
  for (const a of db.affectations) {
    if (a.utilisateurId === utilisateurId && a.actif) ids.add(a.terrasseId)
  }
  return db.terrasses.filter((t) => ids.has(t.id))
}

export function serveuseDeTable(db: DB, tableId: string): string | null {
  return db.tableServeuse.find((x) => x.tableId === tableId && x.actif)?.serveuseId ?? null
}

export function tablesDeServeuse(db: DB, serveuseId: string): string[] {
  return db.tableServeuse.filter((x) => x.serveuseId === serveuseId && x.actif).map((x) => x.tableId)
}

export function abonnementDe(db: DB, terrasseId: string): Abonnement | null {
  return db.abonnements.find((a) => a.terrasseId === terrasseId) ?? null
}

/** L'abonnement permet-il les écritures ? (lecture seule / suspendu → non) */
export function ecriturePermise(db: DB, terrasseId: string): boolean {
  const abo = abonnementDe(db, terrasseId)
  if (!abo) return true
  return abo.statut === 'ESSAI' || abo.statut === 'ACTIF' || abo.statut === 'EN_GRACE'
}

export function contexteTable(db: DB, token: string): { table: TableT; terrasse: Terrasse } {
  const table = db.tables.find((t) => t.tokenQr === token && t.actif)
  if (!table) throw new Error(traduire('erreur.qr_invalide'))
  const terrasse = terrasseDe(db, table.terrasseId)
  if (!terrasse) throw new Error(traduire('erreur.terrasse_introuvable'))
  return { table, terrasse }
}

export function sessionOuverte(db: DB, terrasseId: string, serveuseId: string): SessionService | null {
  return db.sessionsService.find((s) => s.terrasseId === terrasseId && s.serveuseId === serveuseId && s.statut === 'OUVERTE') ?? null
}

/** Montant attendu en caisse pour une session : commandes SERVIE par la serveuse pendant la session */
export function attenduSession(db: DB, session: SessionService): { cdf: number; usdCentimes: number } {
  const fin = session.clotureeLe ?? new Date().toISOString()
  let cdf = 0
  let usd = 0
  for (const c of db.commandes) {
    if (
      c.terrasseId === session.terrasseId && c.statut === 'SERVIE' && c.serviePar === session.serveuseId &&
      c.servieLe && c.servieLe >= session.ouverteLe && c.servieLe <= fin
    ) {
      cdf += c.totalCdf
      usd += c.totalUsdCentimes
    }
  }
  return { cdf, usdCentimes: usd }
}

/** Commandes SERVIE non encore encaissées sur la session (même fenêtre qu'attenduSession) */
export function impayesSession(db: DB, session: SessionService): { nb: number; cdf: number; usdCentimes: number } {
  const fin = session.clotureeLe ?? new Date().toISOString()
  let cdf = 0
  let usd = 0
  let nb = 0
  for (const c of db.commandes) {
    if (
      c.terrasseId === session.terrasseId && c.statut === 'SERVIE' && c.serviePar === session.serveuseId &&
      !c.payeeLe && c.servieLe && c.servieLe >= session.ouverteLe && c.servieLe <= fin
    ) {
      cdf += c.totalCdf
      usd += c.totalUsdCentimes
      nb += 1
    }
  }
  return { nb, cdf, usdCentimes: usd }
}

export function ventesDuJour(db: DB, terrasseId: string, jour?: string): { cdf: number; usdCentimes: number; nb: number } {
  const j = jour ?? jourLubu()
  let cdf = 0
  let usd = 0
  let nb = 0
  for (const c of db.commandes) {
    if (c.terrasseId === terrasseId && c.statut === 'SERVIE' && c.servieLe && jourLubu(c.servieLe) === j) {
      cdf += c.totalCdf
      usd += c.totalUsdCentimes
      nb += 1
    }
  }
  return { cdf, usdCentimes: usd, nb }
}

/** MRR plateforme : somme des prix mensuels des terrasses ACTIF/EN_GRACE */
export function mrrPlateforme(db: DB): number {
  let total = 0
  for (const abo of db.abonnements) {
    if (abo.statut === 'ACTIF' || abo.statut === 'EN_GRACE') total += prixMensuelTerrasse(db, abo.terrasseId)
  }
  return total
}

/** Chiffre d'affaires cumulé : toutes les commandes servies, toutes dates */
export function chiffreAffaires(db: DB, terrasseId: string): { cdf: number; usdCentimes: number; nb: number } {
  let cdf = 0
  let usd = 0
  let nb = 0
  for (const c of db.commandes) {
    if (c.terrasseId === terrasseId && c.statut === 'SERVIE') {
      cdf += c.totalCdf
      usd += c.totalUsdCentimes
      nb += 1
    }
  }
  return { cdf, usdCentimes: usd, nb }
}

/** Valeur du stock en rayon : Σ (stock × prix de vente), produits de la terrasse */
export function valeurStock(db: DB, terrasseId: string): { cdf: number; usdCentimes: number; references: number } {
  let cdf = 0
  let usd = 0
  let references = 0
  for (const p of db.produits) {
    if (p.terrasseId !== terrasseId || p.stock <= 0) continue
    cdf += p.stock * p.prixCdf
    usd += p.stock * p.prixUsdCentimes
    references += 1
  }
  return { cdf, usdCentimes: usd, references }
}

/** Produit phare d'une terrasse (quantités vendues, commandes servies) */
export function produitPhare(db: DB, terrasseId: string): { nom: string; qte: number } | null {
  const compteur = new Map<string, { nom: string; qte: number }>()
  for (const c of db.commandes) {
    if (c.terrasseId !== terrasseId || c.statut !== 'SERVIE') continue
    for (const l of c.lignes) {
      const e = compteur.get(l.produitId) ?? { nom: l.nom, qte: 0 }
      e.qte += l.quantite
      compteur.set(l.produitId, e)
    }
  }
  return Array.from(compteur.values()).sort((a, b) => b.qte - a.qte)[0] ?? null
}

// ---------- Pilotage : agrégats du tableau de bord propriétaire ----------

/** Décale un jour « AAAA-MM-JJ » (format jourLubu) de n jours, sans bord de fuseau. */
export function decalerJour(jour: string, n: number): string {
  const d = new Date(`${jour}T12:00:00`) // midi : jamais à cheval sur deux jours
  d.setDate(d.getDate() + n)
  return jourLubu(d)
}

export interface VenteJourSemaine { jour: string; cdf: number; usdCentimes: number }

/** Ventes servies des 7 derniers jours (du plus ancien à aujourd'hui). */
export function ventesSemaine(db: DB, terrasseId: string): VenteJourSemaine[] {
  const aujourdhui = jourLubu()
  const jours: VenteJourSemaine[] = []
  for (let i = 6; i >= 0; i--) {
    const j = decalerJour(aujourdhui, -i)
    const v = ventesDuJour(db, terrasseId, j)
    jours.push({ jour: j, cdf: v.cdf, usdCentimes: v.usdCentimes })
  }
  return jours
}

/** Total des ventes servies sur les 7 jours AVANT la semaine courante (comparaison). */
export function ventesSemainePrecedente(db: DB, terrasseId: string): { cdf: number; usdCentimes: number } {
  const aujourdhui = jourLubu()
  let cdf = 0
  let usd = 0
  for (let i = 13; i >= 7; i--) {
    const v = ventesDuJour(db, terrasseId, decalerJour(aujourdhui, -i))
    cdf += v.cdf
    usd += v.usdCentimes
  }
  return { cdf, usdCentimes: usd }
}

/** Répartition du stock (produits actifs) : rupture = 0, bas ≤ seuil d'alerte, sinon bon état. */
export function etatStock(db: DB, terrasseId: string): { bon: number; bas: number; rupture: number } {
  let bon = 0
  let bas = 0
  let rupture = 0
  for (const p of db.produits) {
    if (p.terrasseId !== terrasseId || !p.actif) continue
    if (p.stock <= 0) rupture += 1
    else if (p.stock <= p.seuilAlerte) bas += 1
    else bon += 1
  }
  return { bon, bas, rupture }
}

/** Plage de 2 h la plus dense en commandes servies (7 derniers jours) — null si moins de 3 ventes. */
export function picAffluence(db: DB, terrasseId: string): { debut: number; fin: number } | null {
  const aujourdhui = jourLubu()
  const jours = new Set<string>()
  for (let i = 6; i >= 0; i--) jours.add(decalerJour(aujourdhui, -i))
  const parHeure = new Array<number>(24).fill(0)
  let total = 0
  // formatToParts : « 20 h » en fr-FR — Number() direct rendrait NaN
  const fmtHeure = new Intl.DateTimeFormat('fr-FR', { timeZone: 'Africa/Lubumbashi', hour: '2-digit', hour12: false })
  const heureLubuDe = (iso: string) => {
    const part = fmtHeure.formatToParts(new Date(iso)).find((p) => p.type === 'hour')
    return Number(part?.value ?? '0') % 24 // « 24 » possible à minuit selon ICU
  }
  for (const c of db.commandes) {
    if (c.terrasseId !== terrasseId || c.statut !== 'SERVIE' || !c.servieLe) continue
    if (!jours.has(jourLubu(c.servieLe))) continue
    parHeure[heureLubuDe(c.servieLe)] += 1
    total += 1
  }
  if (total < 3) return null
  let meilleur = 0
  let meilleurTotal = -1
  for (let h = 0; h < 24; h++) {
    const s = parHeure[h] + parHeure[(h + 1) % 24]
    if (s > meilleurTotal) { meilleurTotal = s; meilleur = h }
  }
  return { debut: meilleur, fin: (meilleur + 2) % 24 }
}

/** Montants cumulés des ventes du jour (commandes servies, ordre chrono) — sparkline. */
export function ventesCumuleesJour(db: DB, terrasseId: string): number[] {
  const j = jourLubu()
  const servies = db.commandes
    .filter((c) => c.terrasseId === terrasseId && c.statut === 'SERVIE' && c.servieLe && jourLubu(c.servieLe) === j)
    .sort((a, b) => a.servieLe!.localeCompare(b.servieLe!))
  let cumul = 0
  return servies.map((c) => (cumul += c.totalCdf))
}

/** Encaissé du jour par serveuse (commandes payées aujourd'hui, jour de Lubumbashi). */
export function encaisseParServeuse(db: DB, terrasseId: string, jour?: string): Map<string, number> {
  const j = jour ?? jourLubu()
  const par = new Map<string, number>()
  for (const c of db.commandes) {
    if (c.terrasseId !== terrasseId || !c.payeeLe || !c.payeePar) continue
    if (jourLubu(c.payeeLe) !== j) continue
    par.set(c.payeePar, (par.get(c.payeePar) ?? 0) + c.totalCdf)
  }
  return par
}

export { jourLubu }

// ============================================================
// ACTIONS — appels serveur (toutes asynchrones, mêmes noms
// et messages d'erreur que la maquette d'origine)
// ============================================================

// ---------- Langue de l'organisation (boucle 5) ----------

/** Mémorise la langue choisie sur l'organisation (silencieux côté UI). */
export function definirLangue(terrasseId: string, langue: Langue) {
  return exec(api.gbs.definirLangue.mutate({ terrasseId, langue }))
}

// ---------- Connexion staff ----------

export function connexionPin(utilisateurId: string, pin: string) {
  return exec(api.gbs.connexionPin.mutate({ utilisateurId, pin, appareilId: idAppareil() }))
}

/** Entrée de connexion unique : numéro de téléphone + PIN */
export function connexionTelephone(telephone: string, pin: string) {
  return exec(api.gbs.connexionTelephone.mutate({ telephone, pin, appareilId: idAppareil() }))
}

/** Déconnexion propre : révoque la session de CET appareil côté
 *  serveur (session glissante), puis coupe la session locale. */
export async function deconnexion() {
  try {
    await api.gbs.deconnexion.mutate()
  } catch {
    // Même si le serveur est injoignable, la déconnexion locale prime
  }
  ecrireSession(null)
}

/** Révoque un appareil (le sien, ou celui d'un membre pour le proprio) */
export function revoquerAppareil(sessionId: string) {
  return exec(api.gbs.revoquerAppareil.mutate({ sessionId }))
}

// ---------- Client (QR) ----------

export function ouvrirSessionClient(token: string, prenom: string): Promise<ClientSession> {
  return exec(api.gbs.ouvrirSessionClient.mutate({ token, prenom }))
}

export function passerCommande(
  token: string, clientSessionId: string, lignes: LigneCommande[], cleIdempotence: string,
) {
  return exec(api.gbs.passerCommande.mutate({
    token, clientSessionId, cleIdempotence,
    lignes: lignes.map((l) => ({ produitId: l.produitId, quantite: l.quantite })),
  }))
}

export function annulerMaCommande(commandeId: string, clientSessionId: string) {
  return exec(api.gbs.annulerMaCommande.mutate({ commandeId, clientSessionId }))
}

export function noterServeuse(commandeId: string, clientSessionId: string, note: number, commentaire: string) {
  return exec(api.gbs.noterServeuse.mutate({ commandeId, clientSessionId, note, commentaire }))
}

// ---------- Serveuse / staff ----------

export function confirmerCommande(commandeId: string) {
  return exec(api.gbs.confirmerCommande.mutate({ commandeId }))
}

export function marquerServie(commandeId: string) {
  return exec(api.gbs.marquerServie.mutate({ commandeId }))
}

export function annulerCommandeStaff(commandeId: string, motif: string) {
  return exec(api.gbs.annulerCommandeStaff.mutate({ commandeId, motif }))
}

/** Encaissement cash : marque la commande payée (débloque la suivante du client) */
export function marquerPayee(commandeId: string) {
  return exec(api.gbs.marquerPayee.mutate({ commandeId }))
}

export function ouvrirSessionService(terrasseId: string) {
  return exec(api.gbs.ouvrirSessionService.mutate({ terrasseId }))
}

export function cloturerSession(sessionId: string) {
  return exec(api.gbs.cloturerSession.mutate({ sessionId }))
}

export function declarerDepot(sessionId: string, cdf: number, usdCentimes: number, motifEcart?: string) {
  return exec(api.gbs.declarerDepot.mutate({ sessionId, cdf, usdCentimes, motifEcart }))
}

// ---------- Gérant / Propriétaire ----------

export function validerDepot(depotId: string, decision: 'VALIDE' | 'CONTESTE', motif?: string) {
  return exec(api.gbs.validerDepot.mutate({ depotId, decision, motif }))
}

export function modifierPrix(produitId: string, prixCdf: number, prixUsdCentimes: number) {
  return exec(api.gbs.modifierPrix.mutate({ produitId, prixCdf, prixUsdCentimes }))
}

export function ajusterStock(produitId: string, type: TypeMouvement, quantite: number, motif: string) {
  if (type === 'RESERVATION' || type === 'LIBERATION' || type === 'VENTE') {
    return Promise.reject(new Error(traduire('erreur.mouvement_reserve')))
  }
  return exec(api.gbs.ajusterStock.mutate({ produitId, type, quantite, motif }))
}

export function basculerProduitActif(produitId: string) {
  return exec(api.gbs.basculerProduitActif.mutate({ produitId }))
}

export function creerProduit(
  terrasseId: string, nom: string, categorie: string,
  prixCdf: number, prixUsdCentimes: number, stock: number, seuil: number,
  extra?: {
    codeBarres?: string; variante?: string; consignable?: boolean;
    bouteillesParCasier?: number; photoUrl?: string;
    // Boucle 3 — formulaire adaptatif (champs par type de produit)
    typeProduit?: 'MARCHANDISE' | 'CHAMBRE' | 'SERVICE' | 'BILLARD'
    unite?: string; dureeMinutes?: number; capacite?: number
    lot?: string; datePeremption?: string
  },
) {
  return exec(api.gbs.creerProduit.mutate({ terrasseId, nom, categorie, prixCdf, prixUsdCentimes, stock, seuil, ...extra }))
}

/** Enregistre une dépense de caisse (Gérant / Propriétaire) */
export function enregistrerDepense(terrasseId: string, montantCdf: number, montantUsdCentimes: number, motif: string) {
  return exec(api.gbs.enregistrerDepense.mutate({ terrasseId, montantCdf, montantUsdCentimes, motif }))
}

/**
 * Solde de la boutique = argent encaissé (commandes payées)
 * − dépôts validés (cash sorti de la caisse) − dépenses.
 */
export function soldeBoutique(db: DB, terrasseId: string): { cdf: number; usdCentimes: number } {
  let cdf = 0
  let usd = 0
  for (const c of db.commandes) {
    if (c.terrasseId === terrasseId && c.payeeLe) { cdf += c.totalCdf; usd += c.totalUsdCentimes }
  }
  for (const d of db.depots) {
    if (d.terrasseId === terrasseId && d.statut === 'VALIDE') { cdf -= d.declareCdf; usd -= d.declareUsdCentimes }
  }
  for (const d of db.depenses) {
    if (d.terrasseId === terrasseId) { cdf -= d.montantCdf; usd -= d.montantUsdCentimes }
  }
  return { cdf, usdCentimes: usd }
}

/** Dépenses de la terrasse saisies aujourd'hui (jour de Lubumbashi) */
export function depensesDuJour(db: DB, terrasseId: string, jour?: string): Depense[] {
  const j = jour ?? jourLubu()
  return db.depenses
    .filter((d) => d.terrasseId === terrasseId && jourLubu(d.creeLe) === j)
    .sort((a, b) => b.creeLe.localeCompare(a.creeLe))
}

export function creerDemandeStock(
  terrasseId: string, produitId: string, quantite: number,
  type: 'REAPPRO' | 'PERTE' | 'ECART', motif: string,
) {
  return exec(api.gbs.creerDemandeStock.mutate({ terrasseId, produitId, quantite, type, motif }))
}

export function traiterDemandeStock(demandeId: string, decision: 'APPROUVEE' | 'REFUSEE') {
  return exec(api.gbs.traiterDemandeStock.mutate({ demandeId, decision }))
}

export function regenererQr(tableId: string) {
  return exec(api.gbs.regenererQr.mutate({ tableId }))
}

export function assignerServeuse(tableId: string, serveuseId: string | null) {
  return exec(api.gbs.assignerServeuse.mutate({ tableId, serveuseId }))
}

export function creerTable(terrasseId: string) {
  return exec(api.gbs.creerTable.mutate({ terrasseId }))
}

export function archiverTable(tableId: string) {
  return exec(api.gbs.archiverTable.mutate({ tableId }))
}

// ---------- Équipe et invitations ----------

export function creerInvitation(terrasseId: string, role: RoleEtablissement, nomPrevu: string) {
  return exec(api.gbs.creerInvitation.mutate({ terrasseId, role: role as any, nomPrevu })).then((r) => r.code)
}

export function revoquerInvitation(invitationId: string) {
  return exec(api.gbs.revoquerInvitation.mutate({ invitationId }))
}

export function consommerInvitation(code: string, nom: string, telephone: string, pin: string) {
  return exec(api.gbs.consommerInvitation.mutate({ code, nom, telephone, pin }))
}

export function basculerAffectation(affectationId: string) {
  return exec(api.gbs.basculerAffectation.mutate({ affectationId }))
}

// ---------- Chemin A : créer son établissement ----------

export function finaliserInscription(
  nom: string, telephone: string, pin: string,
  nomTerrasse: string, adresse: string, nombreTables: number, aussiGerant: boolean,
  // Le serveur accepte les 9 types d'établissement — le sélecteur
  // d'inscription les propose tous, avec fusion possible (1 à 3 types).
  typeEtablissement: TypeEtablissement = 'TERRASSE',
  typesSecondaires: TypeEtablissement[] = [],
) {
  return exec(api.gbs.finaliserInscription.mutate({ nom, telephone, pin, nomTerrasse, adresse, nombreTables, aussiGerant, typeEtablissement, typesSecondaires }))
}

// ---------- Établissements (étape 6) ----------

export function etablissementsLister() {
  return api.etablissements.lister.query({})
}

export function etablissementCreer(params: {
  organisationId: string; nom: string; adresse: string;
  type: 'TERRASSE' | 'BOUTIQUE'; nombreTables?: number;
}) {
  return exec(api.etablissements.creer.mutate(params))
}

export function etablissementAjouterTable(etablissementId: string, numero?: number) {
  return exec(api.etablissements.ajouterTable.mutate({ etablissementId, numero }))
}

export function etablissementSupprimerTable(tableId: string) {
  return exec(api.etablissements.supprimerTable.mutate({ tableId }))
}

// ---------- Catalogue (étape 7) ----------

export function catalogueLister() {
  return api.catalogue.lister.query({})
}

export function catalogueImporter(
  etablissementId: string, produitIds: string[],
  prixParDefaut?: { prixCdf: number; prixUsdCentimes: number },
) {
  return exec(api.catalogue.importerDansEtablissement.mutate({ etablissementId, produitIds, prixParDefaut }))
}

// ---------- Codes-barres (scan caméra + Open Food Facts) ----------

export function rechercherParCodeBarres(codeBarres: string) {
  return api.catalogue.rechercherParCodeBarres.query({ codeBarres })
}

export function enregistrerCodeBarres(params: {
  codeBarres: string; nom: string; categorie: string;
  variante?: string; consignable?: boolean; bouteillesParCasier?: number;
  prixCdfMoyen?: number; prixUsdMoyen?: number;
}) {
  return exec(api.catalogue.enregistrerCodeBarres.mutate(params))
}

// ---------- Photos produits (étape 5) ----------

/** Téléverse la photo d'un produit (max 5 Mo, convertie en WebP côté serveur) */
export async function produitUploadPhoto(produitId: string, fichier: File) {
  if (fichier.size > 5 * 1024 * 1024) throw new Error(traduire('erreur.photo_lourde'))
  const fichierBase64 = await new Promise<string>((resolve, reject) => {
    const lecteur = new FileReader()
    lecteur.onload = () => resolve(String(lecteur.result).split(',')[1] ?? '')
    lecteur.onerror = () => reject(new Error(traduire('erreur.lecture_fichier')))
    lecteur.readAsDataURL(fichier)
  })
  return exec(api.produits.uploadPhoto.mutate({ produitId, fichierBase64, nomFichier: fichier.name }))
}

// ---------- Abonnement / plateforme ----------

export function soumettrePaiement(
  terrasseId: string, methode: Paiement['methode'], reference: string, annuel: boolean,
) {
  return exec(api.gbs.soumettrePaiement.mutate({ terrasseId, methode, reference, annuel }))
}

export function verifierPinAdmin(pin: string) {
  return api.gbs.verifierPinAdmin.query({ pin }).then((r) => r.ok)
}

/** Super-admin : journal des erreurs client groupées par message (Phase B.6) */
export function listeErreursClient(pinAdmin: string) {
  return api.gbs.erreursClient.query({ pin: pinAdmin })
}

export function validerPaiement(paiementId: string, decision: 'VALIDE' | 'REJETE', pinAdmin: string) {
  return exec(api.gbs.validerPaiement.mutate({ paiementId, decision, pinAdmin }))
}

export function modifierTarif(plan: string, tranche: string, prixCentimes: number, fraisCentimes: number, pinAdmin: string) {
  return exec(api.gbs.modifierTarif.mutate({
    plan: plan as 'ESSENTIEL' | 'PRO' | 'BUSINESS' | 'BOUTIQUE',
    tranche: tranche as 'PETITE' | 'MOYENNE' | 'GRANDE',
    prixCentimes, fraisCentimes, pinAdmin,
  }))
}

// ---------- Billard Vincaire (étape 3 annexe) ----------

/** Client : achète un token sur le billard scanné. Cash par défaut ;
 *  si referenceMobile est fourni, c'est la référence Airtel Money
 *  déclarée par le client (flux manuel — le caissier la vérifie sur
 *  son téléphone avant de valider ; unique par établissement). */
/** Billard : classement public des meilleurs joueurs (par série de victoires) */
export function classementJoueursBillard(terrasseId: string) {
  return api.billard.classementJoueurs.query({ terrasseId })
}

export function acheterTokenBillard(token: string, clientSessionId: string, referenceMobile?: string) {
  return exec(api.billard.acheterToken.mutate({ token, clientSessionId, referenceMobile }))
}

/** Client : annule son token (avant d'entrer en jeu) */
export function annulerMonTokenBillard(tokenId: string, clientSessionId: string) {
  return exec(api.billard.annulerToken.mutate({ tokenId, clientSessionId }))
}

/** Staff : valide le paiement cash d'un token (→ EN_FILE) */
export function validerPaiementTokenBillard(tokenId: string) {
  return exec(api.billard.validerPaiementToken.mutate({ tokenId }))
}

/** Staff : ajoute un joueur au comptoir (client sans téléphone) */
export function ajouterJoueurComptoirBillard(tableId: string, prenom: string, dejaPaye = true) {
  return exec(api.billard.ajouterJoueurComptoir.mutate({ tableId, prenom, dejaPaye }))
}

export function appelerSuivantBillard(tableId: string) {
  return exec(api.billard.appelerSuivant.mutate({ tableId }))
}

/** Direction : export comptable CSV d'une journée (billard, hôtel,
 *  commandes, dépenses — totaux et net). */
export function exporterComptabiliteJour(terrasseId: string, jour: string) {
  return exec(api.comptabilite.exportJournalier.query({ terrasseId, jour }))
}

// ---------- Hôtel (boucle 9) ----------

/** Direction : crée une chambre (numéro unique par établissement) */
/** Client : prolonge son séjour (ajoute une nuit ou une heure à la note). */
export function prolongerSejour(input: {
  token: string;
  clientSessionId: string;
  mode: 'NUIT' | 'HEURE';
}) {
  return exec(api.hotel.prolongerSejour.mutate(input))
}

/** Serveuse : liste les commandes EN_ATTENTE pour sa terrasse. */
export function voirNouvellesCommandes(terrasseId: string) {
  return api.hotel.voirNouvellesCommandes.query({ terrasseId })
}

export function creerChambreHotel(input: {
  terrasseId: string; numero: string; type: 'SIMPLE' | 'DOUBLE' | 'SUITE';
  prixNuitCdf: number; prixHeureCdf: number | null;
  photoUrl?: string | null;
}) {
  return exec(api.hotel.creerChambre.mutate(input))
}

/** Direction : modifie une chambre (photo, prix, type) */
export function modifierChambreHotel(input: {
  chambreId: string;
  photoUrl?: string | null;
  prixNuitCdf?: number;
  prixHeureCdf?: number | null;
  type?: 'SIMPLE' | 'DOUBLE' | 'SUITE';
}) {
  return exec(api.hotel.modifierChambre.mutate(input))
}

/** Direction : upload la photo d'une chambre (base64) */
export function uploadPhotoChambre(input: {
  chambreId: string;
  fichierBase64: string;
  nomFichier?: string;
}) {
  return exec(api.hotel.uploadPhotoChambre.mutate(input))
}

/** Réception : check-in (nom + pièce d'identité, nuitée ou heure) */
export function checkInChambre(input: {
  chambreId: string; clientNom: string; pieceIdentite: string; mode: 'NUIT' | 'HEURE';
}) {
  return exec(api.hotel.checkIn.mutate(input))
}

/** Réception : check-out — retourne le montant calculé par le serveur */
export function checkOutSejour(sejourId: string) {
  return exec(api.hotel.checkOut.mutate({ sejourId }))
}

/** Gouvernante : valide le ménage (A_NETTOYER → LIBRE) */
export function marquerChambreNettoyee(chambreId: string) {
  return exec(api.hotel.marquerNettoyee.mutate({ chambreId }))
}

export function lancerPartieBillard(tableId: string) {
  return exec(api.billard.lancerPartie.mutate({ tableId }))
}

/** Clôture la partie : gagnantTokenId = token du vainqueur déclaré */
export function terminerPartieBillard(partieId: string, gagnantTokenId: string) {
  return exec(api.billard.terminerPartie.mutate({ partieId, gagnantTokenId }))
}

/** Le perdant déclare lui-même sa défaite (prompt maître §3) :
 *  le gagnant est promu roi et le match suivant est lancé aussitôt. */
export function declarerDefaiteBillard(token: string, clientSessionId: string) {
  return exec(api.billard.declarerDefaite.mutate({ token, clientSessionId }))
}

export function marquerAbsentBillard(tokenId: string) {
  return exec(api.billard.marquerAbsent.mutate({ tokenId }))
}

export function annulerPartieBillard(partieId: string, motif: string) {
  return exec(api.billard.annulerPartie.mutate({ partieId, motif }))
}

export function configurerBillard(terrasseId: string, config: {
  prixTokenCdf?: number
  reglePerdant?: 'RACHAT' | 'FIN_FILE' | 'SORTIE'
  maxPartiesVincaire?: number | null
  delaiPresenceMin?: number
}) {
  return exec(api.billard.configurerBillard.mutate({ terrasseId, ...config }))
}

/** Crée une table de billard supplémentaire (gérant/proprio) */
export function creerTableBillard(terrasseId: string) {
  return exec(api.billard.creerTableBillard.mutate({ terrasseId }))
}

// ---------- Divers ----------

export function marquerAlertesLues(terrasseId: string) {
  return exec(api.gbs.marquerAlertesLues.mutate({ terrasseId }))
}

export function masquerAvis(avisId: string, motif: string) {
  return exec(api.gbs.masquerAvis.mutate({ avisId, motif }))
}

export function reinitialiserDemo() {
  return exec(api.gbs.reinitialiserDemo.mutate())
}

// Alerte type réexporté pour les vues
export type { Alerte }

// ---------- Note unique (ANNEXE-2) et « payer pour quelqu'un » (ANNEXE-3) ----------

/** Client : demande l'addition — la note passe A_REGLER et le
 *  personnel des espaces concernés est alerté (§5.2). */
export function demanderAdditionNote(clientSessionId: string) {
  return exec(api.notes.demanderAddition.mutate({ clientSessionId }))
}

/** Client : « je paie pour la table N » — la décision appartient à la
 *  bénéficiaire, enregistrée par la serveuse (ANNEXE-3 §1.1). */
export function proposerPriseEnChargeNote(clientSessionId: string, numeroTableBeneficiaire: string) {
  return exec(api.notes.proposerPriseEnCharge.mutate({ clientSessionId, numeroTableBeneficiaire }))
}

/** Client : déclare son téléphone pour retrouver sa note sur un autre
 *  appareil (§2 — rattachement effectif validé par la serveuse). */
export function declarerTelephoneNote(clientSessionId: string, telephone: string) {
  return exec(api.notes.declarerTelephone.mutate({ clientSessionId, telephone }))
}

/** Cliente : accepte ou refuse la prise en charge proposée (ANNEXE-3 §1.4). */
export function deciderPriseEnChargeClienteNote(clientSessionId: string, id: string, accepter: boolean) {
  return exec(api.notes.deciderPriseEnChargeCliente.mutate({ clientSessionId, id, decision: accepter ? 'ACCEPTEE' : 'REFUSEE' }))
}

/** Staff : encaisse (partiellement ou totalement) une note — CASH ou
 *  MOBILE_MONEY, pourboire hors CA (§5). */
export function encaisserNote(
  noteId: string, montantCdf: number, montantUsd: number,
  mode: 'CASH' | 'MOBILE_MONEY', referenceMobile?: string, pourboireCdf = 0, pourboireUsd = 0,
) {
  return exec(api.notes.encaisserNote.mutate({ noteId, montantCdf, montantUsd, mode, referenceMobile, pourboireCdf, pourboireUsd }))
}

/** Staff : déclare la remise de son cash EN_MAIN au receveur (§5.5). */
export function remettreCaisseNote(terrasseId: string) {
  return exec(api.notes.remettreCaisse.mutate({ terrasseId }))
}

/** Receveur : valide une remise de caisse avec les montants COMPTÉS
 *  (l'écart déclenche l'alerte propriétaire, §5.5). */
export function validerRemiseNote(remiseId: string, recuCdf: number, recuUsd: number, motif = '') {
  return exec(api.notes.validerRemise.mutate({ remiseId, recuCdf, recuUsd, motif }))
}

/** Staff : accepte ou refuse une prise en charge au nom de la
 *  bénéficiaire (ANNEXE-3 §1.4) ; sur EXPIREE, gérance seule (§2). */
export function deciderPriseEnChargeStaff(id: string, accepter: boolean) {
  return exec(api.notes.deciderPriseEnCharge.mutate({ id, decision: accepter ? 'ACCEPTEE' : 'REFUSEE' }))
}
