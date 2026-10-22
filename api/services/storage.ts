// ============================================================
// GBS — Stockage et traitement des photos produits
//
// jimp est une librairie 100 % JavaScript : elle se bundle dans
// dist/boot.js, contrairement à sharp (binaire natif). L'upload de
// photo fonctionne donc sur TOUTES les plateformes, y compris
// celles qui n'installent pas de node_modules complet.
//
// Sortie JPEG (universelle, légère) :
//   - photo    : 800×800 (cover, centré), qualité 75
//   - vignette : 200×200 (cover, centré), qualité 70
// Repli : si le fichier est illisible, l'original est conservé
// tel quel — l'upload ne plante jamais le parcours.
// (Stockage objet type S3/R2 prévu plus tard — voir README.)
// ============================================================

import { Buffer } from "buffer";
import fs from "fs";
import path from "path";
import { Jimp } from "jimp";

export interface PhotosProduit {
  photoUrl: string;
  photoThumbnailUrl: string;
  /** true si l'image a été redimensionnée/convertie, false si repli sur l'original */
  traitee: boolean;
  /** Poids du fichier principal, en Ko (journalisation) */
  poidsKo: number;
}

/** Redimensionne (cover centré) et convertit en JPEG. Lève une erreur si illisible. */
export async function traiterImage(tampon: Buffer): Promise<{ photo: Buffer; vignette: Buffer }> {
  // Image principale : 800×800
  const image = await Jimp.read(tampon);
  image.cover({ w: 800, h: 800 });
  const photo = await image.getBuffer("image/jpeg", { quality: 75 });

  // Vignette : 200×200
  const imgVignette = await Jimp.read(tampon);
  imgVignette.cover({ w: 200, h: 200 });
  const vignette = await imgVignette.getBuffer("image/jpeg", { quality: 70 });

  return { photo, vignette };
}

/** Devine l'extension d'un tampon image d'après ses octets magiques */
function extensionDe(tampon: Buffer): string {
  if (tampon.length > 2 && tampon[0] === 0xff && tampon[1] === 0xd8) return "jpg"; // JPEG
  if (tampon.length > 8 && tampon.subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47]))) return "png"; // PNG
  if (tampon.length > 12 && tampon.subarray(0, 4).toString("latin1") === "RIFF"
    && tampon.subarray(8, 12).toString("latin1") === "WEBP") return "webp";
  if (tampon.length > 6 && tampon.subarray(0, 3).toString("latin1") === "GIF") return "gif";
  return "jpg"; // par défaut
}

/**
 * Traite et enregistre la photo d'un produit sous
 * uploads/produits/{terrasseId}/{produitId}/ puis retourne les URLs publiques.
 * Le dossier est purgé avant écriture (adieu les anciens .webp éventuels).
 */
export async function enregistrerPhotoProduit(
  terrasseId: string,
  produitId: string,
  tampon: Buffer,
): Promise<PhotosProduit> {
  const dossier = path.resolve("uploads", "produits", terrasseId, produitId);
  fs.rmSync(dossier, { recursive: true, force: true });
  fs.mkdirSync(dossier, { recursive: true });
  const base = `/uploads/produits/${terrasseId}/${produitId}`;

  try {
    const { photo, vignette } = await traiterImage(tampon);
    fs.writeFileSync(path.join(dossier, "photo.jpg"), photo);
    fs.writeFileSync(path.join(dossier, "vignette.jpg"), vignette);
    return {
      photoUrl: `${base}/photo.jpg`,
      photoThumbnailUrl: `${base}/vignette.jpg`,
      traitee: true,
      poidsKo: Math.round(photo.length / 1024),
    };
  } catch (e) {
    // Repli : le traitement a échoué (fichier corrompu, format exotique…) —
    // on conserve l'original tel quel plutôt que de bloquer l'utilisateur.
    console.error("[storage] Traitement image échoué, repli sur l'original :", e);
    const ext = extensionDe(tampon);
    fs.writeFileSync(path.join(dossier, `photo.${ext}`), tampon);
    return {
      photoUrl: `${base}/photo.${ext}`,
      photoThumbnailUrl: `${base}/photo.${ext}`,
      traitee: false,
      poidsKo: Math.round(tampon.length / 1024),
    };
  }
}

/**
 * Traite et enregistre la photo d'une chambre sous
 * uploads/chambres/{terrasseId}/{chambreId}/ puis retourne les URLs publiques.
 * Le dossier est purgé avant écriture (comme pour les produits).
 */
export async function enregistrerPhotoChambre(
  terrasseId: string,
  chambreId: string,
  tampon: Buffer,
): Promise<PhotosProduit> {
  const dossier = path.resolve("uploads", "chambres", terrasseId, chambreId);
  fs.rmSync(dossier, { recursive: true, force: true });
  fs.mkdirSync(dossier, { recursive: true });
  const base = `/uploads/chambres/${terrasseId}/${chambreId}`;

  try {
    const { photo, vignette } = await traiterImage(tampon);
    fs.writeFileSync(path.join(dossier, "photo.jpg"), photo);
    fs.writeFileSync(path.join(dossier, "vignette.jpg"), vignette);
    return {
      photoUrl: `${base}/photo.jpg`,
      photoThumbnailUrl: `${base}/vignette.jpg`,
      traitee: true,
      poidsKo: Math.round(photo.length / 1024),
    };
  } catch (e) {
    console.error("[storage] Traitement image chambre échoué, repli sur l'original :", e);
    const ext = extensionDe(tampon);
    fs.writeFileSync(path.join(dossier, `photo.${ext}`), tampon);
    return {
      photoUrl: `${base}/photo.${ext}`,
      photoThumbnailUrl: `${base}/photo.${ext}`,
      traitee: false,
      poidsKo: Math.round(tampon.length / 1024),
    };
  }
}