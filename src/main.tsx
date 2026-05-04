import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider } from "react-router-dom";
import { QueryClientProvider } from "@tanstack/react-query";
import { AuthProvider } from "@/auth/AuthProvider";
import { router } from "@/app/router";
import { queryClient } from "@/lib/queryClient";
import { ToastProvider } from "@/shared/ui/Toaster";
import "@/styles/globals.css";

// Defensive: Supabase recovery emails should redirect to /reset-password,
// but if URL Configuration is misconfigured Supabase falls back to the
// Site URL root and strands the user on the dashboard with a recovery
// session. Detect "type=recovery" in the hash and bounce before React
// mounts so the supabase-js detectSessionInUrl handler runs on the right
// page. We preserve the hash exactly so tokens survive the bounce.
if (
  window.location.hash.includes("type=recovery") &&
  window.location.pathname !== "/reset-password"
) {
  window.location.replace("/reset-password" + window.location.hash);
}

const root = document.getElementById("root");
if (!root) throw new Error("#root element missing from index.html");

createRoot(root).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <AuthProvider>
          <RouterProvider router={router} />
        </AuthProvider>
      </ToastProvider>
    </QueryClientProvider>
  </StrictMode>
);
