// ============================================================
// GBS — Billard Vincaire : les DEUX faces du système (étape 3).
//
// • OngletBillardClient : ce que voit le joueur qui scanne le QR
//   du billard — partie en cours, vincaire et sa série, file
//   d'attente en direct, son ticket (position + attente estimée),
//   achat de ticket (cash validé par la serveuse).
// • PanneauBillards : le tableau de commande du staff (serveuse,
//   billardier, gérant, propriétaire) — validation des paiements,
//   lancer la partie, déclarer le gagnant, absences, ajout au
//   comptoir ; config + statistiques pour gérant/propriétaire.
//
// Toutes les règles métier sont côté serveur (api/routers/
// billard.ts) ; ces écrans ne font qu'afficher et déclencher.
// ============================================================

import { useState } from 'react'
import {
  Banknote, CircleAlert, CirclePlay, Clock, Crown, Flag, Hourglass, Plus,
  Settings, Swords, Target, Trophy, UserPlus, UserX, Users, XCircle,
} from 'lucide-react'
import { toast } from 'sonner'
import { Carte, Chargement, Confirmation, Feuille, GrosBouton, Pill, SaisieNombre, Vide, classeSaisie } from '@/components/gbs'
import { trpc } from '@/providers/trpc'
import { useT } from '@/i18n'
import { fmtCDF, ilYA } from '@/lib/format'
import {
  acheterTokenBillard, ajouterJoueurComptoirBillard, annulerMonTokenBillard, annulerPartieBillard,
  appelerSuivantBillard, configurerBillard, creerTableBillard, declarerDefaiteBillard,
  lancerPartieBillard, marquerAbsentBillard, terminerPartieBillard, useDB, validerPaiementTokenBillard,
} from '@/lib/store'
import type { TableT } from '@/lib/types'

/** Petite étiquette de statut colorée (file d'attente) */
function PillStatut({ statut }: { statut: string }) {
  const t = useT()
  const tons: Record<string, 'neutre' | 'ambre' | 'vert' | 'rouge' | 'bleu'> = {
    ATTENTE_PAIEMENT: 'ambre', EN_FILE: 'bleu', APPELE: 'vert', EN_JEU: 'vert', ABSENT: 'rouge',
  }
  return <Pill ton={tons[statut] ?? 'neutre'}>{t(`billard.statut_${statut.toLowerCase()}`)}</Pill>
}

// ============================================================
// CÔTÉ CLIENT — onglet « Billard » de la vue scannée
// ============================================================

export function OngletBillardClient({ token, sessionId }: { token: string; sessionId: string }) {
  const t = useT()
  const [confirmeAchat, setConfirmeAchat] = useState(false)
  const [confirmeAnnulation, setConfirmeAnnulation] = useState(false)
  const [confirmeDefaite, setConfirmeDefaite] = useState(false)
  const file = trpc.billard.voirFile.useQuery(
    { token, clientSessionId: sessionId },
    { refetchInterval: 4000 }, // la file bouge sans recharger la page
  )

  if (file.isPending) return <Chargement label={t('billard.chargement')} />
  if (file.error || !file.data) {
    return (
      <div className="px-4 pt-4">
        <Vide icone={<CircleAlert className="h-8 w-8" />} titre={t('billard.indisponible')} detail={t('billard.indisponible_d')} />
      </div>
    )
  }

  const f = file.data
  const mon = f.monToken

  const acheter = async () => {
    try {
      await acheterTokenBillard(token, sessionId)
      setConfirmeAchat(false)
      toast.success(t('billard.ticket_cree'))
      void file.refetch()
    } catch (e) { toast.error(e instanceof Error ? e.message : t('commun.erreur')) }
  }
  const annuler = async () => {
    if (!mon) return
    try {
      await annulerMonTokenBillard(mon.id, sessionId)
      setConfirmeAnnulation(false)
      toast.success(t('billard.ticket_annule'))
      void file.refetch()
    } catch (e) { toast.error(e instanceof Error ? e.message : t('commun.erreur')) }
  }
  /** Le perdant déclare sa défaite : le serveur promeut le gagnant
   *  roi et lance immédiatement le match suivant (automatisation). */
  const declarerDefaite = async () => {
    setConfirmeDefaite(false)
    try {
      const r = await declarerDefaiteBillard(token, sessionId)
      toast.success(t('billard.defaite_enregistree', { nom: r.gagnant.prenom }))
      void file.refetch()
    } catch (e) { toast.error(e instanceof Error ? e.message : t('commun.erreur')) }
  }

  return (
    <div className="flex flex-col gap-3 px-4 pt-4">
      {/* ---------- Partie en cours / vincaire régnant ---------- */}
      <Carte classe={f.partieEnCours ? 'border-ambre/30 bg-ambre/5' : ''}>
        {f.partieEnCours && f.vincaire ? (
          <div className="text-center">
            <p className="mb-1 text-xs font-bold uppercase tracking-widest text-ambre">
              {t('billard.partie_en_cours', { n: f.partieEnCours.numero })}
            </p>
            <div className="flex items-center justify-center gap-3 text-lg font-bold text-white">
              <span className="flex items-center gap-1.5">
                <Crown className="h-5 w-5 text-ambre" /> {f.vincaire.prenom}
              </span>
              <Swords className="h-4 w-4 text-sable/50" />
              <span>{f.partieEnCours.challenger?.prenom ?? '…'}</span>
            </div>
            {f.vincaire.serie > 1 && (
              <p className="mt-1 text-sm font-semibold text-ambre">
                {t('billard.serie', { n: f.vincaire.serie })}
              </p>
            )}
          </div>
        ) : f.vincaire ? (
          <div className="flex items-center gap-3">
            <Crown className="h-8 w-8 shrink-0 text-ambre" />
            <div>
              <p className="font-bold text-white">{t('billard.vincaire_regnant', { nom: f.vincaire.prenom })}</p>
              <p className="text-sm text-sable/70">
                {f.vincaire.serie > 0 ? `${t('billard.serie', { n: f.vincaire.serie })} · ` : ''}
                {f.vincaire.depuis ? t('billard.depuis', { temps: ilYA(f.vincaire.depuis) }) : ''}
              </p>
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-3">
            <Target className="h-8 w-8 shrink-0 text-sable/50" />
            <p className="font-semibold text-sable/80">{t('billard.table_libre')}</p>
          </div>
        )}
      </Carte>

      {/* ---------- Mon ticket ---------- */}
      {mon ? (
        <Carte classe="border-ambre/40">
          <div className="mb-2 flex items-center justify-between">
            <p className="font-bold text-white">{t('billard.mon_ticket', { n: mon.numero })}</p>
            <PillStatut statut={mon.statut} />
          </div>
          {mon.statut === 'ATTENTE_PAIEMENT' && (
            <p className="text-sm text-sable/80">
              {t('billard.attente_paiement_d', { prix: fmtCDF(f.prixTokenCdf) })}
            </p>
          )}
          {mon.statut === 'EN_FILE' && (
            <div className="flex items-center gap-3">
              <Hourglass className="h-6 w-6 shrink-0 text-info-clair" />
              <p className="text-sm text-sable/80">
                <b className="text-white">{t('billard.position', { n: mon.position })}</b>
                {mon.personnesDevant > 0 ? ` · ${t('billard.personnes_devant', { n: mon.personnesDevant })}` : ''}
                {mon.attenteEstimeeMin ? ` · ${t('billard.attente_estimee', { min: mon.attenteEstimeeMin })}` : ''}
              </p>
            </div>
          )}
          {mon.statut === 'APPELE' && (
            <div className="flex items-center gap-3 rounded-2xl bg-emerald-500/10 px-3 py-2.5">
              <CirclePlay className="h-6 w-6 shrink-0 text-emerald-400 anim-pulsation" />
              <p className="text-sm font-bold text-emerald-300">
                {t('billard.votre_tour', { min: f.delaiPresenceMin })}
              </p>
            </div>
          )}
          {mon.statut === 'EN_JEU' && (
            <>
              <p className="text-sm font-semibold text-emerald-300">{t('billard.en_jeu')}</p>
              {/* Règle Vincaire du prompt maître : le perdant déclare
                  lui-même sa défaite — le match suivant est lancé
                  immédiatement, sans attendre le staff. */}
              <button
                onClick={() => setConfirmeDefaite(true)}
                className="mt-3 flex w-full items-center justify-center gap-2 rounded-2xl border border-danger/40 bg-danger/10 px-3 py-3 text-sm font-bold text-danger-clair active:bg-danger/20"
              >
                <Flag className="h-4 w-4" /> {t('billard.declarer_defaite')}
              </button>
            </>
          )}
          {(mon.statut === 'ATTENTE_PAIEMENT' || mon.statut === 'EN_FILE' || mon.statut === 'APPELE') && (
            <button
              onClick={() => setConfirmeAnnulation(true)}
              className="mt-3 text-sm font-semibold text-danger-clair underline underline-offset-2"
            >
              {t('billard.annuler_ticket')}
            </button>
          )}
        </Carte>
      ) : (
        <GrosBouton onClick={() => setConfirmeAchat(true)}>
          <Plus className="h-5 w-5" /> {t('billard.prendre_ticket', { prix: fmtCDF(f.prixTokenCdf) })}
        </GrosBouton>
      )}

      {/* ---------- File d'attente en direct ---------- */}
      <Carte>
        <p className="mb-2 flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-sable/50">
          <Users className="h-4 w-4" /> {t('billard.file_titre', { n: f.file.length })}
        </p>
        {f.file.length === 0 ? (
          <p className="text-sm text-sable/60">{t('billard.file_vide')}</p>
        ) : (
          <div className="flex flex-col gap-1.5">
            {f.file.map((j, i) => (
              <div key={`${j.numero}-${i}`} className="flex items-center gap-3 rounded-xl bg-white/4 px-3 py-2">
                <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full font-mono text-sm font-bold ${i === 0 ? 'bg-ambre text-sur-ambre' : 'bg-white/8 text-sable'}`}>
                  {i + 1}
                </span>
                <span className="font-semibold text-white">{j.prenom}</span>
                <span className="ml-auto font-mono text-xs text-sable/50">#{j.numero}</span>
              </div>
            ))}
          </div>
        )}
        {f.nbAttentePaiement > 0 && (
          <p className="mt-2 text-xs text-sable/50">{t('billard.attente_paiements', { n: f.nbAttentePaiement })}</p>
        )}
      </Carte>
      <p className="pb-4 text-center text-xs text-sable/40">{t('billard.paiement_cash')}</p>

      {/* Confirmations */}
      <Feuille ouvert={confirmeAchat} surFermer={() => setConfirmeAchat(false)} titre={t('billard.prendre_ticket_titre')}>
        <p className="mb-4 text-sm text-sable/80">
          Le ticket coûte {fmtCDF(f.prixTokenCdf)}. Il sera ajouté à votre note. Vous pouvez commander d'autres articles et payer le tout à la fin.
        </p>
        <GrosBouton onClick={() => void acheter()}>
          <Plus className="h-5 w-5" /> Ajouter à ma note ({fmtCDF(f.prixTokenCdf)})
        </GrosBouton>
      </Feuille>
      <Confirmation
        ouvert={confirmeAnnulation}
        titre={t('billard.annuler_ticket')}
        message={t('billard.annuler_ticket_d')}
        danger
        surAnnuler={() => setConfirmeAnnulation(false)}
        surConfirmer={() => void annuler()}
      />
      <Confirmation
        ouvert={confirmeDefaite}
        titre={t('billard.declarer_defaite')}
        message={t('billard.declarer_defaite_d')}
        danger
        surAnnuler={() => setConfirmeDefaite(false)}
        surConfirmer={() => void declarerDefaite()}
      />
    </div>
  )
}

// ============================================================
// CÔTÉ STAFF — panneau de gestion des billards d'une terrasse
// ============================================================

export function PanneauBillards({ terrasseId, avecConfig = false }: { terrasseId: string; avecConfig?: boolean }) {
  const t = useT()
  const db = useDB()
  const [confirmAjout, setConfirmAjout] = useState(false)
  const billards = db.tables
    .filter((ta) => ta.terrasseId === terrasseId && ta.actif && !ta.archiveLe && ta.kind === 'BILLARD')
    .sort((a, b) => a.numero - b.numero)

  return (
    <div className="flex flex-col gap-3 px-4 pt-4">
      {billards.length === 0 ? (
        <Vide icone={<Target className="h-8 w-8" />} titre={t('billard.aucun')} detail={t('billard.aucun_d')} />
      ) : (
        billards.map((b) => <CarteBillardGestion key={b.id} table={b} />)
      )}
      {avecConfig && (
        <>
          <GrosBouton ton="secondaire" onClick={() => setConfirmAjout(true)}>
            <Plus className="h-5 w-5" /> {t('billard.ajouter_table')}
          </GrosBouton>
          {billards.length > 0 && <CarteConfigBillard terrasseId={terrasseId} tableId={billards[0]!.id} />}
          {billards.length > 0 && <CarteStatsBillard terrasseId={terrasseId} />}
        </>
      )}
      <Confirmation
        ouvert={confirmAjout}
        titre={t('billard.ajouter_table')}
        message={t('billard.ajouter_table_d')}
        surAnnuler={() => setConfirmAjout(false)}
        surConfirmer={async () => {
          try { await creerTableBillard(terrasseId); toast.success(t('billard.table_creee')) }
          catch (e) { toast.error(e instanceof Error ? e.message : t('commun.erreur')) }
          setConfirmAjout(false)
        }}
      />
    </div>
  )
}

/** Une carte de commande par billard : partie, gagnant, file, caisse */
function CarteBillardGestion({ table }: { table: TableT }) {
  const t = useT()
  const [ajoutJoueur, setAjoutJoueur] = useState(false)
  const [prenomJoueur, setPrenomJoueur] = useState('')
  const [dejaPaye, setDejaPaye] = useState(true)
  const [annulationPartie, setAnnulationPartie] = useState(false)
  const [motif, setMotif] = useState('')
  const gestion = trpc.billard.voirGestion.useQuery(
    { tableId: table.id },
    { refetchInterval: 4000 },
  )

  if (gestion.isPending) return <Carte><Chargement /></Carte>
  if (gestion.error || !gestion.data) {
    return (
      <Carte>
        <p className="text-sm text-danger-clair">{t('billard.indisponible')}</p>
      </Carte>
    )
  }
  const g = gestion.data
  const partie = g.partieEnCours
  const parId = new Map(g.tokens.map((tk) => [tk.id, tk]))
  const vincaire = partie?.vincaireTokenId ? parId.get(partie.vincaireTokenId) : undefined
  const challenger = partie?.challengerTokenId ? parId.get(partie.challengerTokenId) : undefined
  const aAppele = g.tokens.some((tk) => tk.statut === 'APPELE')
  const enFile = g.tokens.filter((tk) => tk.statut === 'EN_FILE').length
  const positions = new Map(g.positionFile.map((p) => [p.id, p.position]))

  /** Déclare le gagnant et clôture la partie (le perdant suit la règle) */
  const declarerGagnant = async (gagnantTokenId: string) => {
    if (!partie) return
    try {
      await terminerPartieBillard(partie.id, gagnantTokenId)
      toast.success(t('billard.partie_cloturee'))
      void gestion.refetch()
    } catch (e) { toast.error(e instanceof Error ? e.message : t('commun.erreur')) }
  }

  return (
    <Carte classe="!p-0 overflow-hidden">
      {/* En-tête du billard */}
      <div className="flex items-center justify-between border-b border-white/8 px-4 py-3">
        <p className="flex items-center gap-2 font-bold text-white">
          <Target className="h-5 w-5 text-ambre" /> {t('billard.billard_n', { n: table.numero })}
        </p>
        <Pill ton="ambre">{fmtCDF(g.config.prixTokenCdf)}</Pill>
      </div>

      <div className="flex flex-col gap-3 p-4">
        {/* Partie en cours : les deux boutons « gagnant » */}
        {partie && vincaire ? (
          <div className="rounded-2xl border border-ambre/30 bg-ambre/5 p-3">
            <p className="mb-2 text-center text-xs font-bold uppercase tracking-widest text-ambre">
              {t('billard.partie_en_cours', { n: partie.numero })}
            </p>
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={() => void declarerGagnant(vincaire.id)}
                className="flex flex-col items-center gap-1 rounded-2xl bg-ambre px-3 py-3 font-bold text-sur-ambre active:bg-ambre-actif"
              >
                <Crown className="h-5 w-5" />
                <span className="text-sm leading-tight">{vincaire.prenom}</span>
                <span className="text-xs font-semibold opacity-80">{t('billard.gagne')}</span>
              </button>
              <button
                onClick={() => { if (challenger) void declarerGagnant(challenger.id) }}
                disabled={!challenger}
                className="flex flex-col items-center gap-1 rounded-2xl bg-white/10 px-3 py-3 font-bold text-white active:bg-white/20 disabled:opacity-40"
              >
                <Trophy className="h-5 w-5" />
                <span className="text-sm leading-tight">{challenger?.prenom ?? '…'}</span>
                <span className="text-xs font-semibold opacity-80">{t('billard.gagne')}</span>
              </button>
            </div>
            <button
              onClick={() => setAnnulationPartie(true)}
              className="mt-2 w-full text-center text-xs font-semibold text-danger-clair underline underline-offset-2"
            >
              {t('billard.annuler_partie')}
            </button>
          </div>
        ) : (
          <div className="flex gap-2">
            <GrosBouton
              petit
              onClick={async () => {
                try { await lancerPartieBillard(table.id); toast.success(t('billard.partie_lancee')); void gestion.refetch() }
                catch (e) { toast.error(e instanceof Error ? e.message : t('commun.erreur')) }
              }}
            >
              <CirclePlay className="h-5 w-5" /> {t('billard.lancer')}
            </GrosBouton>
            {enFile > 0 && !aAppele && (
              <GrosBouton
                petit ton="secondaire"
                onClick={async () => {
                  try { await appelerSuivantBillard(table.id); void gestion.refetch() }
                  catch (e) { toast.error(e instanceof Error ? e.message : t('commun.erreur')) }
                }}
              >
                {t('billard.appeler_suivant')}
              </GrosBouton>
            )}
          </div>
        )}

        {/* Tokens : paiements à valider, appelés, file */}
        {g.tokens.length === 0 ? (
          <p className="text-sm text-sable/60">{t('billard.aucun_joueur')}</p>
        ) : (
          <div className="flex flex-col gap-2">
            {g.tokens.map((tk) => (
              <div key={tk.id} className="flex items-center gap-3 rounded-2xl bg-white/4 px-3 py-2.5">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white/8 font-mono text-sm font-bold text-sable">
                  {tk.statut === 'EN_FILE' ? (positions.get(tk.id) ?? '–') : `#${tk.numero}`}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold text-white">
                    {tk.prenom}
                    {tk.comptoir && <span className="ml-1 text-xs text-sable/50">({t('billard.comptoir')})</span>}
                    {tk.serie > 0 && tk.statut === 'EN_JEU' && (
                      <span className="ml-1 text-xs font-bold text-ambre">· {t('billard.serie', { n: tk.serie })}</span>
                    )}
                  </p>
                  <PillStatut statut={tk.statut} />
                </div>
                {tk.statut === 'ATTENTE_PAIEMENT' && (
                  <button
                    onClick={async () => {
                      try { await validerPaiementTokenBillard(tk.id); toast.success(t('billard.paiement_valide', { n: tk.numero })); void gestion.refetch() }
                      catch (e) { toast.error(e instanceof Error ? e.message : t('commun.erreur')) }
                    }}
                    className="flex shrink-0 items-center gap-1.5 rounded-full bg-ambre px-3 py-2 text-xs font-bold text-sur-ambre active:bg-ambre-actif"
                  >
                    <Banknote className="h-4 w-4" /> {fmtCDF(tk.prixCdf)}
                  </button>
                )}
                {tk.statut === 'APPELE' && (
                  <button
                    onClick={async () => {
                      try { await marquerAbsentBillard(tk.id); toast.success(t('billard.absent_marque')); void gestion.refetch() }
                      catch (e) { toast.error(e instanceof Error ? e.message : t('commun.erreur')) }
                    }}
                    className="flex shrink-0 items-center gap-1.5 rounded-full bg-danger/15 px-3 py-2 text-xs font-bold text-danger-clair active:bg-danger/25"
                  >
                    <UserX className="h-4 w-4" /> {t('billard.absent')}
                  </button>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Ajout au comptoir (client sans téléphone) */}
        <button
          onClick={() => setAjoutJoueur(true)}
          className="flex items-center justify-center gap-2 rounded-2xl border border-dashed border-white/15 px-3 py-2.5 text-sm font-semibold text-sable/80 active:bg-white/5"
        >
          <UserPlus className="h-4 w-4" /> {t('billard.ajouter_comptoir')}
        </button>
      </div>

      {/* Feuille : ajout joueur comptoir */}
      <Feuille ouvert={ajoutJoueur} surFermer={() => setAjoutJoueur(false)} titre={t('billard.ajouter_comptoir')}>
        <input
          className={`${classeSaisie} mb-3`}
          value={prenomJoueur}
          onChange={(e) => setPrenomJoueur(e.target.value)}
          placeholder={t('billard.prenom_ph')}
          autoFocus
        />
        <label className="mb-4 flex items-center gap-3 rounded-2xl bg-white/5 px-4 py-3">
          <input type="checkbox" checked={dejaPaye} onChange={(e) => setDejaPaye(e.target.checked)} className="h-5 w-5 accent-ambre" />
          <span className="text-sm text-white">{t('billard.deja_paye', { prix: fmtCDF(g.config.prixTokenCdf) })}</span>
        </label>
        <GrosBouton
          desactive={!prenomJoueur.trim()}
          onClick={async () => {
            try {
              await ajouterJoueurComptoirBillard(table.id, prenomJoueur.trim(), dejaPaye)
              toast.success(t('billard.joueur_ajoute'))
              setPrenomJoueur(''); setAjoutJoueur(false)
              void gestion.refetch()
            } catch (e) { toast.error(e instanceof Error ? e.message : t('commun.erreur')) }
          }}
        >
          <UserPlus className="h-5 w-5" /> {t('billard.confirmer_ajout')}
        </GrosBouton>
      </Feuille>

      {/* Feuille : annulation de la partie (motif obligatoire) */}
      <Feuille ouvert={annulationPartie} surFermer={() => setAnnulationPartie(false)} titre={t('billard.annuler_partie')}>
        <p className="mb-3 text-sm text-sable/70">{t('billard.annuler_partie_d')}</p>
        <input
          className={`${classeSaisie} mb-4`}
          value={motif}
          onChange={(e) => setMotif(e.target.value)}
          placeholder={t('billard.motif_ph')}
        />
        <GrosBouton
          ton="danger"
          desactive={motif.trim().length < 3}
          onClick={async () => {
            if (!partie) return
            try {
              await annulerPartieBillard(partie.id, motif.trim())
              toast.success(t('billard.partie_annulee'))
              setMotif(''); setAnnulationPartie(false)
              void gestion.refetch()
            } catch (e) { toast.error(e instanceof Error ? e.message : t('commun.erreur')) }
          }}
        >
          <XCircle className="h-5 w-5" /> {t('billard.confirmer_annulation')}
        </GrosBouton>
      </Feuille>
    </Carte>
  )
}

/** Configuration du billard (gérant/propriétaire) : prix, règle du
 *  perdant, limite de série, délai de présence. */
function CarteConfigBillard({ terrasseId, tableId }: { terrasseId: string; tableId: string }) {
  const t = useT()
  const [ouvert, setOuvert] = useState(false)
  const gestion = trpc.billard.voirGestion.useQuery({ tableId })
  const [prix, setPrix] = useState('')
  const [regle, setRegle] = useState<'RACHAT' | 'FIN_FILE' | 'SORTIE'>('RACHAT')
  const [maxParties, setMaxParties] = useState('')
  const [delai, setDelai] = useState('')

  const config = gestion.data?.config
  const ouvrir = () => {
    // Pré-remplit avec la config actuelle au moment d'ouvrir la feuille
    setPrix(String(config?.prixTokenCdf ?? 5000))
    setRegle(config?.reglePerdant ?? 'RACHAT')
    setMaxParties(config?.maxPartiesVincaire ? String(config.maxPartiesVincaire) : '')
    setDelai(String(config?.delaiPresenceMin ?? 3))
    setOuvert(true)
  }

  return (
    <Carte>
      <div className="flex items-center justify-between">
        <div>
          <p className="flex items-center gap-2 font-bold text-white"><Settings className="h-5 w-5 text-sable/60" /> {t('billard.config_titre')}</p>
          {config && (
            <p className="mt-1 text-xs text-sable/60">
              {fmtCDF(config.prixTokenCdf)} · {t(`billard.regle_${config.reglePerdant.toLowerCase()}`)}
              {' · '}{config.maxPartiesVincaire ? t('billard.max_parties', { n: config.maxPartiesVincaire }) : t('billard.vincaire_illimite')}
              {' · '}{t('billard.delai_valeur', { min: config.delaiPresenceMin })}
            </p>
          )}
        </div>
        <GrosBouton petit ton="secondaire" onClick={ouvrir}>{t('commun.modifier')}</GrosBouton>
      </div>
      <Feuille ouvert={ouvert} surFermer={() => setOuvert(false)} titre={t('billard.config_titre')}>
        <p className="mb-1 text-sm font-semibold text-sable/80">{t('billard.prix_token')}</p>
        <SaisieNombre valeur={prix} onChange={setPrix} placeholder="5000" />
        <p className="mb-1 mt-4 text-sm font-semibold text-sable/80">{t('billard.regle_perdant')}</p>
        <select className={`${classeSaisie} [&>option]:bg-surface`} value={regle} onChange={(e) => setRegle(e.target.value as typeof regle)}>
          <option value="RACHAT">{t('billard.regle_rachat')}</option>
          <option value="FIN_FILE">{t('billard.regle_fin_file')}</option>
          <option value="SORTIE">{t('billard.regle_sortie')}</option>
        </select>
        <p className="mt-1 text-xs text-sable/50">{t('billard.regle_aide')}</p>
        <p className="mb-1 mt-4 text-sm font-semibold text-sable/80">{t('billard.max_parties_label')}</p>
        <SaisieNombre valeur={maxParties} onChange={setMaxParties} placeholder={t('billard.illimite_ph')} />
        <p className="mb-1 mt-4 text-sm font-semibold text-sable/80">{t('billard.delai_presence')}</p>
        <SaisieNombre valeur={delai} onChange={setDelai} placeholder="3" />
        <div className="mt-5">
          <GrosBouton
            onClick={async () => {
              try {
                await configurerBillard(terrasseId, {
                  prixTokenCdf: parseInt(prix) || 5000,
                  reglePerdant: regle,
                  maxPartiesVincaire: maxParties.trim() === '' ? null : Math.max(1, parseInt(maxParties) || 1),
                  delaiPresenceMin: Math.max(1, parseInt(delai) || 3),
                })
                toast.success(t('billard.config_enregistree'))
                setOuvert(false)
                void gestion.refetch()
              } catch (e) { toast.error(e instanceof Error ? e.message : t('commun.erreur')) }
            }}
          >
            {t('commun.enregistrer')}
          </GrosBouton>
        </div>
      </Feuille>
    </Carte>
  )
}

/** Statistiques du jour (VOIR_RAPPORTS : propriétaire, gérant). */
function CarteStatsBillard({ terrasseId }: { terrasseId: string }) {
  const t = useT()
  const stats = trpc.billard.statsBillard.useQuery({ terrasseId })
  if (stats.isPending) return <Carte><Chargement /></Carte>
  if (stats.error || !stats.data) return null // droits insuffisants : on n'affiche rien
  const st = stats.data
  return (
    <Carte>
      <p className="mb-3 flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-sable/50">
        <Trophy className="h-4 w-4" /> {t('billard.stats_titre')}
      </p>
      <div className="grid grid-cols-3 gap-2 text-center">
        <div className="rounded-2xl bg-white/4 px-2 py-3">
          <p className="font-mono text-lg font-bold text-ambre">{fmtCDF(st.recetteCdf)}</p>
          <p className="text-xs text-sable/60">{t('billard.stats_recette')}</p>
        </div>
        <div className="rounded-2xl bg-white/4 px-2 py-3">
          <p className="font-mono text-lg font-bold text-white">{st.tokensVendus}</p>
          <p className="text-xs text-sable/60">{t('billard.stats_tickets')}</p>
        </div>
        <div className="rounded-2xl bg-white/4 px-2 py-3">
          <p className="font-mono text-lg font-bold text-white">{st.partiesJouees}</p>
          <p className="text-xs text-sable/60">{t('billard.stats_parties')}</p>
        </div>
      </div>
      {st.classement.length > 0 && (
        <div className="mt-3">
          <p className="mb-1.5 text-xs font-bold uppercase tracking-widest text-sable/50">{t('billard.classement')}</p>
          {st.classement.slice(0, 5).map((j, i) => (
            <div key={j.prenom} className="flex items-center gap-2 py-1 text-sm">
              <span className={`font-mono font-bold ${i === 0 ? 'text-ambre' : 'text-sable/50'}`}>{i + 1}.</span>
              <span className="text-white">{j.prenom}</span>
              <span className="ml-auto font-mono text-sable/60">{t('billard.victoires', { n: j.victoires })}</span>
            </div>
          ))}
        </div>
      )}
      {st.dureeMoyenneMin > 0 && (
        <p className="mt-2 flex items-center gap-1.5 text-xs text-sable/50">
          <Clock className="h-3.5 w-3.5" /> {t('billard.duree_moyenne', { min: st.dureeMoyenneMin })}
        </p>
      )}
    </Carte>
  )
}
