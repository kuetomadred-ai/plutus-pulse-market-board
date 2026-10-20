import { createFileRoute, redirect } from "@tanstack/react-router";

// Keep the imported preview's /index URL compatible with the canonical home page.
export const Route = createFileRoute("/index_")({
  beforeLoad: () => {
    throw redirect({ to: "/", replace: true });
  },
});