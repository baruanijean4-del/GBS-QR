import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import { TRPCProvider } from "@/providers/trpc"
import { ErrorBoundary } from '@/components/ErrorBoundary'
import { I18nProvider } from '@/i18n'
import { enregistrerServiceWorker, demanderPersistanceStockage } from '@/lib/pwa'
import { brancherJournalGlobal } from '@/lib/journalErreurs'
import App from './App.tsx'

// Supervision Sentry : chargée paresseusement et uniquement si un DSN est
// configuré au build (VITE_SENTRY_DSN) — le bundle reste léger sinon,
// ce qui compte sur les connexions mobiles de Lubumbashi.
const sentryDsn = import.meta.env.VITE_SENTRY_DSN as string | undefined
if (sentryDsn) {
  void import('@sentry/react').then((Sentry) => {
    Sentry.init({
      dsn: sentryDsn,
      environment: import.meta.env.PROD ? 'production' : 'development',
      // Les 401/403 sont des réponses métier normales, pas des bugs
      ignoreErrors: ['UNAUTHORIZED', 'FORBIDDEN', 'Session expirée ou invalide'],
      beforeSend(evenement) {
        // Hygiène : jamais de PIN ni de jeton dans un rapport
        if (evenement.request?.headers) delete evenement.request.headers
        return evenement
      },
    })
  })
}

enregistrerServiceWorker()

// Persistance du stockage : demandée UNE fois au premier lancement,
// sans jamais bloquer ni afficher quoi que ce soit (voir lib/pwa.ts).
void demanderPersistanceStockage()

// Journal d'erreurs serveur : erreurs JS hors React et promesses
// rejetées non rattrapées (voir src/lib/journalErreurs.ts).
brancherJournalGlobal()

// CORRECTIF RACINE (Phase A/B) : le drapeau anti-boucle de la
// récupération « chunk disparu » n'est JAMAIS réarmé au démarrage —
// il ne l'est que par une action utilisateur explicite (boutons
// « Réessayer » / « Recharger l'application »). Réarmer ici
// provoquait des rechargements en boucle jusqu'à l'écran d'erreur.

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {/* ErrorBoundary : une erreur de rendu n'affiche plus un écran
        blanc mais un écran de repli avec bouton de rechargement */}
    <ErrorBoundary>
      {/* Le routage est le mini-routeur maison par fragment (src/lib/router) :
          aucune dépendance react-router dans le bundle (boucle 7, budget JS) */}
      <TRPCProvider>
        {/* Socle i18n FR/EN/PT : toute l'application est traduite */}
        <I18nProvider>
          <App />
        </I18nProvider>
      </TRPCProvider>
    </ErrorBoundary>
  </StrictMode>,
)
