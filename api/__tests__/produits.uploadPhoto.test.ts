// ============================================================
// GBS — Tests de produits.uploadPhoto (Étape 8)
// Garde des 5 Mo, contrôle d'accès (403 serveuse), sortie JPEG
// 800×800 + vignette 200×200 (jimp — voir api/services/storage.ts).
// ============================================================

import { Buffer } from "buffer";
import fs from "fs";
import path from "path";
import { TRPCError } from "@trpc/server";
import { afterAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { Jimp } from "jimp";
import { appRouter } from "../router";
import { getDb } from "../queries/connection";
import * as s from "../../db/schema";
import { maintenant } from "../gbsUtils";

// H.1 : identité = session serveur (propriétaire / serveuse de test, fixtures ci-dessous)
const appelant = appRouter.createCaller({ session: { utilisateurId: "usr_test_photo" } } as never);
const appelantServ = appRouter.createCaller({ session: { utilisateurId: "usr_test_photo_serv" } } as never);

const ORG_TEST = "org_test_photo";
const PROP_TEST = "usr_test_photo";
const SERV_TEST = "usr_test_photo_serv";
const ETAB_TEST = "etab_test_photo";
const PRD_TEST = "prd_test_photo";

async function preparer() {
  const db = getDb();
  const now = maintenant();
  await db.insert(s.utilisateurs).values([
    { id: PROP_TEST, nom: "Test Photo", telephone: "+243000000002", pin: "9999", creeLe: now },
    { id: SERV_TEST, nom: "Test Photo Serveuse", telephone: "+243000000003", pin: "9999", creeLe: now },
  ]).onConflictDoNothing();
  await db.insert(s.organisations).values({
    id: ORG_TEST, nom: "Org photo", proprietaireId: PROP_TEST, creeLe: now,
  }).onConflictDoNothing();
  await db.insert(s.terrasses).values({
    id: ETAB_TEST, organisationId: ORG_TEST, nom: "Terrasse photo",
    adresse: "Av. des Tests", typeEtablissement: "TERRASSE",
    seuilEcartCdf: 5000, seuilEcartUsd: 200, tauxUsdCdf: 2800, creeLe: now,
  }).onConflictDoNothing();
  await db.insert(s.affectations).values({
    id: "aff_test_photo_serv", utilisateurId: SERV_TEST, terrasseId: ETAB_TEST,
    role: "SERVEUSE", actif: true, creeLe: now,
  }).onConflictDoNothing();
  await db.insert(s.produits).values({
    id: PRD_TEST, terrasseId: ETAB_TEST, nom: "Produit photo test", categorie: "Divers",
    prixCdf: 1000, prixUsd: 36, stock: 10, stockReserve: 0, seuilAlerte: 6, actif: true,
  }).onConflictDoNothing();
}

afterAll(async () => {
  const db = getDb();
  await db.delete(s.produits).where(eq(s.produits.id, PRD_TEST));
  await db.delete(s.affectations).where(eq(s.affectations.terrasseId, ETAB_TEST));
  await db.delete(s.terrasses).where(eq(s.terrasses.id, ETAB_TEST));
  await db.delete(s.organisations).where(eq(s.organisations.id, ORG_TEST));
  await db.delete(s.utilisateurs).where(eq(s.utilisateurs.id, PROP_TEST));
  await db.delete(s.utilisateurs).where(eq(s.utilisateurs.id, SERV_TEST));
  fs.rmSync(path.resolve("uploads", "produits", ETAB_TEST), { recursive: true, force: true });
});

/** PNG 200×1200 uni encodé en base64 (généré avec jimp, sans dépendance native) */
async function pngBase64(): Promise<string> {
  const img = new Jimp({ width: 200, height: 1200, color: 0xc87828ff });
  const tampon = await img.getBuffer("image/png");
  return tampon.toString("base64");
}

describe("produits.uploadPhoto", () => {
  it("un fichier trop lourd (> 5 Mo) est refusé", async () => {
    await preparer();
    const gros = Buffer.alloc(6 * 1024 * 1024).toString("base64");
    await expect(
      appelant.produits.uploadPhoto({ produitId: PRD_TEST, fichierBase64: gros }),
    ).rejects.toThrow(/5 Mo/);
  });

  it("une serveuse reçoit 403", async () => {
    const b64 = await pngBase64();
    await expect(
      appelantServ.produits.uploadPhoto({ produitId: PRD_TEST, fichierBase64: b64 }),
    ).rejects.toSatisfy((e) => e instanceof TRPCError && e.code === "FORBIDDEN");
  });

  it("l'image uploadée est convertie en JPEG 800×800 (+ vignette 200×200)", async () => {
    const b64 = await pngBase64();
    const r = await appelant.produits.uploadPhoto({ produitId: PRD_TEST, fichierBase64: b64 });
    expect(r.photoUrl).toBe(`/uploads/produits/${ETAB_TEST}/${PRD_TEST}/photo.jpg`);
    expect(r.photoThumbnailUrl).toBe(`/uploads/produits/${ETAB_TEST}/${PRD_TEST}/vignette.jpg`);

    const photo = fs.readFileSync(path.resolve(".", r.photoUrl.replace(/^\//, "")));
    const vignette = fs.readFileSync(path.resolve(".", r.photoThumbnailUrl.replace(/^\//, "")));

    // Signature JPEG (FF D8) sur les deux fichiers
    expect(photo[0]).toBe(0xff);
    expect(photo[1]).toBe(0xd8);
    expect(vignette[0]).toBe(0xff);
    expect(vignette[1]).toBe(0xd8);

    // Dimensions exactes vérifiées en relisant les fichiers produits
    const imgPhoto = await Jimp.read(photo);
    const imgVignette = await Jimp.read(vignette);
    expect([imgPhoto.bitmap.width, imgPhoto.bitmap.height]).toEqual([800, 800]);
    expect([imgVignette.bitmap.width, imgVignette.bitmap.height]).toEqual([200, 200]);

    // Poids raisonnable (JPEG q75/q70 d'un aplats uni : très léger)
    expect(photo.length).toBeLessThanOrEqual(100 * 1024);
    expect(vignette.length).toBeLessThanOrEqual(30 * 1024);

    // La fiche produit est bien mise à jour
    const db = getDb();
    const [p] = await db.select().from(s.produits).where(eq(s.produits.id, PRD_TEST));
    expect(p.photoSource).toBe("UPLOAD");
    expect(p.photoUrl).toBe(r.photoUrl);
  });
});
