// ============================================================
// GBS — Garde-fou de configuration PRODUCTION (boucle 8).
// Fonction PURE (aucune entrée/sortie) : appelée par api/lib/env.ts
// uniquement quand NODE_ENV=production. Le serveur refuse de
// démarrer tant qu'une exigence n'est pas remplie :
//   - ADMIN_PIN obligatoire, 8+ caractères, différent du défaut de
//     développement (« 2468 »). Choix produit assumé : ce PIN reste
//     stocké EN CLAIR en base (jamais haché) — d'où l'exigence de
//     longueur et d'unicité.
//   - SESSION_SECRET obligatoire, 32+ caractères (sinon les sessions
//     seraient signées avec un secret aléatoire perdu à chaque
//     redémarrage — tous les utilisateurs déconnectés).
//   - ANNUAIRE_DEMO interdit (les comptes de démonstration et leurs
//     PIN ne doivent jamais apparaître sur une instance réelle).
// ============================================================

export interface ConfigProductionAVerifier {
  adminPin: string;
  sessionSecret: string;
  annuaireDemo: string;
  pinEncKey: string;
}

/** Lance une erreur explicite par exigence non remplie. */
export function verifierConfigProduction(c: ConfigProductionAVerifier): void {
  if (!c.adminPin) {
    throw new Error(
      "PRODUCTION : ADMIN_PIN est obligatoire (PIN super-admin, 8+ caractères). Démarrage refusé.",
    );
  }
  if (c.adminPin.length < 8 || c.adminPin === "2468") {
    throw new Error(
      "PRODUCTION : ADMIN_PIN doit faire 8+ caractères et ne pas être le défaut de développement. Démarrage refusé.",
    );
  }
  if (!c.sessionSecret || c.sessionSecret.length < 32) {
    throw new Error(
      "PRODUCTION : SESSION_SECRET est obligatoire (32+ caractères aléatoires, ex. openssl rand -hex 32). Démarrage refusé.",
    );
  }
  if (!c.pinEncKey || !/^[0-9a-f]{64}$/i.test(c.pinEncKey)) {
    throw new Error(
      "PRODUCTION : PIN_ENC_KEY est obligatoire (64 caractères hexadécimaux = 32 octets, " +
        "ex. openssl rand -hex 32) — sans elle, les PIN chiffrés AES-256-GCM sont illisibles. Démarrage refusé.",
    );
  }
  if (c.pinEncKey === c.sessionSecret) {
    throw new Error(
      "PRODUCTION : PIN_ENC_KEY doit être DISTINCTE de SESSION_SECRET " +
        "(deux secrets, deux rôles). Démarrage refusé.",
    );
  }
  if (c.annuaireDemo === "true") {
    throw new Error(
      "PRODUCTION : ANNUAIRE_DEMO est interdit — retirez cette variable avant l'ouverture au public. Démarrage refusé.",
    );
  }
}
