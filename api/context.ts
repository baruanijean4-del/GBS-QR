import type { FetchCreateContextFnOptions } from "@trpc/server/adapters/fetch";
import { jetonDepuisEntete, verifierSessionActive } from "./lib/session";
import { langueDepuisEntete, type LangueServeur } from "./lib/traductionServeur";

/** Identité authentifiée extraite du jeton Bearer (null = non connecté) */
export type SessionAuth = {
  utilisateurId: string;
  /** Ligne sessions_appareils (mode glissant) — sert à la déconnexion */
  sid?: string;
};

export type TrpcContext = {
  req: Request;
  resHeaders: Headers;
  /** Session staff vérifiée (signature + expiration + révocation) — null sinon */
  session: SessionAuth | null;
  /** IP du client (proxy : X-Forwarded-For) — sert à l'anti-brute-force */
  ip: string;
  /** Langue du client (en-tête x-lang) — traduit les messages d'erreur et d'alerte */
  langue: LangueServeur;
};

export async function createContext(
  opts: FetchCreateContextFnOptions,
): Promise<TrpcContext> {
  // Le serveur ne fait plus confiance au client pour l'identité :
  // elle provient uniquement du jeton signé (HMAC) présenté ici.
  // Mode glissant : la vérification lit aussi sessions_appareils
  // (révocation par appareil) et prolonge le jeton si besoin — le
  // client le récupère dans l'en-tête X-Session-Renouvelee.
  const jeton = jetonDepuisEntete(opts.req.headers.get("authorization"));
  const verifiee = await verifierSessionActive(jeton);
  if (verifiee?.nouveauJeton) {
    opts.resHeaders.set("x-session-renouvelee", verifiee.nouveauJeton);
  }
  // Derrière un reverse proxy (Coolify, Nginx…), l'IP réelle est dans
  // X-Forwarded-For ; on prend le premier saut (le client).
  const ip = opts.req.headers.get("x-forwarded-for")?.split(",")[0].trim() || "inconnue";
  return {
    req: opts.req,
    resHeaders: opts.resHeaders,
    session: verifiee ? { utilisateurId: verifiee.payload.utilisateurId, sid: verifiee.payload.sid } : null,
    ip,
    langue: langueDepuisEntete(opts.req.headers.get("x-lang")),
  };
}
