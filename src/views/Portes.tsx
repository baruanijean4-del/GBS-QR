// ============================================================
// GBS — Portes d'entrée : création d'établissement, invitation,
// connexion. Écrans secondaires chargés À LA DEMANDE (boucle 7,
// budget JS) : l'accueil (premier contact, LCP) reste dans le
// bundle initial ; ces formulaires arrivent au clic, chunk
// pré-caché par le service worker (hors-ligne compris).
// Tous les textes passent par le socle i18n (FR/EN/PT).
// ============================================================

import { useState } from 'react'
import { Check, ChevronDown, KeyRound, QrCode, ShieldCheck, TicketCheck } from 'lucide-react'
import { toast } from 'sonner'
import { Carte, Champ, Chargement, GrosBouton, SaisieNombre, classeSaisie } from '@/components/gbs'
import { SelecteurLangue } from '@/components/SelecteurLangue'
import { fmtUSD } from '@/lib/format'
import { naviguer } from '@/lib/router'
import { tarifDe, tranchePourTables } from '@/lib/pricing'
import { aTablesDeSalle, fraisInstallationPour, TYPES_ZONE_UNIQUE, type TypeEtablissement } from '@contracts/types'
import {
  connexionPin, connexionTelephone, consommerInvitation, ecrireSession, finaliserInscription,
  useAnnuaire, useDB, useDBPret,
} from '@/lib/store'
import { useT } from '@/i18n'
import { CLE_PIN_ADMIN } from '@/lib/constantes'
import { LogoGBS } from './Home'

// ---------- Chemin A : créer son établissement ----------

export function NouvelEtablissement() {
  const db = useDB()
  const pret = useDBPret()
  const t = useT()
  const [nom, setNom] = useState('')
  const [telephone, setTelephone] = useState('')
  const [pin, setPin] = useState('')
  const [nomTerrasse, setNomTerrasse] = useState('')
  const [adresse, setAdresse] = useState('')
  // Fusion multi-métiers : 1 à 3 types cochés, dans l'ORDRE de
  // cochage — le premier est le métier principal (tarification).
  const [typesChoisis, setTypesChoisis] = useState<TypeEtablissement[]>(['TERRASSE'])
  const [typesOuverts, setTypesOuverts] = useState(false)
  const [nbTables, setNbTables] = useState('8')
  const [aussiGerant, setAussiGerant] = useState(true)

  const typePrincipal = typesChoisis[0] ?? 'TERRASSE'
  // Zone de vente unique (« Comptoir » + QR mural) seulement si TOUS
  // les métiers cochés sont à comptoir unique (règle inchangée sinon).
  const boutique = typesChoisis.every((c) => TYPES_ZONE_UNIQUE.includes(c))
  // Établissement 100 % comptoir (pharmacie, boutique, salon…) : pas de
  // « tables » à compter — un seul QR comptoir, tranche PETITE affichée.
  const avecTables = typesChoisis.some((c) => aTablesDeSalle(c))
  const nbZones = avecTables ? Math.max(1, parseInt(nbTables) || 1) : 1
  const tranche = tranchePourTables(nbZones)
  const tarif = db.plansTarifs.length
    ? tarifDe(db, boutique ? 'BOUTIQUE' : 'ESSENTIEL', boutique ? 'PETITE' : tranche)
    : null
  if (!pret) return <Chargement />

  // Les 9 métiers couverts par GBS (libellés et détails traduits)
  const TYPES: { code: TypeEtablissement; nom: string; detail: string }[] = [
    { code: 'TERRASSE', nom: t('inscr.type_terrasse'), detail: t('inscr.type_terrasse_d') },
    { code: 'RESTAURANT', nom: t('inscr.type_restaurant'), detail: t('inscr.type_restaurant_d') },
    { code: 'GUEST_HOUSE', nom: t('inscr.type_hotel'), detail: t('inscr.type_hotel_d') },
    { code: 'BOUTIQUE', nom: t('inscr.type_boutique'), detail: t('inscr.type_boutique_d') },
    { code: 'QUINCAILLERIE', nom: t('inscr.type_quincaillerie'), detail: t('inscr.type_quincaillerie_d') },
    { code: 'PHARMACIE', nom: t('inscr.type_pharmacie'), detail: t('inscr.type_pharmacie_d') },
    { code: 'SALON', nom: t('inscr.type_salon'), detail: t('inscr.type_salon_d') },
    { code: 'BILLARD', nom: t('inscr.type_billard'), detail: t('inscr.type_billard_d') },
    { code: 'AUTRE', nom: t('inscr.type_autre'), detail: t('inscr.type_autre_d') },
  ]
  const nomDe = (code: TypeEtablissement) => TYPES.find((o) => o.code === code)?.nom ?? code
  // Coche/décoche : au moins 1 métier, au plus 3 (l'ordre compte).
  const basculerType = (code: TypeEtablissement) => {
    setTypesChoisis((prev) =>
      prev.includes(code)
        ? (prev.length > 1 ? prev.filter((x) => x !== code) : prev)
        : (prev.length < 3 ? [...prev, code] : prev),
    )
  }
  const libelleNom = boutique ? t('inscr.nom_etab') : typePrincipal === 'GUEST_HOUSE' ? t('inscr.nom_hotel') : typePrincipal === 'RESTAURANT' ? t('inscr.nom_rest') : t('inscr.nom_terr')
  const exempleNom = boutique ? t('inscr.nom_etab_ph') : typePrincipal === 'GUEST_HOUSE' ? t('inscr.nom_hotel_ph') : typePrincipal === 'RESTAURANT' ? t('inscr.nom_rest_ph') : t('inscr.nom_terr_ph')

  return (
    <div className="mx-auto min-h-dvh max-w-[430px] px-4 pb-10">
      <header className="flex items-center justify-between gap-3 py-5">
        <div className="flex items-center gap-3">
          <LogoGBS taille="petit" />
          <p className="text-sm text-sable/60">{t('inscr.titre')}</p>
        </div>
        <SelecteurLangue />
      </header>

      <div className="flex flex-col gap-5">
        <Carte>
          <p className="mb-4 font-bold text-white">{t('inscr.etape1')}</p>
          <div className="flex flex-col gap-4">
            <Champ label={t('inscr.nom')}>
              <input className={classeSaisie} value={nom} onChange={(e) => setNom(e.target.value)} placeholder={t('inscr.nom_ph')} />
            </Champ>
            <Champ label={t('inscr.tel')}>
              <input className={classeSaisie} value={telephone} onChange={(e) => setTelephone(e.target.value)} placeholder={t('inscr.tel_ph')} inputMode="tel" />
            </Champ>
            <Champ label={t('inscr.pin')} aide={t('inscr.pin_aide')}>
              <input className={`${classeSaisie} font-mono tracking-[0.5em]`} value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 8))} placeholder="••••" inputMode="numeric" type="password" />
            </Champ>
          </div>
        </Carte>

        <Carte>
          <p className="mb-4 font-bold text-white">{t('inscr.etape2')}</p>
          <div className="flex flex-col gap-4">
            {/* Métiers de l'établissement : liste déroulante à coches,
                1 à 3 choix — l'ordre de cochage fixe le métier principal.
                Plusieurs métiers cochés = expérience FUSIONNÉE (union
                des modules du registre TYPES_ETABLISSEMENT). */}
            <Champ label={t('inscr.types_label')} aide={t('inscr.principal_hint')}>
              <div className="overflow-hidden rounded-2xl border border-white/10">
                <button
                  type="button"
                  onClick={() => setTypesOuverts((o) => !o)}
                  className="flex w-full items-center justify-between gap-2 bg-white/5 px-4 py-3 text-left"
                >
                  <span className="min-w-0 flex-1 truncate font-semibold text-white">
                    {typesChoisis.map(nomDe).join(' + ')}
                  </span>
                  <ChevronDown className={`h-5 w-5 shrink-0 text-sable/60 transition-transform ${typesOuverts ? 'rotate-180' : ''}`} />
                </button>
                {typesOuverts && (
                  <div className="divide-y divide-white/5 border-t border-white/10">
                    {TYPES.map((opt) => {
                      const rang = typesChoisis.indexOf(opt.code)
                      const coche = rang >= 0
                      const maxAtteint = !coche && typesChoisis.length >= 3
                      return (
                        <button
                          key={opt.code}
                          type="button"
                          disabled={maxAtteint}
                          title={maxAtteint ? t('inscr.types_max') : undefined}
                          onClick={() => basculerType(opt.code)}
                          className={`flex w-full items-center gap-3 px-4 py-3 text-left transition-colors ${coche ? 'bg-ambre/10' : 'hover:bg-white/5'} ${maxAtteint ? 'opacity-40' : ''}`}
                        >
                          <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-md border ${coche ? 'border-ambre bg-ambre text-black' : 'border-white/20'}`}>
                            {coche && <Check className="h-4 w-4" />}
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block font-semibold text-white">{opt.nom}</span>
                            <span className="block truncate text-xs text-sable/60">{opt.detail}</span>
                          </span>
                          {coche && <span className="shrink-0 font-mono text-xs font-bold text-ambre">{rang + 1}</span>}
                        </button>
                      )
                    })}
                  </div>
                )}
              </div>
            </Champ>
            {typesChoisis.length > 1 && (
              <p className="rounded-2xl border border-ambre/20 bg-ambre/5 px-4 py-3 text-sm text-sable/80">
                {t('inscr.fusion_recap', { liste: typesChoisis.map(nomDe).join(' + ') })}
              </p>
            )}
            <Champ label={libelleNom}>
              <input className={classeSaisie} value={nomTerrasse} onChange={(e) => setNomTerrasse(e.target.value)} placeholder={exempleNom} />
            </Champ>
            <Champ label={t('inscr.adresse')}>
              <input className={classeSaisie} value={adresse} onChange={(e) => setAdresse(e.target.value)} placeholder={t('inscr.adresse_ph')} />
            </Champ>
            {avecTables && !boutique && (
              <Champ
                label={typePrincipal === 'GUEST_HOUSE' ? t('inscr.nb_chambres') : typePrincipal === 'BILLARD' ? t('inscr.nb_billards') : t('inscr.nb_tables')}
                aide={t('inscr.nb_aide')}
              >
                <SaisieNombre valeur={nbTables} onChange={setNbTables} min={1} />
              </Champ>
            )}
            <div className="flex items-center justify-between rounded-2xl bg-ambre/10 px-4 py-3">
              <div>
                <p className="text-sm font-semibold text-ambre">
                  {boutique ? t('inscr.plan_comptoir') : t('inscr.tranche', { tranche: t(`tranche.${tranche.toLowerCase()}`) })}
                </p>
                <p className="text-xs text-sable/60">
                  {boutique
                    ? t('inscr.install_zone', { montant: fmtUSD(fraisInstallationPour(typePrincipal)) })
                    : t('inscr.install_autre', { montant: fmtUSD(fraisInstallationPour(typePrincipal)) })}
                </p>
              </div>
              <p className="font-mono text-xl font-bold text-white">{tarif ? fmtUSD(tarif.prixUsdCentimes) : '…'}<span className="text-sm font-normal text-sable/60">{t('commun.par_mois')}</span></p>
            </div>
            <label className="flex cursor-pointer items-center gap-3 rounded-2xl border border-white/10 px-4 py-3">
              <input type="checkbox" checked={aussiGerant} onChange={(e) => setAussiGerant(e.target.checked)} className="h-5 w-5 accent-ambre" />
              <div>
                <p className="text-sm font-semibold text-white">{t('inscr.aussi_gerant')}</p>
                <p className="text-xs text-sable/60">{t('inscr.aussi_gerant_d')}</p>
              </div>
            </label>
          </div>
        </Carte>

        <GrosBouton
          onClick={async () => {
            try {
              const r = await finaliserInscription(nom, telephone, pin, nomTerrasse, adresse, nbZones, aussiGerant, typesChoisis[0], typesChoisis.slice(1))
              // Connexion immédiate avec le PIN que le nouveau propriétaire vient de choisir
              // → récupère le jeton de session (obligatoire pour les appels protégés).
              const co = await connexionPin(r.utilisateurId, pin)
              ecrireSession({ utilisateurId: r.utilisateurId, terrasseId: r.terrasseId, jeton: co.jeton })
              toast.success(t('inscr.bienvenue'))
              naviguer('/p')
            } catch (e) {
              toast.error(e instanceof Error ? e.message : t('commun.erreur'))
            }
          }}
        >
          <ShieldCheck className="h-5 w-5" /> {t('inscr.creer_essai')}
        </GrosBouton>
        <GrosBouton ton="fantome" petit onClick={() => naviguer('/')}>{t('commun.retour')}</GrosBouton>
      </div>
    </div>
  )
}

// ---------- Chemin B : code d'invitation ----------

export function Invitation() {
  const t = useT()
  const [code, setCode] = useState('')
  const [nom, setNom] = useState('')
  const [telephone, setTelephone] = useState('')
  const [pin, setPin] = useState('')

  return (
    <div className="mx-auto min-h-dvh max-w-[430px] px-4 pb-10">
      <header className="flex items-center justify-between gap-3 py-5">
        <div className="flex items-center gap-3">
          <LogoGBS taille="petit" />
          <p className="text-sm text-sable/60">{t('invit.titre')}</p>
        </div>
        <SelecteurLangue />
      </header>
      <Carte>
        <div className="flex flex-col gap-4">
          <Champ label={t('invit.code')} aide={t('invit.code_aide')}>
            <input
              className={`${classeSaisie} font-mono text-center text-xl uppercase tracking-[0.3em]`}
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8))}
              placeholder="AB12CD34"
            />
          </Champ>
          <Champ label={t('inscr.nom')}>
            <input className={classeSaisie} value={nom} onChange={(e) => setNom(e.target.value)} placeholder={t('invit.nom_ph')} />
          </Champ>
          <Champ label={t('inscr.tel')}>
            <input className={classeSaisie} value={telephone} onChange={(e) => setTelephone(e.target.value)} placeholder={t('inscr.tel_ph')} inputMode="tel" />
          </Champ>
          <Champ label={t('invit.pin')}>
            <input className={`${classeSaisie} font-mono tracking-[0.5em]`} type="password" value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 8))} placeholder="••••" inputMode="numeric" />
          </Champ>
          <GrosBouton
            onClick={async () => {
              try {
                const r = await consommerInvitation(code, nom, telephone, pin)
                // Connexion immédiate avec le PIN fraîchement défini → jeton de session.
                const co = await connexionPin(r.utilisateurId, pin)
                ecrireSession({ utilisateurId: r.utilisateurId, terrasseId: r.terrasseId, jeton: co.jeton })
                toast.success(t('invit.bienvenue'))
                naviguer(
                  r.role === 'GERANT' ? '/g'
                    : r.role === 'RECEPTIONNISTE' || r.role === 'GOUVERNANTE' ? '/h'
                      : r.role === 'CHEF' || r.role === 'MAGASINIER' ? '/cuisine'
                        : '/s',
                )
              } catch (e) {
                toast.error(e instanceof Error ? e.message : t('commun.erreur'))
              }
            }}
          >
            <TicketCheck className="h-5 w-5" /> {t('invit.rejoindre')}
          </GrosBouton>
          <GrosBouton ton="fantome" petit onClick={() => naviguer('/')}>{t('commun.retour')}</GrosBouton>
        </div>
      </Carte>
    </div>
  )
}

// ---------- Connexion unique (téléphone + PIN) ----------

export function Connexion() {
  const annuaire = useAnnuaire() // sert uniquement aux raccourcis démo (vide en production)
  const t = useT()
  const [telephone, setTelephone] = useState('')
  const [pin, setPin] = useState('')
  const [chargement, setChargement] = useState(false)

  const personnes = annuaire.data ?? []
  const LIBELLES: Record<string, string> = {
    PROPRIETAIRE: t('conn.role_prop'), GERANT: t('conn.role_ger'), SERVEUSE: t('conn.role_serv'),
    RECEPTIONNISTE: t('role.receptionniste'), GOUVERNANTE: t('role.gouvernante'),
  }

  const entrer = async () => {
    if (chargement) return
    if (!telephone.trim() || !pin) {
      toast.error(t('conn.manquant'))
      return
    }
    setChargement(true)
    try {
      const r = await connexionTelephone(telephone, pin)
      // Super-admin : même porte que tout le monde, direction l'espace
      // plateforme — le PIN saisi y sert directement de preuve d'accès.
      if (r.roles.includes('SUPER_ADMIN')) {
        sessionStorage.setItem(CLE_PIN_ADMIN, pin)
        toast.success(t('conn.bonjour', { nom: r.utilisateur.nom.split(' ')[0]! }))
        naviguer('/admin')
        return
      }
      if (r.terrasses.length === 0) {
        toast.error(t('conn.aucune_terr'))
        return
      }
      ecrireSession({ utilisateurId: r.utilisateur.id, terrasseId: r.terrasses[0]!.id, jeton: r.jeton })
      toast.success(t('conn.bonjour', { nom: r.utilisateur.nom.split(' ')[0]! }))
      // Une seule porte, cinq destinations : le rôle dirige vers le
      // bon espace (réceptionniste et gouvernante → hôtel, boucle 9 ;
      // chef et magasinier → cuisine/traiteur, MODULE-TRAITEUR §9)
      if (r.roles.includes('PROPRIETAIRE')) naviguer('/p')
      else if (r.roles.includes('GERANT')) naviguer('/g')
      else if (r.roles.includes('RECEPTIONNISTE') || r.roles.includes('GOUVERNANTE')) naviguer('/h')
      else if (r.roles.includes('CHEF') || r.roles.includes('MAGASINIER')) naviguer('/cuisine')
      else naviguer('/s')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t('commun.erreur'))
      setPin('')
    } finally {
      setChargement(false)
    }
  }

  return (
    <div className="mx-auto min-h-dvh max-w-[430px] px-4 pb-10">
      <header className="flex items-center justify-between gap-3 py-5">
        <div className="flex items-center gap-3">
          <LogoGBS taille="petit" />
          <p className="text-sm text-sable/60">{t('conn.titre')}</p>
        </div>
        <SelecteurLangue />
      </header>

      <Carte>
        <div className="flex flex-col gap-4">
          <Champ label={t('conn.tel')} aide={t('conn.tel_aide')}>
            <input
              className={`${classeSaisie} font-mono`}
              value={telephone}
              onChange={(e) => setTelephone(e.target.value)}
              placeholder="+243 810 000 001"
              inputMode="tel"
              autoComplete="tel"
              autoFocus
            />
          </Champ>
          <Champ label={t('conn.pin')}>
            <input
              className={`${classeSaisie} text-center font-mono text-2xl tracking-[0.5em]`}
              type="password"
              inputMode="numeric"
              autoComplete="current-password"
              value={pin}
              onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 8))}
              onKeyDown={(e) => e.key === 'Enter' && void entrer()}
              placeholder="••••"
            />
          </Champ>
          <GrosBouton desactive={chargement} onClick={() => void entrer()}>
            <KeyRound className="h-5 w-5" /> {chargement ? t('conn.verif') : t('conn.entrer')}
          </GrosBouton>
          <GrosBouton ton="fantome" petit onClick={() => naviguer('/')}>{t('commun.retour')}</GrosBouton>
        </div>
      </Carte>

      {personnes.length > 0 && (
        <div className="mt-6 flex flex-col gap-2">
          <p className="text-xs font-semibold uppercase tracking-widest text-sable/40">
            {t('conn.demo_titre')}
          </p>
          <div className="grid grid-cols-2 gap-2">
            {personnes.map((p) => (
              <button
                key={p.id}
                onClick={() => { setTelephone(p.telephone); setPin(p.pin) }}
                className="flex items-center gap-3 rounded-2xl border border-white/8 bg-surface p-3 text-left active:border-ambre/50"
              >
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-ambre/15 text-sm font-bold text-ambre">
                  {p.nom.split(' ').map((x) => x[0]).join('').slice(0, 2)}
                </div>
                <div className="min-w-0">
                  <p className="truncate text-sm font-bold text-white">{p.nom}</p>
                  <p className="truncate text-[11px] text-sable/60">
                    {p.roles.map((r) => LIBELLES[r]).join(' · ')}
                  </p>
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="mt-8 flex items-center justify-center gap-2 text-xs text-sable/40">
        <QrCode className="h-4 w-4" />
        <span>{t('conn.client_qr')}</span>
      </div>
    </div>
  )
}
