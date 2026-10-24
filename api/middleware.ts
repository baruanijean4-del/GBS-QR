import { initTRPC, TRPCError } from "@trpc/server";
import superjson from "superjson";
import type { TrpcContext } from "./context";
import { traduireMessage } from "./lib/traductionServeur";

const t = initTRPC.context<TrpcContext>().create({
  transformer: superjson,
  // Messages d'erreur dans la langue du client (x-lang) ; français sinon.
  errorFormatter({ error, shape, ctx }) {
    const langue = ctx?.langue ?? "fr";
    // Saisie invalide (Zod) : jamais le JSON technique à l'écran
    const message = error.cause?.name === "ZodError"
      ? traduireMessage("Données invalides — vérifiez les champs saisis.", langue)
      : traduireMessage(shape.message, langue);
    return { ...shape, message };
  },
});

export const createRouter = t.router;
export const publicQuery = t.procedure;

/**
 * Garde « session requise » : refuse avec 401 (UNAUTHORIZED) si la requête
 * ne présente pas de jeton signé valide. Après ce middleware, le corps des
 * procédures utilise ctx.session.utilisateurId — jamais un acteurId fourni
 * par le client.
 */
const exigerSession = t.middleware(({ ctx, next }) => {
  if (!ctx.session) {
    throw new TRPCError({
      code: "UNAUTHORIZED",
      message: "Session expirée ou invalide — reconnectez-vous.",
    });
  }
  return next({ ctx: { ...ctx, session: ctx.session } });
});

/** Procédure réservée au personnel connecté (jeton Bearer vérifié) */
export const protegee = publicQuery.use(exigerSession);
