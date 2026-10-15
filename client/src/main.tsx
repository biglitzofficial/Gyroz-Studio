import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider } from "react-router-dom";
import { FeedbackLayer } from "@/components/feedback";
import { AuthProvider } from "@/lib/auth";
import { mutationCache } from "@/lib/feedback";
import { router } from "@/router";
import "./index.css";

const queryClient = new QueryClient({
  mutationCache,
  defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false, staleTime: 5000 } },
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <RouterProvider router={router} />
        <FeedbackLayer />
      </AuthProvider>
    </QueryClientProvider>
  </StrictMode>,
);
