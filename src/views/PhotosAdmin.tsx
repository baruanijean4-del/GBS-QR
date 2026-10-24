// ============================================================
// GBS — Super-admin : demandes de photo des établissements
//
// Le super-admin voit chaque demande (établissement, demandeur, produit
// ou chambre, précisions, photo actuelle), colle l'adresse (URL) de la
// photo préparée avec l'outil d'hébergement de son choix, vérifie
// l'aperçu, puis valide — ou refuse avec un motif. Validée, la photo
// apparaît côté client et côté établissement (docs/PHOTOS.md).
// ============================================================

import { useState } from 'react'
import { Camera } from 'lucide-react'
import { toast } from 'sonner'
import { Carte, Chargement, GrosBouton, Pill, Vide, classeSaisie } from '@/components/gbs'
import { ilYA } from '@/lib/format'
import { useT } from '@/i18n'
import { trpc } from '@/providers/trpc'
import { urlPhotoValide } from '@contracts/photos'

type Demande = {
  id: string; cible: 'PRODUIT' | 'CHAMBRE'; libelle: string; note: string | null; creeLe: string
  photoActuelle: string | null; etablissement: string; demandeur: string
}

function LigneDemande({ demande, pin, surFait }: { demande: Demande; pin: string; surFait: () => void }) {
  const t = useT()
  const traiter = trpc.photos.traiter.useMutation()
  const [url, setUrl] = useState('')
  const [apercuKo, setApercuKo] = useState(false)
  const [refus, setRefus] = useState(false)
  const [motif, setMotif] = useState('')
  const valide = urlPhotoValide(url)

  const envoyer = async (decision: 'VALIDEE' | 'REFUSEE') => {
    try {
      await traiter.mutateAsync({
        pinAdmin: pin, demandeId: demande.id, decision,
        url: decision === 'VALIDEE' ? url.trim() : undefined,
        motif: decision === 'REFUSEE' ? motif.trim() : undefined,
      })
      toast.success(t(decision === 'VALIDEE' ? 'admin.photos_ok' : 'admin.photos_refus_ok'))
      surFait()
    } catch (e) { toast.error(e instanceof Error ? e.message : t('commun.erreur')) }
  }

  return (
    <Carte>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate font-bold text-white">{demande.libelle}</p>
          <p className="truncate text-xs text-sable/60">{demande.demandeur} · {demande.etablissement}</p>
          <p className="text-xs text-sable/40">{ilYA(demande.creeLe)}</p>
        </div>
        {demande.photoActuelle && (
          <div className="shrink-0 text-center">
            <img src={demande.photoActuelle} alt={t('admin.photos_actuelle')} className="h-12 w-12 rounded-lg object-cover" />
            <p className="mt-0.5 text-[9px] text-sable/40">{t('admin.photos_actuelle')}</p>
          </div>
        )}
      </div>
      {demande.note && <p className="mt-2 rounded-xl bg-white/5 p-2 text-xs text-sable/80">{t('admin.photos_note', { note: demande.note })}</p>}

      <label className="mt-3 block text-xs font-bold uppercase tracking-widest text-sable/50" htmlFor={`url-${demande.id}`}>{t('admin.photos_url_label')}</label>
      <input
        id={`url-${demande.id}`}
        className={`${classeSaisie} mt-1`}
        value={url}
        inputMode="url"
        autoCapitalize="none"
        autoCorrect="off"
        onChange={(e) => { setUrl(e.target.value); setApercuKo(false) }}
        placeholder="https://…"
      />
      {url.trim() && !valide && <p className="mt-1 text-xs text-danger-clair">{t('admin.photos_url_invalide')}</p>}
      {valide && (
        apercuKo ? (
          <p className="mt-2 text-xs text-danger-clair">{t('admin.photos_apercu_ko')}</p>
        ) : (
          <img src={url.trim()} alt="" className="mt-2 h-40 w-full rounded-xl object-cover" onError={() => setApercuKo(true)} />
        )
      )}

      {refus ? (
        <div className="mt-3 flex flex-col gap-2">
          <input className={classeSaisie} value={motif} maxLength={200} onChange={(e) => setMotif(e.target.value)} placeholder={t('admin.photos_motif_ph')} />
          <div className="flex gap-2">
            <div className="flex-1"><GrosBouton petit ton="secondaire" onClick={() => setRefus(false)}>{t('commun.annuler')}</GrosBouton></div>
            <div className="flex-1"><GrosBouton petit ton="danger" desactive={!motif.trim()} charge={traiter.isPending} onClick={() => void envoyer('REFUSEE')}>{t('admin.photos_refuser')}</GrosBouton></div>
          </div>
        </div>
      ) : (
        <div className="mt-3 flex gap-2">
          <div className="flex-1"><GrosBouton petit ton="secondaire" onClick={() => setRefus(true)}>{t('admin.photos_refuser')}</GrosBouton></div>
          <div className="flex-1"><GrosBouton petit desactive={!valide || apercuKo} charge={traiter.isPending} onClick={() => void envoyer('VALIDEE')}>{t('admin.photos_valider')}</GrosBouton></div>
        </div>
      )}
    </Carte>
  )
}

export function PhotosAdmin({ pin }: { pin: string }) {
  const t = useT()
  const demandes = trpc.photos.listerAdmin.useQuery({ pinAdmin: pin }, { refetchInterval: 15000, retry: false })

  if (demandes.isPending) return <Chargement />
  if (demandes.error || !demandes.data) {
    return <Vide icone={<Camera className="h-8 w-8" />} titre={t('commun.erreur')} detail={demandes.error?.message ?? ''} />
  }
  if (demandes.data.length === 0) {
    return <Vide icone={<Camera className="h-8 w-8" />} titre={t('admin.photos_aucune')} detail={t('admin.photos_aucune_d')} />
  }
  return (
    <div className="flex flex-col gap-3">
      <Pill ton="ambre">{demandes.data.length}</Pill>
      {demandes.data.map((d) => (
        <LigneDemande key={d.id} demande={d as Demande} pin={pin} surFait={() => void demandes.refetch()} />
      ))}
    </div>
  )
}

/** Nombre de demandes en attente (pastille de l'onglet) */
export function useNbDemandesPhoto(pin: string): number {
  const demandes = trpc.photos.listerAdmin.useQuery({ pinAdmin: pin }, { refetchInterval: 15000, retry: false })
  return demandes.data?.length ?? 0
}
