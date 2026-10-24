// ============================================================
// GBS — Photos : toujours une ADRESSE (URL), jamais un fichier envoyé
//
// Circuit : le gérant ou le propriétaire DEMANDE une photo (produit ou
// chambre) ; le super-admin colle l'adresse de l'image et valide ; la
// photo apparaît côté client et côté établissement.
// Les photos sont préparées à l'installation avec un outil extérieur
// (hébergement d'images au choix) : l'application ne stocke aucune image.
// ============================================================

/** Ce sur quoi porte une demande de photo */
export type CiblePhoto = "PRODUIT" | "CHAMBRE";

export type StatutDemandePhoto = "EN_ATTENTE" | "VALIDEE" | "REFUSEE" | "ANNULEE";

/** Longueur maximale d'une adresse de photo (colonne varchar(500)) */
export const URL_PHOTO_MAX = 500;

/**
 * Une adresse de photo valide : lien https:// complet, sans identifiants
 * (user:mot-de-passe@), 500 caractères au plus. Le https évite les
 * contenus mixtes sur l'application installée (PWA).
 */
export function urlPhotoValide(valeur: string): boolean {
  const v = valeur.trim();
  if (v.length === 0 || v.length > URL_PHOTO_MAX) return false;
  let u: URL;
  try {
    u = new URL(v);
  } catch {
    return false;
  }
  return u.protocol === "https:" && u.hostname.includes(".") && u.username === "" && u.password === "";
}
