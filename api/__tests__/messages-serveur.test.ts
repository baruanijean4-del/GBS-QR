// ============================================================
// GBS — Messages du serveur traduits (erreurs, alertes)
//
// 1. COMPLÉTUDE : chaque message écrit dans le code (erreur("…"),
//    message: "…", alerter(…, "…"), error: "…") a une traduction en
//    anglais, portugais et swahili — ajouter un message sans le
//    traduire fait échouer ce test.
// 2. Le traducteur : messages exacts, variables numérotées dans un
//    ordre différent, repli français, langue d'après l'en-tête.
// 3. De bout en bout : une requête avec « x-lang: en » reçoit
//    l'erreur en anglais (errorFormatter tRPC).
// Test pur : aucune base de données.
// ============================================================

import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { appRouter } from "../router";
import { createContext } from "../context";
import { langueDepuisEntete, traduireMessage } from "../lib/traductionServeur";
import en from "../i18n/serveur.en.json";
import pt from "../i18n/serveur.pt.json";
import sw from "../i18n/serveur.sw.json";

const CATALOGUES: Record<string, Record<string, string>> = { en, pt, sw };

// ---------- extraction des messages du code ----------

function fichiersTs(dossier: string, sortie: string[] = []): string[] {
  for (const e of fs.readdirSync(dossier, { withFileTypes: true })) {
    const p = path.join(dossier, e.name);
    if (e.isDirectory()) { if (e.name !== "__tests__" && e.name !== "i18n") fichiersTs(p, sortie); }
    else if (e.name.endsWith(".ts")) sortie.push(p);
  }
  return sortie;
}

/** Lit un littéral (« », ' ' ou gabarit `…${x}…` → {}) à partir de l'index i. */
function litteral(src: string, i: number): { texte: string; fin: number } | null {
  while (/\s/.test(src[i] ?? "")) i++;
  const q = src[i];
  if (q !== '"' && q !== "'" && q !== "`") return null;
  let j = i + 1;
  let out = "";
  while (j < src.length) {
    const c = src[j];
    if (c === "\\") { out += src[j + 1]; j += 2; continue; }
    if (q === "`" && c === "$" && src[j + 1] === "{") {
      let profondeur = 1;
      let k = j + 2;
      while (k < src.length && profondeur) { if (src[k] === "{") profondeur++; else if (src[k] === "}") profondeur--; k++; }
      out += "{}"; j = k; continue;
    }
    if (c === q) return { texte: out, fin: j + 1 };
    out += c; j++;
  }
  return null;
}

function messagesDuCode(): string[] {
  const trouves = new Set<string>();
  const racine = path.resolve(__dirname, "..");
  for (const f of fichiersTs(racine)) {
    // Les commentaires citent des exemples (erreur("…")) : on les ignore
    const src = fs.readFileSync(f, "utf8").replace(/\r\n/g, "\n")
      .replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|\s)\/\/[^\n]*/g, "$1");
    const motifs = [/\berreur\(\s*/g, /message:\s*(?=["'`])/g, /\berror:\s*(?=["'`])/g, /\btr\(\s*c\s*,\s*/g, /\btraduireMessage\(\s*(?=["'`])/g, /\balerter\(\s*[^,]+,\s*[^,]+,\s*/g];
    for (const re of motifs) {
      let m: RegExpExecArray | null;
      while ((m = re.exec(src))) {
        const lit = litteral(src, m.index + m[0].length);
        if (lit && /[A-Za-zÀ-ÿ]{3,}/.test(lit.texte) && lit.texte !== "Not Found") trouves.add(lit.texte);
      }
    }
  }
  return [...trouves];
}

describe("catalogues de messages serveur", () => {
  const messages = messagesDuCode();

  it("le code contient des messages à traduire (garde-fou de l'extraction)", () => {
    expect(messages.length).toBeGreaterThan(200);
  });

  for (const langue of ["en", "pt", "sw"] as const) {
    it(`chaque message du code est traduit en « ${langue} »`, () => {
      const manquants = messages.filter((m) => !CATALOGUES[langue][m]);
      expect(manquants).toEqual([]);
    });

    it(`« ${langue} » : aucune traduction vide, variables numérotées complètes`, () => {
      for (const [fr, tr] of Object.entries(CATALOGUES[langue])) {
        expect(tr.trim().length, fr).toBeGreaterThan(0);
        expect(tr, fr).not.toContain("{}");
        const nb = fr.split("{}").length - 1;
        for (let i = 1; i <= nb; i++) expect(tr, `${fr} → {${i}}`).toContain(`{${i}}`);
      }
    });
  }

  it("aucune entrée orpheline : tout le catalogue correspond à un message du code", () => {
    const code = new Set(messages);
    for (const langue of ["en", "pt", "sw"]) {
      const orphelines = Object.keys(CATALOGUES[langue]).filter((k) => !code.has(k));
      expect(orphelines, langue).toEqual([]);
    }
  });
});

describe("traduireMessage", () => {
  it("français : le message est renvoyé tel quel", () => {
    expect(traduireMessage("Code PIN incorrect.", "fr")).toBe("Code PIN incorrect.");
  });

  it("message exact traduit dans les trois langues", () => {
    expect(traduireMessage("Code PIN incorrect.", "en")).toBe("Incorrect PIN code.");
    expect(traduireMessage("Code PIN incorrect.", "pt")).toBe("Código PIN incorreto.");
    expect(traduireMessage("Code PIN incorrect.", "sw")).toBe("Msimbo wa PIN si sahihi.");
  });

  it("variables : valeurs reprises, ordre libre selon la langue", () => {
    const fr = "Stock insuffisant pour Primus. Disponible : 3.";
    expect(traduireMessage(fr, "en")).toBe("Not enough stock for Primus. Available: 3.");
    expect(traduireMessage(fr, "pt")).toBe("Stock insuficiente para Primus. Disponível: 3.");
    expect(traduireMessage("Trop de tentatives — réessayez dans 5 min.", "sw"))
      .toBe("Majaribio mengi mno — jaribu tena baada ya dakika 5.");
    // l'ordre des variables peut changer d'une langue à l'autre
    expect(traduireMessage("Token #4 (Alain) annulé APRÈS paiement — 7000 FC à rembourser", "en"))
      .toBe("Token #4 (Alain) cancelled AFTER payment — 7000 FC to refund");
  });

  it("alerte avec un motif libre saisi par un utilisateur : traduit autour, motif conservé", () => {
    expect(traduireMessage("Client parti sans payer : 5000 FC / 0 ¢ — parti sans dire un mot", "en"))
      .toBe("Customer left without paying: 5000 FC / 0 ¢ — parti sans dire un mot");
  });

  it("message inconnu (dynamique, saisi par un utilisateur) : repli français", () => {
    expect(traduireMessage("Message jamais vu", "en")).toBe("Message jamais vu");
  });

  it("langueDepuisEntete : fr-FR, en, PT… ; inconnu ou absent = français", () => {
    expect(langueDepuisEntete("en")).toBe("en");
    expect(langueDepuisEntete("pt-AO")).toBe("pt");
    expect(langueDepuisEntete("SW")).toBe("sw");
    expect(langueDepuisEntete("de")).toBe("fr");
    expect(langueDepuisEntete(null)).toBe("fr");
  });
});

describe("de bout en bout : l'erreur tRPC suit l'en-tête x-lang", () => {
  async function appeler(langue?: string) {
    const entetes: Record<string, string> = {};
    if (langue) entetes["x-lang"] = langue;
    const r = await fetchRequestHandler({
      endpoint: "/api/trpc",
      req: new Request("http://localhost/api/trpc/gbs.mesAppareils", { headers: entetes }),
      router: appRouter,
      createContext,
    });
    const corps = (await r.json()) as { error: { json: { message: string } } };
    return { statut: r.status, message: corps.error.json.message };
  }

  it("sans en-tête : français", async () => {
    const r = await appeler();
    expect(r.statut).toBe(401);
    expect(r.message).toBe("Session expirée ou invalide — reconnectez-vous.");
  });

  it("x-lang: en / pt / sw : même erreur, traduite", async () => {
    expect((await appeler("en")).message).toBe("Session expired or invalid — please sign in again.");
    expect((await appeler("pt")).message).toBe("Sessão expirada ou inválida — inicie sessão novamente.");
    expect((await appeler("sw")).message).toBe("Kipindi kimeisha au si sahihi — ingia tena.");
  });
});
