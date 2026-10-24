// ============================================================
// GBS — ETag des snapshots : le 304 garde le jeton de session prolongé
// (régression « déconnexion à 00h00 » : la prolongation glissante était
// perdue quand les données ne changeaient pas).
// Test pur : aucune base de données.
// ============================================================

import { describe, expect, it } from "vitest";
import { Hono } from "hono";
import { etagSnapshot } from "../lib/etagSnapshot";

function appFictive() {
  const app = new Hono();
  app.use("/snap", etagSnapshot);
  app.get("/snap", (c) => c.json({ donnees: 1 }, 200, { "x-session-renouvelee": "jeton-neuf" }));
  return app;
}

describe("etagSnapshot", () => {
  it("200 : pose l'ETag et garde le jeton prolongé", async () => {
    const r = await appFictive().request("/snap");
    expect(r.status).toBe(200);
    expect(r.headers.get("etag")).toBeTruthy();
    expect(r.headers.get("x-session-renouvelee")).toBe("jeton-neuf");
  });

  it("304 : rien n'a changé, mais le jeton prolongé arrive quand même", async () => {
    const app = appFictive();
    const etag = (await app.request("/snap")).headers.get("etag") ?? "";
    const r = await app.request("/snap", { headers: { "if-none-match": etag } });
    expect(r.status).toBe(304);
    expect(r.headers.get("etag")).toBe(etag);
    expect(r.headers.get("x-session-renouvelee")).toBe("jeton-neuf");
  });

  it("304 sans jeton à prolonger : pas d'en-tête fantôme", async () => {
    const app = new Hono();
    app.use("/snap", etagSnapshot);
    app.get("/snap", (c) => c.json({ donnees: 1 }));
    const etag = (await app.request("/snap")).headers.get("etag") ?? "";
    const r = await app.request("/snap", { headers: { "if-none-match": etag } });
    expect(r.status).toBe(304);
    expect(r.headers.get("x-session-renouvelee")).toBeNull();
  });
});
