import { createTRPCReact } from "@trpc/react-query";
import { httpBatchLink } from "@trpc/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import superjson from "superjson";
import type { AppRouter } from "../../api/router";
import type { ReactNode } from "react";
import { enteteAuth } from "@/lib/sessionLocale";
import { fetchAvecEtag } from "@/lib/fetchEtag";

export const trpc = createTRPCReact<AppRouter>();

const queryClient = new QueryClient();
const trpcClient = trpc.createClient({
  links: [
    httpBatchLink({
      url: "/api/trpc",
      transformer: superjson,
      // Jeton de session (Authorization: Bearer) sur chaque requête
      headers: enteteAuth,
      // ETag/304 sur les snapshots : rejoue la réponse mémorisée
      // quand rien n'a changé côté serveur (voir fetchEtag.ts)
      fetch: fetchAvecEtag,
    }),
  ],
});

export function TRPCProvider({ children }: { children: ReactNode }) {
  return (
    <trpc.Provider client={trpcClient} queryClient={queryClient}>
      <QueryClientProvider client={queryClient}>
        {children}
      </QueryClientProvider>
    </trpc.Provider>
  );
}
