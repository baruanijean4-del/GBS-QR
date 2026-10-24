import type { MiddlewareHandler } from "hono";
import { createHash } from "node:crypto";

/** En-tête portant le jeton de session prolongé (session glissante). */
const ENTETE_JETON_RENOUVELE = "x-session-renouvelee";

/**
 * ETag sur les snapshots : le snapshot poll toutes les 4 s par écran ;
 * quand rien n'a changé, on répond 304 Not Modified au lieu de renvoyer
 * tout le JSON (le catalogue ~1000 produits part à chaque fois sinon).
 * Le hash est calculé sur le JSON brut (avant gzip) : il est stable
 * quel que soit l'encodage négocié. Le client (src/lib/fetchEtag.ts)
 * renvoie If-None-Match et rejoue sa dernière réponse sur un 304.
 *
 * Le 304 doit CONSERVER le jeton de session prolongé : sans cela, un
 * écran dont les données ne bougent pas ne recevait jamais sa
 * prolongation, et la session expirait 12 h après la dernière
 * prolongation reçue (ex. connexion à midi → déconnexion à 00h00).
 */
export const etagSnapshot: MiddlewareHandler = async (c, next) => {
  await next();
  if (c.res.status !== 200) return;
  const corps = await c.res.clone().text();
  const etag = `"${createHash("sha256").update(corps).digest("base64url")}"`;
  if (c.req.header("if-none-match") === etag) {
    const entetes304 = new Headers({ etag });
    const jeton = c.res.headers.get(ENTETE_JETON_RENOUVELE);
    if (jeton) entetes304.set(ENTETE_JETON_RENOUVELE, jeton);
    c.res = new Response(null, { status: 304, headers: entetes304 });
    return;
  }
  const entetes = new Headers(c.res.headers);
  entetes.set("etag", etag);
  entetes.delete("content-length"); // le corps compressé changera de taille
  c.res = new Response(corps, { status: 200, headers: entetes });
};
