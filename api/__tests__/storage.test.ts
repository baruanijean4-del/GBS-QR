// ============================================================
// GBS — Tests unitaires du service de stockage photo (jimp)
// - traiterImage : JPEG 800×800 + vignette 200×200
// - enregistrerPhotoProduit : écriture + URLs publiques
// - repli gracieux : un tampon illisible conserve l'original
// ============================================================

import { Buffer } from "buffer";
import fs from "fs";
import path from "path";
import { afterAll, describe, expect, it } from "vitest";
import { Jimp } from "jimp";
import { enregistrerPhotoProduit, traiterImage } from "../services/storage";

const ETAB_TEST = "etab_test_storage";
const PRD_TEST = "prd_test_storage";

/** Génère un PNG 640×480 uni via jimp */
async function pngFixture(): Promise<Buffer> {
  const img = new Jimp({ width: 640, height: 480, color: 0x2864c8ff });
  return img.getBuffer("image/png");
}

afterAll(() => {
  fs.rmSync(path.resolve("uploads", "produits", ETAB_TEST), { recursive: true, force: true });
});

describe("storage.traiterImage", () => {
  it("produit un JPEG 800×800 et une vignette JPEG 200×200", async () => {
    const { photo, vignette } = await traiterImage(await pngFixture());

    // Signature JPEG (FF D8)
    expect(photo[0]).toBe(0xff);
    expect(photo[1]).toBe(0xd8);
    expect(vignette[0]).toBe(0xff);
    expect(vignette[1]).toBe(0xd8);

    const imgPhoto = await Jimp.read(photo);
    const imgVignette = await Jimp.read(vignette);
    expect([imgPhoto.bitmap.width, imgPhoto.bitmap.height]).toEqual([800, 800]);
    expect([imgVignette.bitmap.width, imgVignette.bitmap.height]).toEqual([200, 200]);
  });

  it("lève une erreur sur un tampon qui n'est pas une image", async () => {
    await expect(traiterImage(Buffer.from("ceci n'est pas une image"))).rejects.toThrow();
  });
});

describe("storage.enregistrerPhotoProduit", () => {
  it("écrit photo.jpg + vignette.jpg et retourne traitee=true", async () => {
    const r = await enregistrerPhotoProduit(ETAB_TEST, PRD_TEST, await pngFixture());

    expect(r.traitee).toBe(true);
    expect(r.photoUrl).toBe(`/uploads/produits/${ETAB_TEST}/${PRD_TEST}/photo.jpg`);
    expect(r.photoThumbnailUrl).toBe(`/uploads/produits/${ETAB_TEST}/${PRD_TEST}/vignette.jpg`);
    expect(r.poidsKo).toBeGreaterThan(0);

    const dossier = path.resolve("uploads", "produits", ETAB_TEST, PRD_TEST);
    expect(fs.existsSync(path.join(dossier, "photo.jpg"))).toBe(true);
    expect(fs.existsSync(path.join(dossier, "vignette.jpg"))).toBe(true);
  });

  it("un tampon illisible déclenche le repli : original conservé, traitee=false", async () => {
    const corrompu = Buffer.from("GIF89a" + "x".repeat(500)); // en-tête GIF tronqué → illisible
    const r = await enregistrerPhotoProduit(ETAB_TEST, PRD_TEST, corrompu);

    expect(r.traitee).toBe(false);
    // L'original est conservé tel quel, avec l'extension détectée
    expect(r.photoUrl).toBe(`/uploads/produits/${ETAB_TEST}/${PRD_TEST}/photo.gif`);
    expect(r.photoThumbnailUrl).toBe(r.photoUrl);

    const dossier = path.resolve("uploads", "produits", ETAB_TEST, PRD_TEST);
    const conserve = fs.readFileSync(path.join(dossier, "photo.gif"));
    expect(conserve.equals(corrompu)).toBe(true);
    // Le repli remplace les fichiers traités précédents (dossier purgé)
    expect(fs.existsSync(path.join(dossier, "vignette.jpg"))).toBe(false);
  });
});
