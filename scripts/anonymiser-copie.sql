-- ============================================================
-- GBS — Anonymisation d'une COPIE de production (essais locaux).
--
-- À jouer UNIQUEMENT sur une copie issue d'une sauvegarde
-- (branche Neon jetable, dump restauré en local) — JAMAIS sur la
-- base vivante. Le garde-fou scripts/reinit-base-locale.mjs et
-- api/lib/gardeLocale.ts bloquent déjà toute URL neon.tech en
-- local ; ce script suppose une base PostgreSQL locale.
--
-- Après passage : aucun nom, téléphone, PIN ni numéro de pièce
-- d'identité réel ne subsiste dans la copie. Les PIN sont
-- remplacés par un placeholder inutilisable (la copie sert aux
-- essais métier, pas aux connexions réelles — les comptes démo du
-- seed fournissent des accès de test).
-- ============================================================

BEGIN;

-- Comptes : nom, téléphone et PIN masqués (placeholder commun,
-- inutilisable pour se connecter — ce n'est pas un PIN réel).
UPDATE utilisateurs u SET
  nom = 'Utilisateur ' || left(md5(u.id), 6),
  telephone = '+24300' || lpad(seq.rn::text, 7, '0'),
  pin = 'PIN_MASQUE'
FROM (SELECT id, row_number() OVER (ORDER BY id) AS rn FROM utilisateurs) seq
WHERE seq.id = u.id;

-- Prénoms des sessions clients (QR) et des tokens billard.
UPDATE clients_session SET prenom = 'Client-' || left(md5(id), 6);
UPDATE tokens SET prenom = 'Client-' || left(md5(id), 6);

-- Séjours hôtel : nom du client masqué, pièce d'identité effacée.
UPDATE sejours SET
  client_nom = 'Client ' || left(md5(id), 6),
  piece_identite = NULL;

-- Journal d'audit : séquences de chiffres type téléphone masquées.
-- LIMITE CONNUE : un nom propre dans le texte libre n'est pas
-- détectable automatiquement — relire un échantillon avant tout
-- partage de la copie hors de l'équipe.
UPDATE audit_log
SET details = regexp_replace(details, '[+]?[0-9][0-9 .-]{6,}[0-9]', '***', 'g')
WHERE details IS NOT NULL;

COMMIT;
