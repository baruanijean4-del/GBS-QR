// ============================================================
// GBS — Rapport PDF de consommation plateforme (super-admin)
//
// Généré dans le navigateur avec jsPDF, chargé en import dynamique :
// la librairie (~350 Ko) n'est téléchargée qu'au clic sur le bouton,
// elle ne pèse donc pas sur le démarrage de l'app.
//
// Contenu : vue d'ensemble, top 10 des produits les plus vendus,
// consommation par catégorie et classement des zones (terrasses)
// qui achètent le plus — toutes commandes SERVIE, toute période.
//
// Note police : les fontes standard jsPDF (Helvetica, WinAnsi) ne
// connaissent ni l'espace fine insécable (U+202F, produite par
// Intl.NumberFormat fr-FR) ni la flèche « → ». On reformate donc
// les nombres avec des espaces ordinaires.
// ============================================================

import type { DB } from './types'
import { LOCALES, langueCourante, traduire } from '@/i18n'

/** Nombre formaté en français, espaces ordinaires (compat. WinAnsi) */
const fmtNombre = (n: number) =>
  n.toLocaleString('fr-FR').replace(/[\u00A0\u202F]/g, ' ')

const fmtCDF = (n: number) => `${fmtNombre(n)} FC`
const fmtUSD = (centimes: number) =>
  `${(centimes / 100).toFixed(2).replace('.', ',')} $`

const COULEUR_AMBRE: [number, number, number] = [246, 160, 31]
const COULEUR_TEXTE: [number, number, number] = [30, 27, 20]
const COULEUR_DOUX: [number, number, number] = [120, 110, 95]

interface VenteProduit { nom: string; qte: number; cdf: number; usdCentimes: number }
interface VenteZone { nom: string; adresse: string; nb: number; cdf: number; usdCentimes: number }

/** Agrège les ventes (commandes SERVIE) par produit, catégorie et terrasse */
function agreger(db: DB) {
  const servies = db.commandes.filter((c) => c.statut === 'SERVIE')
  const categorieDe = new Map(db.produits.map((p) => [p.id, p.categorie]))
  const parProduit = new Map<string, VenteProduit>()
  const parCategorie = new Map<string, VenteProduit>()
  const parTerrasse = new Map<string, VenteZone>()
  let cdf = 0
  let usd = 0

  for (const c of servies) {
    cdf += c.totalCdf
    usd += c.totalUsdCentimes

    // Zone = terrasse (nom + adresse de quartier)
    const t = db.terrasses.find((x) => x.id === c.terrasseId)
    const z = parTerrasse.get(c.terrasseId) ?? {
      nom: t?.nom ?? traduire('pdf.inconnue'), adresse: t?.adresse ?? '', nb: 0, cdf: 0, usdCentimes: 0,
    }
    z.nb += 1
    z.cdf += c.totalCdf
    z.usdCentimes += c.totalUsdCentimes
    parTerrasse.set(c.terrasseId, z)

    for (const l of c.lignes) {
      const p = parProduit.get(l.produitId) ?? { nom: l.nom, qte: 0, cdf: 0, usdCentimes: 0 }
      p.qte += l.quantite
      p.cdf += l.prixCdf * l.quantite
      p.usdCentimes += l.prixUsdCentimes * l.quantite
      parProduit.set(l.produitId, p)

      const cat = categorieDe.get(l.produitId) ?? 'Divers'
      const pc = parCategorie.get(cat) ?? { nom: cat, qte: 0, cdf: 0, usdCentimes: 0 }
      pc.qte += l.quantite
      pc.cdf += l.prixCdf * l.quantite
      pc.usdCentimes += l.prixUsdCentimes * l.quantite
      parCategorie.set(cat, pc)
    }
  }

  return {
    servies,
    cdf,
    usd,
    top10: Array.from(parProduit.values()).sort((a, b) => b.qte - a.qte).slice(0, 10),
    categories: Array.from(parCategorie.values()).sort((a, b) => b.cdf - a.cdf),
    zones: Array.from(parTerrasse.values()).sort((a, b) => b.cdf - a.cdf),
  }
}

/** Génère et télécharge « rapport-consommation-gbs.pdf » */
export async function telechargerRapportConsommation(db: DB): Promise<void> {
  const { jsPDF } = await import('jspdf')
  const doc = new jsPDF({ unit: 'mm', format: 'a4' })
  const stats = agreger(db)
  const marge = 15
  const largeur = 210 - marge * 2
  let y = 0

  /** Saute de page si la section à venir ne tient plus */
  const placePour = (hauteur: number) => {
    if (y + hauteur > 280) {
      doc.addPage()
      y = 20
    }
  }

  const titreSection = (texte: string) => {
    placePour(16)
    y += 6
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(12)
    doc.setTextColor(...COULEUR_AMBRE)
    doc.text(texte, marge, y)
    y += 2
    doc.setDrawColor(...COULEUR_AMBRE)
    doc.line(marge, y, marge + largeur, y)
    y += 6
  }

  const ligne = (gauche: string, droite: string, gras = false) => {
    placePour(7)
    doc.setFont('helvetica', gras ? 'bold' : 'normal')
    doc.setFontSize(10)
    doc.setTextColor(...COULEUR_TEXTE)
    doc.text(gauche, marge, y)
    doc.text(droite, marge + largeur, y, { align: 'right' })
    y += 5.5
  }

  // ---------- En-tête ----------
  y = 20
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(18)
  doc.setTextColor(...COULEUR_TEXTE)
  doc.text(traduire('pdf.titre'), marge, y)
  y += 7
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(10)
  doc.setTextColor(...COULEUR_DOUX)
  doc.text(
    traduire('pdf.sous_titre', { date: new Date().toLocaleString(LOCALES[langueCourante()]) }),
    marge, y,
  )
  y += 4

  // ---------- Vue d'ensemble ----------
  titreSection(traduire('pdf.vue_ensemble'))
  ligne(traduire('pdf.terrasses'), fmtNombre(db.terrasses.length))
  ligne(traduire('pdf.commandes'), fmtNombre(stats.servies.length))
  ligne(traduire('pdf.revenus_cdf'), fmtCDF(stats.cdf), true)
  ligne(traduire('pdf.revenus_usd'), fmtUSD(stats.usd), true)

  // ---------- Top 10 produits ----------
  titreSection(traduire('pdf.top10'))
  if (stats.top10.length === 0) {
    ligne(traduire('pdf.aucune_vente'), '')
  }
  stats.top10.forEach((p, i) => {
    ligne(`${i + 1}. ${p.nom}  (x${fmtNombre(p.qte)})`, `${fmtCDF(p.cdf)}  +  ${fmtUSD(p.usdCentimes)}`)
  })

  // ---------- Consommation par catégorie ----------
  titreSection(traduire('pdf.categories'))
  stats.categories.forEach((c) => {
    ligne(`${c.nom}  (x${fmtNombre(c.qte)})`, `${fmtCDF(c.cdf)}  +  ${fmtUSD(c.usdCentimes)}`)
  })

  // ---------- Zones qui achètent le plus ----------
  titreSection(traduire('pdf.zones'))
  if (stats.zones.length === 0) {
    ligne(traduire('pdf.aucune_vente'), '')
  }
  stats.zones.forEach((z, i) => {
    ligne(`${i + 1}. ${z.nom}`, `${fmtNombre(z.nb)} cmd — ${fmtCDF(z.cdf)}  +  ${fmtUSD(z.usdCentimes)}`)
    if (z.adresse) {
      placePour(6)
      doc.setFont('helvetica', 'normal')
      doc.setFontSize(8)
      doc.setTextColor(...COULEUR_DOUX)
      doc.text(z.adresse, marge + 5, y)
      y += 4.5
    }
  })

  // ---------- Pied de page ----------
  placePour(14)
  y += 6
  doc.setFontSize(8)
  doc.setTextColor(...COULEUR_DOUX)
  doc.text(traduire('pdf.pied'), marge, y)

  doc.save('rapport-consommation-gbs.pdf')
}
