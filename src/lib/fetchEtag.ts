// ============================================================
// GBS — fetch avec cache ETag pour le client tRPC
//
// Le serveur pose un ETag (hash du corps) sur gbs.snapshot et
// répond 304 Not Modified si rien n'a changé (voir api/boot.ts).
// Ici : on renvoie If-None-Match quand on a déjà une réponse pour
// exactement la même requête (URL + corps), et sur un 304 on
// rejoue le corps mémorisé en le re-présentant comme un 200 —
// tRPC/TanStack Query ne voient aucune différence.
//
// Économie : un snapshot staff embarque le catalogue (~1000
// produits) ; sans changement, seuls quelques octets circulent.
// ============================================================

import { mettreAJourJeton } from "./sessionLocale";

interface EntreeCache {
  etag: string;
  corps: string;
}

/** Dernière réponse connue par requête exacte (méthode + URL + corps) */
const cacheEtag = new Map<string, EntreeCache>();

/** fetch compatible tRPC (httpBatchLink) avec gestion ETag/304 */
export async function fetchAvecEtag(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  const cle = `${init?.method ?? "GET"} ${String(input)} ${init?.body ?? ""}`;

  // En-têtes de la requête + If-None-Match si une réponse est mémorisée
  const entetes = new Headers(init?.headers);
  const memo = cacheEtag.get(cle);
  if (memo) entetes.set("if-none-match", memo.etag);

  const reponse = await globalThis.fetch(input, {
    ...(init ?? {}),
    headers: entetes,
    credentials: "include",
  });

  // Session glissante : le serveur peut joindre un jeton prolongé —
  // on le mémorise aussitôt (les prochaines requêtes l'utiliseront).
  const jetonRenouvele = reponse.headers.get("x-session-renouvelee");
  if (jetonRenouvele) mettreAJourJeton(jetonRenouvele);

  // 304 : rien n'a changé — on rejoue la réponse mémorisée
  if (reponse.status === 304 && memo) {
    return new Response(memo.corps, {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }

  // 200 + ETag : on mémorise pour le prochain appel
  const etag = reponse.headers.get("etag");
  if (reponse.ok && etag) {
    const corps = await reponse.clone().text();
    cacheEtag.set(cle, { etag, corps });
  }
  return reponse;
}
