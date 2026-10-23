import { createRouter, publicQuery } from "./middleware";
import { gbsRouter } from "./gbsRouter";
import { etablissementsRouter } from "./routers/etablissements";
import { catalogueRouter } from "./routers/catalogue";
import { produitsRouter } from "./routers/produits";
import { billardRouter } from "./routers/billard";
import { hotelRouter } from "./routers/hotel";
import { comptabiliteRouter } from "./routers/comptabilite";
import { tauxRouter } from "./routers/taux";
import { notesRouter } from "./routers/notes";
import { traiteurRouter } from "./routers/traiteur";
import { remisesRouter } from "./routers/remises";

export const appRouter = createRouter({
  ping: publicQuery.query(() => ({ ok: true, ts: Date.now() })),
  gbs: gbsRouter,
  etablissements: etablissementsRouter,
  catalogue: catalogueRouter,
  produits: produitsRouter,
  billard: billardRouter,
  hotel: hotelRouter,
  comptabilite: comptabiliteRouter,
  taux: tauxRouter,
  notes: notesRouter,
  traiteur: traiteurRouter,
    remises: remisesRouter,
});

export type AppRouter = typeof appRouter;
