// ============================================================
// GBS — Utilitaires serveur (ids, dates, tarifs, messages)
// ============================================================

import { randomBytes } from "crypto";
import { getDb } from "./queries/connection";
import { plansTarifs } from "@db/schema";
import type { PlanCode, Tranche } from "@contracts/types";

export function uid(prefixe: string): string {
  return `${prefixe}_${randomBytes(6).toString("hex")}`;
}

export function tokenQR(): string {
  return randomBytes(16).toString("hex");
}

export function codeInvitation(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const b = randomBytes(8);
  return Array.from(b, (x) => alphabet[x % alphabet.length]).join("");
}

export const maintenant = () => new Date().toISOString();

export function ajouterJours(iso: string, jours: number): string {
  const d = new Date(iso);
  d.setUTCDate(d.getUTCDate() + jours);
  return d.toISOString();
}

export function ajouterMois(iso: string, mois: number): string {
  const d = new Date(iso);
  d.setUTCMonth(d.getUTCMonth() + mois);
  return d.toISOString();
}

export function joursRestants(iso: string): number {
  return Math.max(0, Math.ceil((new Date(iso).getTime() - Date.now()) / 86_400_000));
}

export function fmtCDF(cdf: number): string {
  return `${cdf.toLocaleString("fr-CD")} FC`;
}

export function fmtUSD(centimes: number): string {
  return `${(centimes / 100).toFixed(2).replace(".", ",")} $`;
}

export function tranchePourTables(nbTables: number): Tranche {
  if (nbTables >= 20) return "GRANDE";
  if (nbTables >= 10) return "MOYENNE";
  return "PETITE";
}

export function remiseMulti(nbTerrasses: number): number {
  if (nbTerrasses >= 5) return 0.25;
  if (nbTerrasses >= 3) return 0.15;
  return 0;
}

export async function tarifDe(plan: PlanCode, tranche: Tranche) {
  const lignes = await getDb().select().from(plansTarifs);
  const t = lignes.find((x) => x.plan === plan && x.tranche === tranche);
  if (!t) throw new Error(`Tarif manquant : ${plan}/${tranche}`);
  return t;
}

export class ErreurMetier extends Error {}
