// ============================================================
// GBS — Anti-brute-force (limiteur en mémoire, fenêtre glissante)
//
// Menace : un PIN à 4 chiffres n'a que 10 000 combinaisons — sans
// limitation, un script les épuise en quelques minutes via les
// endpoints publics de connexion.
//
// Règle : 5 échecs (par couple IP + identifiant) → blocage 5 min.
// En mémoire : suffisant pour le déploiement instance unique actuel ;
// si l'app passe un jour en multi-instances, il faudra partager
// ce compteur (ex. table Postgres).
// ============================================================

interface Compteur {
  echecs: number;
  premierEchec: number; // début de la fenêtre glissante (ms)
  bloqueJusquA: number; // fin du blocage (ms), 0 = pas bloqué
}

const compteurs = new Map<string, Compteur>();

const MAX_ECHECS = 5;
const FENETRE_MS = 5 * 60 * 1000; // fenêtre glissante de 5 min
const BLOCAGE_MS = 5 * 60 * 1000; // blocage 5 min après 5 échecs

/** Purge paresseuse des compteurs expirés (évite une fuite mémoire) */
function purger(maintenantMs: number) {
  if (compteurs.size < 1000) return; // balayage seulement si la table grossit
  for (const [cle, c] of compteurs) {
    if (c.bloqueJusquA < maintenantMs && c.premierEchec + FENETRE_MS < maintenantMs) {
      compteurs.delete(cle);
    }
  }
}

/**
 * Vérifie que la clé (IP + identifiant) n'est pas bloquée.
 * Retourne null si OK, sinon le nombre de minutes à attendre.
 */
export function tentativePermise(cle: string): number | null {
  const maintenantMs = Date.now();
  purger(maintenantMs);
  const c = compteurs.get(cle);
  if (c && c.bloqueJusquA > maintenantMs) {
    return Math.ceil((c.bloqueJusquA - maintenantMs) / 60_000);
  }
  return null;
}

/** Enregistre un échec ; déclenche le blocage au seuil */
export function enregistrerEchec(cle: string): void {
  const maintenantMs = Date.now();
  const c = compteurs.get(cle);
  if (!c || c.premierEchec + FENETRE_MS < maintenantMs) {
    compteurs.set(cle, { echecs: 1, premierEchec: maintenantMs, bloqueJusquA: 0 });
    return;
  }
  c.echecs += 1;
  if (c.echecs >= MAX_ECHECS) c.bloqueJusquA = maintenantMs + BLOCAGE_MS;
}

/** Connexion réussie : le compteur repart à zéro */
export function reinitialiserEchecs(cle: string): void {
  compteurs.delete(cle);
}

/** Utilitaire de test : vide tous les compteurs */
export function viderLimiteur(): void {
  compteurs.clear();
}
