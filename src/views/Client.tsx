// ============================================================
// GBS — Interface CLIENT : scan QR → menu → commande → suivi → avis
// Aucun compte. Le prénom n'est demandé qu'une seule fois.
// ============================================================

import { useEffect, useMemo, useState, lazy, Suspense } from 'react'
import { createPortal } from 'react-dom'
import { CircleCheck, Clock, HandCoins, Minus, Plus, Printer, ReceiptText, ScanBarcode, Search, Share2, ShoppingBasket, UtensilsCrossed, WifiOff, XCircle } from 'lucide-react'
import { toast } from 'sonner'
import { BadgeCmd, Carte, Chargement, Etoiles, Feuille, GrosBouton, Money, Vide, classeSaisie } from '@/components/gbs'
import { BlocBoundary } from '@/components/ErrorBoundary'
import { SelecteurLangue } from '@/components/SelecteurLangue'

// Scanner chargé à la demande : @zxing (~450 Ko) ne pèse que sur
// les utilisateurs qui ouvrent réellement la caméra
const ScanCodeBarres = lazy(() =>
  import('@/components/ScanCodeBarres').then((m) => ({ default: m.ScanCodeBarres }))
)
import { dateHeure, fmtCDF, fmtUSD, ilYA, uid } from '@/lib/format'
import { LogoGBS } from './Home'
import { OngletMaNote } from './MaNote'
import { OngletBillardClient } from './Billard'
import {
  FournisseurPortee, annulerMaCommande, contexteTable, ecriturePermise, noterServeuse,
  ouvrirSessionClient, passerCommande, serveuseDeTable, useDB, useDBPret, utilisateurDe,
} from '@/lib/store'
import type { Commande, LigneCommande, Portee, Produit } from '@/lib/types'
import { TYPES_RECHERCHE_PRODUIT } from '@/lib/types'
import { defFusionnee } from '@contracts/types'
import { useT } from '@/i18n'
import { ajouterALaFile, lireFile, retirerDeLaFile } from '@/lib/outbox'

/** Recherche insensible à la casse et aux accents (« para » trouve « Paracétamol ») */
function normaliser(s: string): string {
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
}
const CLE_CLIENT = (token: string) => `gbs.client.${token}`

interface ClientLocal {
  sessionId: string
  prenom: string
}

/** Coquille : détermine la portée (table scannée + session client) puis affiche la vue */
export function VueClient({ token }: { token: string }) {
  const [client, setClient] = useState<ClientLocal | null>(() => {
    try {
      const brut = localStorage.getItem(CLE_CLIENT(token))
      return brut ? (JSON.parse(brut) as ClientLocal) : null
    } catch {
      return null
    }
  })
  // Ne pas envoyer sessionId tant qu'aucune session n'est ouverte
  // (le schéma serveur attend une chaîne, pas null)
  const portee: Portee = client?.sessionId
    ? { kind: 'client', token, sessionId: client.sessionId }
    : { kind: 'client', token }
  return (
    <FournisseurPortee portee={portee}>
      <VueClientInterne token={token} client={client} setClient={setClient} />
    </FournisseurPortee>
  )
}

function VueClientInterne({ token, client, setClient }: {
  token: string
  client: ClientLocal | null
  setClient: (c: ClientLocal) => void
}) {
  const db = useDB()
  const pret = useDBPret()
  const t = useT()
  const [prenom, setPrenom] = useState('')
  const [panier, setPanier] = useState<Record<string, number>>({})
  const [voirPanier, setVoirPanier] = useState(false)
  // Un QR de billard ouvre sur la file d'attente (Vincaire) ; la carte
  // reste accessible via l'onglet « Boissons ». Sinon : menu classique.
  // null = pas encore de choix explicite → l'onglet par défaut dépend
  // du kind de la table (connu seulement après le premier snapshot).
  const [ongletChoisi, setOnglet] = useState<'BILLARD_FILE' | 'menu' | 'suivi' | 'note' | 'chambre' | null>(null)
  const [cleCommande, setCleCommande] = useState(() => uid('cle'))
  const [scan, setScan] = useState(false)
  const [recherche, setRecherche] = useState('')
  const [enLigne, setEnLigne] = useState(navigator.onLine)

  // Contexte table (peut lever une erreur si QR révoqué)
  const contexte = useMemo(() => {
    try {
      return contexteTable(db, token)
    } catch {
      return null
    }
  }, [db, token])

  // Suivi réseau + envoi différé des commandes hors-ligne
  useEffect(() => {
    const enMarche = async () => {
      setEnLigne(true)
      try {
        // Import unique et sans perte de l'ancienne file localStorage,
        // puis lecture de la file IndexedDB (idempotence par « cle »).
        const file = await lireFile()
        for (const c of file) {
          try {
            await passerCommande(c.token, c.sessionId, c.lignes, c.cle)
            // Retirée seulement après succès confirmé — un renvoi de la
            // même clé renverrait la commande existante, jamais un doublon.
            await retirerDeLaFile(c.cle)
            toast.success(t('client.hors_ligne_envoyee'))
          } catch {
            // Reste en file : retentée au prochain retour réseau
          }
        }
      } catch {
        // ignore
      }
    }
    const enPanne = () => setEnLigne(false)
    window.addEventListener('online', enMarche)
    window.addEventListener('offline', enPanne)
    void enMarche() // tente d'envoyer la file au chargement
    return () => {
      window.removeEventListener('online', enMarche)
      window.removeEventListener('offline', enPanne)
    }
    // « t » est stable (useMemo i18n) — ne relance l'effet qu'au
    // changement de langue, ce qui est sans effet sur la file.
  }, [t])

  // Tant que le serveur n'a pas répondu, on ne conclut rien (évite le faux « QR invalide »)
  if (!pret) return <Chargement label={t('client.ouverture_table')} />

  if (!contexte) {
    return (
      <div className="flex min-h-dvh items-center justify-center px-6">
        <Vide
          icone={<XCircle className="h-8 w-8" />}
          titre={t('client.qr_invalide')}
          detail={t('client.qr_invalide_d')}
        />
      </div>
    )
  }

  const { table, terrasse } = contexte
  const ecritureOk = ecriturePermise(db, terrasse.id)
  // Multi-métiers : on lit le registre de l'établissement
  const definition = defFusionnee(terrasse.type, terrasse.typesSecondaires ?? [])
  const estBillard = table.kind === 'BILLARD' || definition.modules.includes('BILLARD_FILE')
  const estHotel = definition.modules.includes('CHAMBRES')
  const estRestaurant = definition.modules.includes('CUISINE_BAR')

  const ongletsDisponibles: { id: string; label: string }[] = []
  if (estBillard) ongletsDisponibles.push({ id: 'BILLARD_FILE', label: t('billard.onglet') })
  if (estHotel) ongletsDisponibles.push({ id: 'chambre', label: t('hotel.onglet_chambre') || 'Ma chambre' })
  if (!estHotel || estRestaurant || !estBillard) {
    ongletsDisponibles.push({ id: 'menu', label: t('client.la_carte') })
  }
  ongletsDisponibles.push({ id: 'suivi', label: t('client.mes_commandes') })
  ongletsDisponibles.push({ id: 'note', label: t('note.onglet') })

  const ongletDefaut = estBillard ? 'BILLARD_FILE' : (estHotel ? 'chambre' : 'menu')
  const onglet = ongletChoisi ?? ongletDefaut

  // ---------- Étape 1 : prénom (une seule fois) ----------
  const demarrer = async () => {
    if (!prenom.trim()) return
    try {
      const s = await ouvrirSessionClient(token, prenom)
      const c = { sessionId: s.id, prenom: prenom.trim() }
      localStorage.setItem(CLE_CLIENT(token), JSON.stringify(c))
      setClient(c)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t('commun.erreur'))
    }
  }

  if (!client) {
    return (
      <div className="halo-lanterne flex min-h-dvh flex-col items-center justify-center px-6">
        <div className="w-full max-w-sm">
          <div className="mb-8 flex flex-col items-center gap-3 text-center">
            <LogoGBS />
            <div>
              <p className="text-lg font-bold text-white">{terrasse.nom}</p>
              <p className="text-sm text-sable/70">
                {table.kind === 'BILLARD'
                  ? t('billard.zone_numero', { numero: table.numero })
                  : t('client.table', { numero: table.numero })}
              </p>
            </div>
          </div>
          <Carte>
            <p className="mb-1 font-bold text-white">{t('client.bienvenue')}</p>
            <p className="mb-4 text-sm text-sable/70">{t('client.prenom_q')}</p>
            <input
              className={`${classeSaisie} mb-4 text-center text-lg`}
              value={prenom}
              onChange={(e) => setPrenom(e.target.value)}
              placeholder={t('client.prenom_ph')}
              autoFocus
              onKeyDown={(e) => {
                if (e.key === 'Enter') void demarrer()
              }}
            />
            <GrosBouton
              desactive={!prenom.trim()}
              onClick={() => void demarrer()}
            >
              {t('client.voir_carte')}
            </GrosBouton>
          </Carte>
        </div>
      </div>
    )
  }

  // ---------- Données menu / commandes ----------
  const produits = db.produits.filter((p) => p.terrasseId === terrasse.id && p.actif)
  const categories = Array.from(new Set(produits.map((p) => p.categorie)))

  // Recherche produit : pharmacie, boutique et quincaillerie ont des
  // catalogues trop longs pour être parcourus par catégorie
  const rechercheActive = TYPES_RECHERCHE_PRODUIT.includes(terrasse.type)
  const requete = normaliser(recherche.trim())
  const produitsFiltres = requete
    ? produits.filter((p) =>
        normaliser(`${p.nom} ${p.variante ?? ''} ${p.categorie} ${p.codeBarres ?? ''}`).includes(requete))
    : produits
  const mesCommandes = db.commandes.filter((c) => c.clientSessionId === client.sessionId)
  const commandeActive = mesCommandes.find((c) => c.statut === 'EN_ATTENTE' || c.statut === 'CONFIRMEE')
  const derniereServie = mesCommandes.find((c) => c.statut === 'SERVIE' && !db.avis.some((a) => a.commandeId === c.id))
  // Règle cash : une commande servie non payée bloque la suivante (le
  // serveur refuse aussi — ici on explique et on désactive en amont)
  const impayee = mesCommandes.find((c) => c.statut === 'SERVIE' && !c.payeeLe)

  const nbArticles = Object.values(panier).reduce((s, n) => s + n, 0)
  const lignesPanier: LigneCommande[] = Object.entries(panier)
    .filter(([, q]) => q > 0)
    .map(([produitId, quantite]) => {
      const p = produits.find((x) => x.id === produitId)!
      return { produitId, nom: p.nom, quantite, prixCdf: p.prixCdf, prixUsdCentimes: p.prixUsdCentimes }
    })
  const totalCdf = lignesPanier.reduce((s, l) => s + l.prixCdf * l.quantite, 0)
  const totalUsd = lignesPanier.reduce((s, l) => s + l.prixUsdCentimes * l.quantite, 0)

  const changerQte = (p: Produit, delta: number) => {
    if (impayee && delta > 0) {
      toast.error(t('client.impayee_regler', { montant: `${fmtCDF(impayee.totalCdf)}${impayee.totalUsdCentimes ? ` + ${fmtUSD(impayee.totalUsdCentimes)}` : ''}` }))
      return
    }
    setPanier((av) => {
      const actuelle = av[p.id] ?? 0
      const dispo = p.stock - p.stockReserve
      const nouvelle = Math.max(0, Math.min(dispo, actuelle + delta))
      return { ...av, [p.id]: nouvelle }
    })
  }

  const envoyerCommande = async () => {
    if (!lignesPanier.length) return
    if (impayee) {
      toast.error(t('client.impayee_bloque'))
      return
    }
    if (!enLigne) {
      // Mode hors-ligne : la commande partira toute seule au retour du
      // réseau. File IndexedDB (survit aux purges grâce à la persistance)
      // ; la clé d'idempotence interdit tout doublon au renvoi.
      await ajouterALaFile({
        cle: cleCommande,
        token,
        sessionId: client.sessionId,
        lignes: lignesPanier,
        ajouteeLe: new Date().toISOString(),
      })
      setPanier({})
      setVoirPanier(false)
      setCleCommande(uid('cle'))
      toast.info(t('client.hors_ligne_file'))
      setOnglet('suivi')
      return
    }
    try {
      await passerCommande(token, client.sessionId, lignesPanier, cleCommande)
      setPanier({})
      setVoirPanier(false)
      setCleCommande(uid('cle'))
      toast.success(t('client.envoyee'))
      setOnglet('suivi')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t('commun.erreur'))
    }
  }

  const serveuse = utilisateurDe(db, serveuseDeTable(db, table.id))

  /** Scan code-barres : le produit scanné est ajouté directement au panier
   *  (recherche locale dans la carte de l'établissement, sans réseau) */
  const auScan = (code: string) => {
    setScan(false)
    const p = produits.find((x) => x.codeBarres === code)
    if (!p) {
      toast.error(t('client.produit_absent'))
      return
    }
    if (p.stock - p.stockReserve <= 0) {
      toast.error(t('client.produit_epuise', { nom: p.nom }))
      return
    }
    changerQte(p, +1)
    toast.success(t('client.ajoute_panier', { nom: p.nom }))
  }

  return (
    <div className="mx-auto min-h-dvh max-w-[430px] pb-28">
      {/* En-tête terrasse */}
      <header className="sticky top-0 z-30 border-b border-white/5 bg-encre/90 backdrop-blur-md">
        <div className="flex flex-col gap-2 px-4 py-2">
          {/* Ligne 1 : Nom de l'établissement + Table + Langue */}
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0 flex-1">
              <p className="truncate text-lg font-bold text-white">{terrasse.nom}</p>
              <p className="truncate text-xs text-sable/70">
                {estBillard
                  ? t('billard.zone_numero', { numero: table.numero })
                  : t('client.table', { numero: table.numero })}
                {serveuse ? ` · ${t('client.servie_par', { nom: serveuse.nom.split(' ')[0]! })}` : ''}
              </p>
            </div>
            <div className="shrink-0">
              <SelecteurLangue compact />
            </div>
          </div>

          {/* Ligne 2 : Actions (Scan, Prénom, Hors ligne) */}
          <div className="flex items-center justify-end gap-2">
            {!enLigne && (
              <span className="flex items-center gap-1 rounded-full bg-danger/15 px-2.5 py-1 text-xs font-semibold text-danger-clair">
                <WifiOff className="h-3.5 w-3.5" /> {t('client.hors_ligne')}
              </span>
            )}
            {ecritureOk && (
              <button
                type="button"
                onClick={() => setScan(true)}
                aria-label={t('client.scan_aria')}
                className="flex h-9 w-9 items-center justify-center rounded-full bg-white/8 text-sable transition-colors focus-visible:ring-2 focus-visible:ring-ambre/60 active:bg-white/15"
              >
                <ScanBarcode className="h-4 w-4" />
              </button>
            )}
            <span className="truncate rounded-full bg-white/8 px-3 py-1 text-sm font-semibold text-sable">{client.prenom}</span>
          </div>
        </div>
        <div className="flex px-4 pb-2">
          {(estBillard ? ['BILLARD_FILE', 'menu', 'suivi', 'note'] as const : ['menu', 'suivi', 'note'] as const).map((o) => (
            <button
              key={o}
              onClick={() => setOnglet(o)}
              className={`relative flex-1 py-2 text-sm font-bold ${onglet === o ? 'text-ambre' : 'text-sable/60'}`}
            >
              {o === 'menu'
                  ? (estBillard ? t('billard.onglet_boissons') : t('client.la_carte'))
                  : o === 'note'
                    ? t('note.onglet')
                    : `${t('client.mes_commandes')}${commandeActive ? ' •' : ''}`}
              {onglet === o && <span className="absolute inset-x-8 bottom-0 h-0.5 rounded-full bg-ambre" />}
            </button>
          ))}
        </div>
      </header>

      {!ecritureOk && (
        <div className="mx-4 mt-4 rounded-2xl bg-danger/10 px-4 py-3 text-center text-sm font-semibold text-danger-clair">
          {t('client.service_indispo')}
        </div>
      )}

      {/* Règle cash : commande servie non payée → on règle avant de recommander */}
      {impayee && (
        <div className="mx-4 mt-4 flex items-center gap-3 rounded-2xl border border-ambre/40 bg-ambre/10 px-4 py-3">
          <HandCoins className="h-6 w-6 shrink-0 text-ambre" />
          <p className="text-sm text-white">
            <b>{t('client.a_payer', { montant: `${fmtCDF(impayee.totalCdf)}${impayee.totalUsdCentimes ? ` + ${fmtUSD(impayee.totalUsdCentimes)}` : ''}` })}</b>
            {' '}{t('client.a_payer_d', { nom: serveuse ? serveuse.nom.split(' ')[0]! : t('client.la_serveuse') })}
          </p>
        </div>
      )}

      {onglet === 'BILLARD_FILE' ? (
        <BlocBoundary><OngletBillardClient token={token} sessionId={client.sessionId} /></BlocBoundary>
      ) : onglet === 'chambre' ? (
        <div className="px-4 pt-4">
          <Carte>
            <p className="text-lg font-bold text-white">Chambre {table.numero}</p>
            <p className="mt-1 text-sm text-sable/70">{terrasse.nom}</p>
            <div className="mt-4 flex flex-col gap-2">
              <GrosBouton onClick={() => setOnglet('menu')}>Commander le petit-déjeuner</GrosBouton>
              <GrosBouton ton="secondaire" onClick={() => toast.info('Appel à la réception envoyé.')}>Appeler la réception</GrosBouton>
            </div>
          </Carte>
        </div>
      ) : onglet === 'note' ? (
        <BlocBoundary><OngletMaNote sessionId={client.sessionId} /></BlocBoundary>
      ) : onglet === 'menu' ? (
        <div className="px-4 pt-4">
          {commandeActive && (
            <button
              onClick={() => setOnglet('suivi')}
              className="mb-4 flex w-full items-center gap-3 rounded-2xl bg-info/10 px-4 py-3 text-left"
            >
              <Clock className="h-5 w-5 shrink-0 text-info-clair anim-pulsation" />
              <p className="text-sm text-info-clair">
                {t('client.commande_en_cours')} — <b>{commandeActive.statut === 'EN_ATTENTE' ? t('client.envoyee_serveuse') : t('client.en_preparation')}</b>
              </p>
            </button>
          )}

          {/* Recherche produit (pharmacie, boutique, quincaillerie) */}
          {rechercheActive && (
            <div className="relative mb-4">
              <Search className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-sable/50" />
              <input
                className={`${classeSaisie} !pl-12`}
                value={recherche}
                onChange={(e) => setRecherche(e.target.value)}
                placeholder={t('client.recherche_ph')}
                type="search"
                enterKeyHint="search"
                aria-label={t('client.recherche_aria')}
              />
            </div>
          )}

          {/* Liste du menu = bloc protégé (Phase B.2) : un produit
              défectueux n'emporte ni le panier ni la navigation */}
          <BlocBoundary>
          {rechercheActive && requete ? (
            // Résultats de recherche : liste plate, toutes catégories confondues
            <div className="mb-6">
              <h2 className="mb-2 text-xs font-bold uppercase tracking-widest text-sable/50">
                {t(produitsFiltres.length > 1 ? 'client.resultats' : 'client.resultat', { n: produitsFiltres.length })}
              </h2>
              {produitsFiltres.length === 0 ? (
                <Vide
                  icone={<Search className="h-7 w-7" />}
                  titre={t('client.aucun_produit', { q: recherche.trim() })}
                  detail={t('client.aucun_produit_d')}
                />
              ) : (
                <div className="flex flex-col gap-2">
                  {produitsFiltres.map((p) => (
                    <LigneProduitMenu key={p.id} p={p} qte={panier[p.id] ?? 0} ecritureOk={ecritureOk} onChangerQte={changerQte} />
                  ))}
                </div>
              )}
            </div>
          ) : (
          categories.map((cat) => (
            <div key={cat} className="mb-6">
              <h2 className="mb-2 text-xs font-bold uppercase tracking-widest text-sable/50">{cat}</h2>
              <div className="flex flex-col gap-2">
                {produits.filter((p) => p.categorie === cat).map((p) => (
                  <LigneProduitMenu key={p.id} p={p} qte={panier[p.id] ?? 0} ecritureOk={ecritureOk} onChangerQte={changerQte} />
                ))}
              </div>
            </div>
          ))
          )}
          </BlocBoundary>
          <p className="pb-4 text-center text-xs text-sable/40">{t('client.paiement_cash')}</p>
        </div>
      ) : (
        <SuiviCommandes
          mesCommandes={mesCommandes}
          sessionId={client.sessionId}
          derniereServie={derniereServie ?? null}
        />
      )}

      {/* Barre panier */}
      {nbArticles > 0 && onglet === 'menu' && ecritureOk && (
        <div className="fixed inset-x-0 bottom-0 z-40 mx-auto max-w-[430px] p-4">
          <button
            onClick={() => setVoirPanier(true)}
            className="flex w-full items-center justify-between rounded-2xl bg-ambre px-5 py-4 font-bold text-sur-ambre shadow-lg shadow-black/40 active:bg-ambre-actif"
          >
            <span className="flex items-center gap-2">
              <ShoppingBasket className="h-5 w-5" />
              {t(nbArticles > 1 ? 'client.articles' : 'client.article', { n: nbArticles })}
            </span>
            <span className="font-mono">
              {totalCdf > 0 && <>{totalCdf.toLocaleString('fr-CD')} FC</>}
              {totalCdf > 0 && totalUsd > 0 && ' + '}
              {totalUsd > 0 && <>{(totalUsd / 100).toFixed(2).replace('.', ',')} $</>}
            </span>
          </button>
        </div>
      )}

      {/* Scanner code-barres (plein écran, caméra arrière) */}
      {scan && (
        <Suspense fallback={<div className="fixed inset-0 z-[70] bg-black" />}>
          <ScanCodeBarres onScan={auScan} surFermer={() => setScan(false)} />
        </Suspense>
      )}

      {/* Feuille confirmation panier */}
      <Feuille ouvert={voirPanier} surFermer={() => setVoirPanier(false)} titre={t('client.votre_commande')}>
        <div className="mb-4 flex flex-col gap-2">
          {lignesPanier.map((l) => (
            <div key={l.produitId} className="flex items-center justify-between rounded-2xl bg-white/5 px-4 py-3">
              <div>
                <p className="font-semibold text-white">{l.nom}</p>
                <p className="text-sm text-sable/60">× {l.quantite}</p>
              </div>
              <Money cdf={l.prixCdf * l.quantite} usd={l.prixUsdCentimes * l.quantite} />
            </div>
          ))}
        </div>
        <div className="mb-5 flex items-center justify-between border-t border-white/10 pt-4">
          <p className="font-bold text-white">{t('client.total_cash')}</p>
          <Money cdf={totalCdf} usd={totalUsd} gros />
        </div>
        <GrosBouton onClick={envoyerCommande}>
          <CircleCheck className="h-5 w-5" /> {t('client.envoyer_serveuse')}
        </GrosBouton>
        <p className="mt-3 text-center text-xs text-sable/50">{t('client.table_paiement', { numero: table.numero })}</p>
      </Feuille>
    </div>
  )
}

// ---------- Ligne produit du menu (catégories + résultats de recherche) ----------

function LigneProduitMenu({ p, qte, ecritureOk, onChangerQte }: {
  p: Produit
  qte: number
  ecritureOk: boolean
  onChangerQte: (p: Produit, delta: number) => void
}) {
  const t = useT()
  const dispo = p.stock - p.stockReserve
  return (
    <div className={`flex items-center gap-3 rounded-2xl border border-white/8 bg-surface p-3 ${dispo <= 0 ? 'opacity-40' : ''}`}>
      {(p.photoThumbnailUrl ?? p.photoUrl) && (
        <img
          src={p.photoThumbnailUrl ?? p.photoUrl ?? undefined}
          alt={p.nom}
          loading="lazy"
          className="h-14 w-14 shrink-0 rounded-xl object-cover"
        />
      )}
      <div className="min-w-0 flex-1">
        <p className="font-semibold text-white">{p.nom}</p>
        <Money cdf={p.prixCdf} usd={p.prixUsdCentimes} />
        {dispo <= 0 && <p className="text-xs font-semibold text-danger-clair">{t('client.epuise')}</p>}
      </div>
      {dispo > 0 && ecritureOk && (
        <div className="flex items-center gap-2">
          {qte > 0 && (
            <>
              <button onClick={() => onChangerQte(p, -1)} className="flex h-11 w-11 items-center justify-center rounded-full bg-white/8 text-white transition-colors focus-visible:ring-2 focus-visible:ring-ambre/60 active:bg-white/15" aria-label={t('client.retirer')}>
                <Minus className="h-5 w-5" />
              </button>
              <span className="w-6 text-center font-mono text-lg font-bold text-white">{qte}</span>
            </>
          )}
          <button onClick={() => onChangerQte(p, 1)} className="flex h-11 w-11 items-center justify-center rounded-full bg-ambre text-sur-ambre transition-colors focus-visible:ring-2 focus-visible:ring-white/70 active:bg-ambre-actif" aria-label={t('commun.ajouter')}>
            <Plus className="h-5 w-5" />
          </button>
        </div>
      )}
    </div>
  )
}

// ---------- Suivi des commandes + avis ----------

/** Ticket client : reçu détaillé d'une commande payée — affichage,
 *  impression (reçu papier/PDF) et partage WhatsApp. */
function FeuilleTicket({ commande, surFermer }: { commande: Commande; surFermer: () => void }) {
  const db = useDB()
  const t = useT()
  const [impression, setImpression] = useState(false)
  const terrasse = db.terrasses.find((x) => x.id === commande.terrasseId)
  const table = db.tables.find((x) => x.id === commande.tableId)
  const client = db.clientsSession.find((x) => x.id === commande.clientSessionId)
  const payeeLe = commande.payeeLe ?? commande.creeLe

  const totalTxt = `${fmtCDF(commande.totalCdf)}${commande.totalUsdCentimes > 0 ? ` + ${fmtUSD(commande.totalUsdCentimes)}` : ''}`
  const lignesTxt = commande.lignes.map(
    (l) => `${l.quantite} × ${l.nom} — ${fmtCDF(l.prixCdf * l.quantite)}${l.prixUsdCentimes > 0 ? ` (${fmtUSD(l.prixUsdCentimes * l.quantite)})` : ''}`,
  )
  // Version texte (WhatsApp) : sobre, lisible sur n'importe quel téléphone
  const texteTicket = [
    `${terrasse?.nom ?? ''} — ${terrasse?.adresse ?? ''}`,
    `${t('client.ticket_table')} ${table?.numero ?? '?'} · ${client?.prenom ?? ''} · ${dateHeure(payeeLe)}`,
    '',
    ...lignesTxt,
    '',
    `TOTAL : ${totalTxt}`,
    t('client.ticket_merci'),
  ].join('\n')

  const imprimer = () => {
    setImpression(true)
    setTimeout(() => window.print(), 60) // laisse React monter la zone avant l'impression
  }

  return (
    <Feuille ouvert surFermer={surFermer} titre={t('client.ticket_titre')}>
      <Carte>
        <p className="text-center text-base font-extrabold text-white">{terrasse?.nom}</p>
        <p className="mb-3 text-center text-xs text-sable/60">{terrasse?.adresse}</p>
        <p className="mb-3 text-center text-xs text-sable/60">
          {t('client.ticket_table')} {table?.numero ?? '?'} · {client?.prenom ?? ''} · {dateHeure(payeeLe)}
        </p>
        <div className="mb-3 flex flex-col gap-1 border-t border-white/8 pt-3">
          {commande.lignes.map((l) => (
            <div key={l.produitId} className="flex justify-between text-sm">
              <span className="text-white">{l.quantite} × {l.nom}</span>
              <Money cdf={l.prixCdf * l.quantite} usd={l.prixUsdCentimes * l.quantite} />
            </div>
          ))}
        </div>
        <div className="flex items-center justify-between border-t border-white/8 pt-3">
          <span className="text-sm font-bold text-sable">TOTAL</span>
          <Money cdf={commande.totalCdf} usd={commande.totalUsdCentimes} gros />
        </div>
        <p className="mt-3 text-center text-xs text-sable/50">{t('client.ticket_merci')}</p>
      </Carte>
      <div className="mt-3 grid grid-cols-2 gap-2">
        <GrosBouton petit ton="secondaire" onClick={imprimer}>
          <Printer className="h-4 w-4" /> {t('client.ticket_imprimer')}
        </GrosBouton>
        <a
          href={`https://wa.me/?text=${encodeURIComponent(texteTicket)}`}
          target="_blank"
          rel="noreferrer"
          className="flex min-h-11 items-center justify-center gap-2 rounded-2xl bg-white/10 px-4 text-sm font-bold text-white active:bg-white/20"
        >
          <Share2 className="h-4 w-4" /> WhatsApp
        </a>
      </div>

      {/* Zone d'impression : reçu au format ticket (80 mm), seul bloc imprimé */}
      {impression && createPortal(
        <div className="zone-impression hidden print:block">
          <h1 style={{ fontSize: 18, fontWeight: 800, textAlign: 'center' }}>{terrasse?.nom}</h1>
          <p style={{ textAlign: 'center', fontSize: 12 }}>{terrasse?.adresse}</p>
          <p style={{ textAlign: 'center', fontSize: 12 }}>
            {t('client.ticket_table')} {table?.numero ?? '?'} · {client?.prenom ?? ''} · {dateHeure(payeeLe)}
          </p>
          <hr style={{ margin: '10px 0', borderStyle: 'dashed' }} />
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <tbody>
              {commande.lignes.map((l) => (
                <tr key={l.produitId}>
                  <td style={{ padding: '2px 0' }}>{l.quantite} × {l.nom}</td>
                  <td style={{ textAlign: 'right' }}>{fmtCDF(l.prixCdf * l.quantite)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <hr style={{ margin: '10px 0', borderStyle: 'dashed' }} />
          <p style={{ textAlign: 'right', fontSize: 15, fontWeight: 800 }}>TOTAL : {totalTxt}</p>
          <p style={{ marginTop: 12, textAlign: 'center', fontSize: 12 }}>{t('client.ticket_merci')}</p>
        </div>,
        document.body,
      )}
    </Feuille>
  )
}

function SuiviCommandes({
  mesCommandes, sessionId, derniereServie,
}: {
  mesCommandes: Commande[]
  sessionId: string
  derniereServie: Commande | null
}) {
  const db = useDB()
  const t = useT()
  const [note, setNote] = useState(5)
  const [commentaire, setCommentaire] = useState('')
  // Ticket client : commande payée dont on affiche le reçu
  const [ticketId, setTicketId] = useState<string | null>(null)
  const commandeTicket = ticketId ? mesCommandes.find((c) => c.id === ticketId) ?? null : null

  if (mesCommandes.length === 0) {
    return <Vide icone={<ReceiptText className="h-8 w-8" />} titre={t('client.aucune_commande')} detail={t('client.aucune_commande_d')} />
  }

  return (
    <div className="flex flex-col gap-3 px-4 pt-4">
      {mesCommandes.map((c) => (
        <Carte key={c.id} classe="anim-arrivee">
          <div className="mb-2 flex items-center justify-between">
            <p className="text-sm text-sable/60">{ilYA(c.creeLe)}</p>
            <BadgeCmd statut={c.statut} />
          </div>
          <div className="mb-3 flex flex-col gap-1">
            {c.lignes.map((l) => (
              <div key={l.produitId} className="flex justify-between text-sm">
                <span className="text-white">{l.quantite} × {l.nom}</span>
                <Money cdf={l.prixCdf * l.quantite} usd={l.prixUsdCentimes * l.quantite} />
              </div>
            ))}
          </div>
          <div className="flex items-center justify-between border-t border-white/8 pt-3">
            <Money cdf={c.totalCdf} usd={c.totalUsdCentimes} gros />
            {c.statut === 'EN_ATTENTE' && (
              <button
                onClick={async () => {
                  try {
                    await annulerMaCommande(c.id, sessionId)
                    toast.success(t('client.commande_annulee'))
                  } catch (e) {
                    toast.error(e instanceof Error ? e.message : t('commun.erreur'))
                  }
                }}
                className="text-sm font-semibold text-danger-clair underline underline-offset-2"
              >
                {t('commun.annuler')}
              </button>
            )}
            {c.statut === 'SERVIE' && (
              <div className="flex flex-col items-end gap-1">
                <span className="flex items-center gap-1 text-sm font-semibold text-succes-clair">
                  <UtensilsCrossed className="h-4 w-4" /> {t('client.bon_appetit')}
                </span>
                {c.payeeLe
                  ? (
                    <button
                      onClick={() => setTicketId(c.id)}
                      className="flex items-center gap-1 text-xs font-bold text-ambre underline underline-offset-2"
                    >
                      <ReceiptText className="h-3.5 w-3.5" /> {t('client.ticket')}
                    </button>
                  )
                  : <span className="text-xs font-bold text-ambre">{t('client.a_payer_court')}</span>}
              </div>
            )}
          </div>

          {/* Avis après service */}
          {derniereServie?.id === c.id && (
            <div className="mt-4 rounded-2xl bg-ambre/8 p-4">
              <p className="mb-2 text-sm font-bold text-white">{t('client.avis_q')}</p>
              <Etoiles note={note} onChange={setNote} />
              <textarea
                className={`${classeSaisie} mt-3 min-h-16 text-sm`}
                placeholder={t('client.avis_ph')}
                value={commentaire}
                onChange={(e) => setCommentaire(e.target.value)}
              />
              <div className="mt-3">
                <GrosBouton
                  petit
                  onClick={async () => {
                    try {
                      await noterServeuse(c.id, sessionId, note, commentaire)
                      toast.success(t('client.avis_merci'))
                    } catch (e) {
                      toast.error(e instanceof Error ? e.message : t('commun.erreur'))
                    }
                  }}
                >
                  {t('client.avis_envoyer')}
                </GrosBouton>
              </div>
            </div>
          )}
        </Carte>
      ))}
      {db.avis.some((a) => mesCommandes.some((c) => c.id === a.commandeId)) && (
        <p className="py-2 text-center text-xs text-sable/40">{t('client.avis_note_merci')}</p>
      )}
      {/* Reçu d'une commande payée (imprimable, partageable WhatsApp) */}
      {commandeTicket && <FeuilleTicket commande={commandeTicket} surFermer={() => setTicketId(null)} />}
    </div>
  )
}