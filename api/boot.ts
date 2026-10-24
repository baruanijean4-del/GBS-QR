import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { compress } from "hono/compress";
import { secureHeaders } from "hono/secure-headers";
import type { HttpBindings } from "@hono/node-server";
import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { appRouter } from "./router";
import { createContext } from "./context";
import { etagSnapshot } from "./lib/etagSnapshot";
import { langueDepuisEntete, traduireMessage } from "./lib/traductionServeur";
import { env } from "./lib/env";
import { capturerErreur, initMonitoring } from "./lib/monitoring";
import { enregistrerErreurClient, erreurPermise, schemaErreurClient } from "./lib/erreursClient";

initMonitoring(); // no-op si SENTRY_DSN est absent

// Avertissements production au démarrage (configuration à risque)
if (env.isProduction) {
  if (env.adminPin === "2468") {
    console.warn("⚠ SÉCURITÉ : ADMIN_PIN vaut la valeur par défaut « 2468 » — définissez ADMIN_PIN (secret fort) avant l'ouverture au public !");
  }
  if (!env.sessionSecret) {
    console.warn("⚠ SÉCURITÉ : SESSION_SECRET absent — les sessions seront invalidées à chaque redémarrage. Définissez SESSION_SECRET (64 caractères aléatoires).");
  }
}

const app = new Hono<{ Bindings: HttpBindings }>();

/** Message d'erreur (écrit en français) traduit selon l'en-tête x-lang de la requête */
const tr = (c: { req: { header: (n: string) => string | undefined } }, message: string) =>
  traduireMessage(message, langueDepuisEntete(c.req.header("x-lang")));

// 10 Mo suffisent : la plus grosse requête est l'upload photo produit
// (5 Mo de binaire → ~7 Mo une fois encodé en base64 dans le JSON tRPC).
// Au-delà → 413 avec un message clair (protection DoS / bande passante).
app.use(bodyLimit({
  maxSize: 10 * 1024 * 1024,
  onError: (c) => c.json({ error: tr(c, "Fichier trop volumineux. Maximum 10 Mo.") }, 413),
}));

// En-têtes de sécurité HTTP (X-Frame-Options, X-Content-Type-Options,
// Referrer-Policy, CSP…). La CSP autorise les images HTTPS distantes
// (photos Open Food Facts) et les styles inline (Tailwind/Sonner).
app.use("*", secureHeaders({
  contentSecurityPolicy: {
    defaultSrc: ["'self'"],
    scriptSrc: ["'self'"],
    styleSrc: ["'self'", "'unsafe-inline'"],
    imgSrc: ["'self'", "data:", "https:"],
    connectSrc: ["'self'", "https://*.ingest.sentry.io", "https://*.ingest.de.sentry.io"], // domaines Sentry : supervision navigateur possible sans toucher la CSP
    fontSrc: ["'self'", "data:"],
    objectSrc: ["'none'"],
    frameAncestors: ["'none'"],
  },
}));
// Compression des réponses (gzip/deflate via CompressionStream).
// Gros gains sur les snapshots tRPC (JSON volumineux, catalogue ~1000
// produits) et le bundle JS — crucial sur les réseaux mobiles de
// Lubumbashi. Node 20 ne gère pas brotli dans CompressionStream :
// gzip est négocié automatiquement à la place.
app.use("*", compress());

// ETag sur les snapshots (304 si rien n'a changé) — voir api/lib/etagSnapshot.ts.
// Seule la requête exacte « gbs.snapshot » est concernée : un appel
// batché avec d'autres procédures traverse sans ETag.
app.use("/api/trpc/gbs.snapshot", etagSnapshot);
app.use("/api/trpc/*", async (c) => {
  return fetchRequestHandler({
    endpoint: "/api/trpc",
    req: c.req.raw,
    router: appRouter,
    createContext,
    // Seules les erreurs internes (bugs) remontent vers Sentry —
    // les 401/403 et refus métier (BAD_REQUEST) sont des réponses normales.
    onError({ error }) {
      if (error.code === "INTERNAL_SERVER_ERROR") capturerErreur(error);
    },
  });
});
// Journal des erreurs client (Phase B.6) : les apps envoient ici
// leurs erreurs d'affichage (boundaries, onerror, unhandledrejection).
// Schéma STRICT : toute clé surprise (PIN, mot de passe, jeton,
// contenu de formulaire) est refusée — on ne stocke que du technique.
// Limite : 10 enregistrements par minute et par appareil.
app.post("/api/erreurs", async (c) => {
  let corps: unknown;
  try {
    corps = await c.req.json();
  } catch {
    return c.json({ error: tr(c, "Corps JSON invalide.") }, 400);
  }
  const lu = schemaErreurClient.safeParse(corps);
  if (!lu.success) {
    return c.json({ error: tr(c, "Charge refusée : champs non conformes.") }, 400);
  }
  const ip = c.req.header("x-forwarded-for")?.split(",")[0].trim() || "inconnue";
  if (!erreurPermise(`${ip}|${lu.data.appareilId}`)) {
    return c.json({ error: tr(c, "Trop d'envois — réessayez dans une minute.") }, 429);
  }
  try {
    await enregistrerErreurClient(lu.data, c.req.header("user-agent"));
    return c.json({ ok: true });
  } catch (e) {
    capturerErreur(e);
    return c.json({ error: tr(c, "Enregistrement impossible.") }, 500);
  }
});

app.all("/api/*", (c) => c.json({ error: "Not Found" }, 404));

// Erreur non interceptée hors tRPC (front statique, middlewares…)
app.onError((e, c) => {
  capturerErreur(e);
  return c.json({ error: tr(c, "Erreur interne du serveur.") }, 500);
});

export default app;

if (env.isProduction) {
  const { serve } = await import("@hono/node-server");
  const { serveStaticFiles } = await import("./lib/vite");
  serveStaticFiles(app);

  const port = parseInt(process.env.PORT || "3000");

  // Garde de schéma AVANT d'accepter le trafic : la plateforme de
  // publication teste l'app dès le démarrage — si la base existante
  // n'a pas les dernières migrations, l'API casserait immédiatement
  // (« colonne manquante »). Idempotent, no-op sur base vide, borné
  // à 20 s.
  // En production, une migration manquante est FATALE : démarrer
  // quand même servirait une application cassée (snapshot en échec).
  // Une base simplement injoignable (réseau) ne doit en revanche
  // pas empêcher le démarrage — l'erreur remontera via l'API.
  try {
    const { assurerSchema } = await import("./lib/assurerSchema");
    await Promise.race([
      assurerSchema(),
      new Promise((r) => setTimeout(r, 20_000)),
    ]);
  } catch (e) {
    if (e instanceof Error && e.message.includes("Migrations manquantes en production")) {
      console.error("[boot] FATAL :", e.message);
      process.exit(1); // la plateforme redémarrera et l'erreur restera visible
    }
    console.warn("[boot] garde de schéma en échec (l'API remontera l'erreur) :", e);
  }

  serve({ fetch: app.fetch, port }, () => {
    console.log(`Server running on http://localhost:${port}/`);
    // Préchauffe le pool Postgres : chaque nouvelle connexion paie un
    // handshake TLS coûteux (~1-2 s vers Neon). On ouvre les connexions
    // du pool dès le démarrage pour que le 1er visiteur ne les attende pas.
    void (async () => {
      try {
        // Compte super-admin : créé/maj au démarrage (PIN = ADMIN_PIN)
        const { assurerSuperAdmin } = await import("./lib/superAdmin");
        await assurerSuperAdmin();
        // Référentiel codes-barres : 10 codes connus (idempotent)
        const { assurerSeedCodesBarres } = await import("../db/seed");
        await assurerSeedCodesBarres();
        // Journal d'erreurs client : table créée si absente (idempotent)
        const { assurerTableErreursClient } = await import("./lib/erreursClient");
        await assurerTableErreursClient();
        const { getDb } = await import("./queries/connection");
        const s = await import("@db/schema");
        await Promise.all(Array.from({ length: 10 }, () => getDb().select().from(s.meta).limit(1)));
        console.log("Pool Postgres préchauffé (10 connexions).");
      } catch (e) {
        console.warn("Préchauffage du pool impossible (la 1re requête paiera le coût) :", e);
      }
    })();
  });
}
