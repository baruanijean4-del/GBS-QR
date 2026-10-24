// ============================================================
// GBS — Traduction des messages du serveur (erreurs, alertes)
//
// Principe : le CODE reste écrit en français (erreur("Code PIN
// incorrect.")) — le gabarit français est la CLÉ du catalogue. Au
// moment d'envoyer la réponse, le serveur traduit selon la langue du
// client (en-tête « x-lang »). Aucun appel existant n'est réécrit,
// et un message sans traduction retombe sur le français.
//
// Gabarits avec variables : « Stock insuffisant pour {}. Disponible
// : {}. » — dans le catalogue de chaque langue les variables sont
// NUMÉROTÉES ({1}, {2}…) pour que l'ordre des mots puisse changer.
//
// Catalogues : api/i18n/serveur.{en,pt,sw}.json. Le test
// api/__tests__/messages-serveur.test.ts échoue si un message du code
// n'a pas de traduction (ajouter un message = l'ajouter aux 3 fichiers).
// ============================================================

import en from "../i18n/serveur.en.json";
import pt from "../i18n/serveur.pt.json";
import sw from "../i18n/serveur.sw.json";

export type LangueServeur = "fr" | "en" | "pt" | "sw";

const CATALOGUES: Record<Exclude<LangueServeur, "fr">, Record<string, string>> = { en, pt, sw };

/** Langue demandée par le client (« fr-FR », « en »…) ; français par défaut. */
export function langueDepuisEntete(valeur: string | null | undefined): LangueServeur {
  const v = (valeur ?? "").slice(0, 2).toLowerCase();
  return v === "en" || v === "pt" || v === "sw" ? v : "fr";
}

interface Motif { re: RegExp; trad: string; poids: number }
interface Index { exact: Map<string, string>; motifs: Motif[] }

const echapper = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Compile un catalogue : messages sans variable → table exacte ; avec
 *  variables → expression régulière (les plus spécifiques d'abord). */
function construire(catalogue: Record<string, string>): Index {
  const exact = new Map<string, string>();
  const motifs: Motif[] = [];
  for (const [fr, trad] of Object.entries(catalogue)) {
    if (!fr.includes("{}")) { exact.set(fr, trad); continue; }
    const parties = fr.split("{}");
    const re = new RegExp(`^${parties.map(echapper).join("([\\s\\S]*?)")}$`);
    motifs.push({ re, trad, poids: parties.join("").length });
  }
  motifs.sort((a, b) => b.poids - a.poids);
  return { exact, motifs };
}

const INDEX: Partial<Record<LangueServeur, Index>> = {};

/**
 * Traduit un message serveur (écrit en français). Retourne le message
 * inchangé si la langue est le français ou si aucun gabarit ne correspond
 * (message dynamique, texte saisi par un utilisateur…).
 */
export function traduireMessage(messageFr: string, langue: LangueServeur): string {
  if (langue === "fr") return messageFr;
  const index = (INDEX[langue] ??= construire(CATALOGUES[langue]));
  const direct = index.exact.get(messageFr);
  if (direct !== undefined) return direct;
  for (const { re, trad } of index.motifs) {
    const m = re.exec(messageFr);
    if (m) return trad.replace(/\{(\d+)\}/g, (_, n: string) => m[Number(n)] ?? "");
  }
  return messageFr;
}
