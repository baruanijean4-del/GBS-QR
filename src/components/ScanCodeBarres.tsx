// ============================================================
// GBS — Scanner de code-barres (caméra arrière, @zxing/browser)
// Formats : EAN-13, EAN-8, Code 128. Plein écran avec cadre de
// visée, bouton Fermer, gestion d'erreurs caméra.
// ⚠️ La caméra exige HTTPS (ou localhost) — getUserMedia est
// bloqué en HTTP simple par les navigateurs Android.
// ============================================================

import { useEffect, useRef, useState } from 'react'
import { BrowserMultiFormatReader, type IScannerControls } from '@zxing/browser'
import { BarcodeFormat, DecodeHintType } from '@zxing/library'
import { X, CameraOff, ScanBarcode } from 'lucide-react'
import { useT } from '@/i18n'

export function ScanCodeBarres({ onScan, surFermer }: {
  onScan: (code: string) => void
  surFermer: () => void
}) {
  const t = useT()
  const videoRef = useRef<HTMLVideoElement>(null)
  const controlesRef = useRef<IScannerControls | null>(null)
  const [erreur, setErreur] = useState<string | null>(null)

  useEffect(() => {
    let annule = false
    const lecteur = new BrowserMultiFormatReader(
      // Restreint aux formats du commerce de détail (évite les faux positifs QR)
      new Map([[DecodeHintType.POSSIBLE_FORMATS, [
        BarcodeFormat.EAN_13, BarcodeFormat.EAN_8, BarcodeFormat.CODE_128,
      ]]]),
      { delayBetweenScanAttempts: 300 },
    )

    async function demarrer() {
      try {
        // facingMode « environment » = caméra arrière du téléphone
        const controles = await lecteur.decodeFromConstraints(
          { video: { facingMode: 'environment' } },
          videoRef.current ?? undefined,
          (resultat) => {
            const code = resultat?.getText()
            if (code && !annule) {
              annule = true // un seul scan : on arrête tout de suite
              controlesRef.current?.stop()
              onScan(code)
            }
          },
        )
        if (!annule) controlesRef.current = controles
        else controles.stop()
      } catch {
        if (!annule) setErreur(t('scan.erreur_camera'))
      }
    }
    void demarrer()

    return () => {
      annule = true
      controlesRef.current?.stop()
    }
    // « t » est stable (contexte i18n) ; l'inclure ne relance le
    // scanner qu'au changement de langue — comportement souhaité.
  }, [onScan, t])

  return (
    <div className="fixed inset-0 z-[70] bg-black flex flex-col">
      {/* Entête : titre + fermeture */}
      <div className="flex items-center justify-between px-4 py-3 text-white">
        <div className="flex items-center gap-2 font-semibold">
          <ScanBarcode className="w-5 h-5 text-emerald-400" />
          {t('scan.titre')}
        </div>
        <button
          type="button"
          onClick={surFermer}
          aria-label={t('scan.fermer')}
          className="h-11 w-11 rounded-full bg-white/10 flex items-center justify-center active:scale-95"
        >
          <X className="w-6 h-6" />
        </button>
      </div>

      {/* Zone caméra + cadre de visée */}
      <div className="relative flex-1 overflow-hidden">
        <video ref={videoRef} className="absolute inset-0 h-full w-full object-cover" muted playsInline />
        {!erreur && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="w-72 h-40 rounded-2xl border-4 border-emerald-400/90 shadow-[0_0_0_9999px_rgba(0,0,0,0.45)]" />
          </div>
        )}
        {erreur && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 px-8 text-center text-white">
            <CameraOff className="w-12 h-12 text-red-400" />
            <p className="text-sm leading-relaxed">{erreur}</p>
          </div>
        )}
      </div>

      {/* Pied : consigne */}
      <div className="px-6 py-5 text-center text-white/80 text-sm">
        {t('scan.consigne')}
      </div>
    </div>
  )
}
