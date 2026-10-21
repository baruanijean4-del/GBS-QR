// ============================================================
// GBS — Écran d'erreur final (Phase B)
//
// VOLONTAIREMENT AUTONOME : aucun import de traduction, aucun
// hook réseau, aucune donnée serveur. Le chargement des
// traductions ou de l'API peut justement être la CAUSE de
// l'erreur — cet écran doit s'afficher même quand tout le reste
// est en panne. Ses textes (FR/EN/PT) vivent donc dans ce
// fichier, avec un repli français garanti.
//
// Langue : localStorage « gbs-lang » (choix de l'utilisateur),
// sinon navigator.language, sinon français.
// ============================================================

import { useEffect, useState } from 'react'
import { MessageCircle, RotateCcw, TriangleAlert } from 'lucide-react'
import { rechargerApplication } from '@/lib/recuperation'
import { langueErreur, type LangueErreur } from '@/lib/langueErreur'
import { fileNonVide } from '@/lib/outbox'

/** Numéro WhatsApp du support GBS (Lubumbashi, RDC) */
const SUPPORT_WHATSAPP = '243974480803'

interface TextesErreur {
  titre: string
  message: string
  /** Affiché À LA PLACE du message quand des actions hors-ligne sont en file */
  messageFile: string
  reessayer: string
  recharger: string
  code: (id: string) => string
  support: string
  patronMessageWhatsApp: (id: string) => string
}

// Textes imposés par le cahier des charges (Phase B.3) — PT européen.
const TEXTES: Record<LangueErreur, TextesErreur> = {
  fr: {
    titre: 'Une erreur est survenue',
    message:
      "L'application a rencontré un problème inattendu. Vos données sont en sécurité sur le serveur. Rechargez pour reprendre.",
    messageFile: 'Vos actions en attente sont gardées sur cet appareil.',
    reessayer: 'Réessayer',
    recharger: "Recharger l'application",
    code: (id) => `Code d'erreur : ${id}`,
    support: 'Contacter le support',
    patronMessageWhatsApp: (id) => `Bonjour, erreur GBS ${id}`,
  },
  en: {
    titre: 'Something went wrong',
    message:
      'The app ran into an unexpected problem. Your data is safe on the server. Reload to continue.',
    messageFile: 'Your pending actions are kept on this device.',
    reessayer: 'Try again',
    recharger: 'Reload the app',
    code: (id) => `Error code: ${id}`,
    support: 'Contact support',
    patronMessageWhatsApp: (id) => `Hello, GBS error ${id}`,
  },
  pt: {
    titre: 'Ocorreu um erro',
    message:
      'A aplicação encontrou um problema inesperado. Os seus dados estão seguros no servidor. Recarregue para continuar.',
    messageFile: 'As suas ações pendentes ficam guardadas neste dispositivo.',
    reessayer: 'Tentar novamente',
    recharger: 'Recarregar a aplicação',
    code: (id) => `Código do erro: ${id}`,
    support: 'Contactar o suporte',
    patronMessageWhatsApp: (id) => `Olá, erro GBS ${id}`,
  },
  sw: {
    titre: 'Hitilafu imetokea',
    message:
      'Programu imekutana na tatizo lisilotarajiwa. Data zako ziko salama kwenye seva. Pakia upya kuendelea.',
    messageFile: 'Vitendo vyako vya nje ya mtandao vimehifadhiwa kwenye kifaa hiki.',
    reessayer: 'Jaribu tena',
    recharger: 'Pakia upya programu',
    code: (id) => `Msimbo wa hitilafu: ${id}`,
    support: 'Wasiliana na usaidizi',
    patronMessageWhatsApp: (id) => `Habari, hitilafu GBS ${id}`,
  },
}

/** Vrai si l'ANCIENNE file localStorage contient encore des commandes */
function fileLegacyPresente(): boolean {
  try {
    const brut = localStorage.getItem('gbs.outbox')
    if (!brut) return false
    const file = JSON.parse(brut) as unknown
    return Array.isArray(file) && file.length > 0
  } catch {
    return false
  }
}

export interface PropsEcranErreur {
  /** Code court stable (ex. ERR-7K2F) affiché et pré-rempli chez le support */
  code: string
  /** « Réessayer » : réaffiche l'écran d'origine SANS recharger la page */
  surReessayer: () => void
}

/**
 * Écran de secours pleine page. Deux boutons dont UN SEUL principal
 * (orange) : « Réessayer ». « Recharger l'application » désinscrit le
 * service worker et vide les caches avant de recharger.
 */
export function EcranErreur({ code, surReessayer }: PropsEcranErreur) {
  const t = TEXTES[langueErreur()]
  const [rechargement, setRechargement] = useState(false)
  // Honnêteté du message : la file hors-ligne est sur l'APPAREIL ;
  // on ne parle de « données en sécurité sur le serveur » que pour
  // ce qui a réellement été envoyé. La file vit en IndexedDB (lecture
  // asynchrone) ; l'ancienne file localStorage sert de valeur immédiate.
  const [filePresente, setFilePresente] = useState(fileLegacyPresente)
  useEffect(() => {
    let actif = true
    // Ne peut que CONFIRMER la présence (IndexedDB), jamais l'infirmer :
    // la valeur initiale localStorage couvre l'ancienne file, et un
    // basculement du message après affichage serait pire qu'un
    // faux positif (l'utilisateur doit savoir que rien n'est perdu).
    fileNonVide()
      .then((nonVide) => { if (actif && nonVide) setFilePresente(true) })
      .catch(() => { /* la valeur initiale localStorage suffit */ })
    return () => { actif = false }
  }, [])
  const message = filePresente ? t.messageFile : t.message
  const lienWhatsApp = `https://wa.me/${SUPPORT_WHATSAPP}?text=${encodeURIComponent(t.patronMessageWhatsApp(code))}`

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-encre px-8 text-center">
      <TriangleAlert className="h-12 w-12 text-ambre" aria-hidden />
      <p className="text-lg font-bold text-white">{t.titre}</p>
      <p className="max-w-sm text-base text-sable/70">{message}</p>
      <button
        type="button"
        onClick={surReessayer}
        className="flex min-h-14 w-full max-w-xs items-center justify-center gap-2 rounded-2xl bg-ambre px-5 text-base font-bold text-sur-ambre transition-colors focus-visible:ring-2 focus-visible:ring-ambre/50 active:bg-ambre-actif"
      >
        <RotateCcw className="h-5 w-5" aria-hidden />
        {t.reessayer}
      </button>
      <button
        type="button"
        disabled={rechargement}
        onClick={() => {
          if (rechargement) return
          setRechargement(true)
          void rechargerApplication()
        }}
        className="min-h-14 w-full max-w-xs rounded-2xl border border-white/15 px-5 text-base font-semibold text-sable transition-colors active:bg-white/10 disabled:opacity-50"
      >
        {t.recharger}
      </button>
      <p className="font-mono text-xs text-sable/50">{t.code(code)}</p>
      <a
        href={lienWhatsApp}
        target="_blank"
        rel="noopener noreferrer"
        className="flex min-h-11 items-center gap-2 text-base font-semibold text-ambre underline-offset-4 active:underline"
      >
        <MessageCircle className="h-4 w-4" aria-hidden />
        {t.support}
      </a>
    </div>
  )
}

// ------------------------------------------------------------
// Écran sobre affiché PENDANT la récupération automatique d'un
// chunk disparu (l'app va recharger toute seule) : on évite de
// montrer « Une erreur est survenue » pour une auto-guérison
// normale après un déploiement.
// ------------------------------------------------------------

const TEXTES_MAJ: Record<LangueErreur, string> = {
  fr: "Mise à jour de l'application…",
  en: 'Updating the app…',
  pt: 'A atualizar a aplicação…',
  sw: 'Inasasisha programu…',
}

/** Indicateur neutre de rechargement automatique (auto-guérison) */
export function EcranMiseAJour() {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-encre px-8 text-center">
      <div className="h-10 w-10 animate-spin rounded-full border-4 border-ambre border-t-transparent" aria-hidden />
      <p className="text-base text-sable/80">{TEXTES_MAJ[langueErreur()]}</p>
    </div>
  )
}

// ------------------------------------------------------------
// Variante compacte « bloc » (Phase B.2 — niveau bloc) : une
// liste, un graphique ou un formulaire qui plante n'emporte
// ni la page ni la navigation.
// ------------------------------------------------------------

const TEXTES_BLOC: Record<LangueErreur, string> = {
  fr: "Ce bloc n'a pas pu s'afficher.",
  en: 'This section could not be displayed.',
  pt: 'Não foi possível apresentar esta secção.',
  sw: 'Sehemu hii haikuweza kuonyeshwa.',
}

/** Carte de repli discrète pour un bloc qui a planté (avec « Réessayer ») */
export function BlocErreur({ surReessayer }: { surReessayer: () => void }) {
  const langue = langueErreur()
  return (
    <div className="flex flex-col items-center gap-3 rounded-2xl border border-white/10 bg-surface/60 px-4 py-6 text-center">
      <TriangleAlert className="h-6 w-6 text-ambre" aria-hidden />
      <p className="text-base text-sable/80">{TEXTES_BLOC[langue]}</p>
      <button
        type="button"
        onClick={surReessayer}
        className="flex min-h-12 items-center gap-2 rounded-xl border border-white/15 px-4 text-base font-semibold text-sable active:bg-white/10"
      >
        <RotateCcw className="h-4 w-4" aria-hidden />
        {TEXTES[langue].reessayer}
      </button>
    </div>
  )
}
