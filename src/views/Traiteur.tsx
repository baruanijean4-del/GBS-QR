// ============================================================
// GBS — Vue traiteur (MODULE-TRAITEUR §9) : quatre rôles, quatre
// écrans, et AUCUN montant hors du panneau propriétaire.
//
//  * CHEF : composants et recettes (proposées, jamais validées par
//    lui), fiche de production groupée par composant — sans prix ;
//  * MAGASINIER : bon de sortie groupé par ingrédient (lot FEFO,
//    sans prix) + comptage à l'aveugle (théorique jamais affiché) ;
//  * GÉRANT : plans du jour (personnes, heure, entreprise) — sans
//    prix ni coûts ;
//  * PROPRIÉTAIRE : validation des recettes, prix des menus, coûts
//    et marges, valeur des écarts. Lui SEUL voit un montant.
// ============================================================

import { useState } from 'react'
import { ChefHat, ClipboardList, Package, PackageOpen, Plus } from 'lucide-react'
import { toast } from 'sonner'
import { BoutonDeconnexion, CoquilleRole, PorteRole } from '@/components/Coquille'
import { Carte, Chargement, Feuille, GrosBouton, Pill, SaisieNombre, Vide, classeSaisie } from '@/components/gbs'
import { versBase } from '@contracts/traiteur'
import { fmtUSD } from '@/lib/format'
import { rolesSur, useDB } from '@/lib/store'
import type { Terrasse, Utilisateur } from '@/lib/types'
import { trpc } from '@/providers/trpc'
import { useT } from '@/i18n'

const KINDS = ['PLAT', 'SAUCE', 'ACCOMPAGNEMENT', 'BOISSON'] as const
const UNITES_FINES = ['g', 'mg', 'ml', 'pièce'] as const

// ---------- Chef : composants, recettes, fiche de production ----------

function PanneauChef({ terrasse }: { terrasse: Terrasse }) {
  const t = useT()
  const db = useDB()
  const [nom, setNom] = useState('')
  const [kind, setKind] = useState<(typeof KINDS)[number]>('PLAT')
  const [composantChoisi, setComposantChoisi] = useState('')
  const [lignes, setLignes] = useState<{ produitId: string; quantite: string; unite: (typeof UNITES_FINES)[number]; perte: string }[]>([])
  const composants = trpc.traiteur.listeComposants.useQuery({ terrasseId: terrasse.id }, { refetchInterval: 8000 })
  const plans = trpc.traiteur.listePlans.useQuery({ terrasseId: terrasse.id }, { refetchInterval: 8000 })
  const produits = db.produits.filter((p) => p.terrasseId === terrasse.id && p.actif)

  const creerComposant = trpc.traiteur.creerComposant.useMutation({
    onSuccess: () => { setNom(''); toast.success(t('trt.composant_cree')); void composants.refetch() },
    onError: (e) => toast.error(e.message),
  })
  const proposer = trpc.traiteur.proposerRecette.useMutation({
    onSuccess: (r) => { setLignes([]); toast.success(t('trt.recette_proposee', { v: r.version })) },
    onError: (e) => toast.error(e.message),
  })

  const proposerRecette = () => {
    if (!composantChoisi || lignes.length === 0) return
    try {
      proposer.mutate({
        composantId: composantChoisi,
        lignes: lignes.map((l) => ({
          produitId: l.produitId,
          quantiteParPersonneBase: versBase(l.unite, parseFloat(l.quantite.replace(',', '.')) || 0),
          tauxPertePct: parseInt(l.perte) || 0,
        })),
      })
    } catch (e) { toast.error(e instanceof Error ? e.message : t('commun.erreur')) }
  }

  return (
    <div className="flex flex-col gap-4 px-4 pt-4">
      {/* Nouveau composant */}
      <Carte>
        <p className="mb-2 font-bold text-white">{t('trt.nouveau_composant')}</p>
        <input className={`${classeSaisie} mb-2`} value={nom} onChange={(e) => setNom(e.target.value)} placeholder={t('trt.composant_ph')} aria-label={t('trt.composant_ph')} />
        <div className="mb-3 flex flex-wrap gap-2">
          {KINDS.map((k) => (
            <button key={k} onClick={() => setKind(k)}
              className={`rounded-full px-3 py-1.5 text-xs font-bold ${kind === k ? 'bg-ambre text-sur-ambre' : 'bg-white/8 text-sable'}`}>
              {t(`trt.kind_${k.toLowerCase()}`)}
            </button>
          ))}
        </div>
        <GrosBouton petit desactive={!nom.trim() || creerComposant.isPending}
          onClick={() => creerComposant.mutate({ terrasseId: terrasse.id, nom: nom.trim(), kind })}>
          {t('trt.creer_composant')}
        </GrosBouton>
      </Carte>

      {/* Proposer une recette */}
      <Carte>
        <p className="mb-2 font-bold text-white">{t('trt.proposer_recette')}</p>
        <select className={`${classeSaisie} mb-2`} value={composantChoisi} onChange={(e) => setComposantChoisi(e.target.value)} aria-label={t('trt.proposer_recette')}>
          <option value="">{t('trt.choisir_composant')}</option>
          {(composants.data ?? []).map((c) => <option key={c.id} value={c.id}>{c.nom}</option>)}
        </select>
        {lignes.map((l, i) => (
          <div key={i} className="mb-2 flex items-center gap-2">
            <select className={`${classeSaisie} flex-1`} value={l.produitId}
              onChange={(e) => setLignes(lignes.map((x, j) => j === i ? { ...x, produitId: e.target.value } : x))}
              aria-label={t('trt.ingredient')}>
              <option value="">{t('trt.ingredient')}</option>
              {produits.map((p) => <option key={p.id} value={p.id}>{p.nom}</option>)}
            </select>
            <div className="w-20"><SaisieNombre valeur={l.quantite} onChange={(v) => setLignes(lignes.map((x, j) => j === i ? { ...x, quantite: v } : x))} placeholder="0" /></div>
            <select className={`${classeSaisie} w-20`} value={l.unite}
              onChange={(e) => setLignes(lignes.map((x, j) => j === i ? { ...x, unite: e.target.value as typeof UNITES_FINES[number] } : x))}
              aria-label={t('trt.unite')}>
              {UNITES_FINES.map((u) => <option key={u} value={u}>{u}</option>)}
            </select>
            <div className="w-16"><SaisieNombre valeur={l.perte} onChange={(v) => setLignes(lignes.map((x, j) => j === i ? { ...x, perte: v } : x))} placeholder="%" /></div>
          </div>
        ))}
        <div className="flex gap-2">
          <div className="flex-1">
            <GrosBouton petit ton="secondaire" onClick={() => setLignes([...lignes, { produitId: '', quantite: '', unite: 'g', perte: '0' }])}>
              <Plus className="h-4 w-4" /> {t('trt.ajouter_ingredient')}
            </GrosBouton>
          </div>
          <div className="flex-1">
            <GrosBouton petit desactive={!composantChoisi || lignes.length === 0 || lignes.some((l) => !l.produitId || !l.quantite) || proposer.isPending}
              onClick={proposerRecette}>
              {t('trt.soumettre')}
            </GrosBouton>
          </div>
        </div>
        <p className="mt-2 text-xs text-sable/55">{t('trt.recette_d')}</p>
      </Carte>

      {/* Fiches de production des plans en cours — SANS prix */}
      <p className="text-xs font-bold uppercase tracking-widest text-sable/50">{t('trt.fiches')}</p>
      {(plans.data ?? []).filter((p) => p.statut === 'EN_COURS').map((p) => (
        <FicheProduction key={p.id} planId={p.id} entreprise={p.entreprise} jour={p.jour} heure={p.heure} nbPersonnes={p.nbPersonnes} />
      ))}
      {(plans.data ?? []).filter((p) => p.statut === 'EN_COURS').length === 0 && (
        <Vide icone={<ChefHat className="h-8 w-8" />} titre={t('trt.aucun_plan')} detail={t('trt.aucun_plan_chef_d')} />
      )}
    </div>
  )
}

function FicheProduction({ planId, entreprise, jour, heure, nbPersonnes }: { planId: string; entreprise: string; jour: string; heure: string; nbPersonnes: number }) {
  const t = useT()
  const fiche = trpc.traiteur.ficheProduction.useQuery({ planId })
  return (
    <Carte>
      <div className="mb-2 flex items-center justify-between">
        <p className="font-bold text-white">{entreprise}</p>
        <Pill ton="ambre">{jour} {heure}</Pill>
      </div>
      <p className="mb-2 text-xs text-sable/55">{t('trt.personnes', { n: nbPersonnes })}</p>
      {fiche.data?.map((c, ci) => (
        <div key={`${c.composant}-${ci}`} className="mb-2 rounded-2xl bg-white/5 p-3">
          <p className="mb-1 text-sm font-bold text-ambre">{c.composant} <span className="font-normal text-sable/55">({c.personnes} pers.)</span></p>
          {c.ingredients.map((i) => (
            <p key={i.produit} className="flex justify-between text-sm">
              <span className="text-sable/80">{i.produit}</span>
              <b className="text-white">{i.quantite}</b>
            </p>
          ))}
        </div>
      ))}
    </Carte>
  )
}

// ---------- Magasinier : bons de sortie + comptage à l'aveugle ----------

function PanneauMagasinier({ terrasse }: { terrasse: Terrasse }) {
  const t = useT()
  const db = useDB()
  const [produitComptage, setProduitComptage] = useState('')
  const [quantiteComptee, setQuantiteComptee] = useState('')
  const plans = trpc.traiteur.listePlans.useQuery({ terrasseId: terrasse.id }, { refetchInterval: 8000 })
  const ecarts = trpc.traiteur.listeEcarts.useQuery({ terrasseId: terrasse.id }, { refetchInterval: 10000 })
  const produits = db.produits.filter((p) => p.terrasseId === terrasse.id && p.actif)

  const emettre = trpc.traiteur.emettreBonSortie.useMutation({
    onSuccess: () => { toast.success(t('trt.bon_emis')); void plans.refetch() },
    onError: (e) => toast.error(e.message),
  })
  const compter = trpc.traiteur.comptageAveugle.useMutation({
    onSuccess: (r) => {
      setQuantiteComptee('')
      toast.success(t(r.ecart === 0 ? 'trt.comptage_parfait' : 'trt.comptage_ecart', { n: Math.abs(r.ecart) }))
      void ecarts.refetch()
    },
    onError: (e) => toast.error(e.message),
  })

  return (
    <div className="flex flex-col gap-4 px-4 pt-4">
      <p className="text-xs font-bold uppercase tracking-widest text-sable/50">{t('trt.bons')}</p>
      {(plans.data ?? []).filter((p) => p.statut === 'EN_COURS').map((p) => (
        <Carte key={p.id}>
          <div className="mb-2 flex items-center justify-between">
            <p className="font-bold text-white">{p.entreprise}</p>
            <Pill ton="ambre">{p.jour} {p.heure}</Pill>
          </div>
          <BonSortie planId={p.id} onEmettre={() => emettre.mutate({ planId: p.id })} enCours={emettre.isPending} />
        </Carte>
      ))}
      {(plans.data ?? []).filter((p) => p.statut === 'EN_COURS').length === 0 && (
        <Vide icone={<PackageOpen className="h-8 w-8" />} titre={t('trt.aucun_plan')} detail={t('trt.aucun_plan_mag_d')} />
      )}

      {/* Comptage à l'aveugle : le théorique n'est JAMAIS affiché (§7bis) */}
      <Carte>
        <p className="mb-2 font-bold text-white">{t('trt.comptage')}</p>
        <p className="mb-3 text-xs text-sable/60">{t('trt.comptage_d')}</p>
        <select className={`${classeSaisie} mb-2`} value={produitComptage} onChange={(e) => setProduitComptage(e.target.value)} aria-label={t('trt.ingredient')}>
          <option value="">{t('trt.choisir_produit')}</option>
          {produits.map((p) => <option key={p.id} value={p.id}>{p.nom} ({p.unite ?? 'pièce'})</option>)}
        </select>
        <div className="mb-3">
          <SaisieNombre valeur={quantiteComptee} onChange={setQuantiteComptee} placeholder={t('trt.quantite_comptee')} />
        </div>
        <GrosBouton petit desactive={!produitComptage || !quantiteComptee || compter.isPending}
          onClick={() => compter.mutate({ terrasseId: terrasse.id, produitId: produitComptage, quantiteComptee: parseInt(quantiteComptee) || 0 })}>
          {t('trt.enregistrer_comptage')}
        </GrosBouton>
      </Carte>

      {/* Écarts en QUANTITÉ seulement (§7bis) */}
      {(ecarts.data ?? []).length > 0 && (
        <Carte>
          <p className="mb-2 font-bold text-white">{t('trt.ecarts')}</p>
          {ecarts.data!.slice(0, 10).map((e) => (
            <p key={e.id} className="flex justify-between py-1 text-sm">
              <span className="text-sable/80">{e.produit}</span>
              <b className={e.ecart === 0 ? 'text-succes' : 'text-danger-clair'}>
                {e.ecart === 0 ? '✓' : `${e.ecart > 0 ? '-' : '+'}${Math.abs(e.ecart)} ${e.unite ?? ''}`}
              </b>
            </p>
          ))}
        </Carte>
      )}
    </div>
  )
}

function BonSortie({ planId, onEmettre, enCours }: { planId: string; onEmettre: () => void; enCours: boolean }) {
  const t = useT()
  const bon = trpc.traiteur.voirBonSortie.useQuery({ planId }, { retry: false })
  if (bon.data) {
    return (
      <div>
        {bon.data.lignes.map((l) => (
          <p key={l.produit} className="flex justify-between py-1 text-sm">
            <span className="text-sable/80">{l.produit}{l.lot ? ` · ${l.lot}` : ''}</span>
            <b className="text-white">{l.quantite}</b>
          </p>
        ))}
        <Pill ton="vert">{t('trt.bon_emis_pill')}</Pill>
      </div>
    )
  }
  return <GrosBouton petit desactive={enCours} onClick={onEmettre}><Package className="h-4 w-4" /> {t('trt.emettre_bon')}</GrosBouton>
}

// ---------- Gérant : plans du jour (sans prix) ----------

export function PanneauPlansTraiteur({ terrasseId }: { terrasseId: string }) {
  const t = useT()
  const [entreprise, setEntreprise] = useState('')
  const [nbPersonnes, setNbPersonnes] = useState('')
  const [jour, setJour] = useState(() => new Date().toISOString().slice(0, 10))
  const [heure, setHeure] = useState('12:00')
  const [menuId, setMenuId] = useState('')
  const menus = trpc.traiteur.listeMenus.useQuery({ terrasseId })
  const plans = trpc.traiteur.listePlans.useQuery({ terrasseId }, { refetchInterval: 8000 })

  const creer = trpc.traiteur.creerPlan.useMutation({
    onSuccess: () => { setEntreprise(''); setNbPersonnes(''); toast.success(t('trt.plan_cree')); void plans.refetch() },
    onError: (e) => toast.error(e.message),
  })
  const demarrer = trpc.traiteur.demarrerPlan.useMutation({
    onSuccess: () => { toast.success(t('trt.plan_demarre')); void plans.refetch() },
    onError: (e) => toast.error(e.message),
  })

  return (
    <div className="flex flex-col gap-4 px-4 pt-4">
      <Carte>
        <p className="mb-2 font-bold text-white">{t('trt.nouveau_plan')}</p>
        <select className={`${classeSaisie} mb-2`} value={menuId} onChange={(e) => setMenuId(e.target.value)} aria-label={t('trt.menu')}>
          <option value="">{t('trt.choisir_menu')}</option>
          {(menus.data ?? []).map((m) => <option key={m.id} value={m.id}>{m.nom}</option>)}
        </select>
        <input className={`${classeSaisie} mb-2`} value={entreprise} onChange={(e) => setEntreprise(e.target.value)} placeholder={t('trt.entreprise_ph')} aria-label={t('trt.entreprise_ph')} />
        <div className="mb-2 flex gap-2">
          <div className="flex-1"><SaisieNombre valeur={nbPersonnes} onChange={setNbPersonnes} placeholder={t('trt.nb_personnes')} /></div>
          <input type="date" className={`${classeSaisie} flex-1`} value={jour} onChange={(e) => setJour(e.target.value)} aria-label={t('trt.jour')} />
          <input type="time" className={`${classeSaisie} w-24`} value={heure} onChange={(e) => setHeure(e.target.value)} aria-label={t('trt.heure')} />
        </div>
        <GrosBouton petit desactive={!menuId || !entreprise.trim() || !nbPersonnes || creer.isPending}
          onClick={() => creer.mutate({ menuId, entreprise: entreprise.trim(), nbPersonnes: parseInt(nbPersonnes) || 0, jour, heure })}>
          {t('trt.creer_plan')}
        </GrosBouton>
      </Carte>

      <p className="text-xs font-bold uppercase tracking-widest text-sable/50">{t('trt.plans')}</p>
      {(plans.data ?? []).map((p) => (
        <Carte key={p.id}>
          <div className="flex items-center justify-between">
            <div>
              <p className="font-bold text-white">{p.entreprise}</p>
              <p className="text-xs text-sable/55">{p.jour} {p.heure} — {t('trt.personnes', { n: p.nbPersonnes })}</p>
            </div>
            {p.statut === 'BROUILLON' ? (
              <div className="w-32">
                <GrosBouton petit desactive={demarrer.isPending} onClick={() => demarrer.mutate({ planId: p.id })}>{t('trt.demarrer')}</GrosBouton>
              </div>
            ) : (
              <Pill ton={p.statut === 'EN_COURS' ? 'ambre' : 'neutre'}>{t(`trt.statut_${p.statut.toLowerCase()}`)}</Pill>
            )}
          </div>
        </Carte>
      ))}
      {(plans.data ?? []).length === 0 && (
        <Vide icone={<ClipboardList className="h-8 w-8" />} titre={t('trt.aucun_plan')} detail={t('trt.aucun_plan_ger_d')} />
      )}
    </div>
  )
}

// ---------- Propriétaire : validation, menus, coûts, écarts ----------

export function PanneauTraiteurProprio({ terrasseId }: { terrasseId: string }) {
  const t = useT()
  const [nomMenu, setNomMenu] = useState('')
  const [prixMenu, setPrixMenu] = useState('')
  const [menuComposants, setMenuComposants] = useState<string[]>([])
  const [planCouts, setPlanCouts] = useState<string | null>(null)
  const aValider = trpc.traiteur.recettesAValider.useQuery({ terrasseId }, { refetchInterval: 8000 })
  const composants = trpc.traiteur.listeComposants.useQuery({ terrasseId })
  const plans = trpc.traiteur.listePlans.useQuery({ terrasseId }, { refetchInterval: 10000 })
  const ecarts = trpc.traiteur.listeEcarts.useQuery({ terrasseId }, { refetchInterval: 10000 })

  const valider = trpc.traiteur.validerRecette.useMutation({
    onSuccess: () => { toast.success(t('trt.recette_validee')); void aValider.refetch() },
    onError: (e) => toast.error(e.message),
  })
  const creerMenu = trpc.traiteur.creerMenu.useMutation({
    onSuccess: () => { setNomMenu(''); setPrixMenu(''); setMenuComposants([]); toast.success(t('trt.menu_cree')) },
    onError: (e) => toast.error(e.message),
  })

  return (
    <div className="flex flex-col gap-4 px-4 pt-4">
      {/* Recettes proposées à valider (§1) */}
      <p className="text-xs font-bold uppercase tracking-widest text-sable/50">{t('trt.a_valider')}</p>
      {(aValider.data ?? []).map((r) => (
        <Carte key={r.recetteId}>
          <div className="mb-1 flex items-center justify-between">
            <p className="font-bold text-white">{r.composant} <span className="text-xs font-normal text-sable/55">v{r.version}</span></p>
            <Pill ton="ambre">{t(`trt.kind_${r.kind.toLowerCase()}`)}</Pill>
          </div>
          {r.ingredients.map((i) => (
            <p key={i.produit} className="flex justify-between text-sm">
              <span className="text-sable/80">{i.produit}{i.tauxPertePct > 0 ? ` (+${i.tauxPertePct} %)` : ''}</span>
              <span className="text-sable">{i.quantite}/pers.</span>
            </p>
          ))}
          <div className="mt-3">
            <GrosBouton petit desactive={valider.isPending} onClick={() => valider.mutate({ recetteId: r.recetteId })}>{t('trt.valider')}</GrosBouton>
          </div>
        </Carte>
      ))}
      {(aValider.data ?? []).length === 0 && <p className="text-sm text-sable/55">{t('trt.rien_a_valider')}</p>}

      {/* Nouveau menu (prix = propriétaire) */}
      <Carte>
        <p className="mb-2 font-bold text-white">{t('trt.nouveau_menu')}</p>
        <input className={`${classeSaisie} mb-2`} value={nomMenu} onChange={(e) => setNomMenu(e.target.value)} placeholder={t('trt.menu_ph')} aria-label={t('trt.menu_ph')} />
        <div className="mb-2">
          <input className={`${classeSaisie} font-mono`} inputMode="decimal" value={prixMenu} onChange={(e) => setPrixMenu(e.target.value)} placeholder={t('trt.prix_ph')} aria-label={t('trt.prix_ph')} />
        </div>
        <div className="mb-3 flex flex-wrap gap-2">
          {(composants.data ?? []).map((c) => {
            const actif = menuComposants.includes(c.id)
            return (
              <button key={c.id}
                onClick={() => setMenuComposants(actif ? menuComposants.filter((x) => x !== c.id) : [...menuComposants, c.id])}
                className={`rounded-full px-3 py-1.5 text-xs font-bold ${actif ? 'bg-ambre text-sur-ambre' : 'bg-white/8 text-sable'}`}>
                {c.nom}
              </button>
            )
          })}
        </div>
        <GrosBouton petit desactive={!nomMenu.trim() || !prixMenu || menuComposants.length === 0 || creerMenu.isPending}
          onClick={() => creerMenu.mutate({
            terrasseId, nom: nomMenu.trim(),
            prixPersonneUsd: Math.round((parseFloat(prixMenu.replace(',', '.')) || 0) * 100),
            lignes: menuComposants.map((composantId) => ({ composantId, qteParPersonneX1000: 1000 })),
          })}>
          {t('trt.creer_menu')}
        </GrosBouton>
      </Carte>

      {/* Coûts et marges par plan (§5 — propriétaire SEUL) */}
      <p className="text-xs font-bold uppercase tracking-widest text-sable/50">{t('trt.couts')}</p>
      {(plans.data ?? []).filter((p) => p.statut !== 'BROUILLON').map((p) => (
        <button key={p.id} onClick={() => setPlanCouts(p.id)} className="text-left">
          <Carte classe="active:bg-white/5">
            <div className="flex items-center justify-between">
              <p className="font-bold text-white">{p.entreprise}</p>
              <p className="text-xs text-sable/55">{p.jour}</p>
            </div>
          </Carte>
        </button>
      ))}

      {/* Écarts d'inventaire AVEC valeur (§7bis — propriétaire seul) */}
      {(ecarts.data ?? []).some((e) => e.ecart !== 0) && (
        <Carte>
          <p className="mb-2 font-bold text-white">{t('trt.ecarts_valeur')}</p>
          {ecarts.data!.filter((e) => e.ecart !== 0).slice(0, 10).map((e) => (
            <p key={e.id} className="flex justify-between py-1 text-sm">
              <span className="text-sable/80">{e.produit} ({e.ecart > 0 ? '-' : '+'}{Math.abs(e.ecart)} {e.unite ?? ''})</span>
              <b className="text-danger-clair">{e.valeurEcartCentimes != null ? fmtUSD(Math.abs(e.valeurEcartCentimes)) : '—'}</b>
            </p>
          ))}
        </Carte>
      )}

      <Feuille ouvert={!!planCouts} surFermer={() => setPlanCouts(null)} titre={t('trt.couts')}>
        {planCouts && <CoutsPlan planId={planCouts} />}
      </Feuille>
    </div>
  )
}

function CoutsPlan({ planId }: { planId: string }) {
  const t = useT()
  const couts = trpc.traiteur.coutsPlan.useQuery({ planId })
  if (!couts.data) return <Chargement />
  const c = couts.data
  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm text-sable/70">{c.entreprise} — {c.jour} — {t('trt.personnes', { n: c.nbPersonnes })}</p>
      {c.parComposant.map((x, xi) => (
        <p key={`${x.composant}-${xi}`} className="flex justify-between text-sm">
          <span className="text-sable/80">{x.composant}</span>
          <b className="text-white">{fmtUSD(x.coutCentimes)}</b>
        </p>
      ))}
      <div className="mt-2 space-y-1 border-t border-white/10 pt-3 text-sm">
        <p className="flex justify-between"><span className="text-sable/70">{t('trt.cout_personne')}</span><b className="text-white">{fmtUSD(c.coutParPersonneCentimes)}</b></p>
        <p className="flex justify-between"><span className="text-sable/70">{t('trt.cout_jour')}</span><b className="text-white">{fmtUSD(c.coutJourCentimes)}</b></p>
        <p className="flex justify-between"><span className="text-sable/70">{t('trt.recette_attendue')}</span><b className="text-white">{fmtUSD(c.recetteCentimes)}</b></p>
        <p className="flex justify-between text-base"><span className="font-bold text-ambre">{t('trt.marge')}</span><b className="text-ambre">{fmtUSD(c.margeCentimes)} ({c.margePct} %)</b></p>
      </div>
    </div>
  )
}

// ---------- Porte du personnel traiteur (chef / magasinier) ----------

function EspaceTraiteur({ moi, terrasse }: { moi: Utilisateur; terrasse: Terrasse }) {
  const t = useT()
  const db = useDB()
  // Le rôle vient des affectations sur la terrasse (jamais d'un rôle
  // global) : CHEF en priorité si les deux rôles sont affectés.
  const estChef = rolesSur(db, moi.id, terrasse.id).includes('CHEF')
  return (
    <CoquilleRole
      titre={terrasse.nom}
      sousTitre={`${moi.nom} — ${t(estChef ? 'trt.role_chef' : 'trt.role_magasinier')}`}
      droite={<BoutonDeconnexion />}
      actif="traiteur"
      onChange={() => {}}
      onglets={[{ id: 'traiteur', label: t('trt.onglet'), icone: estChef ? <ChefHat className="h-6 w-6" /> : <Package className="h-6 w-6" /> }]}
    >
      {estChef ? <PanneauChef terrasse={terrasse} /> : <PanneauMagasinier terrasse={terrasse} />}
    </CoquilleRole>
  )
}

export function VueTraiteur() {
  return (
    <PorteRole rolesVoulus={['CHEF', 'MAGASINIER']} indiceDemo="">
      {({ moi, terrasse }) => <EspaceTraiteur moi={moi} terrasse={terrasse} />}
    </PorteRole>
  )
}
