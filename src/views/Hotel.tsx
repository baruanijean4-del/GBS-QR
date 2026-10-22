// ============================================================
// GBS — Hôtel : interface RÉCEPTION et MÉNAGE (boucle 9).
// Grille des chambres à code couleur strict :
//   VERT = LIBRE (cliquer → check-in), ROUGE = OCCUPÉE (cliquer →
//   check-out avec montant calculé), JAUNE = À NETTOYER (la
//   gouvernante marque « propre » — jamais la réception : contrôle
//   croisé). Trois modes selon le rôle :
//   - direction (proprio/gérant) : tout + création de chambre ;
//   - reception (réceptionniste) : check-in / check-out ;
//   - menage (gouvernante) : validation du ménage seulement.
// Le backend reste la seule source de vérité (cycle LIBRE →
// OCCUPEE → A_NETTOYER → LIBRE, transactions + verrous) ; l'écran
// se rafraîchit toutes les 4 s.
// ============================================================

import { useState } from 'react'
import {
  BedDouble, BrushCleaning, DoorOpen, LogIn, LogOut, Plus,
} from 'lucide-react'
import { toast } from 'sonner'
import { trpc } from '@/providers/trpc'
import { useT } from '@/i18n'
import {
  Carte, Chargement, Confirmation, Feuille, GrosBouton, Pill, SaisieNombre, Vide, classeSaisie,
} from '@/components/gbs'
import { montantSejourCdf, type ModeSejour, type StatutChambre } from '@contracts/hotel'
import { fmtCDF, ilYA } from '@/lib/format'
import {
  FournisseurPortee, checkInChambre, checkOutSejour, creerChambreHotel,
  marquerChambreNettoyee, modifierChambreHotel, uploadPhotoChambre, rolesSur, useDB, useSession,
} from '@/lib/store'
import { BoutonDeconnexion, CoquilleRole, PorteRole } from '@/components/Coquille'
import { BoutonSupportWhatsApp } from '@/components/gbs'
import type { Terrasse, Utilisateur } from '@/lib/types'

/** Ce que le rôle connecté peut faire sur la grille. */
export type ModeHotel = 'direction' | 'reception' | 'menage'

type ChambreVue = {
  id: string
  numero: string
  type: string
  statut: StatutChambre
  prixNuitCdf: number
  prixHeureCdf: number | null
  photoUrl: string | null
  sejour: {
    id: string
    clientNom: string
    pieceIdentite: string | null
    mode: string
    arriveeLe: string
  } | null
}

/** Couleurs strictes de la maquette : vert/rouge/jaune. */
const STYLES_STATUT: Record<StatutChambre, { cadre: string; pill: 'vert' | 'rouge' | 'ambre' }> = {
  LIBRE: { cadre: 'border-succes/40 bg-succes/8', pill: 'vert' },
  OCCUPEE: { cadre: 'border-danger/40 bg-danger/8', pill: 'rouge' },
  A_NETTOYER: { cadre: 'border-ambre/40 bg-ambre/10', pill: 'ambre' },
}

// ============================================================
// Panneau partagé (direction, réception, ménage)
// ============================================================

export function PanneauHotel({ terrasseId, mode }: { terrasseId: string; mode: ModeHotel }) {
  const t = useT()
  const chambres = trpc.hotel.voirChambres.useQuery(
    { terrasseId },
    { refetchInterval: 4000 }, // l'occupation bouge sans recharger
  )
  const [selection, setSelection] = useState<ChambreVue | null>(null)
  const [creation, setCreation] = useState(false)
  const [modification, setModification] = useState<ChambreVue | null>(null)

  if (chambres.isPending) return <Chargement label={t('hotel.chargement')} />
  if (chambres.error || !chambres.data) {
    return (
      <div className="px-4 pt-4">
        <Vide icone={<BedDouble className="h-8 w-8" />} titre={t('hotel.indisponible')} detail={t('hotel.indisponible_d')} />
      </div>
    )
  }

  const liste = chambres.data as ChambreVue[]
  const peutRecevoir = mode === 'direction' || mode === 'reception'
  const peutNettoyer = mode === 'direction' || mode === 'menage'
  const aNettoyer = liste.filter((c) => c.statut === 'A_NETTOYER').length

  return (
    <div className="flex flex-col gap-3 px-4 pt-4">
      {/* Compteurs d'occupation */}
      <div className="grid grid-cols-3 gap-2">
        <Carte classe="text-center">
          <p className="font-mono text-xl font-bold text-succes-clair">{liste.filter((c) => c.statut === 'LIBRE').length}</p>
          <p className="text-xs text-sable/50">{t('hotel.statut_libre')}</p>
        </Carte>
        <Carte classe="text-center">
          <p className="font-mono text-xl font-bold text-danger-clair">{liste.filter((c) => c.statut === 'OCCUPEE').length}</p>
          <p className="text-xs text-sable/50">{t('hotel.statut_occupee')}</p>
        </Carte>
        <Carte classe="text-center">
          <p className="font-mono text-xl font-bold text-ambre">{aNettoyer}</p>
          <p className="text-xs text-sable/50">{t('hotel.statut_a_nettoyer')}</p>
        </Carte>
      </div>

      {/* Grille des chambres */}
      {liste.length === 0 ? (
        <Vide icone={<BedDouble className="h-8 w-8" />} titre={t('hotel.aucune')} detail={t('hotel.aucune_d')} />
      ) : (
        <div className="grid grid-cols-2 gap-2">
          {liste.map((c) => {
            const style = STYLES_STATUT[c.statut] ?? STYLES_STATUT.LIBRE
            return (
              <button
                key={c.id}
                onClick={() => setSelection(c)}
                className={`flex flex-col items-start gap-1 overflow-hidden rounded-2xl border text-left active:scale-[0.98] ${style.cadre}`}
              >
                {c.photoUrl && (
                  <img src={c.photoUrl} alt={`Chambre ${c.numero}`} className="h-24 w-full object-cover" />
                )}
                <div className="flex w-full items-center justify-between px-3 pt-3">
                  <span className="font-mono text-lg font-bold text-white">{c.numero}</span>
                  <Pill ton={style.pill}>{t(`hotel.statut_${c.statut.toLowerCase()}`)}</Pill>
                </div>
                <div className="px-3 pb-3">
                  <span className="text-xs text-sable/60">{t(`hotel.type_${c.type.toLowerCase()}`)} · {fmtCDF(c.prixNuitCdf)}</span>
                  {c.sejour && (
                    <span className="block truncate text-xs font-semibold text-white">
                      {c.sejour.clientNom} · {ilYA(c.sejour.arriveeLe)}
                    </span>
                  )}
                </div>
              </button>
            )
          })}
        </div>
      )}

      {mode === 'direction' && (
        <GrosBouton ton="secondaire" onClick={() => setCreation(true)}>
          <Plus className="h-5 w-5" /> {t('hotel.ajouter')}
        </GrosBouton>
      )}

      {/* Feuille d'action sur la chambre sélectionnée */}
      {selection && (
        <FeuilleChambre
          chambre={selection}
          peutRecevoir={peutRecevoir}
          peutNettoyer={peutNettoyer}
          surFermer={() => setSelection(null)}
          surFait={() => { setSelection(null); void chambres.refetch() }}
        />
      )}

      {creation && (
        <FeuilleCreation
          terrasseId={terrasseId}
          surFermer={() => setCreation(false)}
          surFait={() => { setCreation(false); void chambres.refetch() }}
        />
      )}

      {modification && (
        <FeuilleModification
          chambre={modification}
          surFermer={() => setModification(null)}
          surFait={() => { setModification(null); void chambres.refetch() }}
        />
      )}
    </div>
  )
}

// ---------- Feuille d'action (check-in / check-out / ménage) ----------

function FeuilleChambre({ chambre, peutRecevoir, peutNettoyer, surFermer, surFait }: {
  chambre: ChambreVue
  peutRecevoir: boolean
  peutNettoyer: boolean
  surFermer: () => void
  surFait: () => void
}) {
  const t = useT()
  const [nom, setNom] = useState('')
  const [piece, setPiece] = useState('')
  const [modeSejour, setModeSejour] = useState<ModeSejour>('NUIT')
  const [confirmeSortie, setConfirmeSortie] = useState(false)
  const [charge, setCharge] = useState(false)

  const executer = async (action: () => Promise<void>) => {
    if (charge) return
    setCharge(true)
    try { await action() } finally { setCharge(false) }
  }

  // Montant estimé du check-out (même calcul PUR que le serveur —
  // le montant facturé reste celui renvoyé par le backend)
  let estime: number | null = null
  if (chambre.statut === 'OCCUPEE' && chambre.sejour) {
    try {
      estime = montantSejourCdf({
        mode: chambre.sejour.mode as ModeSejour,
        arriveeLe: chambre.sejour.arriveeLe,
        departLe: new Date().toISOString(),
        prixNuitCdf: chambre.prixNuitCdf,
        prixHeureCdf: chambre.prixHeureCdf,
      })
    } catch { estime = null }
  }

  return (
    <Feuille ouvert surFermer={surFermer} titre={t('hotel.chambre_n', { n: chambre.numero })}>
      {/* ----- LIBRE → check-in (réception/direction) ----- */}
      {chambre.statut === 'LIBRE' && peutRecevoir && (
        <div className="flex flex-col gap-3">
          <label className="text-xs font-bold uppercase tracking-widest text-sable/50" htmlFor="hot-nom">{t('hotel.nom_client')}</label>
          <input id="hot-nom" className={classeSaisie} value={nom} onChange={(e) => setNom(e.target.value)} maxLength={120} />
          <label className="text-xs font-bold uppercase tracking-widest text-sable/50" htmlFor="hot-piece">{t('hotel.piece_identite')}</label>
          <input id="hot-piece" className={classeSaisie} value={piece} onChange={(e) => setPiece(e.target.value)} maxLength={60} />
          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={() => setModeSejour('NUIT')}
              className={`rounded-2xl border px-3 py-3 text-sm font-bold ${modeSejour === 'NUIT' ? 'border-ambre bg-ambre/15 text-ambre' : 'border-white/10 text-sable/60'}`}
            >
              {t('hotel.mode_nuit')} · {fmtCDF(chambre.prixNuitCdf)}
            </button>
            <button
              onClick={() => chambre.prixHeureCdf !== null && setModeSejour('HEURE')}
              className={`rounded-2xl border px-3 py-3 text-sm font-bold ${modeSejour === 'HEURE' ? 'border-ambre bg-ambre/15 text-ambre' : 'border-white/10 text-sable/60'} ${chambre.prixHeureCdf === null ? 'opacity-40' : ''}`}
            >
              {t('hotel.mode_heure')}{chambre.prixHeureCdf !== null ? ` · ${fmtCDF(chambre.prixHeureCdf)}` : ''}
            </button>
          </div>
          <GrosBouton
            charge={charge}
            desactive={!nom.trim()}
            onClick={() => void executer(async () => {
              try {
                await checkInChambre({ chambreId: chambre.id, clientNom: nom.trim(), pieceIdentite: piece.trim(), mode: modeSejour })
                toast.success(t('hotel.checkin_ok', { nom: nom.trim() }))
                surFait()
              } catch (e) { toast.error(e instanceof Error ? e.message : t('commun.erreur')) }
            })}
          >
            <LogIn className="h-5 w-5" /> {t('hotel.checkin')}
          </GrosBouton>
        </div>
      )}

      {/* ----- OCCUPEE → check-out (réception/direction) ----- */}
      {chambre.statut === 'OCCUPEE' && (
        <div className="flex flex-col gap-3">
          <Carte>
            <p className="font-semibold text-white">{chambre.sejour?.clientNom}</p>
            <p className="text-xs text-sable/60">
              {chambre.sejour?.mode === 'NUIT' ? t('hotel.mode_nuit') : t('hotel.mode_heure')}
              {' · '}{t('hotel.arrivee')} {chambre.sejour ? ilYA(chambre.sejour.arriveeLe) : ''}
            </p>
            {estime !== null && (
              <p className="mt-2 font-mono text-lg font-bold text-ambre">{t('hotel.montant_estime')} {fmtCDF(estime)}</p>
            )}
          </Carte>
          {peutRecevoir && (
            <GrosBouton ton="danger" onClick={() => setConfirmeSortie(true)}>
              <LogOut className="h-5 w-5" /> {t('hotel.checkout')}
            </GrosBouton>
          )}
        </div>
      )}

      {/* ----- A_NETTOYER → validation ménage (gouvernante/direction) ----- */}
      {chambre.statut === 'A_NETTOYER' && peutNettoyer && (
        <GrosBouton
          charge={charge}
          onClick={() => void executer(async () => {
            try {
              await marquerChambreNettoyee(chambre.id)
              toast.success(t('hotel.menage_ok', { n: chambre.numero }))
              surFait()
            } catch (e) { toast.error(e instanceof Error ? e.message : t('commun.erreur')) }
          })}
        >
          <BrushCleaning className="h-5 w-5" /> {t('hotel.marquer_propre')}
        </GrosBouton>
      )}

      {/* Statut sans action permise pour ce rôle */}
      {((chambre.statut === 'LIBRE' && !peutRecevoir)
        || (chambre.statut === 'A_NETTOYER' && !peutNettoyer)) && (
        <p className="text-sm text-sable/60">{t('hotel.aucune_action')}</p>
      )}

      <Confirmation
        ouvert={confirmeSortie}
        titre={t('hotel.checkout')}
        message={t('hotel.checkout_d', { nom: chambre.sejour?.clientNom ?? '', montant: estime !== null ? fmtCDF(estime) : '…' })}
        danger
        surAnnuler={() => setConfirmeSortie(false)}
        surConfirmer={() => {
          setConfirmeSortie(false)
          if (!chambre.sejour) return
          void executer(async () => {
            try {
              const r = await checkOutSejour(chambre.sejour!.id)
              toast.success(t('hotel.checkout_ok', { montant: fmtCDF(r.montantTotalCdf) }))
              surFait()
            } catch (e) { toast.error(e instanceof Error ? e.message : t('commun.erreur')) }
          })
        }}
      />
    </Feuille>
  )
}

// ---------- Feuille de création de chambre (direction) ----------

function FeuilleCreation({ terrasseId, surFermer, surFait }: {
  terrasseId: string
  surFermer: () => void
  surFait: () => void
}) {
  const t = useT()
  const [numero, setNumero] = useState('')
  const [type, setType] = useState<'SIMPLE' | 'DOUBLE' | 'SUITE'>('SIMPLE')
  const [prixNuit, setPrixNuit] = useState('')
  const [prixHeure, setPrixHeure] = useState('')
  const [photoUrl, setPhotoUrl] = useState('')
  const [charge, setCharge] = useState(false)

  const prixN = parseInt(prixNuit, 10)
  const prixH = prixHeure.trim() === '' ? null : parseInt(prixHeure, 10)
  const valide = numero.trim().length > 0 && Number.isFinite(prixN) && prixN > 0
    && (prixH === null || (Number.isFinite(prixH) && prixH > 0))

  return (
    <Feuille ouvert surFermer={surFermer} titre={t('hotel.ajouter')}>
      <div className="flex flex-col gap-3">
        <label className="text-xs font-bold uppercase tracking-widest text-sable/50" htmlFor="hot-num">{t('hotel.numero')}</label>
        <input id="hot-num" className={classeSaisie} value={numero} onChange={(e) => setNumero(e.target.value.slice(0, 10))} placeholder={t('hotel.numero_ph')} />
        <label className="text-xs font-bold uppercase tracking-widest text-sable/50">{t('hotel.type')}</label>
        <div className="grid grid-cols-3 gap-2">
          {(['SIMPLE', 'DOUBLE', 'SUITE'] as const).map((ty) => (
            <button
              key={ty}
              onClick={() => setType(ty)}
              className={`rounded-2xl border px-2 py-2.5 text-sm font-bold ${type === ty ? 'border-ambre bg-ambre/15 text-ambre' : 'border-white/10 text-sable/60'}`}
            >
              {t(`hotel.type_${ty.toLowerCase()}`)}
            </button>
          ))}
        </div>
        <label className="text-xs font-bold uppercase tracking-widest text-sable/50">{t('hotel.prix_nuit')}</label>
        <SaisieNombre valeur={prixNuit} onChange={setPrixNuit} placeholder="40000" />
        <label className="text-xs font-bold uppercase tracking-widest text-sable/50">{t('hotel.prix_heure')}</label>
        <SaisieNombre valeur={prixHeure} onChange={setPrixHeure} placeholder={t('hotel.prix_heure_ph')} />
        <label className="text-xs font-bold uppercase tracking-widest text-sable/50">URL de la photo</label>
        <label className="text-xs font-bold uppercase tracking-widest text-sable/50">Photo de la chambre</label>
        <input
          type="file"
          accept="image/*"
          className={classeSaisie}
          onChange={(e) => {
            const file = e.target.files?.[0]
            if (!file) return
            const reader = new FileReader()
            reader.onload = () => {
              const base64 = (reader.result as string).split(',')[1]
              setPhotoUrl(base64)
            }
            reader.readAsDataURL(file)
          }}
        />
        {photoUrl && (
          <img src={photoUrl.startsWith('data:') ? photoUrl : `data:image/jpeg;base64,${photoUrl}`} alt="Chambre" className="h-32 w-full rounded-xl object-cover" />
        )}
        <GrosBouton
          charge={charge}
          desactive={!valide}
          onClick={() => {
            if (charge) return
            setCharge(true)
            void (async () => {
              try {
                await creerChambreHotel({ terrasseId, numero: numero.trim(), type, prixNuitCdf: prixN, prixHeureCdf: prixH, photoUrl: photoUrl.trim() || null })
                toast.success(t('hotel.chambre_creee', { n: numero.trim() }))
                surFait()
              } catch (e) { toast.error(e instanceof Error ? e.message : t('commun.erreur')) }
              finally { setCharge(false) }
            })()
          }}
        >
          <Plus className="h-5 w-5" /> {t('hotel.confirmer_creation')}
        </GrosBouton>
      </div>
    </Feuille>
  )
}

// ============================================================
// Route /h — espace dédié réceptionniste & gouvernante
// ============================================================

export function VueHotel() {
  const [session] = useSession()
  const portee = session ? { kind: 'staff' as const } : { kind: 'public' as const }
  return (
    <FournisseurPortee portee={portee}>
      <VueHotelInterne />
    </FournisseurPortee>
  )
}

function VueHotelInterne() {
  const t = useT()
  return (
    <PorteRole rolesVoulus={['RECEPTIONNISTE', 'GOUVERNANTE']} indiceDemo={t('hotel.indice_demo')}>
      {({ moi, terrasse }) => <EspaceHotel moi={moi} terrasse={terrasse} />}
    </PorteRole>
  )
}

function EspaceHotel({ moi, terrasse }: { moi: Utilisateur; terrasse: Terrasse }) {
  const t = useT()
  const db = useDB()
  const roles = rolesSur(db, moi.id, terrasse.id)
  // Le rôle décide de l'écran : réception (check-in/out) ou ménage
  const mode: ModeHotel = roles.includes('RECEPTIONNISTE') ? 'reception' : 'menage'
  return (
    <CoquilleRole
      titre={terrasse.nom}
      sousTitre={`${moi.nom} — ${t(mode === 'reception' ? 'role.receptionniste' : 'role.gouvernante')}`}
      droite={
        <div className="flex items-center gap-1">
          <BoutonSupportWhatsApp />
          <BoutonDeconnexion />
        </div>
      }
      actif="chambres"
      onChange={() => undefined}
      onglets={[{ id: 'chambres', label: t('hotel.onglet'), icone: <DoorOpen className="h-6 w-6" /> }]}
    >
      <PanneauHotel terrasseId={terrasse.id} mode={mode} />
    </CoquilleRole>
  )
}

// ---------- Feuille de modification (direction) ----------

function FeuilleModification({ chambre, surFermer, surFait }: {
  chambre: ChambreVue
  surFermer: () => void
  surFait: () => void
}) {
  const t = useT()
  const [photoUrl, setPhotoUrl] = useState(chambre.photoUrl ?? '')
  const [charge, setCharge] = useState(false)

  return (
    <Feuille ouvert surFermer={surFermer} titre={`Modifier la chambre ${chambre.numero}`}>
      <div className="flex flex-col gap-3">
        <label className="text-xs font-bold uppercase tracking-widest text-sable/50">Photo de la chambre</label>
        <input
          type="file"
          accept="image/*"
          className={classeSaisie}
          onChange={(e) => {
            const file = e.target.files?.[0]
            if (!file) return
            const reader = new FileReader()
            reader.onload = () => {
              const base64 = (reader.result as string).split(',')[1]
              setPhotoUrl(base64)
            }
            reader.readAsDataURL(file)
          }}
        />
        {photoUrl && (
          <img src={photoUrl.startsWith('data:') ? photoUrl : `data:image/jpeg;base64,${photoUrl}`} alt={`Chambre ${chambre.numero}`} className="h-32 w-full rounded-xl object-cover" />
        )}
        <GrosBouton
          charge={charge}
          onClick={() => {
            if (charge) return
            setCharge(true)
            void (async () => {
              try {
                if (photoUrl.startsWith('data:')) {
                  // C'est une image base64 → on l'upload
                  const base64 = photoUrl.split(',')[1]
                  const result = await uploadPhotoChambre({ chambreId: chambre.id, fichierBase64: base64 })
                  // On enregistre l'URL renvoyée par le serveur
                  await modifierChambreHotel({ chambreId: chambre.id, photoUrl: result.photoUrl })
                } else {
                  // C'est une URL → on la passe directement
                  await modifierChambreHotel({ chambreId: chambre.id, photoUrl: photoUrl.trim() || null })
                }
                toast.success('Photo mise à jour !')
                surFait()
              } catch (e) { toast.error(e instanceof Error ? e.message : t('commun.erreur')) }
              finally { setCharge(false) }
            })()
          }}
        >
          Enregistrer
        </GrosBouton>
      </div>
    </Feuille>
  )
}
