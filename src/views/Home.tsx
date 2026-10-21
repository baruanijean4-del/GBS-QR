// ============================================================
// GBS — Accueil (maquette validée). Premier écran : il reste dans
// le bundle initial (LCP) ; les formulaires (inscription,
// invitation, connexion) sont chargés à la demande (./Portes).
// Tous les textes passent par le socle i18n (FR/EN/PT).
// ============================================================

import { useState, useId } from 'react'
import { KeyRound, MessageCircle, Store, TicketCheck } from 'lucide-react'
import { toast } from 'sonner'
import { Carte, GrosBouton } from '@/components/gbs'
import { SelecteurLangue } from '@/components/SelecteurLangue'
import { naviguer } from '@/lib/router'
import { reinitialiserDemo, useAnnuaire } from '@/lib/store'
import { useT } from '@/i18n'
import { COURRIEL, WA_AFFICHE, lienWhatsApp } from '@/lib/contact'

// ---------- Logo ----------

// La marque GBS : chope de bière + modules QR (maquette d'accueil), déclinée
// en favicon et icônes PWA (public/icons). Inline ici pour zéro requête
// réseau et un rendu identique hors-ligne. Couleurs via les tokens CSS.
function MarqueGBS({ className }: { className: string }) {
  // useId : le dégradé doit avoir un id unique (plusieurs logos par page)
  const id = useId()
  return (
    <svg viewBox="0 0 64 64" className={`${className} shrink-0 drop-shadow-[0_6px_14px_rgb(var(--ambre)/0.25)]`} role="img" aria-label="Logo GBS">
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="rgb(var(--ambre))" />
          <stop offset="1" stopColor="rgb(var(--ambre-actif))" />
        </linearGradient>
      </defs>
      <rect width="64" height="64" rx="16" fill={`url(#${id})`} />
      <g transform="translate(-2 2)">
        {/* anse de la chope */}
        <path d="M42 29h3.5a6.5 6.5 0 0 1 0 13H42" fill="none" stroke="rgb(var(--encre))" strokeWidth="4" strokeLinecap="round" />
        {/* corps de la chope */}
        <rect x="16" y="22" width="26" height="29" rx="5" fill="rgb(var(--encre))" />
        {/* mousse */}
        <circle cx="22" cy="19" r="6" fill="rgb(var(--creme))" />
        <circle cx="29.5" cy="16" r="7" fill="rgb(var(--creme))" />
        <circle cx="36" cy="19.5" r="5.5" fill="rgb(var(--creme))" />
        {/* modules QR */}
        <g fill="rgb(var(--ambre))">
          <rect x="19.5" y="27" width="8" height="8" rx="1.5" />
          <rect x="30.5" y="27" width="8" height="8" rx="1.5" />
          <rect x="19.5" y="39" width="8" height="8" rx="1.5" />
          <rect x="31" y="39.5" width="3.5" height="3.5" rx=".8" />
          <rect x="36" y="43.5" width="3.5" height="3.5" rx=".8" />
        </g>
        <g fill="rgb(var(--encre))">
          <rect x="22" y="29.5" width="3" height="3" rx=".6" />
          <rect x="33" y="29.5" width="3" height="3" rx=".6" />
          <rect x="22" y="41.5" width="3" height="3" rx=".6" />
        </g>
      </g>
    </svg>
  )
}

export function LogoGBS({ taille = 'grand' }: { taille?: 'grand' | 'petit' }) {
  const t = useT()
  return (
    <div className="flex items-center gap-3">
      <MarqueGBS className={taille === 'grand' ? 'h-14 w-14' : 'h-9 w-9'} />
      <div>
        <p className={`font-titre font-extrabold tracking-tight text-white ${taille === 'grand' ? 'text-3xl' : 'text-lg'}`}>GBS</p>
        {taille === 'grand' && <p className="text-xs font-semibold uppercase tracking-widest text-sable/60">{t('accueil.sous_titre')}</p>}
      </div>
    </div>
  )
}


// ---------- Accueil (maquette : hero + téléphone, douleurs, étapes) ----------

export function Accueil() {
  const annuaire = useAnnuaire()
  const demoActive = (annuaire.data?.length ?? 0) > 0
  const [confirmReset, setConfirmReset] = useState(false)
  const t = useT()

  return (
    <div className="halo-lanterne min-h-dvh font-corps">
      <div className="mx-auto flex min-h-dvh w-full max-w-5xl flex-col px-5 pb-8 pt-5">
        {/* En-tête : logo + bascule de langue */}
        <header className="flex items-center justify-between">
          <LogoGBS taille="petit" />
          <SelecteurLangue />
        </header>

        {/* Hero : texte + maquette téléphone */}
        <main className="grid flex-1 items-center gap-10 py-10 md:grid-cols-[1.15fr_0.85fr] md:gap-14">
          <section>
            <p className="mb-3 font-semibold text-ambre">{t('accueil.sous_titre')}</p>
            <h1 className="font-titre text-4xl font-extrabold leading-[1.02] tracking-tight text-white sm:text-5xl lg:text-6xl">
              <span className="block">{t('accueil.h1a')}</span>
              <span className="block text-ambre">{t('accueil.h1b')}</span>
            </h1>
            <p className="mb-7 mt-5 max-w-md text-lg text-sable/80">
              <b className="font-semibold text-creme">{t('accueil.lead1')}</b> {t('accueil.lead2')}
            </p>
            <div className="grid max-w-md gap-3">
              <GrosBouton onClick={() => naviguer('/connexion')}>
                <KeyRound className="h-5 w-5" /> {t('accueil.connexion')}
              </GrosBouton>
              <div className="grid grid-cols-2 gap-3 max-[380px]:grid-cols-1">
                <GrosBouton ton="secondaire" petit onClick={() => naviguer('/nouveau')}>
                  <Store className="h-4 w-4" /> {t('accueil.creer')}
                </GrosBouton>
                <GrosBouton ton="secondaire" petit onClick={() => naviguer('/invitation')}>
                  <TicketCheck className="h-4 w-4" /> {t('accueil.invitation')}
                </GrosBouton>
              </div>
            </div>
            {/* Ligne de prix imposée : 5 $/mois · installation 5–10 $ · essai 14 j */}
            <p className="mt-5 max-w-md text-sm font-semibold text-creme/90">{t('accueil.prix')}</p>
            <a
              href={lienWhatsApp(t('accueil.wa_msg'))}
              target="_blank"
              rel="noopener"
              className="mt-4 inline-flex max-w-md items-center gap-3 rounded-full border border-white/15 py-2.5 pl-3 pr-5 transition-colors hover:border-ambre"
            >
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-ambre text-encre">
                <MessageCircle className="h-5 w-5" />
              </span>
              <span>
                <b className="block text-[15px] font-semibold leading-tight text-white">{t('accueil.wa_cta')}</b>
                <small className="text-[13px] text-sable/60">{WA_AFFICHE}</small>
              </span>
            </a>
            <p className="mt-3.5 text-sm text-sable/60">
              {t('accueil.mail_t')} :{' '}
              <a href={`mailto:${COURRIEL}`} className="break-all text-creme underline decoration-white/25 underline-offset-4">{COURRIEL}</a>
            </p>
          </section>

          {/* Téléphone : une vente de A à Z (maquette) */}
          <aside className="anim-telephone mx-auto w-full max-w-72 rotate-[2.5deg] rounded-[30px] bg-white p-5 text-encre shadow-2xl" aria-hidden="true">
            <h2 className="mb-3 font-titre text-[15px] font-extrabold">{t('accueil.tel_titre')}</h2>
            <div className="flex items-center gap-2.5">
              <svg className="h-11 w-11 shrink-0" viewBox="0 0 21 21" shapeRendering="crispEdges">
                <rect width="21" height="21" fill="#fff" />
                <g fill="rgb(var(--encre))">
                  <path d="M0 0h7v7H0zM14 0h7v7H0zM0 14h7v7H0z" />
                  <path fill="#fff" d="M1 1h5v5H1zM15 1h5v5h-5zM1 15h5v5H1z" />
                  <path d="M2 2h3v3H2zM16 2h3v3h-3zM2 16h3v3H2zM9 0h2v2H9zM8 3h3v1H8zM9 6h1v3H9zM11 8h3v2h-3zM8 10h2v2H8zM12 12h2v2h-2zM9 14h2v3H9zM15 10h3v1h-3zM16 13h2v2h-2zM14 16h3v2h-3zM18 18h3v3h-3zM11 18h2v3h-2z" />
                </g>
              </svg>
              <div>
                <b className="block text-sm font-semibold leading-tight">{t('accueil.tel_m1t')}</b>
                <span className="text-[13px] leading-snug text-encre/60">{t('accueil.tel_m1d')}</span>
              </div>
            </div>
            <div className="my-2.5">
              <div className="flex justify-between border-t border-encre/10 py-2 text-sm"><span>2 × Eau Vive</span><b className="font-semibold">6 000 FC</b></div>
              <div className="flex justify-between border-t border-encre/10 py-2 text-sm"><span>1 × Huile Avena</span><b className="font-semibold">11 000 FC</b></div>
              <div className="flex justify-between border-t-2 border-encre/15 py-2 text-sm font-extrabold"><span>{t('commun.total')}</span><b>17 000 FC</b></div>
            </div>
            <div className="flex items-center gap-2.5">
              <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-encre text-xl font-extrabold text-ambre">✓</span>
              <div>
                <b className="block text-sm font-semibold leading-tight">{t('accueil.tel_m2t')}</b>
                <span className="text-[13px] leading-snug text-encre/60">{t('accueil.tel_m2d')}</span>
              </div>
            </div>
            <div className="mt-3 rounded-xl bg-[#FFF1C2] px-3 py-2.5 text-[13px]">
              <b className="block font-semibold">{t('accueil.tel_m3t')}</b>
              <span className="mt-0.5 block leading-snug">{t('accueil.tel_m3d')}</span>
            </div>
          </aside>
        </main>

        {/* Douleurs : là où l'argent disparaît */}
        <section className="mt-11 border-t border-white/15 pt-12" aria-labelledby="h-pain">
          <h2 id="h-pain" className="mb-6 max-w-xl font-titre text-3xl font-extrabold leading-tight tracking-tight text-white sm:text-4xl">
            {t('accueil.pain_t')}
          </h2>
          <ul className="mb-5">
            {[t('accueil.p1'), t('accueil.p2'), t('accueil.p3')].map((p) => (
              <li key={p} className="border-b border-white/15 py-4 font-titre text-xl font-extrabold leading-snug text-creme sm:text-2xl">
                {p}
              </li>
            ))}
          </ul>
          <p className="max-w-2xl text-lg font-semibold text-ambre">{t('accueil.pain_fin')}</p>
        </section>

        {/* Étapes : comment ça marche */}
        <section className="mt-11 border-t border-white/15 pt-12" aria-labelledby="h-how">
          <h2 id="h-how" className="mb-6 font-titre text-3xl font-extrabold tracking-tight text-white sm:text-4xl">{t('accueil.comment_t')}</h2>
          <ol className="grid list-none gap-6 md:grid-cols-3">
            {[
              { titre: t('accueil.etape1t'), detail: t('accueil.etape1d') },
              { titre: t('accueil.etape2t'), detail: t('accueil.etape2d') },
              { titre: t('accueil.etape3t'), detail: t('accueil.etape3d') },
            ].map((s, i) => (
              <li key={s.titre} className="border-l-[3px] border-ambre pl-4">
                <span className="block font-titre text-4xl font-extrabold leading-none text-ambre">{i + 1}</span>
                <h3 className="mb-1.5 mt-2 font-titre text-xl font-extrabold text-white">{s.titre}</h3>
                <p className="text-sable/80">{s.detail}</p>
              </li>
            ))}
          </ol>
        </section>

        {/* Démo en direct (comptes seedés) */}
        {demoActive && (
          <section className="mt-11">
            <Carte classe="!bg-white/[0.04]">
              <p className="text-sm font-semibold text-sable">{t('demo.titre')}</p>
              <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm text-sable/70">
                <li>{t('demo.p1a')} <b className="text-white">Marie</b> {t('demo.p1b')}</li>
                <li>{t('demo.p2a')} <b className="text-white">{t('demo.qr_table_1')}</b> {t('demo.p2b')}</li>
                <li>{t('demo.p3a')} <b className="text-ambre">{t('demo.en_direct')}</b> {t('demo.p3b')}</li>
                <li>{t('demo.p4a')} <b className="text-white">Papa Jean</b> {t('demo.p4b')}</li>
              </ol>
              <p className="mt-3 border-t border-white/10 pt-3 text-xs text-sable/50">{t('demo.note')}</p>
              <div className="mt-3 flex items-center justify-end text-xs text-sable/40">
                {confirmReset ? (
                  <button
                    className="font-semibold text-danger-clair underline underline-offset-2"
                    onClick={async () => {
                      try {
                        await reinitialiserDemo()
                        toast.success(t('demo.reinit_ok'))
                      } catch (e) {
                        toast.error(e instanceof Error ? e.message : t('commun.erreur'))
                      }
                      setConfirmReset(false)
                    }}
                  >
                    {t('demo.reinit_confirm')}
                  </button>
                ) : (
                  <button className="underline underline-offset-2" onClick={() => setConfirmReset(true)}>
                    {t('demo.reinit')} ({annuaire.data?.length ?? '…'} {t('demo.comptes')})
                  </button>
                )}
              </div>
            </Carte>
          </section>
        )}

        {/* Appel final */}
        <section className="mt-14 border-t border-white/15 pb-2 pt-14 text-center">
          <h2 className="mb-6 font-titre text-3xl font-extrabold tracking-tight text-white sm:text-4xl">{t('accueil.fin_t')}</h2>
          <div className="mx-auto max-w-xs">
            <GrosBouton onClick={() => naviguer('/nouveau')}>
              <Store className="h-5 w-5" /> {t('accueil.creer')}
            </GrosBouton>
          </div>
        </section>

        <footer className="pt-8 text-[13px] text-sable/50">
          {t('accueil.pied')} ·{' '}
          <a href={lienWhatsApp(t('accueil.wa_msg'))} target="_blank" rel="noopener" className="underline decoration-white/20 underline-offset-2">{WA_AFFICHE}</a>
          {' · '}
          <a href={`mailto:${COURRIEL}`} className="break-all underline decoration-white/20 underline-offset-2">{COURRIEL}</a>
        </footer>
      </div>
    </div>
  )
}