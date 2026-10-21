// ============================================================
// GBS — Service Open Food Facts (recherche produit par code-barres)
// API publique gratuite : https://world.openfoodfacts.org
// Règles d'usage : User-Agent obligatoire, timeout 5 s, on n'extrait
// que 8 champs pour garder une réponse < 1 Ko.
// ============================================================

/** Résultat normalisé d'une recherche Open Food Facts (≤ 1 Ko). */
export interface ProduitOff {
  code: string; // code-barres (EAN-13 / EAN-8)
  nom: string; // product_name_fr || product_name
  marque: string | null; // brands (première marque)
  categorie: string; // traduite vers CATEGORIES_PRODUIT (français)
  format: string | null; // quantity (« 33 cl », « 1 L »…)
  photoUrl: string | null; // image_front_url
  photoThumbnailUrl: string | null; // image_front_small_url
  nutriscore: string | null; // nutrition_grade_fr || nutriscore_grade
}

/** Format accepté : 8 à 14 chiffres (EAN-8, EAN-13, UPC-A, Code 128 numérique). */
export const REGEX_CODE_BARRES = /^\d{8,14}$/;

/**
 * Traduit les étiquettes de catégories Open Food Facts (anglais, snake-case)
 * vers les catégories françaises de l'application (CATEGORIES_PRODUIT).
 * L'ordre compte : la première correspondance gagne.
 */
export function traduireCategorie(tags: string[]): string {
  const t = tags.join(" ").toLowerCase();
  if (/\bbeer|biere|lager|ale\b/.test(t)) return "Bières";
  // Snacks avant boissons : « chocolate » contient « cola » en sous-chaîne
  if (/snack|biscuit|chocolate|chocolat|candy|bonbon|crisp|chip/.test(t)) return "Snacks & conserves";
  if (/canned|conserve|sauce|bouillon|seasoning|epice|spice/.test(t)) return "Snacks & conserves";
  if (/water|eau/.test(t)) return "Boissons"; // eau = boisson dans l'app
  if (/soda|\bcola|beverage|boisson|juice|jus\b|energy-drink|soft-drink|lemonade/.test(t)) return "Boissons";
  if (/soap|savon|detergent|détergent|hygiene|toothpaste|dentifrice|cosmetic/.test(t)) return "Savons & détergents";
  if (/fish|poisson|sardine|thon|tuna/.test(t)) return "Poissons";
  if (/rice|riz|flour|farine|oil|huile|sugar|sucre|salt|sel\b|pasta|pates|staple/.test(t)) return "Produits de base";
  return "Divers";
}

/**
 * Recherche un produit par code-barres sur Open Food Facts.
 * Retourne null si le format est invalide, le produit inconnu,
 * ou en cas d'erreur réseau / timeout (5 s) — jamais d'exception.
 */
export async function chercherOpenFoodFacts(codeBarres: string): Promise<ProduitOff | null> {
  const code = codeBarres.trim();
  if (!REGEX_CODE_BARRES.test(code)) return null;

  try {
    const reponse = await fetch(
      `https://world.openfoodfacts.org/api/v0/product/${encodeURIComponent(code)}.json`,
      {
        // L'API exige un User-Agent identifiant l'application
        headers: { "User-Agent": "NgandaPOS/1.0 (contact@ngandapos.cd)" },
        signal: AbortSignal.timeout(5000),
      },
    );
    if (!reponse.ok) return null;

    const donnees = (await reponse.json()) as {
      status?: number;
      product?: Record<string, unknown>;
    };
    if (donnees.status !== 1 || !donnees.product) return null;

    const p = donnees.product;
    const texte = (v: unknown): string | null =>
      typeof v === "string" && v.trim() !== "" ? v.trim() : null;

    const nom = texte(p.product_name_fr) ?? texte(p.product_name);
    if (!nom) return null; // sans nom, le résultat est inutilisable

    const marques = texte(p.brands);
    const tags = Array.isArray(p.categories_tags)
      ? (p.categories_tags as unknown[]).filter((x): x is string => typeof x === "string")
      : [];

    return {
      code,
      nom,
      marque: marques ? marques.split(",")[0].trim() : null,
      categorie: traduireCategorie(tags),
      format: texte(p.quantity),
      photoUrl: texte(p.image_front_url),
      photoThumbnailUrl: texte(p.image_front_small_url),
      nutriscore: texte(p.nutrition_grade_fr) ?? texte(p.nutriscore_grade),
    };
  } catch {
    // Timeout, DNS, réseau coupé… : le scan ne doit jamais planter
    return null;
  }
}
