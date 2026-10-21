// ============================================================
// Chiffrement immédiat des PIN restés EN CLAIR (décision 3.2)
//
// À lancer PAR LE PROPRIÉTAIRE après déploiement avec PIN_ENC_KEY,
// après sauvegarde Neon confirmée :
//
//   PIN_ENC_KEY=<64 hex> DATABASE_URL=<url> npx tsx scripts/chiffrer-pins-clairs.ts
//     → SIMULATION (aucune écriture) : compte les PIN en clair
//   PIN_ENC_KEY=<64 hex> DATABASE_URL=<url> npx tsx scripts/chiffrer-pins-clairs.ts --executer
//     → chiffre les PIN en clair (transaction unique, vérifiée)
//   PIN_ENC_KEY=<64 hex> DATABASE_URL=<url> npx tsx scripts/chiffrer-pins-clairs.ts --retour-arriere
//     → restaure en clair les PIN chiffrés par une exécution précédente
//
// Format : v1:<nonce hex>:<tag hex>:<corps hex> — IDENTIQUE à
// api/lib/pin.ts (AES-256-GCM, nonce 12 octets, tag 16 octets).
// Le script est volontairement AUTONOME (aucun import de api/) pour
// ne pas déclencher les gardes de démarrage de l'application.
//
// JAMAIS de PIN dans les journaux : seuls des compteurs sont
// affichés. Les PIN hachés scrypt (irréversibles) ne sont pas
// touchés — ils migrent à la prochaine connexion du titulaire.
// ============================================================

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import postgres from "postgres";

const VERSION = "v1";

function cleDepuisEnv(): Buffer {
  const hex = process.env.PIN_ENC_KEY ?? "";
  if (!/^[0-9a-f]{64}$/i.test(hex)) {
    throw new Error("PIN_ENC_KEY absente ou invalide (64 caractères hexadécimaux requis).");
  }
  return Buffer.from(hex, "hex");
}

function chiffrer(pin: string, cle: Buffer): string {
  const nonce = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", cle, nonce);
  const corps = Buffer.concat([c.update(pin, "utf8"), c.final()]);
  return `${VERSION}:${nonce.toString("hex")}:${c.getAuthTag().toString("hex")}:${corps.toString("hex")}`;
}

function dechiffrer(valeur: string, cle: Buffer): string | null {
  const m = valeur.match(/^v1:([0-9a-f]{24}):([0-9a-f]{32}):([0-9a-f]+)$/i);
  if (!m) return null;
  try {
    const d = createDecipheriv("aes-256-gcm", cle, Buffer.from(m[1], "hex"));
    d.setAuthTag(Buffer.from(m[2], "hex"));
    return Buffer.concat([d.update(Buffer.from(m[3], "hex")), d.final()]).toString("utf8");
  } catch {
    return null; // tag invalide = valeur altérée
  }
}

const mode = process.argv.includes("--executer")
  ? "executer"
  : process.argv.includes("--retour-arriere")
    ? "retour"
    : "simulation";

const url = process.env.DATABASE_URL ?? "";
if (!url) throw new Error("DATABASE_URL absente.");

const cle = cleDepuisEnv();
const sql = postgres(url, { prepare: false, max: 1 });

// Journal des comptes traités (ids SEULEMENT — jamais de PIN) :
// permet le retour arrière ciblé sans toucher aux v1 légitimes.
const TABLE_JOURNAL = "_gbs_journal_chiffrement_pin";

async function principale(): Promise<void> {
  await sql`CREATE TABLE IF NOT EXISTS ${sql(TABLE_JOURNAL)} (
    utilisateur_id varchar(40) PRIMARY KEY,
    traite_le   timestamptz NOT NULL DEFAULT now()
  )`;

  if (mode === "retour") {
    await sql.begin(async (tx) => {
      const lignes = await tx`
        SELECT u.id, u.pin FROM utilisateurs u
        JOIN ${tx(TABLE_JOURNAL)} j ON j.utilisateur_id = u.id
        WHERE u.pin LIKE 'v1:%'`;
      let restaures = 0;
      for (const l of lignes) {
        const clair = dechiffrer(String(l.pin), cle);
        if (clair === null) throw new Error("Déchiffrement impossible — retour arrière annulé, rien n'a été modifié.");
        await tx`UPDATE utilisateurs SET pin = ${clair} WHERE id = ${String(l.id)}`;
        restaures++;
      }
      await tx`DELETE FROM ${tx(TABLE_JOURNAL)}`;
      console.log(`[retour arrière] ${restaures} PIN restaurés en clair, journal vidé.`);
    });
    return;
  }

  // Cible : PIN ni chiffrés (v1:) ni hachés (scrypt$) = en clair
  const cibles = await sql`
    SELECT id, pin FROM utilisateurs
    WHERE pin NOT LIKE 'v1:%' AND pin NOT LIKE 'scrypt$%'`;

  if (mode === "simulation") {
    console.log(`[simulation] ${cibles.length} PIN en clair seraient chiffrés (0 écriture). Relancer avec --executer.`);
    return;
  }

  await sql.begin(async (tx) => {
    let chiffres = 0;
    for (const c of cibles) {
      const clair = String(c.pin);
      const v1 = chiffrer(clair, cle);
      await tx`UPDATE utilisateurs SET pin = ${v1} WHERE id = ${String(c.id)} AND pin = ${clair}`;
      // Vérification AVANT commit : la valeur écrite se déchiffre
      // exactement vers l'original, sinon tout est annulé.
      const [relu] = await tx`SELECT pin FROM utilisateurs WHERE id = ${String(c.id)}`;
      if (dechiffrer(String(relu.pin), cle) !== clair) {
        throw new Error("Vérification post-écriture en échec — transaction annulée, rien n'a été modifié.");
      }
      await tx`INSERT INTO ${tx(TABLE_JOURNAL)} (utilisateur_id) VALUES (${String(c.id)})
               ON CONFLICT (utilisateur_id) DO NOTHING`;
      chiffres++;
    }
    console.log(`[exécution] ${chiffres} PIN chiffrés en AES-256-GCM (v1), vérifiés un à un.`);
  });
}

try {
  await principale();
} finally {
  await sql.end();
}
