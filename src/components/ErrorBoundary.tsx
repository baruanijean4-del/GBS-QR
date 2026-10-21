// ============================================================
// GBS — Frontières d'erreur, TROIS niveaux (Phase B.2) :
//
//   1. ErrorBoundary (application) : montée dans main.tsx, tout
//      en haut. Dernier filet — affiche l'écran de secours
//      complet (3 langues, code court, support WhatsApp).
//   2. PageBoundary (page/route) : une page qui plante laisse
//      les autres routes et la navigation utilisables.
//   3. BlocBoundary (bloc) : une liste, un graphique ou un
//      formulaire qui plante n'emporte pas sa page.
//
// Tous : détectent le « chunk disparu après déploiement » et
// déclenchent la récupération automatique UNE seule fois (voir
// src/lib/recuperation.ts), puis journalisent vers le serveur.
// Pendant une auto-guérison, un écran sobre « Mise à jour… »
// remplace l'écran d'erreur (pas de fausse alerte).
// (React exige un composant classe pour componentDidCatch.)
// ============================================================

import { Component, type ErrorInfo, type ReactNode } from 'react'
import { BlocErreur, EcranErreur, EcranMiseAJour } from './ErreurEcran'
import { codeCourtErreur, estErreurChargementModule, reinitialiserRecuperation, tenterRecuperationChunk } from '@/lib/recuperation'
import { journaliserErreur } from '@/lib/journalErreurs'

interface Props { children: ReactNode }

interface Etat {
  erreur: Error | null
  /** La récupération automatique a DÉJÀ échoué dans cette session :
   *  on affiche l'écran de secours au lieu de recharger en boucle. */
  recupEchouee: boolean
}

/**
 * Classe de base : logique commune aux trois niveaux.
 * - chunk disparu → récupération auto unique, écran sobre pendant
 *   l'opération, écran de secours si elle a déjà échoué ;
 * - autre erreur → journal serveur + écran de secours du niveau.
 */
abstract class BaseBoundary<P extends Props> extends Component<P, Etat> {
  override state: Etat = { erreur: null, recupEchouee: false }

  static getDerivedStateFromError(erreur: Error): Etat {
    return { erreur, recupEchouee: false }
  }

  override componentDidCatch(erreur: Error, info: ErrorInfo) {
    console.error(`[GBS] Erreur interceptée (${this.niveau()}) :`, erreur, info.componentStack)

    if (estErreurChargementModule(erreur?.message ?? '')) {
      // Récupération UNE fois (désinscription SW + vidage caches +
      // rechargement). Si elle a déjà été tentée dans cette session,
      // on bascule sur l'écran de secours stable — jamais de boucle.
      void tenterRecuperationChunk().then((lancee) => {
        if (!lancee) this.setState({ recupEchouee: true })
      })
      // Une erreur de chunk journalisée aussi : c'est le signal
      // d'un déploiement qui casse les anciens onglets.
      journaliserErreur(erreur, { composant: info.componentStack ?? undefined })
      return
    }
    journaliserErreur(erreur, { composant: info.componentStack ?? undefined })
  }

  /** « Réessayer » : réaffiche SANS recharger (session conservée) */
  protected reessayer = () => {
    reinitialiserRecuperation() // l'utilisateur reprend la main : réarme le filet
    this.setState({ erreur: null, recupEchouee: false })
  }

  /** Étiquette de niveau pour la console (ex. « page /p ») */
  protected abstract niveau(): string

  /** Rendu de secours propre au niveau (pleine page ou bloc) */
  protected abstract repli(): ReactNode

  override render() {
    const { erreur, recupEchouee } = this.state
    if (!erreur) return this.props.children
    // Auto-guérison en cours (chunk disparu) : écran sobre, pas d'alarme
    if (!recupEchouee && estErreurChargementModule(erreur.message ?? '')) {
      return <EcranMiseAJour />
    }
    return this.repli()
  }
}

// ------------------------------------------------------------
// Niveau 1 — APPLICATION (dernier filet, écran complet)
// ------------------------------------------------------------

export class ErrorBoundary extends BaseBoundary<Props> {
  protected niveau(): string {
    return 'application'
  }

  protected repli(): ReactNode {
    return <EcranErreur code={codeCourtErreur(this.state.erreur)} surReessayer={this.reessayer} />
  }
}

// ------------------------------------------------------------
// Niveau 2 — PAGE : chaque route est enfermée dans sa frontière.
// Une page qui plante n'empêche pas de naviguer ailleurs : quand
// la route change, la frontière se réinitialise d'elle-même.
// ------------------------------------------------------------

interface PropsPage extends Props {
  /** Clé de route courante : son changement réarme la frontière */
  route: string
}

export class PageBoundary extends BaseBoundary<PropsPage> {
  override componentDidUpdate(precedentes: PropsPage) {
    // Navigation vers une autre route : la page en panne est quittée,
    // la frontière repart à zéro pour la nouvelle page.
    if (precedentes.route !== this.props.route && this.state.erreur) {
      this.setState({ erreur: null, recupEchouee: false })
    }
  }

  protected niveau(): string {
    return `page ${this.props.route}`
  }

  protected repli(): ReactNode {
    return <EcranErreur code={codeCourtErreur(this.state.erreur)} surReessayer={this.reessayer} />
  }
}

// ------------------------------------------------------------
// Niveau 3 — BLOC : listes, graphiques, formulaires risqués.
// Repli compact qui laisse le reste de la page intact.
// ------------------------------------------------------------

export class BlocBoundary extends BaseBoundary<Props> {
  protected niveau(): string {
    return 'bloc'
  }

  protected repli(): ReactNode {
    return <BlocErreur surReessayer={this.reessayer} />
  }
}
