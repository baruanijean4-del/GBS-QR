import type { Hono } from "hono";
import type { HttpBindings } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import fs from "fs";
import path from "path";

type App = Hono<{ Bindings: HttpBindings }>;

/** Types MIME servis pour les variantes pré-compressées */
const MIME_PAR_EXT: Record<string, string> = {
  ".js": "text/javascript",
  ".css": "text/css",
  ".html": "text/html",
  ".svg": "image/svg+xml",
  ".json": "application/json",
  ".webmanifest": "application/manifest+json",
  ".txt": "text/plain",
};

export function serveStaticFiles(app: App) {
  const distPath = path.resolve(import.meta.dirname, "../dist/public");

  // Photos produits téléversées (persistantes, hors du bundle Vite)
  app.use("/uploads/*", serveStatic({ root: "./" }));

  // Variantes pré-compressées : le post-build (scripts/compresser-assets.mjs)
  // génère un .gz à côté de chaque asset. Si le client accepte gzip et que
  // la variante existe, on la sert directement — zéro CPU au runtime.
  app.use("*", async (c, next) => {
    if (!c.req.header("accept-encoding")?.includes("gzip")) return next();
    const chemin = decodeURIComponent(new URL(c.req.url).pathname);
    // Garde anti-traversée : le chemin doit rester dans dist/public
    const fichier = path.resolve(distPath, `.${chemin}`);
    if (!fichier.startsWith(distPath)) return next();
    const ext = path.extname(fichier);
    const mime = MIME_PAR_EXT[ext];
    if (!mime || !fs.existsSync(`${fichier}.gz`)) return next();
    const gz = fs.readFileSync(`${fichier}.gz`);
    return new Response(new Uint8Array(gz), {
      headers: {
        "content-type": mime,
        "content-encoding": "gzip",
        "content-length": String(gz.length),
        vary: "Accept-Encoding",
      },
    });
  });

  app.use("*", serveStatic({ root: "./dist/public" }));

  app.notFound((c) => {
    const accept = c.req.header("accept") ?? "";
    if (!accept.includes("text/html")) {
      return c.json({ error: "Not Found" }, 404);
    }
    const indexPath = path.resolve(distPath, "index.html");
    const content = fs.readFileSync(indexPath, "utf-8");
    return c.html(content);
  });
}
