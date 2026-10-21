# LOOPS.md — Journal des boucles de finalisation GBS

Mécanique : observer → agir → vérifier → décider. Contrôles globaux G1 (check), G2 (tests ≥ départ), G3 (build), G4 (aucun secret/PIN, aucun console.log), G5 (seed idempotent si changé), G6 (aucun texte en dur).

## Cartographie (15 lignes)

1. Frontend React 19 + Vite (src/), backend Hono + tRPC v11 (api/), Drizzle + Neon Postgres (db/).
2. Routeur unique : `api/gbsRouter.ts` (gbsRouter, ~182 procédures), monté dans `api/router.ts` (appRouter), servi par `api/boot.ts`.
3. Tables : organisations, utilisateurs, terrasses, table_serveuse, clients_session, sessions_service, depots, avis, invitations, demandes_stock, audit_log, depenses, abonnements, historique_tranches, paiements, factures, meta, erreurs_client.
4. Pages (src/views/) : Home (accueil + inscription + connexion), Client (/t/:token), Serveuse (/s), Gerant (/g), Proprio (/p), Admin (/admin).
5. Seed unique : db/seed.ts (idempotent). Catalogue produits : db/catalogue.ts (CATALOGUE_BASE).
6. Abonnements : grille plans dans db/seed.ts + api (calcul tranches, historique_tranches, factures, paiements).
7. État client : src/lib/store.tsx (tRPC + TanStack Query), validation tolérante src/lib/validation.ts.
8. i18n : src/i18n (fr de référence ; en/pt à venir boucle 5). Écran d'erreur autonome (sans i18n) : src/components/ErreurEcran.tsx.
9. PWA : public/sw.js (gabarit versionné par scripts/versionner-sw.mjs au build), bandeau MAJ src/components/StatutApp.tsx.
10. Récupération chunks : src/lib/recuperation.ts (une seule tentative par session).
11. Journal erreurs : src/lib/journalErreurs.ts → POST /api/erreurs → table erreurs_client → onglet Admin.
12. Factures PDF : src/lib/rapportPdf.ts (jspdf chargé à la demande).
13. Tests : vitest (api/__tests__ node, src/__tests__ jsdom).
14. Build : vite build → versionner-sw → compresser-assets → esbuild boot.js (dist/).
15. Déploiement plateforme : /code/bootstrap exécute dist/boot.js.

## BOUCLE 0 — ÉTAT DE DÉPART (une seule passe)

- Itération 0 — Constat : branche `finalisation` créée depuis main (commit e0de97c, Phase B incluse), git propre.
- Tests de départ : **120** (94 existants + 26 Phase B) — 14 fichiers, tous verts.
- Bundle initial : `index-2vhri9E3.js` = 613 635 o brut / **175 658 o gzip (~171,6 Ko)** — au-dessus du budget 170 Ko (à traiter en boucle 7).
- npm audit : **BLOQUÉ** — le miroir npm configuré (npm.mirrors.msh.team) n'implémente pas l'endpoint d'audit (404 NOT_IMPLEMENTED). Hors de portée sandbox ; à rejouer sur un registre standard.
- Sortie : G1 (tsc -b) vert, G2 120/120 verts, G3 build vert (version KdqqYMIMbnnl, pré-cache 15 fichiers).

## BOUCLE 1 — TARIFS (tout est divisé par deux)

### Itération 1
- **Constat** : grille en deux endroits (db/seed.ts + copie client src/lib/pricing.ts GRILLE_INITIALE), installation stockée par ligne de plan (5000/7500/10000) et lue à la facturation (api/gbsRouter.ts, src/views/Proprio.tsx) ; texte « 50 $ d'installation » en dur dans l'inscription (Home.tsx) ; test seed.test.ts attendait 1000/5000.
- **Action** :
  - Nouvelle grille (centimes USD) : ESSENTIEL 1000/1500/2000, PRO 1750/2500/3500, BUSINESS 2500/3750/5000, BOUTIQUE 500 — seed + GRILLE_INITIALE.
  - Installation par TYPE via `fraisInstallationPour()` (contracts/types.ts, partagé client/serveur) : 500 boutique/salon, 1000 sinon ; utilisée à la facturation serveur, au montant dû proprio et au texte d'inscription (dynamique).
  - Seed : la grille (seule donnée) est mise à jour par upsert en ré-exécution — abonnements et factures intacts.
  - Admin : l'éditeur ne touche plus que le prix mensuel ; l'installation n'est plus affichée par ligne (elle dépend du type).
  - Commentaires « 10 USD » corrigés (schema, seed, etablissements, contracts).
  - Tests : seed.test.ts mis à jour (grille complète) ; +10 tests unitaires (src/__tests__/tarifs.test.ts) ; +3 tests d'intégration (api/__tests__/tarifs.test.ts : terrasse 1000+1000, boutique 500+500, référence en double refusée).
- **Résultats (avant → après)** :
  - Recherche anciennes valeurs : 12 lignes de grille + 4 commentaires → **0** (les montants 1000/2000/3500/5000 restants sont les NOUVELLES valeurs ; 3000/4000/7000/7500/10000 absents).
  - G1 tsc : vert → vert. G2 tests : 120 → **133** (130 suite complète + 3 intégration). G3 build : vert (version Zdsk7bR-jgvq, pré-cache 15 fichiers dont le bundle).
  - G4 : aucun console.log/secret ajouté. G5 : seed ×2 sans erreur ; grille vérifiée en base (10 lignes aux nouvelles valeurs) ; 13 abonnements existants intacts.
  - G6 : deux textes d'interface FR existants adaptés (Admin, inscription) — extraction i18n prévue boucle 5.
- **PROPOSITION** : la colonne plans_tarifs.frais_install_usd est conservée (données intactes, valeur de référence 500/1000) mais n'est plus la source du calcul — la règle par type la remplace. À confirmer : la supprimer plus tard ou la garder comme documentation.
- **Décision** : conditions de sortie atteintes en 1 itération → boucle 1 terminée.

## BOUCLE 5 — I18N : APPLICATION ENTIÈRE EN FR / EN / PT (PORTUGAIS D'ANGOLA)

### Itération 1
- **Constat** : textes en dur dans les 4 vues staff (Serveuse, Gerant, Proprio, Admin) + format.ts (dates, « il y a », rôles) + rapportPdf.ts + pricing.ts (descriptions de plans) ; sélecteur FR|EN|PT présent uniquement sur les écrans publics ; aucune colonne langue sur l'organisation.
- **Action** :
  - 3 dictionnaires plats (src/i18n/fr.json, en.json, pt.json) construits en parité : **671 clés chacun, aucune valeur vide** ; lexique PT européen/africain (mesa, encomenda, caixa, ecrã, telemóvel) — « pedido » toléré uniquement pour la demande de stock (usage européen correct).
  - Socle i18n étendu : `LOCALES` (fr-FR/en-GB/pt-PT), `langueCourante()` et `traduire()` hors React (formatage, PDF, store).
  - Extraction complète : Serveuse (6 composants), Gerant (89 clés), Proprio (1183 l.), Admin (60 clés) ; variables de boucle nommées `t` renommées (te/table/tf/ty) pour ne pas masquer le traducteur.
  - Dates Intl par langue (format.ts, RapportJour, PDF) ; montants CDF/USD inchangés (règle maître).
  - `organisations.langue` varchar(2) défaut 'fr' : schéma + type + mutation `definirLangue` + wrapper store + effet de synchro dans PorteRole (pousse seulement si différent) ; migration 0006 générée et appliquée (drizzle-kit push + generate).
  - Sélecteur déplacé dans src/components/SelecteurLangue.tsx (variante compacte) et ajouté à l'en-tête de TOUS les écrans staff (Entete) — exigence « accueil + inscription + réglages » couverte : accueil, inscription, invitation, connexion + staff.
  - Script scripts/controle-i18n.mjs : parité, valeurs vides, clés référencées, chaînes en dur (exemptions : ErreurEcran autonome, __tests__, console.*).
  - pricing.ts : champ `contenu` retiré des PLANS → `contenuPlan()` traduit (plan.desc_*).
- **Résultats (avant → après)** :
  - G1 tsc : vert. G2 tests : 133 → **141** (+8 tests i18n : parité, vides, lexique PT, repli, interpolation, langueCourante, LOCALES). G3 build : vert.
  - G4 : aucun secret ni console.log ajouté. G5 : seed inchangé (test idempotence vert). G6 : contrôle i18n vert (671 clés ×3, 583 clés référencées, 0 chaîne en dur).
- **PROPOSITION** : `ErreurEcran.tsx` reste volontairement indépendant du socle i18n (il doit marcher même si le chargement des traductions est la cause du plantage) — ses textes 3 langues sont en dur dans le composant, exemptés du contrôle.
- **Décision** : conditions de sortie atteintes en 1 itération → boucle 5 terminée.

## BOUCLE 7 — DESIGN, PWA ET RENDU FINAL

### Itération 1 — Écran Pilotage conforme à la maquette « GBS — Pilotage.html »
- **Constat** : l'écran Pilotage (propriétaire) n'avait ni chips d'état, ni sparkline, ni delta J-7, ni état du stock agrégé, ni file « À traiter » unifiée, ni graphe 7 jours, ni grille des tables, ni équipe en service, ni top vendus du jour ; la date du jour était absente de l'en-tête ; « QR de la table 1 » et « en direct » restaient en dur dans Home.tsx (français sans accent, invisible au contrôle i18n).
- **Action** :
  - `Pilotage` (src/views/Proprio.tsx) entièrement réécrit (501 lignes) : chips (taux 1 $ = … FC, en ligne/hors ligne, statut d'abonnement) ; AUJOURD'HUI (ventes du jour + sparkline SVG inline sans librairie + delta vs J-7, valeur du stock + barre bon/bas/rupture, caisse + bouton dépense, CA) ; À TRAITER (demandes de stock Approuver/Refuser, clôtures déclarées avec détail comptage/attendu/écart, commandes en attente avec l'ancienneté, alertes + « Tout marquer lu ») ; CETTE SEMAINE (7 barres, jour courant en ambre, meilleur jour, pic d'affluence sur plage de 2 h) ; EN SALLE (grille des tables occupées/libres, masquée sans tables) ; ÉQUIPE EN SERVICE (sessions ouvertes + encaissé + avis) ; DERNIÈRES DÉPENSES (3, avec auteur) ; LES PLUS VENDUS AUJOURD'HUI ; sections existantes conservées (consolidé multi-terrasses, état des serveuses, dépôts, rapports Du jour/Global/CSV, journal d'audit filtrable).
  - 7 agrégats purs dans src/lib/store.tsx : `decalerJour` (midi local, anti-bord-de-fuseau), `ventesSemaine`, `ventesSemainePrecedente`, `etatStock` (rupture=0, bas≤seuil, actifs seuls), `picAffluence` (plage 2 h la plus dense sur 7 j, null si <3 ventes, heures via Intl formatToParts), `ventesCumuleesJour`, `encaisseParServeuse`.
  - Date du jour dans l'en-tête propriétaire : Intl (weekday long, day, month, fuseau Africa/Lubumbashi), suit la langue choisie.
  - i18n : +37 clés pilotage.* + demo.qr_table_1 + demo.en_direct (711 clés ×3, parité) ; contrôle renforcé (RE_FR_SANS_ACCENT) pour le JSX français sans accent.
  - Correctif i18n connexe : variable module `langueActive` mise à jour SYNCHRONEMENT dans setLangue — traduire() hors React (ilYA, PDF) bascule immédiatement au lieu d'un rendu de retard (vérifié : « há 10 h » en PT).
  - +10 tests unitaires (src/__tests__/pilotage.test.ts) : fixture UTC explicite (le sandbox est en UTC+8), couvre les 7 agrégats.
- **Résultats (avant → après)** :
  - G1 tsc : vert → vert. G2 tests : 141 → **151** (18 fichiers, +10). G3 build : vert (ENOENT flaky au 1er essai, relance OK — montage /mnt/agents).
  - G4 : aucun secret ni console.log ajouté (diff contrôlé). G5 : seed inchangé. G6 : contrôle i18n vert (711 clés ×3, 612 référencées, 0 chaîne en dur).
  - Vérification navigateur (FR + PT) : date du jour « dimanche 11 octobre » dans l'en-tête, chips, sparkline, « 39 bon état / 1 bas / 0 rupture », « 3 tables sur 6 occupées », « Meilleur jour : dimanche », équipe en service, top vendus du jour, rapports et journal d'audit — tout présent et traduit.
- **PROPOSITION 1** : les alertes sont stockées en base en français au moment de leur création — les alertes historiques restent en français quand on bascule en EN/PT. Traduire les alertes passées demanderait de stocker clé + paramètres au lieu du texte ; hors périmètre itération 1.
- **PROPOSITION 2** : la maquette mentionne des « demandes de remise (Approuver/Refuser) » — aucune entité remise n'existe dans le modèle de données. Aucune fausse donnée créée (règle ZÉRO DÉMO) ; à trancher : ajouter une entité remise dans une boucle ultérieure ou retirer le bloc de la maquette.
- **Décision** : écran Pilotage conforme à la maquette, 6 contrôles verts → itération 1 livrée. Restent dans la boucle 7 : tokens/typographie (JetBrains Mono, rayons 24/16, max 430 px), logo/PWA/manifest, Lighthouse ≥85/≥90, bundle JS <170 Ko (171,6 Ko mesurés en boucle 0).

### Itération 2 — Tokens et typographie de la maquette
- **Constat** : la palette en place (#14171F / #1C2130 / #F7A026, succès #45B26B, info #6E8FC7, danger #E05A4E) différait de la palette officielle de la boucle 7 ; les chiffres utilisaient la mono système ; les conteneurs étaient à 512 px (max-w-lg) au lieu de 430 px.
- **Action** : tokens alignés sur la palette officielle dans src/index.css (ambre #F6A01F, encre #14161D, surface #262932, succès #4FD18B, info #8FA6D0, danger #FF7A7A + variantes claires, nouveau token contrôle #2F3545) ; JetBrains Mono variable auto-hébergée (public/fonts/jetbrains-mono-latin.woff2, 40 Ko, préchargée, pré-cachée par le SW) branchée sur la classe .font-mono (tabular-nums) — tous les montants de l'app passent par le composant Money ; rayons conformes sans retouche (Carte = rounded-3xl = 24 px, contrôles = rounded-2xl = 16 px) ; conteneurs à 430 px (Coquille, gbs, Admin, Client, Home) ; badge notification danger en texte encre (contraste) ; theme-color, manifest, QR et PDF alignés.
- **Résultats** : G1 tsc vert ; G3 build vert (16 fichiers en pré-cache, la nouvelle police incluse) ; G4 propre ; G5 seed inchangé ; G6 contrôle i18n vert. Vérification navigateur : chiffres en mono tabulaire, colonne 430 px, nouvelle palette.
- **Écart assumé** : les couleurs de texte (crème #F5F1E8, sable #D7C6AD) sont conservées — la palette officielle ne les mentionne pas ; la maquette utilise #FFF/#9A988F, proche du rendu sable/70.

### Itération 3 — Budget JS : bundle principal sous 170 Ko
- **Constat** : bundle principal à 211 Ko gzip (739 Ko brut) — au-dessus du budget 170 Ko (déjà 171,6 Ko en boucle 0). Causes : react-router importé pour un seul BrowserRouter inutile (le routage est le mini-routeur maison par fragment), 3 dictionnaires i18n (~113 Ko brut) et toutes les vues staff dans le bundle initial.
- **Action** : react-router retiré (import + dépendance) ; dictionnaires EN/PT chargés à la demande (`assurerDico`, le PT charge aussi le repli EN ; fr synchrone ; re-rendu via versionDicos ; pré-cachés par le SW → bascule hors-ligne) ; vues staff (Client, Serveuse, Gerant, Proprio, Admin) en React.lazy + Suspense — l'accueil/inscription/connexion restent dans le bundle initial ; test i18n adapté (charge explicitement les dicos).
- **Résultats (avant → après)** : bundle principal **211 034 → 146 449 o gzip (−31 %), sous le budget de 170 Ko** ; chunks paresseux : Proprio 17 Ko, Gerant 7,8 Ko, Client 6 Ko, Serveuse 5,5 Ko, dicos 11 Ko chacun, superjson 53 Ko (chunk partagé). G1 tsc vert ; G2 151/151 verts ; G3 build vert (25 assets pré-compressés) ; G4 propre ; G5 seed inchangé ; G6 vert. Vérification navigateur : rechargement direct en PT (dico paresseux restauré), bascule PT instantanée dans le Pilotage (vue paresseuse), date du jour traduite (« domingo, 11 de outubro »).
- **PROPOSITION** : superjson (53 Ko gzip, transformer tRPC chargé au démarrage) pourrait être remplacé par du JSON pur avec reviver de dates maison — gain réel mais risque de régression sur les Date de tous les payloads ; à évaluer seul dans une itération dédiée si le budget se resserre.

### Itération 4 — PWA et performance Lighthouse (≥ 85 / ≥ 90)
- **Constat** : au départ de l'itération, Lighthouse donnait Perf 62-84 (variance ±2-3 points), A11y 100, BP 100. Causes mesurées : l'installation du service worker + le pré-cache (~900 Ko) étaient comptés dans le premier chargement (« redirects » ~4,8 s) ; la CSS bloquait le premier rendu ; les formulaires Nouvel établissement / Invitation / Connexion étaient chargés avec l'accueil ; la police du titre (élément LCP) n'était pas préchargée ; le basculement font-display: swap provoquait un CLS de 0,045.
- **Action** :
  - **Pré-cache scindé** (public/sw.js + scripts/versionner-sw.mjs) : `PRE_CACHE` vital (./, manifest, favicon-32, JS/CSS du HTML — 4 fichiers, 473 Ko) installé au 1er passage ; `PRE_CACHE_DIFFERE` (icônes lourdes + polices — 11 fichiers, 383 Ko) pré-caché au repos (message `PRECACHER_LE_RESTE` envoyé par src/lib/pwa.ts au requestIdleCallback, repli setTimeout 3 s ; handler e.waitUntil + allSettled dans le SW). activate : nettoyage des anciens caches puis clients.claim() SANS attendre le différé.
  - **CSS inlinée** (scripts/inline-css.mjs, ajouté à la chaîne de build) : la feuille compilée (38,7 Ko) est inlinée dans dist/public/index.html — un aller-retour bloquant de moins ; garde-fou : échec si une url() relative resterait cassée.
  - **Accueil allégé** : NouvelEtablissement / Invitation / Connexion déplacés de Home.tsx vers src/views/Portes.tsx (chunk paresseux, 3,6 Ko gzip) ; accueil seul en import statique. Extraction connexe : CLE_PIN_ADMIN → src/lib/constantes.ts (Admin.tsx restait importé statiquement par Home et cassait le lazy) ; WhatsApp/courriel → src/lib/contact.ts (règle react-refresh/only-export-components) ; gbs.tsx : WHATSAPP_SUPPORT = WA_NUMERO, badge danger en text-encre, colonne 430 px.
  - **Précharge de la police du titre** : bricolage-grotesque-800-latin.woff2 (élément LCP mesuré : H1) préchargée dans index.html à côté d'Inter ; JetBrains Mono NON préchargée (chargée à l'usage par les écrans staff).
  - **font-display: optional** sur les quatre familles (src/index.css) : fenêtre de blocage courte au lieu du swap tardif — la police préchargée est là à temps, sinon le repli système est conservé pour ce chargement ; vise le CLS de basculement.
- **Résultats (avant → après)** :
  - Lighthouse (production locale, 3 runs) : Perf **93 / 89 / 88 — médiane 89 ≥ 85** ; A11y **100 ≥ 90** ; BP 100. FCP 1,7-2,0 s, LCP 2,3-2,7 s, TBT 250-310 ms (était 410), « redirects » du 1er passage disparu.
  - Bundle principal 137,5 Ko gzip (< 170 Ko, inchangé) ; CLS résiduel 0,044 (non lié aux polices : identique avant/après optional — piste restante, non bloquante pour la cible).
  - G1 tsc : vert. G2 tests : **151/151 verts** (483 s). G3 build : vert (34 assets pré-compressés, −71 %). G4 : aucun secret ni console.log (diff contrôlé). G5 : seed inchangé. G6 : Portes.tsx 57 appels t(), 0 chaîne en dur ; ESLint sur les fichiers touchés : 0 problème (baseline préexistante non modifiée).
- **PROPOSITION** : la baseline ESLint préexistante (101 problèmes, 99 erreurs — ex. react-hooks/purity sur Date.now() dans Proprio.tsx) n'est pas traitée ici ; à planifier en boucle 8 (audit production) pour repartir d'une liste à zéro.
- **Décision** : Perf médiane 89 ≥ 85 et A11y 100 ≥ 90, budget JS respecté, 6 contrôles verts → itération 4 livrée et **boucle 7 terminée** (manifest/icônes/maskable déjà conformes, SW hors-ligne vérifié). Reste l'ordre de travail existant : boucle 2 (seed référentiel), boucle 3 (formulaire produit adaptatif), boucle 6 (Airtel Money), boucle 8 (audit production), puis 24 parcours finaux.

### Annexe 2 — section 5 « Paiement unifié » réécrite (documentaire, même commit)
- **Constat** : réponses aux 5 questions du paiement unifié + correction de principe (la recette appartient à l'établissement : suivre l'argent physique, pas la comptabilité).
- **Action** : docs/ANNEXE-2-note-client.md section 5 réécrite (5.0 à 5.11) : tout employé autorisé encaisse sauf séjour chambre (réception/gérant) ; « Demander l'addition » alerte l'espace, escalade gérant après N min ; client parti = note LITIGE jamais supprimée, motif + journal_audit, pas de responsabilité automatique serveuse ; pourboire à l'employé qui encaisse (table pourboires, hors CA/ventilation) ; acomptes partout (REGLEE à solde zéro) ; cash suivi par encaissements (statut EN_MAIN|REMIS|ECART) + remises_caisse validées par le receveur (attendu vs reçu, clôture « Vous devez remettre X FC », écart = alerte immédiate proprio) ; mobile money validé par le caissier avec référence UNIQUE ; ventilation par espace comptable seulement ; transaction + verrou sur encaisserNote ; API : demanderAddition, encaisserNote, ventilerPaiement, remettreCaisse, validerRemise, declarerLitige ; écrans : encaissement serveur, « Ma caisse », validation remise gérant, « Demander l'addition » client.
- **Portée** : documentaire uniquement — aucune migration appliquée (la migration sera montrée avant application, à l'étape 1 de l'ordre de travail : table espaces + rattachement QR).

## BOUCLE 2 — SEED RÉFÉRENTIEL SEUL (ZÉRO DÉMO)

### Itération 1 — Scission référentiel / fixtures de démo
- **Constat** : `assurerSeed()` (api/gbsSeed.ts) insérait le seed canonique COMPLET — y compris l'organisation « Nganda Group », les 4 personas et les 6 établissements de démo — dans TOUS les environnements dès que la table organisations était vide, même avec ANNUAIRE_DEMO=false. Violation du principe « PRODUCTION DIRECTE ZÉRO DÉMO » : une base de production fraîche démarrait remplie de données fictives.
- **Action** :
  - Nouveau module **db/fixtures-demo.ts** : toute la donnée de démonstration y est déplacée à l'identique (organisation, 4 personas, 6 établissements — terrasse, boutique, QUINCAILLERIE, pharmacie, restaurant, hôtel —, tables QR, affectations, sélections de produits, abonnements ESSAI, session, 2 commandes, 2 alertes, DEMO_PINS). `executerFixturesDemo()` idempotent ; `executerSeedCanonique()` = référentiel + fixtures, conservé pour les tests et le développement.
  - **db/seed.ts** devient le seed du RÉFÉRENTIEL seul : `executerSeedReferentiel()` (grille des 10 plans en onConflictDoUpdate, catalogue ~1000 articles, 10 codes-barres connus, compteur de factures). CLI : `tsx db/seed.ts` = référentiel seul (production) ; `--avec-demo` ajoute les fixtures (import dynamique, jamais chargées sinon) ; `--reinitialiser` combine les deux. Nouveau script npm `db:seed:demo`.
  - **api/gbsSeed.ts** : `assurerSeed()` décide via la fonction pure `planifierSeed({ referentielPresent, demoPresente, annuaireDemo })` — le référentiel se réinsère s'il manque ; la démo n'entre QUE si `annuaireDemo` ET base vide d'organisations (jamais d'écrasement d'une instance réelle). Avec ANNUAIRE_DEMO=false : référentiel seul, zéro démo, quel que soit l'état de la base.
  - gbsRouter.ts : DEMO_PINS importé depuis db/fixtures-demo.
  - Typage bonus : `parLots(table: PgTable, …)` au lieu de `any` (une erreur ESLint de la baseline retirée au passage).
- **Migration** : AUCUNE — schéma inchangé, changement de code uniquement (rien à montrer ni appliquer).
- **Résultats (avant → après)** :
  - G1 tsc : vert. G2 tests : 151 → **154** (+3 : idempotence du référentiel seul ×1, planifierSeed ×2 — dont « jamais de démo si annuaireDemo=false »). G3 build : vert (ENOENT flaky du montage, résolu par purge complète de dist).
  - G4 : aucun secret ni console.log ajouté. G5 : idempotence du référentiel testée (plans=10, catalogue ≥800, codes-barres ≥10 stables sur 2 exécutions). G6 : aucun texte UI touché.
  - ESLint sur les fichiers touchés : 0 problème. Vérification serveur : annuaire démo inchangé sur la base existante (Papa Jean + 6 établissements, comptes réels préservés).
- **PROPOSITION** : un déploiement de DÉMONSTRATION publique devra tourner avec NODE_ENV ≠ production ou repenser l'annuaire ; la suppression complète d'ANNUAIRE_DEMO reste prévue en boucle 8.
- **Décision** : ZÉRO DÉMO garanti en production par le code, tests et build verts → itération 1 livrée, boucle 2 terminée.

### Analyse de lenteur de la suite (483 s → 478 s) — PROPOSITION, non appliquée
- **Mesures par fichier** (run du 15 oct.) : interfaces.test.ts **182,7 s** (22 tests) ; seed.test.ts **89,7 s** (dont le seul test d'idempotence du canonique : 79,1 s) ; etablissements 31,4 s ; auth 27,4 s ; depenses 26,9 s ; stock 24,7 s ; tarifs 24,3 s ; uploadPhoto 18,2 s ; securite 15,7 s ; catalogue 15,5 s. Les 6 fichiers src/ (69 tests) : < 0,5 s au total.
- **Cause racine** : chaque aller-retour Neon coûte ~600-900 ms ; les tests d'interface enchaînent 15-30 appels tRPC séquentiels (ex. « parcours complet commande » 20,5 s, « nul ne valide son propre dépôt » 18,3 s). La somme des durées fichiers ≈ la durée totale → les fichiers tournent quasiment en série (contention DB).
- **Découpage proposé** (à valider avant toute action) :
  1. `interfaces.test.ts` (183 s) → 3 fichiers par domaine : ventes/commandes (~6 tests), caisse/dépôts/clôtures (~8 tests), autorisations/invitations/journal (~8 tests) — gain attendu ×3 sur ce fichier si exécution parallèle réelle.
  2. `seed.test.ts` : isoler l'idempotence du canonique (79 s, 2 seeds complets ~1000 articles) dans un fichier marqué `test.concurrent` exclus, ou réduire à 1 exécution + comparaison des comptes (l'idempotence du référentiel seul est déjà testée à part).
  3. Activer le parallélisme de fichiers (pool forks, maxForks 3-4) APRÈS avoir vérifié que les fixtures par fichier n'entrent pas en collision (IDs déjà préfixés par test — à confirmer pour auth/etablissements).
  - Gain estimé : 478 s → ~200-250 s. Risque principal : collisions de données entre fichiers parallèles sur la même base Neon de test.

### Itération 2 — Durcissement ZÉRO DÉMO + découpage des tests lents
- **Constat** : (a) `annuaireDemo` valait TRUE par défaut même en production (seul `ANNUAIRE_DEMO=false` le désactivait) ; (b) `db:seed:demo` acceptait de tourner avec NODE_ENV=production ; la suite de 478 s était dominée par interfaces.test.ts (183 s) et l'idempotence du canonique (79 s).
- **Action** :
  - api/lib/env.ts : `annuaireDemoParDefaut()` — désactivé PAR DÉFAUT en production, activé par défaut en développement/test ; ANNUAIRE_DEMO=true|false force le choix (avertissement conservé si forcé en production). Le .env du sandbox (ignoré par git) reçoit ANNUAIRE_DEMO=true explicite pour préserver la démo publique.
  - db/seed.ts : le CLI refuse `--avec-demo` quand NODE_ENV=production (« Refusé : … ZÉRO DÉMO », exit 1) — vérifié en direct.
  - Vérifications : prod sans variable → annuaireDemo=false ✓ ; dev sans variable → true ✓ ; forcé true/false respecté ✓.
  - Découpage (étapes 1 et 2 validées, pas de maxForks) : interfaces.test.ts (22 tests, 183 s) → **interfaces-ventes** (12 tests : session, parcours, étanchéité, encaissement), **interfaces-caisse** (6 : clôture, dépôt, écart, validations), **interfaces-permissions** (5 : prix, stock, invitations, journal) — chaque fichier a ses propres fixtures préfixées (test_ven/test_cai/test_per) et reste séquentiel en interne ; l'idempotence du canonique est isolée dans **seed-idempotence.test.ts** (seed.test.ts garde structure + référentiel seul + planifierSeed).
- **Migration** : AUCUNE.
- **Résultats** : tsc vert ; ESLint 0 problème sur les fichiers touchés ; run ciblé 4 fichiers = 31/31 verts (ventes 87 s, caisse 73 s, permissions 58 s). La durée totale de la suite ne baissera qu'avec le parallélisme (étape 3, refusée pour l'instant) — le découpage prépare ce gain et accélère déjà les runs ciblés.
- **Décision** : itération 2 livrée ; boucle 2 terminée (ZÉRO DÉMO appliqué par le code ET par défaut d'environnement).

## Boucle 3 — Formulaire produit adaptatif

### Itération 1 — Schéma, migration 0007, référentiel catégories, validation API
- **Observer** : le formulaire produit était identique pour les 8 métiers ; aucune colonne pour chambres/services/lots. La spec boucle 3 (prompt maître §118-140) exige : table categories_produit, colonnes nullables (type_produit, unite, duree_minutes, capacite, lot, date_peremption), refus API (catégorie d'un autre type, chambre sans capacité, service sans durée).
- **Action** :
  - contracts/types.ts : `TypeProduit`, `CategorieProduit`, `CATEGORIES_PAR_TYPE` (32 entrées FR/EN/PT + icônes Lucide), `categoriesPour`, `typeProduitParDefaut`, `categorieParLibelle`, `TYPES_SANS_STOCK` ; Produit étendu des 6 champs nullables.
  - db/schema.ts : 6 colonnes nullables sur produits + table `categoriesProduit` (unique(code, type_etablissement), index sur type_etablissement).
  - **Migration 0007 montrée avant application** (SQL ci-dessous) ; appliquée après réalignement du journal drizzle (les migrations 0000-0006 avaient été appliquées hors drizzle-kit migrate — journal vide constaté, 7 lignes réinsérées par hash SHA-256, puis 0007 exécutée instruction par instruction) :
    CREATE TABLE categories_produit (…, CONSTRAINT uq_catprod_code_type UNIQUE(code, type_etablissement)) ; ALTER TABLE produits ADD COLUMN type_produit varchar(12) / unite varchar(20) / duree_minutes integer / capacite integer / lot varchar(60) / date_peremption varchar(10) ; CREATE INDEX idx_catprod_type.
  - db/seed.ts : executerSeedReferentiel insère les 32 catégories (IDs fixes cat_<type>_<code>, onConflictDoNothing → idempotent).
  - api/gbsSnapshot.ts : mapperProduit factorisé (2 sites) incluant les 6 nouvelles colonnes.
  - api/gbsRouter.ts creerProduit : input étendu (6 champs optionnels) ; refus si la catégorie appartient au référentiel d'un AUTRE type (sauf « Divers », générique) ; CHAMBRE exige capacite, SERVICE exige dureeMinutes ; typeProduit déduit de la catégorie du référentiel si non fourni ; libellés libres hors référentiel tolérés (compatibilité anciens produits).
- **Résultats (avant → après)** :
  - G1 tsc : vert. G2 tests : 155 → **164** (+9 : refus chambre/service/catégorie étrangère, libellé libre toléré, déductions CHAMBRE/SERVICE/BILLARD/MARCHANDISE, lot+péremption ; +assertion 32 catégories dans le test d'idempotence du référentiel). G4 : aucun secret ni console.log. G5 : idempotence référentiel étendue aux catégories (testée). G6 : aucun texte UI touché (messages serveur FR existants).
  - ESLint sur les fichiers touchés : 0 problème ajouté.
  - Vérifications demandées : (a) `annuaireDemoParDefaut()` = false par défaut en production ✓ (relu) ; (b) `npx tsx db/seed.ts --avec-demo` avec NODE_ENV=production → exit 1 « Refusé … ZÉRO DÉMO » ✓ (testé en direct).
- **Base de test plus proche (réponse à la question)** : PostgreSQL local impossible dans le sandbox (pas de binaire, user non-root, OS wipé) ; une branche Neon reste en us-east-2 (aucun gain de latence — il faudrait un NOUVEAU projet Neon en région Asie, action console hors sandbox) ; PGlite écarté (changement de driver, risque FOR UPDATE mono-connexion). Les 600-900 ms/requête restent donc le coût structurel ; le découpage fichiers reste la seule marge interne.
- **Décision** : itération 1 livrée → itération 2 : formulaire adaptatif (8 types × test de composant).

### Correctif hors boucle — « Échec de la publication » (erreur SQL colonne manquante)
- **Constat** : la plateforme de publication démarre dist/boot.js sur une base EXISTANTE ; l'entrypoint Docker ne migre que les bases VIDES → la migration 0007 n'était jamais appliquée en production publiée → « column produits.type_produit does not exist » au premier snapshot → publication en échec.
- **Action** : api/lib/assurerSchema.ts — garde de schéma au démarrage, même pattern que assurerTableErreursClient (idempotente, mémoïsée) : CREATE TABLE IF NOT EXISTS categories_produit (contrainte unique inline), ALTER TABLE produits ADD COLUMN IF NOT EXISTS × 6, index idx_catprod_type, puis réalignement du journal drizzle (8 hash SHA-256, INSERT … WHERE NOT EXISTS). No-op strict sur une base vide (cas entrypoint). Appelée en PREMIER dans la chaîne de préchauffage de boot.ts, avant assurerSuperAdmin.
- **Vérifications** : tsc vert, ESLint 0 problème, build vert, boot local OK (accueil 200, annuaire tRPC intact, NOTICE « already exists, skipping » = idempotence confirmée sur base déjà migrée).
- **Décision** : auto-migration limitée au démarrage (artefacts 0007 uniquement) — choix assumé pour débloquer la publication ; toute migration future devra ajouter ses artefacts ici OU documenter l'application manuelle (db/migrations/README.md).

### Correctif publication n°2 — garde synchrone + couverture 0006
- **Constat** : deux failles dans le premier correctif. (1) La garde tournait en tâche de fond APRÈS l'ouverture du port : un test de disponibilité de la plateforme pouvait frapper l'API avant la fin de la garde → même erreur SQL. (2) La garde ne couvrait que 0007 ; si la base publiée date d'avant la boucle 5, `organisations.langue` (migration 0006) manque aussi — même symptôme « colonne manquante ».
- **Action** : assurerSchema.ts couvre 0006 (ADD COLUMN IF NOT EXISTS langue) + 0007 ; boot.ts attend la garde AVANT serve(), bornée à 20 s et tolérante à l'échec (une base injoignable n'empêche pas le démarrage, l'erreur remonte via l'API). 0005 reste couverte par assurerTableErreursClient. Règle inscrite : toute migration future ajoute ses artefacts ici.
- **Vérifications** : tsc vert, ESLint 0 problème, build vert, boot local : « [boot] schéma vérifié (migrations 0006-0007 assurées) » PUIS accueil 200 + annuaire tRPC intact.

## Annexe EXPÉRIENCE — Itération fusion multi-métiers + type BILLARD (9e type)
- **Observer** : demande utilisateur « ajouter aussi le billard… liste déroulante avec coches pour deux ou 3 établissements… fonctionnalité fusionnée puis adaptée ». Le registre TYPES_ETABLISSEMENT (annexe étape 1) existait avec 8 types ; ni BILLARD ni sélection multiple.
- **Action** :
  - contracts/types.ts : `TypeEtablissement` étendu à 9 types (+BILLARD) ; registre complété (modules, vocabulaire, QR ZONE+COMPTOIR+BILLARD, rôles dont BILLARDIER, widgets file Vincaire, alertes, frais 1000, pas zone-unique) ; `tousLesTypes()` (dédoublonne, retire le principal des secondaires) et `defFusionnee()` (union modules/QR/rôles/widgets/alertes, vocabulaire + frais du principal, zoneUnique=every, rechercheProduit=some) ; 4 catégories BILLARD (Parties de billard/Bières/Boissons/Snacks → 36 entrées) ; `RoleEtablissement` étendu à 10 rôles ; `RoleActif = "PROPRIETAIRE" | "CLIENT" | "SUPER_ADMIN" | RoleEtablissement` ; Terrasse += `typesSecondaires`.
  - db/schema.ts : terrasses += `types_secondaires jsonb NOT NULL DEFAULT '[]'`.
  - **Migrations montrées avant application** : 0008 (modules_etablissement, étape 1) puis 0009 = `ALTER TABLE "terrasses" ADD COLUMN "types_secondaires" jsonb DEFAULT '[]'::jsonb NOT NULL;` — appliquées via drizzle-kit migrate (exit 0) après réalignement du journal (10 hash).
  - Garde assurerSchema étendue 0006-0009 + backfill des 10 hash (publication).
  - api/gbsRouter.ts : finaliserInscription += `typesSecondaires` (max 2, enum 9 types) ; plan BOUTIQUE seulement si TOUS les types sont zone-unique ; QR mural si AU MOINS un zone-unique ; creerProduit : union des catégories de tous les types (refus si catégorie d'un type NON fusionné).
  - src/views/Portes.tsx : liste déroulante à coches (min 1, max 3, ordre = rang de clic, 1er = principal), récap fusion « Terrasse + Billard » ; store.tsx : wrapper finaliserInscription += typesSecondaires.
  - i18n : +6 clés × 3 langues (717 clés chacun) — types_label, principal_hint, fusion_recap, types_max, type_billard(_d).
  - Règle frais tranchée (réponse « No preference ») : frais du type PRINCIPAL.
- **Résultats (avant → après)** :
  - G1 tsc : vert. G2 tests : 164 → **177** (+13 : 8 tests purs registre/fusion + 5 tests API — produit billard accepté sur Terrasse+Billard, « Chambres » refusé non fusionné, inscriptions Terrasse+Billard et Boutique+Salon, mono-type inchangé). Suite complète : 177/177 verts (1 test tarifs.test.ts mis à jour : 8→9 types, comparaison zone-unique triée car l'ordre suit désormais le registre).
  - G3 build : à refaire à cette itération. G4 : aucun secret ni console.log. G5 : seed inchangé (types_secondaires a un défaut). G6 : aucun texte en dur (6 clés i18n ×3).
  - ESLint sur les fichiers touchés : 0 erreur ajoutée (baseline 100 problèmes inchangée).
- **Décision** : fusion livrée. Prochaine étape annexe : étape 2 (RBAC 11 rôles — élargir affectations.role varchar(10)→16 + peut()) puis étape 3 (billard Vincaire complet : tables tokens/parties à créer).

## Annexe EXPÉRIENCE — Étape 2 : RBAC 11 rôles + journal d'audit enrichi
- **Observer** : rôles limités à GERANT/SERVEUSE (colonnes varchar(10) — RECEPTIONNISTE = 14 caractères ne rentrait pas) ; audit_log sans établissement ni avant/après ; aucune matrice de permissions ni surcharge.
- **Migration 0010 montrée avant application, puis appliquée** (drizzle-kit migrate, exit 0 ; vérifiée en base par information_schema) :
  CREATE TABLE permissions_surcharge (…, UNIQUE(terrasse_id, utilisateur_id, action)) ; ALTER affectations/invitations.role → varchar(16) ; ALTER audit_log.role_actif → varchar(16) ; audit_log += terrasse_id, avant text, apres text ; index idx_permsurch_ter + idx_audit_terrasse_date.
- **Action** :
  - contracts/types.ts : `ActionSensible` (10 actions), `PERMISSIONS_PAR_ROLE` (matrice de l'annexe §7 : ordonnance = pharmacien seul parmi les employés, gérant exclu ; équipe = propriétaire seul ; token billard = serveuse/billardier), `SEUIL_REMISE_PAR_ROLE` (gérant illimité, employés caisse 5 %, cuisine/gouvernante/prestataire 0), helpers permissionsParDefaut/seuilRemisePour/toutesLesActionsSensibles.
  - api/lib/permissions.ts (NOUVEAU) : `peut()`, `peutAvecRoles()` (cœur pur : PROPRIETAIRE toujours oui, surcharge prime, union des rôles), `exigerPermission()` (refus journalisé avec établissement), `journaliserPermission()`. Lecture base locale pour éviter tout cycle d'imports avec gbsRouter.
  - api/gbsRouter.ts : zRoleEtab → 10 rôles ; `journaliser()` étendu (extras terrasseId/avant/après, rétrocompatible) ; endpoints `definirSurchargePermission` (proprio, cible = membre actif, null = retrait, journalisé avant/après), `listerSurcharges`, `mesPermissions` (pour que l'UI masque les actions interdites) ; retour de consommerInvitation typé RoleEtablissement.
  - Garde assurerSchema étendue 0006→0010 (11 hash dans le journal).
  - UI Proprio.tsx : sélecteur de rôle = union des rôles des types fusionnés de l'établissement (defFusionnee), libellés de rôle dynamiques ; i18n : 8 clés role.* × 3 langues (725 clés chacun).
- **Résultats (avant → après)** :
  - G1 tsc : vert. G2 tests : 177 → **192** (+15 : 10 purs matrice/décision + 5 API dont invitation RECEPTIONNISTE 14 caractères, surcharge accordée/retirée, refus non-propriétaire). G4 : aucun secret ni console.log. G5 : seed inchangé. G6 : aucun texte en dur (8 clés i18n ×3).
  - ESLint projet : 100 problèmes / 98 erreurs = baseline exacte (0 ajoutée) ; les 3 nouveaux fichiers sont propres.
  - Révocation immédiate : déjà garantie (rôles relus en base à chaque requête — relu api/lib/session.ts).
- **Décision** : étape 2 livrée (fondation). Non fait volontairement : le recâblage des contrôles existants sur exigerPermission (boucle par boucle, « ne change pas ce qui fonctionne ») et le PIN court par employé (avec le flux concerné, étape 3).

## Annexe EXPÉRIENCE — Étape 3 : Billard Vincaire complet (backend)
- **Observer** : le type BILLARD existait au registre (étape fusion) mais aucune logique métier : pas de file d'attente, pas de tokens payants, pas de cycle de parties. Règles tranchées avec l'utilisateur : prix token configurable (défaut 5 000 FC) ; perdant RACHAT par défaut ; vincaire illimité par défaut ; paiement cash validé par serveuse/billardier ; rôle BILLARDIER opérationnel.
- **Découverte majeure en base réelle** : les tables `tokens` et `parties` PRÉ-EXISTAIENT (prototype jamais versionné dans db/schema.ts). Conformément à l'annexe (« ne recrée rien »), le schéma a été remappé sur ces tables au lieu d'en créer de nouvelles ; 1 vraie ligne de test utilisateur (`tok_027d3a68d444`, « héritier », 5 000 FC) PRÉSERVÉE, statut migré EN_ATTENTE → ATTENTE_PAIEMENT. Cause racine de l'échec silencieux de drizzle-kit migrate (spinner avalant l'erreur) : `idx_parties_table already exists`.
- **Migration 0011 montrée avant application, réécrite idempotente puis appliquée** (script instruction par instruction, 20/20 OK — drizzle-kit migrate inutilisable sur ce cas) :
  CREATE TABLE IF NOT EXISTS tokens / parties / config_billard ; ALTER TABLE tokens ADD COLUMN IF NOT EXISTS serie / paye_le / paye_par / entree_file_le / annule_le / annule_par, statut → varchar(20) ; ALTER TABLE parties ADD COLUMN IF NOT EXISTS numero / termine_par, statut → varchar(20) ; UPDATE tokens SET statut = 'ATTENTE_PAIEMENT' WHERE statut = 'EN_ATTENTE'.
- **Migration 0012 montrée avant application, puis appliquée** (script tsx + journal) : `ALTER TABLE "alertes" ALTER COLUMN "type" SET DATA TYPE varchar(30);` — BILLARD_ANNULATION_PAYEE (24 car.) dépassait varchar(15).
- **Action** :
  - contracts/billard.ts (NOUVEAU) : StatutTokenBillard (7 statuts), StatutPartieBillard, ReglePerdant, ConfigBillard + CONFIG_BILLARD_DEFAUT (5 000 FC, RACHAT, illimité, présence 3 min) ; fonctions pures statutApresDefaite, vincaireDoitSortir, dureeMoyennePartiesMin (10 dernières, borne 240 min), estimerAttenteMin, appelExpire, positionDansFile.
  - db/schema.ts : tokensBillard → pgTable("tokens"), partiesBillard → pgTable("parties") (colonnes réelles + ajouts), table configBillard (terrasseId unique), tables_qr += kind varchar(12) défaut "ZONE".
  - api/routers/billard.ts (NOUVEAU, ~650 lignes) : cycle complet ATTENTE_PAIEMENT → EN_FILE (FIFO) → APPELE (3 min) → EN_JEU → SORTI/ABSENT/ANNULE ; 12 endpoints : voirFile (public + sweep absents), acheterToken (1 actif/session, numéro du jour par billard), annulerToken (alerte si payé), validerPaiementToken (permission VALIDER_TOKEN_BILLARD), ajouterJoueurComptoir, appelerSuivant, lancerPartie / terminerPartie / annulerPartie (transactions + SELECT … FOR UPDATE), marquerAbsent, configurerBillard (audit avant/après JSON), statsBillard (VOIR_RAPPORTS : recette, classement, heures de pointe). Siège vincaire = tenant EN_JEU sinon 1er de file promu ; challenger = appelé suivant.
  - contracts/types.ts : Alerte.type += BILLARD_ABSENT | BILLARD_ANNULATION_PAYEE.
  - api/gbsRouter.ts : ajouterTableDb += param kind ("ZONE"|"BILLARD", journalise BILLARD_CREE) ; finaliserInscription : kind BILLARD si typeEtablissement BILLARD.
  - Garde assurerSchema étendue 0006-0012 + journal réaligné (12 hash SHA-256) : log « [boot] schéma vérifié (migrations 0006-0012 assurées) ».
- **Bugs corrigés en cours d'itération** : siège/challenger inversés au premier lancerPartie (challenger choisi avant le siège → restructuré avec helper promouvoir) ; alertes.type trop court (→ migration 0012) ; verrous SQL référençant parties_billard après remappage → FROM parties (2 sites).
- **Résultats (avant → après)** :
  - G1 tsc : vert. G2 tests : 192 → **216** (+24 : 10 tests purs billard + 14 tests API — flux complet : config défaut, 3 achats, refus cuisine / accord serveuse, FIFO, lancerPartie vincaire+challenger, victoire série+1 et perdant SORTI, double clôture refusée « déjà clôturée », retour gratuit règle FIN_FILE (payePar inchangé), absent+alerte, annulation payée+alerte, stats). Suites isolées : 10/10 et 14/14.
  - G4 : aucun secret ni console.log ; DATABASE_URL inchangée côté serveur. G5 : seed inchangé (défauts en schéma). G6 : aucun texte UI (backend pur, messages serveur FR existants).
  - ESLint projet : baseline exacte 100 problèmes / 98 erreurs (4 scripts de diagnostic supprimés après usage).
- **Décision** : backend billard livré. Itération suivante : UI — ClientBillard (file, mon token, position, estimation) + GestionBillards (panneau par billard : Vincaire/Challenger gagne, Lancer, valider paiements, ajout comptoir) + i18n ×3.

## Annexe EXPÉRIENCE — Étape 3 (suite) : UI billard + formulaire adaptatif + pharmacie comptoir — puis AUDIT GÉNÉRAL
- **Observer** : retour utilisateur — le formulaire « Nouveau produit » générique ne correspondait pas au métier, une pharmacie avait des tables, et le billard backend n'avait aucune UI visible (file d'attente, gagnant).
- **Action (UI)** :
  - src/views/Billard.tsx (NOUVEAU, ~600 lignes) : OngletBillardClient (ticket, position, estimation, bannière « C'est votre tour », file en direct, rafraîchissement 4 s) ; PanneauBillards partagé Serveuse/Gerant/Proprio — partie en cours avec 2 gros boutons « <prénom> gagne », lancer/appeler, encaisser, absent, ajout joueur comptoir, annulation avec motif, config (prix, règle perdant, max parties, délai) et stats (réservées rapports).
  - Client.tsx : QR kind BILLARD → onglet « Billard » par défaut, menu renommé « Boissons », suivi conservé.
  - Serveuse.tsx : rôle BILLARDIER admis, onglet Billards si l'établissement en a. Gerant/Proprio : même panneau + config/stats.
  - Proprio.tsx : FeuilleAjout adaptative — catégories = union des types fusionnés, typeProduit déduit, champs conditionnels (capacité CHAMBRE, durée SERVICE, unité + lot/péremption MARCHANDISE, stock masqué SERVICE/BILLARD) ; vocabulaire « Comptoirs » pour les établissements sans salle ; billards marqués dans la grille.
  - Portes.tsx : champ « nombre de tables » masqué si aucun type fusionné n'a de tables de salle (pharmacie/boutique…) ; label « billards » pour le type BILLARD.
  - contracts/types.ts : TableT.kind ("ZONE"|"BILLARD") + helper aTablesDeSalle(type) ; gbsSnapshot : mapperTable centralisé ; gbsRouter.finaliserInscription : 1 seul QR comptoir si établissement 100 % comptoir (tarification inchangée) ; validation.ts : kind assaini.
  - api/routers/billard.ts : endpoint voirGestion (staff : tokens détaillés, positions FIFO, partie en cours) ; monToken typé précisément.
  - i18n : 725 → 829 clés ×3 (billard.*, proprio.* adaptatif, inscr.nb_billards) — contrôle maison vert.
- **Bug trouvé par les tests (migration 0013, montrée avant application)** : `ALTER TABLE tokens ALTER COLUMN client_session_id DROP NOT NULL` — la table tokens pré-existait avec NOT NULL, le CREATE TABLE IF NOT EXISTS de 0011 était sans effet ; l'ajout de joueur au comptoir (clientSessionId NULL) échouait. Journal + snapshot 0013 + garde assurerSchema étendue (0006-0013).
- **AUDIT GÉNÉRAL (demande utilisateur)** :
  - Secrets : .env gitignoré (seul .env.example tracé, valeurs vides), aucun secret ni console.log côté client, DATABASE_URL/SESSION_SECRET/ADMIN_PIN serveur uniquement (api/), .dockerignore exclut .env, Dockerfile sans COPY .env. ✔
  - Auth : jetons HMAC-SHA256 12 h, rôles relus en base à chaque requête (révocation immédiate), anti-brute-force 5 échecs → 5 min (IP+numéro), comparerSecret à temps constant, PIN personnel scrypt, erreurs de connexion ambiguës (pas d'oracle). ✔
  - Endpoints publics sensibles vérifiés : snapshot (portées filtrées, admin exige PIN, staff exige jeton), modifierTarif (exigerAdmin), reinitialiserDemo (verrouillé hors mode démo). ✔
  - **Bug de sécurité trouvé et corrigé** : collision de numéro — un compte « Fiston » inscrit le 12/10 avec +243970000000 (ADMIN_TELEPHONE par défaut, public) rendait la connexion super-admin aléatoire (LIMIT 1 sans ORDER BY → mauvaise ligne → « PIN incorrect »). Correctif : connexionTelephone relève tous les candidats (super-admin d'abord) et le PIN départage ; finaliserInscription et consommerInvitation refusent désormais le numéro technique admin. +2 tests de régression.
  - **Migrations non versionnées** : db/migrations/*.sql était dans .gitignore (un clone neuf ne pouvait pas migrer) → ligne retirée, 14 fichiers SQL désormais suivis (recommandation d'audit antérieure appliquée).
  - PWA : manifest + sw.js + icônes présents, enregistrement via src/lib/pwa.ts ; aucun dangerouslySetInnerHTML/eval. ✔
  - **Reste à trancher (boucle 8)** : ADMIN_PIN absent du .env → défaut « 2468 » actif en production (à définir, 8+ caractères) ; SESSION_SECRET absent → sessions invalidées à chaque redémarrage ; ANNUAIRE_DEMO=true sur le sandbox (démo publique assumée, à retirer à l'ouverture réelle) ; pas de limitation de débit sur inscription/achat de token (échelle quartier — acceptable pour l'instant).
- **Résultats (avant → après)** :
  - G1 tsc : vert. G2 tests : 216 → **224** attendus (+2 purs aTablesDeSalle, +1 inscription pharmacie 1 comptoir, +3 voirGestion, +2 collision/réservation numéro admin ; les 2 échecs auth révélés par l'audit corrigés). G4 : aucun secret ni console.log. G5 : seed inchangé. G6 : contrôle i18n vert (829 clés ×3).
  - ESLint projet : **16 problèmes / 14 erreurs — nouvelle référence documentée** (disable justifié de react-refresh/only-export-components dans store.tsx : 84 erreurs structurelles sans signal, 1 par fonction exportée du magasin ; sous l'ancienne baseline 100/98, 0 erreur ajoutée).
- **Décision** : UI billard + formulaire adaptatif + pharmacie comptoir + audit livrés. Prochaine étape : annexe étape 4 (hôtel/folio) ou boucle 8 (ADMIN_PIN/SESSION_SECRET production) selon « continue ».

## PROMPT MAÎTRE — Alignement : billard.declarerDefaite (automatisation Vincaire) + hôtel backend
- **Observer** : le prompt maître complet (téléversé) précise la règle Vincaire exacte : « c'est le PERDANT qui déclare lui-même sa défaite sur son téléphone (ou via l'écran) ; dès la défaite déclarée, le roi est destitué, le challenger promu roi et le match suivant immédiatement lancé ». L'app n'avait que la déclaration staff (« X gagne »). Le module hôtel (§4/§7 : checkIn/checkOut/marquerNettoyee, tables chambres + sejours) manquait entièrement.
- **Migration 0014 montrée avant application, puis appliquée** (drizzle-kit generate --name hotel-sejours + db:migrate, vérifié en base) : CREATE TABLE chambres (numéro unique par établissement, statut LIBRE/OCCUPEE/A_NETTOYER, prix nuit + prix heure nullable) ; CREATE TABLE sejours (client, pièce d'identité, mode NUIT/HEURE, montant calculé au check-out) + 4 index. Garde assurerSchema étendue (0006-0014, artefacts idempotents + hash).
- **Action** :
  - api/routers/billard.ts : `declarerDefaite` (public, session client) — le joueur EN_JEU déclare SA défaite ; transaction + FOR UPDATE ; gagnant série +1 (limite de série = comme terminerPartie) ; AUTOMATISATION immédiate : roi promu/conservé, 1er de file challenger EN_JEU sans appel, nouvelle partie EN_COURS ; perdant selon la règle (RACHAT → SORTI, peut racheter). Journalisé BILLARD_DEFAITE_DECLAREE. La voie staff (terminerPartie, appel supervisé) reste inchangée — « ou via l'écran ».
  - UI client : bouton « J'ai perdu — déclarer ma défaite » sur le ticket EN_JEU (confirmation danger) + 3 clés i18n ×3 (832 clés).
  - contracts/hotel.ts (NOUVEAU) : StatutChambre/ModeSejour, transitionChambreValide (cycle strict), montantSejourCdf (unités entamées, min 1 ; HEURE refusée sans prix horaire).
  - api/routers/hotel.ts (NOUVEAU) : voirChambres (état + séjour en cours, personnel seul), creerChambre (gérant/proprio, doublon refusé), checkIn (réception/gérant/proprio, transaction + FOR UPDATE, chambre LIBRE exigée), checkOut (montant calculé, double clôture refusée, chambre A_NETTOYER), marquerNettoyee (gouvernante/direction SEULES — contrôle croisé : qui loge ne déclare pas propre).
- **Bug de test révélé** : config billard par ÉTABLISSEMENT (FIN_FILE héritée du test précédent) — le scénario fixe désormais la règle au départ (déterminisme).
- **Résultats (avant → après)** :
  - G1 tsc : vert. G2 tests : 224 → **242** attendus (+6 purs hôtel, +7 API hôtel, +5 API declarerDefaite ; billard 22/22, hôtel 7/7 isolés). G4 : aucun secret ni console.log. G5 : seed inchangé (défauts schéma). G6 : contrôle i18n vert (832 ×3).
  - ESLint projet : 16 problèmes / 14 erreurs = référence exacte (0 ajoutée).
- **Décision** : alignement prompt maître livré côté serveur + défaite client. NON FAIT volontairement : l'UI hôtel (écran réception : check-in/out, gouvernante) — prochaine boucle ; le prompt maître §7 ne demandait que schéma + routes. L'automatisation du billard est côté client ; l'écran staff garde le lancement supervisé (les deux voies du prompt coexistent).

## Audit général n°2 (post-alignement prompt maître) — 3 failles corrigées

**Observer** : audit demandé après l'itération declarerDefaite + hôtel backend.
Secrets : propres (aucun côté client, .env non suivi, .env.example vierge).
Hygiène : tsc 0, ESLint 16/14 (référence inchangée), i18n 832×3 vert,
15 migrations toutes journalisées dans assurerSchema, seed idempotent
(onConflictDoNothing partout + onConflictDoUpdate sur la grille).

**3 failles réelles trouvées et corrigées** :
1. **Race double défaite (billard)** : deux joueurs déclarant leur défaite
   au même instant — la 2e transaction relisait la partie AVANT le verrou
   sans jamais revérifier son statut après FOR UPDATE → perdant
   ressuscité + partie fantôme EN_COURS. Correctif : relecture du statut
   APRÈS verrouillage, refus « partie déjà clôturée ».
2. **Pièce d'identité exposée (hôtel)** : voirChambres renvoyait le
   numéro de pièce d'identité à TOUT le personnel (serveuse comprise).
   Correctif : masqué hors réception/direction (pieceIdentite: null).
3. **Ménage validé en double (hôtel)** : deux gouvernantes simultanées →
   deux journaux « nettoyée ». Correctif : update conditionnel +
   returning, la seconde reçoit un refus explicite.

**Tests** : +2 régressions (déclarations simultanées des deux joueurs :
une seule passe, invariants vérifiés en base ; confidentialité pièce
d'identité réception vs serveuse). Ciblés 31/31 verts. Build vert.

**Reste à trancher** (inchangé, boucle 8) : ADMIN_PIN + SESSION_SECRET
à définir en production ; ANNUAIRE_DEMO à retirer à l'ouverture réelle ;
pas de rate-limit sur inscription/achat token ; UI hôtel à livrer.

## Boucle 6 — Durcissement production + Airtel Money manuel + export comptable + pilote

**Observer→agir→vérifier** (demande utilisateur en 6 points) :
1. **Durcissement** : verifierConfigProduction (fonction pure, 5 tests) —
   démarrage REFUSÉ en production si ADMIN_PIN absent/<8 car./« 2468 »,
   SESSION_SECRET absent/<32 car., ou ANNUAIRE_DEMO=true (auparavant
   simple avertissement). PIN super-admin toujours EN CLAIR en base
   (choix produit reconfirmé : jamais haché). Scan historique git :
   aucun secret, .env jamais commité.
2. **Inventaire base** (neondb, Neon us-east-2) : 15 fichiers de
   migration / 17 lignes drizzle (2 hash rejoués, sans effet —
   idempotent). espaces : INEXISTANTE (gel respecté, rien créé).
   sejours : existe (0014). folio_lignes : inexistante.
3. **Suite complète** : 249/253 — 4 échecs tous expliqués (3 tests
   purs chargés pendant l'édition concurrente, 1 test export avant
   application de la migration) ; relancés après : tous verts.
4. ESLint 98→14 : disable justifié react-refresh/only-export-components
   dans store.tsx (−84 erreurs structurelles). Les 14 restantes :
   fast-refresh (10), any (2), whitespace (1), purity (1).
5. **Remote git : AUCUN** — dépôt local seulement, rien de poussé.
   Nécessite les identifiants de l'utilisateur (GitHub/GitLab privé).
6. **Airtel Money flux manuel** : référence déclarée par le client à
   l'achat du token (format validé, normalisée majuscules), UNIQUE par
   établissement (index partiel, migration 0015 montrée puis appliquée),
   visible du caissier qui valide après vérification sur son téléphone.
   **Export comptable quotidien** : CSV (billard cash+Airtel, hôtel,
   commandes, dépenses, totaux + net), réservé direction, journalisé,
   bouton « Export CSV » dans la vue gérant. **PILOTE.md** : checklist
   de mise en production avec un établissement réel.
- UI hôtel : toujours NON livrée (ordre utilisateur respecté).
- Garde assurerSchema étendue 0006→0015. i18n 838 clés ×3. tsc vert,
  ESLint 16/14 exact, build vert. Tests : purs 13/13, Airtel 5/5,
  hôtel+config+export verts (55/55 au run ciblé post-migration).

## Boucle 9 — UI hôtel : réception & ménage (après backend boucle 8)

**Observer** : backend prêt (chambres, sejours, checkIn/checkOut/
marquerNettoyee) mais aucun écran — le réceptionniste et la
gouvernante ne pouvaient pas cliquer. Rôles RECEPTIONNISTE et
GOUVERNANTE existaient en RBAC mais aboutissaient à la vue serveuse.

**Agir** :
- src/views/Hotel.tsx : grille à code couleur strict (VERT libre /
  ROUGE occupée / JAUNE à nettoyer), feuille d'action par statut —
  check-in (nom + pièce d'identité + nuitée/heure), check-out avec
  montant ESTIMÉ affiché avant confirmation (même calcul pur
  @contracts/hotel que le serveur ; le montant facturé reste celui du
  backend), « Marquer comme propre » réservé à la gouvernante/direction
  (contrôle croisé), création de chambre (direction). 3 modes :
  direction / reception / menage. Rafraîchissement 4 s.
- Route /h (VueHotel) : porte RECEPTIONNISTE + GOUVERNANTE ; routage
  connexion et invitation mis à jour (4 destinations).
- Onglet « Hôtel » dans Proprio et Gerant (type GUEST_HOUSE uniquement,
  mode direction : toutes actions + création).
- i18n : 875 clés ×3 (+37).

**Vérifier** : tsc vert ; ESLint 16/14 exact (0 ajoutée — l'erreur
purity Proprio.tsx est la baseline connue) ; i18n vert ; tests purs
93/93 ; hotel-api 9/9 ; build vert. Aucune migration (schéma boucle 8
inchangé) ; espaces/folio_lignes toujours inexistantes (gel respecté).

## Boucle 10 — Documentation décisions : payer pour quelqu'un, PIN, taux, traiteur

**Observer** : quatre décisions produit à figer AVANT tout code —
voie serveuse pour « Payer pour quelqu'un », correctif PIN (alerte
titulaire supprimée), règle taux de change par établissement, module
traiteur multi-composants. Cadre : migration montrée avant application.

**Agir** (documentation + contrat pur SEULEMENT, zéro migration) :
- docs/ANNEXE-3-payer-pour-quelquun.md : voie serveuse PAR DÉFAUT —
  demande sur l'écran de la serveuse de zone (lignes + total, jamais
  d'identité ni de téléphone du payeur), accord de la bénéficiaire
  elle-même, seuls serveuse de zone + gérant enregistrent, note ouverte
  si absente / note vide refusée, lignes figées à l'acceptation,
  expiration N min → gérant, alerte anti-abus, journal d'audit complet.
- docs/DECISION-PIN.md : 9 règles ; point 4 « alerte au titulaire »
  SUPPRIMÉ (ni implémenté ni prévu). Reste : AES-256-GCM, PIN_ENC_KEY
  obligatoire en prod, masqué + « Afficher » 30 s, vérification
  d'identité, limite/heure, audit immuable, PIN jamais journalisé.
- docs/REGLE-TAUX-CHANGE.md + docs/migrations-proposees/0016-* :
  migration PROPOSÉE NON APPLIQUÉE (volontairement hors db/migrations/).
  Plan ventes existantes : taux NULL = « taux d'époque », aucune
  conversion rétroactive. contracts/taux.ts : logique pure (bornes,
  alertes variation 5 % / fréquence 3 par jour, équivalent affichage,
  libellé client). Correctif coquille alerteVariationPct (test rouge).
- docs/MODULE-TRAITEUR.md : schéma proposé 9 tables (sous-recettes
  prévues v2, jamais en v1), calculs en unité de base entière, bons
  sans prix, montants invisibles gérant/chef/magasinier. Cas poulet
  200 p. vérifiés : 404,00 $/jour, 2,020 $/pers, marge 196,00 $ =
  32,67 %, sans boisson 344,00 $, sel 200 g exacts.

**Vérifier** : tsc vert ; ESLint 16/14 exact (0 ajoutée) ; tests purs
110/110 (taux.test.ts 17/17 après correctif) ; build vert. Aucune
migration appliquée ; espaces et tarification intouchées (gel).

## Boucle 11 — Taux de change : migration 0016 sur branche + endpoints + figeage

**Observer** : la règle taux exigeait UNE colonne nullable — or
`terrasses.taux_change` existait déjà (NOT NULL, défaut 2800, usage
affichage seul). Deux colonnes = confusion garantie.

**Agir** :
- Migration 0016 (db/migrations/) : RENAME taux_change → taux_usd_cdf
  (valeurs conservées), DROP NOT NULL + DROP DEFAULT (NULL =
  mono-devise), 3 colonnes de seuils par établissement (variation 5 %,
  3 changements/jour, plafond 10 000 FC), colonnes de figeage NULLABLES
  SANS défaut sur commandes/tokens/sejours — aucune réécriture des
  ventes existantes.
- docs/migrations-proposees/ supprimé (version unique = db/migrations).
- Router taux : voir (tout membre) / modifier (proprio + gérant DE CET
  ÉTABLISSEMENT via exigerGerantOuProprio — un gérant d'un autre
  établissement est refusé et journalisé). Bornes via le contrat pur,
  journal TAUX_MODIFIE (avant/après) dans audit_log (aucun endpoint
  d'écriture — non modifiable), alertes TAUX_VARIATION / TAUX_FREQUENCE.
- Figeage : tauxCourantDb() lu à la création des commandes (validation
  client), tokens (guichet et comptoir) et séjours (check-in).
- UI : chip taux et équivalent FC de l'abonnement masqués si NULL
  (aucune clé i18n ajoutée). Création d'établissement : taux NULL par
  défaut (mono-devise) ; fixtures démo conservées à 2800.
- MODULE-TRAITEUR.md complété : comptage À L'AVEUGLE (la quantité
  théorique jamais affichée au compteur) + écarts EN QUANTITÉ pour
  gérant/chef/magasinier (valeur réservée au propriétaire) + table
  traiteur_comptages au schéma proposé.
- Branche Neon : pas d'API key ni MCP configuré → CREATE DATABASE
  gbs_br_0016 (isolation par base séparée), migrations 0000→0016
  appliquées, suite complète lancée contre la branche uniquement.
  Base principale INTACTE en attendant la validation.

**Vérifier** : tsc vert ; ESLint 16/14 exact (0 ajoutée) ; schéma
branche conforme (taux nullable sans défaut partout, base vierge) ;
build vert. Suite complète : résultat rapporté dans la réponse.

## Investigation (lecture seule) — PWA qui « disparaît » chaque jour à 00h00

**Observer** : téléphone du propriétaire — l'app installée disparaît de
l'écran vers 00h00 locale, le téléphone propose de la réinstaller.
Investigation en lecture seule, AUCUN code modifié.

**Faits établis (code)** :
- Manifeste : public/manifest.webmanifest STATIQUE, id/start_url/scope
  = « / », icônes fixes — aucune valeur datée ou versionnée, servi tel
  quel en dev et en prod. Identité PWA stable.
- SW (public/sw.js + scripts/versionner-sw.mjs) : version = empreinte
  du contenu (change au build, pas à minuit) ; aucun code horaire ;
  caches.delete limité aux anciennes versions gbs-* ; pas de
  skipWaiting automatique ; jamais de cache /api/*.
- AUCUN déclencheur à minuit dans le code (ni client, ni SW, ni
  serveur — grep Date/cron/setInterval/clear/unregister exhaustif) :
  le déclencheur horaire est EXTERNE à l'app.
- unregister() + caches.delete() existent dans
  src/lib/recuperation.ts (récupération chunk disparu, UNE fois) —
  déclenchés uniquement sur vite:preloadError ou action utilisateur.
- Bannière d'installation : AUCUN beforeinstallprompt dans le code —
  la proposition de réinstallation vient de Chrome, pas de l'app.
- Persistance : navigator.storage.persist() JAMAIS appelé → stockage
  « best effort », purgeable par Android/Chrome (maintenance nocturne).
- File hors-ligne « gbs.outbox » en localStorage (Client.tsx:33) —
  perdue si le stockage est purgé (réinstallation = commandes en
  attente perdues).
- Session : jeton HMAC FIXE 12 h (api/lib/session.ts:22, non
  renouvelé à l'usage) ; au 401 le client coupe la session et revient
  à la connexion (store.tsx:55-59). Si SESSION_SECRET est absent en
  production, un secret aléatoire est généré au démarrage → TOUTES
  les sessions meurent à chaque redémarrage du serveur.
- Fuseau : serveur 100 % UTC (maintenant().slice(0,10)) — le jour
  serveur bascule à 02h00 heure de Lubumbashi : risque réel pour la
  caisse du jour et les rapports (indépendant du symptôme). Client :
  jourLubu() correct (Africa/Lubumbashi).

**Hypothèses classées** (déclencheur externe + fragilités internes) :
1. Purge nocturne du stockage par Android/Chrome (non persistant) —
   retire le WebAPK quand les données du site sont effacées. Fenêtre
   de maintenance ≈ minuit. La plus compatible avec le symptôme.
2. Revalidation quotidienne du WebAPK par Chrome contre un serveur de
   PREVIEW qui dort/redémarre la nuit (manifeste ou start_url
   injoignable → WebAPK désinstallé).
3. Expiration du jeton 12 h fixe : connexion à midi → déconnexion à
   00h00 (écran de connexion, pas disparition d'icône à elle seule).
4. SESSION_SECRET absent sur la plateforme de preview → sessions
   invalidées à chaque redémarrage nocturne du serveur.

**Corrections proposées (NON appliquées)** :
1. navigator.storage.persist() au démarrage (pwa.ts).
2. Outbox → IndexedDB (unifiée avec le stockage persisté).
3. Session glissante (réémission si < 6 h restantes) ou durée portée
   à 24-72 h pour la direction — décision produit.
4. Jour comptable Africa/Lubumbashi côté serveur (helper partagé).
5. Pilote sur hébergement always-on + SESSION_SECRET défini (déjà
   exigé par verifierConfigProduction) + manifeste toujours 200.

**Tests de régression proposés** : horloge simulée (vi.setSystemTime)
pour l'expiration 12 h et le jour comptable local ; mock
storage.persist ; outbox survie à la purge localStorage.

## Boucle 12 — Correctifs « disparition à 00h00 » (1, 2, 4) + garde production

- **(a) Garde production** : `assurerSchema` n'applique plus AUCUNE migration en production — vérification lecture seule des 13 artefacts 0006→0016, démarrage refusé avec message explicite si l'un manque. Dev/test inchangés. Test pur de `artefactsManquants` (complet/vide/sans 0016). Commit 4fb15b0. La base principale reste SANS la 0016 (vérifié : `taux_change` présente, journal = 0015).
- **Correctif 1** : `navigator.storage.persist()` demandé UNE fois au premier lancement (`demanderPersistanceStockage` dans pwa.ts, drapeau `gbs.persistDemandee`, log console discret, jamais bloquant). 5 tests (pwa-persist.test.ts). Commit 0761b8a.
- **Correctif 2** : file hors-ligne localStorage → IndexedDB (`src/lib/outbox.ts`, store keyPath `cle` = clé d'idempotence déjà reconnue par le serveur). Import unique et sans perte (écriture avant suppression ; JSON illisible → clé de sauvegarde, jamais détruit) ; repli localStorage si IndexedDB absent ; ErreurEcran lit la file en asynchrone. 6 tests (outbox.test.ts, fake-indexeddb) dont « survit à la fermeture/réouverture » et « import des anciennes entrées ». Commit e203038.
- **Correctif 3 (jour comptable Lubumbashi)** : inventaire des fonctions livré, application EN ATTENTE de validation.
- **Correctif 4** : docs/SESSION-GLISSANTE.md — variante glissante (inactivité 12 h, absolu 7 jours configurable, révocation par appareil, risques R1-R4, retour arrière par drapeau). NON appliquée. Commit dcbbc8c.
- **(c)** : bundle git complet `/mnt/agents/output/gbs-repo.bundle` (vérifié) + paire SSH ed25519 de déploiement générée (clé publique livrée dans le chat, privée en fichier).
- Gates : tsc propre ; ESLint 16 problèmes / 14 erreurs = baseline (0 ajoutée) ; 11 tests ajoutés, tous verts.

## Boucle 12 (suite) — Audit avant livraison

- BLOQUANT B1 confirmé par requête directe : la base principale est à la 0015 (aucune colonne taux_usd_cdf) alors que le code sélectionne/insère tauxUsdCdf partout (snapshot compris) → production en panne tant que la 0016 n'est pas appliquée explicitement.
- Majeurs : garde de schéma avalée par le try/catch du boot (M1), jour comptable UTC en attente du feu vert (M2), session fixe 12 h (M3), PIN admin en sessionStorage (M4, CSP atténue), CSP connectSrc 'self' bloquera Sentry navigateur (M5).
- Forts : secrets, en-têtes, PIN/jetons hygiène, RBAC relus en base, 9 transactions + 15 verrous, PWA complète, index DB, garde-fou config production.
- Suite complète UNE fois (branche gbs_br_0016) : 35 fichiers, 300 tests, 299 réussis / 1 échoué (1 414,55 s) — échec = régression du correctif 2 sur ErreurEcran, corrigée (8/8), commit dédié.
- Rapport complet : docs/AUDIT-LIVRAISON.md.

## Boucle 12 (fin) — Produit final

- (b) 0016 rejouable : rename encadré + IF NOT EXISTS ; testée sur base peuplée (valeurs conservées, rejeu no-op, rollback, ré-application) ; retour arrière documenté (0016_rollback.sql). Hash mis à jour dans assurerSchema. Commit a5e3978.
- B1 RÉSOLU : 0016 appliquée à la base principale (npm run db:migrate) et vérifiée (4 colonnes nullable sans défaut, config 5/3/10000, journal c03d2f2f).
- M1 : garde de schéma fatale en production (process.exit 1 si migration manquante ; base injoignable reste non fatale). M5 : CSP connectSrc + domaines Sentry. Commit 066fef3.
- Correctif 3 APPLIQUÉ : jourComptable + plageUtcDuJourLocal ; 11 filtres LIKE → plages gte/lt (comptabilite ×4, billard ×6, taux ×1) ; horodatages UTC inchangés. 8 tests horloge (23h59/00h01/01h59/02h01 + nuit à cheval) ; API billard/taux/hôtel 51/51. Commit 046e75d.
- ESLint baseline : 14 erreurs + 2 avertissements → 0 (any typés, espaces insécables échappées, horloge d'état dans Pilotage, deps d'effets complètes, override react-refresh justifié pour i18n/providers/ui). Commit f9c41e2.
- Session glissante : NON appliquée (choix réservé au propriétaire du produit, docs/SESSION-GLISSANTE.md).
- Phase 0 bis : reconciliation git — sandbox = reference (finalisation = main + 60 commits, 0 en retard, aucun remote) ; bundle gbs-repo-complet.bundle genere et verifie ; cle de deploiement SSH ed25519 generee (publique seule a ajouter au depot prive).
- Boucle 10 Phase 0 : principale neondb = 36 tables, journal drizzle 19 lignes, 0016+0017 presentes, 24 etablissements non demo (majorite = saisies manuelles de test via l'UI) ; branche gbs_br_0016 = 36 tables, journal vide (migrations appliquees a la main), 0 etablissement non demo. Table « espaces » : absente des deux bases.
- Session glissante LIVREE (migration 0017 sur les 2 bases, API + client + 14 tests) — flag SESSION_GLISSANTE=0 pour retour arriere ; rapports periode + export complet (PIN exclu) ; ticket client 80 mm + WhatsApp ; swahili 896 cles (9/9). Commits 585de20..137cd0a.
- Deflakisation tests : hotel-api utilisait le jour UTC au lieu du jour comptable (echec 22h-00h UTC) ; taux-api dependait de 4 changements repartis sur le fichier (minuit Lubumbashi). 23/23.
- CONSTAT Phase 1 : assurerSchema applique du DDL au demarrage (ALTER/CREATE IF NOT EXISTS) — a desactiver en production (regle 2 boucle 10), garde fatale conservee.
- ESSAI LOCAL (avant production) : ESSAI A base vierge OK (18 migrations rejouees, 36 tables, rejeu idempotent, seed 992 articles + 6 etablissements demo) ; ESSAI B copie production 2 363 lignes -> anonymisation (65/65 PIN/telephones/noms masques) -> 0017 reJouee sur donnees peuplees -> restauration apres crash simule OK. Suite complete 324/325 (l'echec = mon nouveau test de concurrence mal borne, corrige, 13/13 en cible). 9 cas de demarrage production joues (6 refus + acceptations correctes). DEFAUT D1 corrige : marquerPayee non atomique -> UPDATE conditionnel (double audit impossible). D2/D3 presentes au proprietaire (journal production, DDL au demarrage). Guide docs/ESSAI-LOCAL.md + journal-essai-local.md. Commits 61aeabd, d5e92bb, cc76673.
- BOUCLE FINALE (decisions validees) : D3 CONSTATS corriges — assurerSchema est DEJA conforme (production = verification seule + refus fatal, DDL hors production uniquement) ; preuve reelle : boot production sur scratch prive de sessions_appareils => refus « Migrations manquantes en production » ; temoin sur la base reelle => « schema verifie (lecture seule, 0006-0017 presents) ». D2 PREPARE et TESTE sur scratch (simulation 19 lignes/17 hash -> assainissement 18/18 -> rollback exact, ids restaures) : commandes pretes, execution production en attente de la confirmation de sauvegarde. 3.2 IMPLEMENTE : PIN AES-256-GCM v1:nonce:tag:corps, PIN_ENC_KEY 64 hex obligatoire et distincte de SESSION_SECRET (refus de demarrage), super-admin chiffre, transition transparente scrypt/clair -> v1 a la connexion, jamais de hachage ni de clair. Espace super-admin « Mot de passe oublie » : recherche par telephone, PIN masque, « Afficher » 30 s, methode de verification obligatoire (APPEL/WHATSAPP/PRESENTIEL), quota 20/h, journal immuable sans le PIN. Inventaire production : 65 comptes = 52 scrypt + 13 clair + 0 chiffre ; AUCUN compte reinitialise (transition transparente au login ; plan presente, en attente d'accord). Bases d'essai a donnees reelles : toutes supprimees (ne restent que neondb, gbs_br_0016 synthetique, postgres) ; aucune copie non masquee sur disque. c438747 = arbre EXACT d'e302684 (diff vide, rien perdu). Suite complete UNE fois apres toutes corrections : 38 fichiers, 337 tests, 337 REUSSIS (1 476,62 s). tsc = 0 erreur, ESLint = 0 erreur. Commits 9e5dc38, 716928c.
- BOUCLE FINALE (suite) : D2 CORRIGE — INSERT de la 0017 au « when » canonique de meta/_journal.json (1792445318121) au lieu de now() ; re-teste sur base peuplee jetable : assainissement 18/18, retour arriere exact, migration future (when = 0017 + 1 s, anterieure a now()) APPLIQUEE — et contre-preuve : avec now(), elle est SAUTEE silencieusement (piege confirme, evite). Scripts livres : scripts/d2-assainissement-journal.sql + d2-retour-arriere.sql (execution par le proprietaire). Script scripts/chiffrer-pins-clairs.ts : simulation par defaut, --executer (transaction verifiee un a un), --retour-arriere teste, idempotent, AUCUN PIN dans les journaux — teste sur base jetable (2 clair chiffres, scrypt/v1 intacts, dechiffrement exact). Espace super-admin : reinitialiserPin ajoute (PIN 6 chiffres genere, stocke chiffre, affiche 30 s, methode obligatoire, quota 20/h, REINITIALISATION_PIN sans le PIN) + test 13/13. HYGIENE FINALE : DATABASE_URL de production purge du sandbox (.env en placeholder, aucune trace dans fichiers/tmp/historiques/git/bundles — verifie par grep exhaustif) ; cles privees SSH supprimees (gbs-deploy-key + gbs_deploy_key_privee*), historique git 122 commits sans « PRIVATE KEY » ; bases : neondb + gbs_br_0016 (synthetique) + postgres uniquement. Deploiement : render.yaml (Blueprint, sync:false pour les secrets) + docs/DEPLOIEMENT-RENDER.md (build npm ci && npm run build, start npm start, healthcheck /api/trpc/ping, Frankfurt, Starter, variables documentees, retour arriere). README : regle de depot des tests (prefixe de fixtures unique). tsc 0, ESLint 0, i18n 9/9.
