// ============================================================
// GBS — Demande de photo (gérant / propriétaire)
//
// Les photos sont TOUJOURS des URL (docs/PHOTOS.md). Depuis un produit
// ou une chambre, le gérant ou le propriétaire DEMANDE une photo ; le
// super-admin colle l'adresse de l'image et valide ; la photo apparaît
// ensuite côté client et côté établissement (elle suit le snapshot).
// ============================================================

import { useState } from 'react'
import { Camera, Clock } from 'lucide-react'
import { toast } from 'sonner'
import { Feuille, GrosBouton, Pill, classeSaisie } from '@/components/gbs'
import { useT } from '@/i18n'
import { trpc } from '@/providers/trpc'
import type { CiblePhoto } from '@contracts/photos'

export function BoutonDemandePhoto({ cible, cibleId, terrasseId, libelle }: {
  cible: CiblePhoto
  cibleId: string
  terrasseId: string
  /** Nom affiché dans la demande (nom du produit, « Chambre 12 »…) */
  libelle: string
}) {
  const t = useT()
  const utils = trpc.useUtils()
  const demandes = trpc.photos.mesDemandes.useQuery({ terrasseId }, { refetchInterval: 15000, retry: false })
  const demander = trpc.photos.demander.useMutation()
  const annuler = trpc.photos.annuler.useMutation()
  const [ouvert, setOuvert] = useState(false)
  const [note, setNote] = useState('')

  // Rôle insuffisant (ni gérant ni propriétaire) : pas de bouton
  if (demandes.error) return null

  // La liste est triée de la plus récente à la plus ancienne
  const derniere = demandes.data?.find((d) => d.cible === cible && d.cibleId === cibleId)
  const enAttente = derniere?.statut === 'EN_ATTENTE'
  const refusee = derniere?.statut === 'REFUSEE'

  const envoyer = async () => {
    try {
      await demander.mutateAsync({ cible, cibleId, note: note.trim() || undefined })
      toast.success(t('photo.demande_envoyee'))
      setOuvert(false)
      setNote('')
      await utils.photos.mesDemandes.invalidate({ terrasseId })
    } catch (e) { toast.error(e instanceof Error ? e.message : t('commun.erreur')) }
  }
  const retirer = async () => {
    if (!derniere) return
    try {
      await annuler.mutateAsync({ demandeId: derniere.id })
      toast.success(t('photo.annulee'))
      await utils.photos.mesDemandes.invalidate({ terrasseId })
    } catch (e) { toast.error(e instanceof Error ? e.message : t('commun.erreur')) }
  }

  return (
    <div className="flex flex-col gap-2">
      {enAttente ? (
        <>
          <Pill ton="ambre"><Clock className="mr-1 inline h-3.5 w-3.5" />{t('photo.en_attente')}</Pill>
          <GrosBouton petit ton="secondaire" charge={annuler.isPending} onClick={() => void retirer()}>
            {t('photo.annuler')}
          </GrosBouton>
        </>
      ) : (
        <>
          {refusee && derniere?.motifRefus && (
            <p className="text-xs text-danger-clair">{t('photo.refusee', { motif: derniere.motifRefus })}</p>
          )}
          <GrosBouton petit ton="secondaire" onClick={() => setOuvert(true)}>
            <Camera className="h-4 w-4" /> {refusee ? t('photo.redemander') : t('photo.demander')}
          </GrosBouton>
        </>
      )}

      {ouvert && (
        <Feuille ouvert surFermer={() => setOuvert(false)} titre={t('photo.demande_titre', { nom: libelle })}>
          <div className="flex flex-col gap-3">
            <p className="text-sm text-sable/70">{t('photo.intro')}</p>
            <label className="text-xs font-bold uppercase tracking-widest text-sable/50" htmlFor="photo-note">{t('photo.note_label')}</label>
            <textarea
              id="photo-note"
              className={`${classeSaisie} min-h-24`}
              value={note}
              maxLength={300}
              onChange={(e) => setNote(e.target.value)}
              placeholder={t('photo.note_ph')}
            />
            <GrosBouton charge={demander.isPending} onClick={() => void envoyer()}>{t('photo.envoyer')}</GrosBouton>
          </div>
        </Feuille>
      )}
    </div>
  )
}
